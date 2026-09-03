// ============================================================================
// 回测框架 · V9.7 证据样本构建 —— 把规则命中转化为可入 metrics 的不可变证据快照
//
// 定位：promote/metrics 的 computeMetrics 吃「eligible 证据快照」，要求每条带
//   verdict_direction / match_result / odds / observed_at / league / trigger_data。
// V9.7 真规则多数 effects 无自动可判方向（仅台账）；S25 是例外：其 total_goals_signal
// 自带大小球倾向语义（「阻大=真实看大球」→ over / 「阻小=真实看小球」→ under），
// 可对照「实际总进球 vs 大小球盘口中线」给出可判向证据。
//
// 本模块把 S25 的命中事件固化为 eligible 证据快照，补齐「总进球方向映射」缺口，
// 使 S25 能像让球盘规则一样走回测指标 + 治理转正闭环。
// ============================================================================
'use strict';

const { adaptMatch } = require('../features/adapt');
const { runRule } = require('../engine/v97/run');
const { collectOverUnderRows, pickAnyReference } = require('../engine/v97/fields');
const { parseDepth } = require('../engine/v97/handicap');
const { createEvidenceSnapshot } = require('./evidence');

const FAR_FUTURE = '2999-12-31T23:59:59+08:00';

/**
 * 从 V9.7 维度结论抽取总进球方向倾向。
 * @param {Object} dimensions V9.7 求值维度结论（含 total_goals_signal）
 * @returns {'over'|'under'|null}
 */
function totalGoalsLean(dimensions) {
  const vals = (dimensions && dimensions.total_goals_signal) || [];
  const blob = vals.join('、');
  if (/大球/.test(blob)) return 'over';
  if (/小球/.test(blob)) return 'under';
  return null;
}

/** 大小球盘口中线（按参考机构）。 */
function ouLineMid(markets) {
  const rows = collectOverUnderRows(markets);
  if (!rows.length) return null;
  const ref = pickAnyReference(rows, 'over_odds');
  return ref ? parseDepth(ref.line).depth : null;
}

/**
 * 通用证据样本构建：对真实历史场次跑规则，每命中一次产出一条 eligible 证据快照。
 * @param {Object} rule V9.7 规则对象（含 id/rule_id + atoms + effects）
 * @param {Array<Object>} matches DB 历史 MatchSchema（带 actual_result / meta.total_goals）
 * @param {Object} opts
 * @param {Function} opts.computeLean (dimensions) => 'over'|'under'|null
 * @param {string} [opts.ruleVersionId] 证据归属的 rule_version_id
 * @param {string} [opts.backtestEnd] 回测截止（默认极远未来，确保历史场 result_available）
 * @returns {Object[]} 冻结的 EvidenceSnapshot（statistics_eligible 已标注）
 */
function buildRuleEvidence(rule, matches, opts) {
  const { computeLean, ruleVersionId, backtestEnd = FAR_FUTURE } = opts || {};
  const snapshots = [];
  for (const m of matches) {
    const t = m.match_time;
    if (!t) continue;
    const { markets } = adaptMatch(m, t);
    const res = runRule(rule, { markets, match: m, t });
    if (res.status !== 'hit') continue;

    const lean = computeLean(res.dimensions || {});
    if (!lean) continue;

    const line = ouLineMid(markets);
    const tg = m.meta && m.meta.total_goals != null ? m.meta.total_goals : null;
    if (line == null || tg == null) continue;

    // push（总进球刚好压线）→ 不参与判定，排除
    const matchResult = tg > line ? 'over' : tg < line ? 'under' : null;
    if (!matchResult) continue;

    const rows = collectOverUnderRows(markets);
    const ref = pickAnyReference(rows, lean === 'over' ? 'over_odds' : 'under_odds') || rows[0];
    const water = ref ? (lean === 'over' ? ref.over_odds : ref.under_odds) : null;
    if (water == null) continue;

    // 水位(water, <1) → 十进制赔付(odds = 1 + water)，用于 ROI/edge 计算
    const odds = +(1 + Number(water)).toFixed(4);

    snapshots.push(createEvidenceSnapshot({
      rule_version_id: ruleVersionId || `${rule.id || rule.rule_id}#1`,
      match_id: m.match_id,
      observed_at: m.match_time,
      received_at: m.match_time,
      match_time: m.match_time,
      match_result: matchResult,
      league: m.league,
      odds,
      verdict_direction: lean,
      trigger_data: {
        line_mid: line,
        total_goals: tg,
        lean,
        dimensions: res.dimensions,
      },
    }, { valid_from: m.match_time, valid_to: null }, backtestEnd));
  }
  return snapshots;
}

/**
 * 构建 S25 的总进球 eligible 证据样本（真实历史 × 真规则）。
 * @param {Object} rule S25 的 V9.7 规则对象
 * @param {Array<Object>} matches DB 历史 MatchSchema
 * @param {Object} [opts]
 * @returns {Object[]} 冻结证据快照
 */
function buildS25Evidence(rule, matches, opts = {}) {
  return buildRuleEvidence(rule, matches, {
    computeLean: totalGoalsLean,
    ruleVersionId: (rule.id || rule.rule_id) + '#1',
    backtestEnd: opts.backtestEnd,
  });
}

module.exports = { buildS25Evidence, buildRuleEvidence, totalGoalsLean, ouLineMid, FAR_FUTURE };
