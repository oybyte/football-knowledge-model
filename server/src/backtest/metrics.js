// ============================================================================
// 回测框架 · 6 项指标计算 + 阈值判定
// 仅对 statistics_eligible=true 的证据计算（AGENTS.md：仅 eligible 数据入正式评估）。
// 命中判定：favor_upper→上盘 / favor_lower→下盘 与 match_result 一致即命中；draw 判 miss。
// warning/follow 无明确方向，不参与命中率与 ROI，但计入 sample_size。
// ============================================================================
'use strict';

/** 指标阈值（设计文档 §6） */
const THRESHOLDS = Object.freeze({
  hit_rate: 0.55,
  roi: 0.03,
  max_drawdown: 0.15,
  sample_size: 30,
  time_stability: 0.05,
  league_coverage: 2,
});

/** @param {string} verdict @returns {boolean} 是否有明确方向 */
function hasDirection(verdict) {
  return verdict === 'favor_upper' || verdict === 'favor_lower';
}

/** @param {string} verdict @param {string} result @returns {boolean} 是否命中 */
function isHit(verdict, result) {
  if (verdict === 'favor_upper') return result === 'upper';
  if (verdict === 'favor_lower') return result === 'lower';
  return false;
}

/** @param {string} dateIso @returns {string} "YYYY-Qn" */
function quarterKey(dateIso) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** @param {number[]} xs @returns {number} 总体方差 */
function variance(xs) {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
}

/**
 * 计算 6 项指标并判定是否达标（阈值全部通过 → all_pass）。
 * @param {Object[]} sample 仅 eligible 的证据快照
 * @returns {{ metrics: Object, passes: Object, all_pass: boolean }}
 */
function computeMetrics(sample) {
  const singled = [...sample].sort(
    (a, b) => new Date(a.observed_at) - new Date(b.observed_at),
  );

  // 方向样本与命中
  let directionCount = 0;
  let hitCount = 0;
  let winSum = 0; // Σ赢回（只对有方向样本下注）
  let equity = 0; // 资金曲线累计净盈亏
  let peak = 0;
  let maxDrawdown = 0;
  const groupRates = new Map(); // quarter → 命中数组
  const leagues = new Set();

  for (const e of singled) {
    leagues.add(e.league);
    const dir = hasDirection(e.verdict_direction);
    const hit = isHit(e.verdict_direction, e.match_result);
    if (dir) {
      directionCount += 1;
      if (hit) {
        hitCount += 1;
        winSum += e.odds;
        equity += e.odds - 1;
      } else {
        equity -= 1;
      }
      const q = quarterKey(e.observed_at);
      if (!groupRates.has(q)) groupRates.set(q, []);
      groupRates.get(q).push(hit ? 1 : 0);
    }
    // 非方向样本盈亏 0，仍计入曲线游程但不改变 equity

    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }

  const sampleSize = singled.length;
  const hitRate = directionCount ? hitCount / directionCount : 0;
  const roi = directionCount ? (winSum - directionCount) / directionCount : 0;
  const quarterRates = [...groupRates.values()].map(
    (hits) => hits.reduce((a, b) => a + b, 0) / hits.length,
  );
  const timeStability = variance(quarterRates);
  const leagueCoverage = leagues.size;

  const metrics = {
    sample_size: sampleSize,
    direction_count: directionCount,
    hit_count: hitCount,
    hit_rate: Math.round(hitRate * 1e6) / 1e6,
    roi: Math.round(roi * 1e6) / 1e6,
    max_drawdown: Math.round(maxDrawdown * 1e6) / 1e6,
    time_stability: Math.round(timeStability * 1e6) / 1e6,
    league_coverage: leagueCoverage,
    leagues: [...leagues],
  };

  const passes = {
    hit_rate: metrics.hit_rate >= THRESHOLDS.hit_rate,
    roi: metrics.roi >= THRESHOLDS.roi,
    max_drawdown: metrics.max_drawdown <= THRESHOLDS.max_drawdown,
    sample_size: metrics.sample_size >= THRESHOLDS.sample_size,
    time_stability: metrics.time_stability <= THRESHOLDS.time_stability,
    league_coverage: metrics.league_coverage >= THRESHOLDS.league_coverage,
  };
  const all_pass = Object.values(passes).every(Boolean);

  return { metrics, passes, all_pass };
}

module.exports = { computeMetrics, THRESHOLDS, hasDirection, isHit };