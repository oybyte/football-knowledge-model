// ============================================================================
// 回测框架 · 不可变证据快照生成
// 对齐 G12 qd_evidence_snapshots：原子冻结触发特征快照 + 5 项准入 + 三时间戳。
// 生成后 Object.freeze —— 不可变原则（AGENTS.md）：只读不改，更新则生成新版本。
// ============================================================================
'use strict';

const { validateEvidenceEligibility } = require('./eligibility');

/** @type {Map<string, number>} rule_version_id → 已生成证据计数 */
const seqByRule = new Map();

/**
 * 生成不可变证据快照并冻结。
 * @param {Object} input 触发点输入
 * @param {string} input.rule_version_id
 * @param {string} input.match_id
 * @param {string} input.observed_at
 * @param {string} input.received_at
 * @param {string} input.match_time
 * @param {string} input.match_result
 * @param {string} input.league
 * @param {number} input.odds
 * @param {string} input.verdict_direction
 * @param {Object} input.trigger_data
 * @param {Object} rule RuleVersion（用于准入校验 valid_from/valid_to）
 * @param {string|number} backtestEnd 回测截止
 * @returns {Object} 冻结的 EvidenceSnapshot
 */
function createEvidenceSnapshot(input, rule, backtestEnd) {
  const n = (seqByRule.get(input.rule_version_id) || 0) + 1;
  seqByRule.set(input.rule_version_id, n);
  const evidence_id = `ev_${input.rule_version_id}_${String(n).padStart(3, '0')}`;

  const base = {
    evidence_id,
    rule_version_id: input.rule_version_id,
    match_id: input.match_id,
    observed_at: input.observed_at,
    received_at: input.received_at,
    match_time: input.match_time,
    match_result: input.match_result,
    league: input.league,
    odds: input.odds,
    verdict_direction: input.verdict_direction,
    trigger_data: input.trigger_data,
  };

  const el = validateEvidenceEligibility(base, rule, backtestEnd);
  const snapshot = Object.freeze({
    ...base,
    statistics_eligible: el.eligible,
    eligible_checks: Object.freeze({ ...el.checks }),
    trust_level: el.trust_level,
    created_at: new Date().toISOString(),
  });
  return snapshot;
}

module.exports = { createEvidenceSnapshot };