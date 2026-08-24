// ============================================================================
// 特征工程服务 · cache —— 特征缓存（1.2 设计文档 §6 / G6 §7）
// 阶段 1 以内存 Map 实现，接口与 Redis 等价（get/set/del），后续可替换。
// 键：feat:{match_id}:{computed_at}；TTL 30 分钟；命中率可统计。
// ============================================================================
'use strict';

const TTL_MS = 30 * 60 * 1000; // 30 分钟（G6 §7）

/**
 * 内存特征缓存。
 */
class FeatureCache {
  constructor({ ttlMs = TTL_MS } = {}) {
    this.ttlMs = ttlMs;
    /** @type {Map<string, { value: Object, expiresAt: number }>} */
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /** @param {string} matchId @param {string} computedAt @returns {string} */
  static key(matchId, computedAt) {
    return `feat:${matchId}:${computedAt}`;
  }

  /**
   * 读取缓存；命中返回特征快照，未命中/过期返回 null。
   * @param {string} matchId
   * @param {string} computedAt
   * @returns {?Object}
   */
  get(matchId, computedAt) {
    const k = FeatureCache.key(matchId, computedAt);
    const entry = this.store.get(k);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(k);
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return entry.value;
  }

  /**
   * 写入缓存。
   * @param {string} matchId
   * @param {string} computedAt
   * @param {Object} snapshot
   */
  set(matchId, computedAt, snapshot) {
    const k = FeatureCache.key(matchId, computedAt);
    this.store.set(k, { value: snapshot, expiresAt: Date.now() + this.ttlMs });
  }

  /** 主动失效（快照更新时调用，保证 point-in-time 语义） */
  invalidate(matchId) {
    const prefix = `feat:${matchId}:`;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  /** @returns {number} 命中率 */
  hitRate() {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  clear() {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

module.exports = { FeatureCache, TTL_MS };