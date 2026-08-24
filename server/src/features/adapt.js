// ============================================================================
// 特征工程服务 · adapt —— 把 1.1 MatchSchema 快照重组为特征计算所需结构
// 1.1 把 initial/current 拆成两份不同 observed_at 的快照；本层按机构×市场
// 重新聚合，并应用 point-in-time 过滤（observed_at ≤ T）后选出 initial/current。
// ============================================================================
'use strict';

const { isISOTime } = require('../data/schema');

/**
 * 按机构×市场聚合快照，应用 point-in-time 过滤。
 * @param {import('../data/schema').MatchSchema} match
 * @param {string} t 分析时点（ISO 8601）
 * @returns {{ markets: Object, filtered_out: number, sources: string[] }}
 *
 * markets 结构：
 *   {
 *     handicap: { macau: { initial:{h,hw,aw}, current:{h,hw,aw} }, ... },
 *     european: { macau: { initial:{h,d,a,kelly}, current:{...} }, ... },
 *     over_under: { ... },
 *     bf: { betfair: { current:{...} } }
 *   }
 */
function adaptMatch(match, t) {
  const tMs = Date.parse(t);
  const markets = {};
  const sources = new Set();
  let filteredOut = 0;

  for (const s of match.snapshots || []) {
    const obsMs = s.observed_at && isISOTime(s.observed_at) ? Date.parse(s.observed_at) : NaN;
    if (!Number.isNaN(tMs) && !Number.isNaN(obsMs) && obsMs > tMs) {
      filteredOut += 1;
      continue; // point-in-time：只使用 observed_at ≤ T 的快照
    }
    if (s.source_id) sources.add(s.source_id);

    const market = markets[s.market] || (markets[s.market] = {});
    const inst = market[s.institution] || (market[s.institution] = { initial: null, current: null });

    // 同一机构内：最早 = initial，最晚 = current
    if (!inst.initial || obsMs < Date.parse(inst.initial.observed_at)) {
      inst.initial = { ...s.data, observed_at: s.observed_at };
    }
    if (!inst.current || obsMs >= Date.parse(inst.current.observed_at)) {
      inst.current = { ...s.data, observed_at: s.observed_at };
    }
  }

  return { markets, filtered_out: filteredOut, sources: [...sources] };
}

module.exports = { adaptMatch };