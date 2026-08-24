// ============================================================================
// 检索 Worker · retrieval —— point-in-time 检索 + G19 置信度解析
// 对全部 active 规则做 DSL 求值（evaluated_at = at），仅保留命中集；
// 每条命中解析 G19 置信度（backtest 优先 / base 兜底）。
// ============================================================================
'use strict';

const { evaluate } = require('../dsl/evaluator');

/**
 * 检索命中集。
 * @param {Object} p
 * @param {Object[]} p.rules RuleVersion[]（通常为 active）
 * @param {Object} p.featureSnapshot point-in-time 特征快照
 * @param {string} p.at 评估时刻（唯一时序锚点）
 * @param {Function} p.confidenceOf (version_id, base_confidence) => number
 * @returns {Object[]} Hit[]（含 rule / match / direction / confidence）
 */
function retrieveHits({ rules, featureSnapshot, at, confidenceOf }) {
  if (!rules || rules.length === 0) return [];
  const data = { features: featureSnapshot };

  const hits = [];
  for (const rule of rules) {
    if (rule.status !== 'active') continue;
    const match = evaluate(rule, data, { evaluated_at: at });
    if (!match.hit) continue;
    const confidence = confidenceOf
      ? confidenceOf(rule.version_id, rule.base_confidence)
      : rule.base_confidence;
    hits.push({ rule, match, direction: rule.direction, confidence });
  }
  return hits;
}

module.exports = { retrieveHits };