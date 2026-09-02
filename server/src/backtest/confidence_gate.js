// ============================================================================
// 回测框架 · G19 跨域时序（ConfidenceGate）
// 回测（写置信度）与检索 Worker（读置信度）跨进程：仅当 job.completed 才原子写入；
// 运行中 get 读到旧/空值，绝不读到中间态（write-then-read 杜绝竞态）。
// ============================================================================
'use strict';

class ConfidenceGate {
  constructor() {
    /** @type {Map<string, Object>} rule_id → 已提交置信度 */
    this.confirmed = new Map();
  }

  /**
   * 仅在回测 completed 时原子提交置信度；否则拒绝且不写（保持旧值）。
   * @param {Object} job BacktestJob
   * @param {number} confidence [0,1]
   * @param {Object} [extra] 附加引用
   * @returns {boolean} 是否写入成功
   */
  commit(job, confidence, extra = {}) {
    if (job.status !== 'completed') return false;
    this.confirmed.set(job.rule_version_id, Object.freeze({
      rule_id: job.rule_version_id,
      confidence,
      report_ref: job.report_ref,
      committed_at: new Date().toISOString(),
      ...extra,
    }));
    return true;
  }

  /**
   * 检索读取置信度；未提交或运行中 → null（读到旧/空值）。
   * @param {string} ruleId
   * @returns {?Object}
   */
  get(ruleId) {
    return this.confirmed.get(ruleId) || null;
  }

  clear() {
    this.confirmed.clear();
  }
}

module.exports = { ConfidenceGate };