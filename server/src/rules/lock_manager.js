// ============================================================================
// 规则存储服务 · lockManager —— 规则级排他锁
// 对齐实施计划 1.3：Redis SETNX 语义，超时 30s / 心跳续期 10s。
// 阶段 1 以内存 Map 实现，接口与 Redis 等价。
// ============================================================================
'use strict';

const DEFAULT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_HEARTBEAT_MS = 10 * 1000;

/**
 * 规则级排他锁管理器。
 */
class LockManager {
  constructor({ timeoutMs = DEFAULT_TIMEOUT_MS, heartbeatMs = DEFAULT_HEARTBEAT_MS } = {}) {
    this.timeoutMs = timeoutMs;
    this.heartbeatMs = heartbeatMs;
    /** @type {Map<string, { holder: string, expiresAt: number, timer: NodeJS.Timeout }>} */
    this.locks = new Map();
  }

  /**
   * 尝试获取锁。
   * @param {string} ruleId
   * @param {string} holder 持锁者标识
   * @param {number} [timeoutMs] 覆盖默认超时
   * @returns {(() => void) | null} 成功返回 release 函数，失败返回 null
   */
  acquire(ruleId, holder, timeoutMs) {
    const ttl = timeoutMs || this.timeoutMs;
    const existing = this.locks.get(ruleId);
    if (existing && Date.now() < existing.expiresAt) {
      return null;
    }
    if (existing && existing.timer) clearTimeout(existing.timer);

    const expiresAt = Date.now() + ttl;
    const self = this;
    const timer = setTimeout(() => {
      if (self.locks.get(ruleId)?.holder === holder) {
        self.locks.delete(ruleId);
      }
    }, ttl + 100);

    this.locks.set(ruleId, { holder, expiresAt, timer });

    return function release() {
      const entry = self.locks.get(ruleId);
      if (entry && entry.holder === holder) {
        if (entry.timer) clearTimeout(entry.timer);
        self.locks.delete(ruleId);
      }
    };
  }

  /**
   * 心跳续期。
   * @param {string} ruleId
   * @param {string} holder
   * @returns {boolean} 续期成功返回 true
   */
  heartbeat(ruleId, holder) {
    const entry = this.locks.get(ruleId);
    if (!entry || entry.holder !== holder) return false;
    entry.expiresAt = Date.now() + this.timeoutMs;
    return true;
  }

  /** @param {string} ruleId @returns {boolean} */
  isLocked(ruleId) {
    const entry = this.locks.get(ruleId);
    return !!entry && Date.now() < entry.expiresAt;
  }

  /** @param {string} ruleId @returns {boolean} */
  forceRelease(ruleId) {
    const entry = this.locks.get(ruleId);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this.locks.delete(ruleId);
    return true;
  }

  clear() {
    for (const entry of this.locks.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.locks.clear();
  }
}

module.exports = { LockManager, DEFAULT_TIMEOUT_MS, DEFAULT_HEARTBEAT_MS };
