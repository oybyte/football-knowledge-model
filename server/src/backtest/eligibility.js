// ============================================================================
// 回测框架 · 5 项准入校验 —— statistics_eligible
// 对齐 G12 qd_evidence_snapshots.statistics_eligible + architecture：
// 任一校验失败 → eligible=false / trust_level=untrusted，仅作沙盒参考不入正式统计。
// 时间泄漏（temporal_integrity）为强制阻断，非建议（project_memory）。
// ============================================================================
'use strict';

/**
 * @typedef {Object} EvidenceInput 触发点证据原始输入
 * @property {string} evidence_id
 * @property {string} rule_version_id
 * @property {string} observed_at   触发观测时间（唯一时序锚点）
 * @property {string} received_at   数据接收时间
 * @property {string} match_time    开赛时间
 * @property {string} match_result  "upper"|"lower"|"draw"
 * @property {string} league
 * @property {number} odds
 * @property {Object|null} trigger_data 触发时特征快照
 * @property {string} verdict_direction "favor_upper"|"favor_lower"|"warning"|"follow"
 */

/** 归一化为毫秒时间戳；无效输入返回 NaN */
function ts(v) {
  if (typeof v === 'number') return v;
  return Date.parse(v);
}

/**
 * 5 项准入校验。
 * @param {EvidenceInput} evidence
 * @param {{ valid_from?: string, valid_to?: string|null }} rule RuleVersion
 * @param {string|number} backtestEnd 回测截止（排除未来数据）
 * @returns {{
 *   eligible: boolean,
 *   trust_level: "trusted"|"untrusted",
 *   failed_checks: string[],
 *   checks: Record<string, boolean>,
 * }}
 */
function validateEvidenceEligibility(evidence, rule, backtestEnd) {
  const end = ts(backtestEnd);
  const observed = ts(evidence.observed_at);
  const received = ts(evidence.received_at);
  const matchTime = ts(evidence.match_time);
  const validFrom = rule.valid_from ? ts(rule.valid_from) : null;
  const validTo = rule.valid_to ? ts(rule.valid_to) : null;

  const snapshotIntact =
    evidence.trigger_data !== null && evidence.trigger_data !== undefined;

  const checks = {
    temporal_integrity: observed <= end,
    receipt_consistency: received >= observed,
    result_available: matchTime < end,
    snapshot_complete: snapshotIntact,
    rule_active_at_trigger:
      (validFrom === null || observed >= validFrom) &&
      (validTo === null || observed <= validTo),
  };

  const failed_checks = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  const eligible = failed_checks.length === 0;

  return {
    eligible,
    trust_level: eligible ? 'trusted' : 'untrusted',
    failed_checks,
    checks,
  };
}

module.exports = { validateEvidenceEligibility, ts };