// ============================================================================
// DSL 引擎 · matcher —— 加权 Jaccard 模糊匹配
// degree = Σ(命中条件权重) / Σ(全部条件权重)
// 精确命中（全部原子为真）→ match_degree = 1.0, match_type = 'exact'
// degree ≥ threshold → 'fuzzy'，否则 'none'
// ============================================================================
'use strict';

const { DEFAULT_MATCH_THRESHOLD } = require('./registry');

/**
 * 计算加权 Jaccard 匹配度。
 * @param {Array} atomicResults 推理链（含每项 { hit, weight }）
 * @param {number} [threshold]
 * @returns {{ degree: number, hit: boolean, exact: boolean, match_type: string }}
 */
function weightedJaccard(atomicResults, threshold = DEFAULT_MATCH_THRESHOLD) {
  let hitWeight = 0;
  let totalWeight = 0;
  for (const item of atomicResults || []) {
    const w = item.weight == null ? 1 : item.weight;
    totalWeight += w;
    if (item.hit) hitWeight += w;
  }
  const degree = totalWeight > 0 ? hitWeight / totalWeight : 0;
  const exact = atomicResults.length > 0 && atomicResults.every((i) => i.hit);
  const fuzzy = degree >= threshold;
  const matchType = exact ? 'exact' : fuzzy ? 'fuzzy' : 'none';
  return {
    degree: exact ? 1 : round3(degree),
    hit: exact || fuzzy,
    exact,
    match_type: matchType,
  };
}

const round3 = (n) => Math.round(n * 1000) / 1000;

module.exports = { weightedJaccard, DEFAULT_MATCH_THRESHOLD };