// ============================================================================
// Redis 并发锁管理器 — SETNX 语义，30s 超时 / 10s 心跳续期
// 对齐实施计划 1.3：规则级排他锁，Redis 实现。
// 保持与 LockManager（server/src/rules/lock_manager.js）相同的接口签名。
// ============================================================================
'use strict';

const { defaultLogger } = require('../lib/logger');

const DEFAULT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_HEARTBEAT_MS = 10 * 1000;
const LOCK_PREFIX = 'oe:lock:';

/**
 * Redis 规则级排他锁管理器
 * 接口兼容 LockManager（server/src/rules/lock_manager.js）
 */
class RedisLockManager {
  /**
   * @param {object} redis ioredis 实例
   * @param {{ timeoutMs?: number, heartbeatMs?: number, prefix?: string, logger?: object }} [opts]
   */
  constructor(redis, { timeoutMs = DEFAULT_TIMEOUT_MS, heartbeatMs = DEFAULT_HEARTBEAT_MS, prefix = LOCK_PREFIX, logger = defaultLogger } = {}) {
    this.redis = redis;
    this.timeoutMs = timeoutMs;
    this.heartbeatMs = heartbeatMs;
    this.prefix = prefix;
    this.logger = logger;
    /** @type {Map<string, NodeJS.Timeout>} 心跳定时器 */
    this._heartbeats = new Map();
  }

  _key(k) { return this.prefix + k; }

  /**
   * 尝试获取锁（SETNX）。
   * @param {string} ruleId
   * @param {string} holder
   * @param {number} [timeoutMs]
   * @returns {Promise<(() => void) | null>}
   */
  async acquire(ruleId, holder, timeoutMs) {
    const ttl = Math.ceil((timeoutMs || this.timeoutMs) / 1000);
    const key = this._key(ruleId);
    try {
      const ok = await this.redis.set(key, holder, 'PX', ttl * 1000, 'NX');
      if (ok !== 'OK') return null;
      this._startHeartbeat(ruleId, holder);
      return () => { this.release(ruleId, holder); };
    } catch (e) {
      this.logger.warn('lock_acquire_error', { ruleId, holder, error: e.message });
      return null;
    }
  }

  /**
   * 心跳续期。
   * @param {string} ruleId
   * @param {string} holder
   * @returns {Promise<boolean>}
   */
  async heartbeat(ruleId, holder) {
    const key = this._key(ruleId);
    try {
      const script = `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("pexpire",KEYS[1],ARGV[2]) else return 0 end`;
      const result = await this.redis.eval(script, 1, key, holder, String(this.timeoutMs));
      return result === 1;
    } catch (e) {
      this.logger.warn('lock_heartbeat_error', { ruleId, holder, error: e.message });
      return false;
    }
  }

  /**
   * 释放锁。
   * @param {string} ruleId
   * @param {string} holder
   * @returns {Promise<boolean>}
   */
  async release(ruleId, holder) {
    this._stopHeartbeat(ruleId);
    const key = this._key(ruleId);
    try {
      const script = `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`;
      const result = await this.redis.eval(script, 1, key, holder);
      return result === 1;
    } catch (e) {
      this.logger.warn('lock_release_error', { ruleId, holder, error: e.message });
      return false;
    }
  }

  /**
   * 检查锁是否被持有。
   * @param {string} ruleId
   * @returns {Promise<boolean>}
   */
  async isLocked(ruleId) {
    try {
      const val = await this.redis.get(this._key(ruleId));
      return val != null;
    } catch { return false; }
  }

  /**
   * 强制释放锁。
   * @param {string} ruleId
   * @returns {Promise<boolean>}
   */
  async forceRelease(ruleId) {
    this._stopHeartbeat(ruleId);
    try {
      const n = await this.redis.del(this._key(ruleId));
      return n > 0;
    } catch { return false; }
  }

  /** 清空所有锁 */
  async clear() {
    for (const ruleId of this._heartbeats.keys()) {
      this._stopHeartbeat(ruleId);
    }
    try {
      const stream = this.redis.scanStream({ match: this.prefix + '*' });
      for await (const keys of stream) {
        if (keys.length) await this.redis.del(...keys);
      }
    } catch (e) {
      this.logger.warn('lock_clear_error', { error: e.message });
    }
  }

  _startHeartbeat(ruleId, holder) {
    this._stopHeartbeat(ruleId);
    const timer = setInterval(() => {
      this.heartbeat(ruleId, holder).catch(() => {});
    }, this.heartbeatMs);
    timer.unref();
    this._heartbeats.set(ruleId, timer);
  }

  _stopHeartbeat(ruleId) {
    const timer = this._heartbeats.get(ruleId);
    if (timer) {
      clearInterval(timer);
      this._heartbeats.delete(ruleId);
    }
  }
}

module.exports = { RedisLockManager, DEFAULT_TIMEOUT_MS, DEFAULT_HEARTBEAT_MS, LOCK_PREFIX };