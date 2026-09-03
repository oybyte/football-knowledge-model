// ============================================================================
// 回测框架 · 6 项指标计算 + 阈值判定
// 仅对 statistics_eligible=true 的证据计算（AGENTS.md：仅 eligible 数据入正式评估）。
// 命中判定：favor_upper→上盘 / favor_lower→下盘 与 match_result 一致即命中；draw 判 miss。
// warning/follow 无明确方向，不参与命中率与 ROI，但计入 sample_size。
// ============================================================================
'use strict';

/** 指标阈值（设计文档 §6，通用默认值；S25 转正试点用用户 stated 门禁覆盖） */
const THRESHOLDS = Object.freeze({
  hit_rate: 0.55,
  roi: 0.03,
  max_drawdown: 0.15,
  sample_size: 30,
  time_stability: 0.05,
  league_coverage: 2,
});

/**
 * 方向轴定义：verdict_direction ↔ match_result 的映射关系。
 *  - handicap：让球盘 favor_upper/favor_lower ↔ upper/lower（原默认行为）。
 *  - total_goals：总进球 over/under ↔ over/under（S25「总进球方向映射」缺口）。
 */
const AXES = Object.freeze({
  handicap: {
    dirs: ['favor_upper', 'favor_lower'],
    isHit: (v, r) => (v === 'favor_upper' ? r === 'upper' : v === 'favor_lower' ? r === 'lower' : false),
  },
  total_goals: {
    dirs: ['over', 'under'],
    isHit: (v, r) => (v === 'over' ? r === 'over' : v === 'under' ? r === 'under' : false),
  },
});

/** @param {string} verdict @param {string} [axisName] @returns {boolean} 是否有明确方向 */
function hasDirection(verdict, axisName = 'handicap') {
  const axis = AXES[axisName] || AXES.handicap;
  return axis.dirs.includes(verdict);
}

/** @param {string} verdict @param {string} result @param {string} [axisName] @returns {boolean} 是否命中 */
function isHit(verdict, result, axisName = 'handicap') {
  const axis = AXES[axisName] || AXES.handicap;
  return axis.isHit(verdict, result);
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
 * @param {Object} [opts]
 * @param {'handicap'|'total_goals'} [opts.axis='handicap'] 方向轴（总进球方向映射用 total_goals）
 * @param {Object} [opts.thresholds] 覆盖默认 THRESHOLDS（如 S25 转正门禁）
 * @param {string[]} [opts.gatedKeys] 仅这些指标参与 all_pass（其余仍计入报告，便于透明）。
 *   缺省 = 全部阈值均门禁。S25 试点按用户 stated 门禁仅 gate [hit_rate, roi, sample_size]。
 * @returns {{ metrics: Object, passes: Object, all_pass: boolean, gated_keys: string[] }}
 */
function computeMetrics(sample, opts = {}) {
  const axisName = opts.axis || 'handicap';
  const axis = AXES[axisName] || AXES.handicap;
  const thresholds = { ...THRESHOLDS, ...(opts.thresholds || {}) };

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
    const dir = hasDirection(e.verdict_direction, axisName);
    const hit = isHit(e.verdict_direction, e.match_result, axisName);
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
    hit_rate: metrics.hit_rate >= thresholds.hit_rate,
    roi: metrics.roi >= thresholds.roi,
    max_drawdown: metrics.max_drawdown <= thresholds.max_drawdown,
    sample_size: metrics.sample_size >= thresholds.sample_size,
    time_stability: metrics.time_stability <= thresholds.time_stability,
    league_coverage: metrics.league_coverage >= thresholds.league_coverage,
  };
  // 门禁仅对 gatedKeys 生效（其余指标仍计入报告，透明但不阻断）。
  const gatedKeys = opts.gatedKeys && opts.gatedKeys.length ? opts.gatedKeys : Object.keys(passes);
  const all_pass = gatedKeys.every((k) => passes[k]);

  return { metrics, passes, all_pass, gated_keys: gatedKeys };
}

module.exports = { computeMetrics, THRESHOLDS, AXES, hasDirection, isHit };