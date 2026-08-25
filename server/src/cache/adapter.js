// ============================================================================
// Redis 缓存抽象层 — CacheAdapter + MemoryCacheAdapter / RedisCacheAdapter
// 对齐实施计划 1.2（特征缓存 TTL）、1.3（规则缓存 TTL）。
// 默认使用 MemoryCacheAdapter（零依赖），配置 REDIS_URL 后自动切换 Redis。
// ============================================================================
'use strict';

const { defaultLogger } = require('../lib/logger');

const DEFAULT_TTL_MS = 60 * 1000;

/**
 * 缓存记录包装
 * @template T
 */
class CacheEntry {
  /** @param {T} value @param {number} [ttlMs] */
  constructor(value, ttlMs) {
    this.value = value;
    this.expiresAt = ttlMs ? Date.now() + ttlMs : Infinity;
  }
  get alive() { return Date.now() < this.expiresAt; }
}

/**
 * 缓存适配器接口（抽象基类）
 */
class CacheAdapter {
  /**
   * @param {string} key
   * @returns {Promise<T | undefined>}
   */
  async get(key) { throw new Error('not_implemented'); }

  /**
   * @param {string} key
   * @param {T} value
   * @param {number} [ttlMs]
   */
  async set(key, value, ttlMs) { throw new Error('not_implemented'); }

  /** @param {string} key */
  async del(key) { throw new Error('not_implemented'); }

  /** 清空所有缓存 */
  async clear() { throw new Error('not_implemented'); }

  /** @returns {Promise<number>} 当前缓存条目数 */
  async size() { throw new Error('not_implemented'); }

  /**
   * 获取缓存，未命中时通过 factory 生成并缓存
   * @param {string} key
   * @param {() => Promise<T>} factory
   * @param {number} [ttlMs]
   * @returns {Promise<T>}
   */
  async getOrSet(key, factory, ttlMs) {
    const existing = await this.get(key);
    if (existing !== undefined) return existing;
    const value = await factory();
    await this.set(key, value, ttlMs);
    return value;
  }
}

/**
 * 内存缓存适配器（零依赖，默认使用）
 * @template T
 */
class MemoryCacheAdapter extends CacheAdapter {
  /** @param {{ defaultTtlMs?: number, logger?: object } } [opts] */
  constructor({ defaultTtlMs = DEFAULT_TTL_MS, logger = defaultLogger } = {}) {
    super();
    this.defaultTtlMs = defaultTtlMs;
    this.logger = logger;
    /** @type {Map<string, CacheEntry<T>>} */
    this._map = new Map();
    this._timer = setInterval(() => this._evict(), 30_000).unref();
  }

  async get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (!entry.alive) {
      this._map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key, value, ttlMs) {
    this._map.set(key, new CacheEntry(value, ttlMs ?? this.defaultTtlMs));
  }

  async del(key) {
    this._map.delete(key);
  }

  async clear() {
    this._map.clear();
  }

  async size() {
    return this._map.size;
  }

  _evict() {
    const now = Date.now();
    for (const [key, entry] of this._map) {
      if (now >= entry.expiresAt) this._map.delete(key);
    }
  }
}

/**
 * Redis 缓存适配器（需要 ioredis）
 * @template T
 */
class RedisCacheAdapter extends CacheAdapter {
  /**
   * @param {object} redis ioredis 实例
   * @param {{ defaultTtlMs?: number, prefix?: string, logger?: object } } [opts]
   */
  constructor(redis, { defaultTtlMs = DEFAULT_TTL_MS, prefix = 'oe:cache:', logger = defaultLogger } = {}) {
    super();
    this.redis = redis;
    this.defaultTtlMs = Math.ceil(defaultTtlMs / 1000);
    this.prefix = prefix;
    this.logger = logger;
  }

  _key(k) { return this.prefix + k; }

  async get(key) {
    try {
      const raw = await this.redis.get(this._key(key));
      if (raw == null) return undefined;
      return JSON.parse(raw);
    } catch (e) {
      this.logger.warn('cache_redis_get_error', { key, error: e.message });
      return undefined;
    }
  }

  async set(key, value, ttlMs) {
    try {
      const ttl = ttlMs != null ? Math.ceil(ttlMs / 1000) : this.defaultTtlMs;
      const raw = JSON.stringify(value);
      if (ttl > 0) {
        await this.redis.setex(this._key(key), ttl, raw);
      } else {
        await this.redis.set(this._key(key), raw);
      }
    } catch (e) {
      this.logger.warn('cache_redis_set_error', { key, error: e.message });
    }
  }

  async del(key) {
    try {
      await this.redis.del(this._key(key));
    } catch (e) {
      this.logger.warn('cache_redis_del_error', { key, error: e.message });
    }
  }

  async clear() {
    try {
      const stream = this.redis.scanStream({ match: this.prefix + '*' });
      for await (const keys of stream) {
        if (keys.length) await this.redis.del(...keys);
      }
    } catch (e) {
      this.logger.warn('cache_redis_clear_error', { error: e.message });
    }
  }

  async size() {
    try {
      return await this.redis.exists(this.prefix + '*');
    } catch { return 0; }
  }
}

/**
 * 创建缓存适配器（自动检测 Redis 可用性）
 * @param {{ redisUrl?: string, redis?: object, defaultTtlMs?: number, logger?: object }} [opts]
 * @returns {Promise<CacheAdapter>}
 */
async function createCacheAdapter(opts = {}) {
  const { redisUrl, redis, defaultTtlMs, logger = defaultLogger } = opts;

  if (redis) {
    logger.info('cache_using_redis_instance');
    return new RedisCacheAdapter(redis, { defaultTtlMs, logger });
  }

  if (redisUrl) {
    try {
      const { default: IORedis } = require('ioredis');
      const client = new IORedis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) { return Math.min(times * 200, 3000); },
        lazyConnect: true,
      });
      await client.connect();
      logger.info('cache_redis_connected', { url: redisUrl.replace(/\/\/.*@/, '//***@') });
      return new RedisCacheAdapter(client, { defaultTtlMs, logger });
    } catch (e) {
      logger.warn('cache_redis_unavailable_fallback_memory', { error: e.message });
    }
  }

  logger.info('cache_using_memory_adapter');
  return new MemoryCacheAdapter({ defaultTtlMs, logger });
}

module.exports = {
  CacheAdapter,
  MemoryCacheAdapter,
  RedisCacheAdapter,
  createCacheAdapter,
  CacheEntry,
  DEFAULT_TTL_MS,
};