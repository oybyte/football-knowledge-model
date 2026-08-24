// ============================================================================
// 特征工程服务 · pointInTime —— point-in-time 防泄漏校验（1.2 设计文档 §5）
// 防御性校验：计算完成后断言所有参与快照 observed_at ≤ T，否则拒绝输出。
// ============================================================================
'use strict';

const { isISOTime } = require('../data/schema');

/**
 * 防御性校验：确认参与计算的所有快照均在 T 时点前可得。
 * @param {Object} markets adaptMatch 产出的 markets 结构
 * @param {string} t 分析时点（ISO 8601）
 * @returns {{ ok: boolean, leaks: string[] }}
 */
function assertNoFutureData(markets, t) {
  const tMs = Date.parse(t);
  const leaks = [];
  for (const marketName of Object.keys(markets)) {
    for (const inst of Object.keys(markets[marketName])) {
      const rec = markets[marketName][inst];
      for (const slot of ['initial', 'current']) {
        const snap = rec[slot];
        if (snap && snap.observed_at) {
          const obsMs = isISOTime(snap.observed_at) ? Date.parse(snap.observed_at) : NaN;
          if (!Number.isNaN(obsMs) && !Number.isNaN(tMs) && obsMs > tMs) {
            leaks.push(`${marketName}:${inst}:${slot}@${snap.observed_at}`);
          }
        }
      }
    }
  }
  return { ok: leaks.length === 0, leaks };
}

module.exports = { assertNoFutureData };