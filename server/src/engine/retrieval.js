// ============================================================================
// 预测链 · engine/retrieval —— 2.3 检索引擎（matchExact / matchFuzzy / traceRuleChain）
// 对齐实施计划 2.3：单场预测可追溯完整推理链。
// 复用 1.4 DSL 求值 + 1.7 检索命中集；本层仅做面向 2.3 的命名对齐与链路追踪。
// ============================================================================
'use strict';

const { evaluate } = require('../dsl/evaluator');
const { retrieveHits } = require('../worker/retrieval');

/**
 * 单条规则精确命中（match_type=exact）。
 * @param {import('../rules/schema').RuleVersion} rule
 * @param {Object} featureSnapshot
 * @param {string} at
 * @returns {boolean}
 */
function matchExact(rule, featureSnapshot, at) {
  const m = evaluate(rule, { features: featureSnapshot }, { evaluated_at: at });
  return m.hit && m.match_type === 'exact';
}

/**
 * 单条规则模糊命中（allowable match）。
 * @param {import('../rules/schema').RuleVersion} rule
 * @param {Object} featureSnapshot
 * @param {string} at
 * @returns {boolean}
 */
function matchFuzzy(rule, featureSnapshot, at) {
  const m = evaluate(rule, { features: featureSnapshot }, { evaluated_at: at });
  return m.hit && m.match_type === 'fuzzy';
}

/**
 * 单条规则推理链（完整条件级 trace）。
 * @param {import('../rules/schema').RuleVersion} rule
 * @param {Object} featureSnapshot
 * @param {string} at
 * @returns {Object} RuleMatch（含 chain / match_type / match_degree）
 */
function traceRuleChain(rule, featureSnapshot, at) {
  return evaluate(rule, { features: featureSnapshot }, { evaluated_at: at });
}

/**
 * 整场推理链：检索全部命中 + 推理链 +（可选）命中集。
 * @param {Object} p
 * @param {Object[]} p.rules active 规则
 * @param {Object} p.featureSnapshot
 * @param {string} p.at
 * @param {Function} [p.confidenceOf]
 * @returns {Object} { hits, chains:Object[], match_exact_ids:[], match_fuzzy_ids:[] }
 */
function traceMatchChain({ rules, featureSnapshot, at, confidenceOf }) {
  const chains = (rules || []).map((r) => traceRuleChain(r, featureSnapshot, at));
  const exactIds = chains.filter((c) => c.match_type === 'exact' && !c.skipped).map((c) => c.version_id);
  const fuzzyIds = chains.filter((c) => c.match_type === 'fuzzy' && !c.skipped).map((c) => c.version_id);
  const hits = retrieveHits({ rules, featureSnapshot, at, confidenceOf });
  return { hits, chains, match_exact_ids: exactIds, match_fuzzy_ids: fuzzyIds };
}

module.exports = { matchExact, matchFuzzy, traceRuleChain, traceMatchChain };