// ============================================================================
// 融合决策层 · 动态权重 —— 默认 + 场景调整 + 归一化
// 标称权重默认 { rule:0.5, model:0.3, anomaly:0.2 }（architecture FusionDecision）。
// 调整因素：规则 exact 命中提高规则话语权；异常主动触发提高异常话语权。
// 信任隔离（untrusted 归零）由 fuse.js 基于 basis_weights 再做归一。
// ============================================================================
'use strict';

const DEFAULT_WEIGHTS = Object.freeze({ rule: 0.5, model: 0.3, anomaly: 0.2 });
const STREAMS = ['rule', 'model', 'anomaly'];
// 运行时可配置（关闭 G10「可配置性空白」）：env OE_FUSION_WEIGHTS=rule:0.5,model:0.3,anomaly:0.2
// 仅覆盖给定键，缺失键回退默认；解析失败/空 → 默认。格式宽松：允许部分键、允许非 1 总和（归一化）。
const WEIGHTS_ENV = 'OE_FUSION_WEIGHTS';

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
 * 从 env（或显式 env 对象）解析融合权重覆盖。
 * 格式：rule:0.5,model:0.3,anomaly:0.2（键可省、值须非负有限数）。
 * 仅覆盖给定键，其余回退 DEFAULT_WEIGHTS；解析失败/空 → 返回 null（调用方回退默认）。
 * @param {Object} [env] 默认 process.env
 * @returns {?Object} 已归一化的权重或 null
 */
function parseWeightsFromEnv(env) {
  const src = (env && env[WEIGHTS_ENV]) ||
    (typeof process !== 'undefined' && process.env && process.env[WEIGHTS_ENV]) || '';
  if (!src) return null;
  const picked = {};
  for (const part of String(src).split(',')) {
    const kv = part.split(':');
    if (kv.length !== 2) continue;
    const k = kv[0].trim();
    const v = Number(kv[1].trim());
    if (STREAMS.includes(k) && Number.isFinite(v) && v >= 0) picked[k] = v;
  }
  if (!STREAMS.some((s) => picked[s] !== undefined)) return null;
  const merged = { ...DEFAULT_WEIGHTS };
  for (const s of STREAMS) if (picked[s] !== undefined) merged[s] = picked[s];
  return normalizeWeights(merged);
}

/**
 * 计算标称（basis）权重：默认 + 场景调整，归一化到 [0,1] 且总和 1。
 * 尚未做信任隔离（untrusted 归零在 fuse.js 完成）。
 * @param {Object} streams { rule_output?, model_output?, anomaly_output?, weights?, context? }
 * @param {?Object} [streams.weights] 显式权重覆盖（优先于 env）；缺省读 env OE_FUSION_WEIGHTS，再回退默认
 * @returns {Object} { rule, model, anomaly }
 */
function computeBasisWeights({ rule_output = null, model_output = null, anomaly_output = null, weights = null } = {}) {
  const explicit = weights || parseWeightsFromEnv();
  const base = { ...DEFAULT_WEIGHTS, ...(explicit || {}) }; // 部分覆盖键与默认合并，缺失键回退默认
  const w = { ...base };

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

module.exports = { DEFAULT_WEIGHTS, STREAMS, WEIGHTS_ENV, normalizeWeights, parseWeightsFromEnv, computeBasisWeights };