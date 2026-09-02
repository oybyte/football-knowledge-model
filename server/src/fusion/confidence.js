// ============================================================================
// 融合决策层 · G19 置信度接入 —— 回测写 → 检索读（写-后-读无竞态）
// 规则最终置信度优先取 CongressGate 已提交的 backtest 置信度；
// 未命中（回测运行中/未提交）时 fallback base_confidence —— 读到旧/空值，绝不读到中间态。
// ============================================================================
'use strict';

/**
 * G19 置信度解析器。
 * @param {Object} [opts]
 * @param {import('../backtest/confidence_gate').ConfidenceGate|null} [opts.gate]
 * @param {import('../lib/logger').Logger} [opts.logger]
 */
class ConfidenceProvider {
  constructor(opts = {}) {
    this.gate = opts.gate || null;
    this.logger = opts.logger || null;
  }

  /**
   * 解析规则置信度（backtest 优先，base 兜底）。
   * @param {Object} p
   * @param {string} p.rule_version_id
   * @param {number} [p.fallback] 兜底 base_confidence（默认 0.5）
   * @returns {{ confidence: number, source: "backtest"|"base" }}
   */
  resolve({ rule_version_id, fallback = 0.5 }) {
    const committed = this.gate ? this.gate.get(rule_version_id) : null;
    if (committed && typeof committed.confidence === 'number') {
      const c = Math.min(1, Math.max(0, committed.confidence));
      if (this.logger) {
        this.logger.debug('fusion_confidence_backtest', {
          rule_version_id,
          confidence: c,
          report_ref: committed.report_ref || null,
        });
      }
      return { confidence: c, source: 'backtest', report_ref: committed.report_ref || null };
    }
    const base = Math.min(1, Math.max(0, fallback));
    if (this.logger) {
      this.logger.debug('fusion_confidence_base', { rule_version_id, confidence: base });
    }
    return { confidence: base, source: 'base', report_ref: null };
  }
}

module.exports = { ConfidenceProvider };