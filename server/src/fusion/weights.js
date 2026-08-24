// ============================================================================
// 融合决策层 · 动态权重 —— 默认 + 场景调整 + 归一化
// 标称权重默认 { rule:0.5, model:0.3, anomaly:0.2 }（architecture FusionDecision）。
// 调整因素：规则 exact 命中提高规则话语权；异常主动触发提高异常话语权。
// 信任隔离（untrusted 归零）由 fuse.js 基于 basis_weights 再做归一。
// ============================================================================
'use strict';

const DEFAULT_WEIGHTS = Object.freeze({ rule: 0.5, model: 0.3, anomaly: 0.2 });
const STREAMS = ['rule', 'model', 'anomaly'];

/** @param {number|undefined} x @returns {boolean} */
function isFiniteNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * 归一化权重使总和为 1（容忍全零）。
 * @param {Object} weights
 * @returns {Object}
 */
function normalizeWeights(weights) {
  const list = STREAMS.map((s) => (isFiniteNum(weights[s]) ? weights[s] : 0));
  const sum = list.reduce((a, b) => a + b, 0);
  const out = {};
  STREAMS.forEach((s, i) => {
    out[s] = sum > 0 ? list[i] / sum : 0;
  });
  return out;
}

/**
 * 计算标称（basis）权重：默认 + 场景调整，归一化到 [0,1] 且总和 1。
 * 尚未做信任隔离（untrusted 归零在 fuse.js 完成）。
 * @param {Object} streams { rule_output?, model_output?, anomaly_output?, context? }
 * @returns {Object} { rule, model, anomaly }
 */
function computeBasisWeights({ rule_output = null, model_output = null, anomaly_output = null } = {}) {
  const w = { ...DEFAULT_WEIGHTS };

  // 规则 exact 命中（可解释强）→ 规则话语权提高
  if (rule_output && isFiniteNum(w.rule)) {
    if (rule_output.exact === true || rule_output.match_type === 'exact') w.rule *= 1.2;
  }

  // 异常检测主动触发 → 异常话语权提高
  if (anomaly_output && typeof anomaly_output === 'object' && Object.keys(anomaly_output).length) {
    if (isFiniteNum(w.anomaly)) w.anomaly *= 1.5;
  }

  return normalizeWeights(w);
}

module.exports = { DEFAULT_WEIGHTS, STREAMS, normalizeWeights, computeBasisWeights };