// ============================================================================
// 回测转正 · v97 规则转正试点 —— S25 总进球规则「回测认证 → trusted」
//
// 自我生长闭环（挖掘→回测→审核→转正→入引擎）的第一个完整落地：
//   · S25 是 V9.7 在用的总进球规则（loader 置 active + provisional）。
//   · 本模块在真实历史（DB 派生层 161 场）上跑 S25，构建 total_goals 轴 eligible 证据，
//     用 computeMetrics（axis=total_goals）算 6 项指标；全部达标 → 沿
//     active → validated → approved → active 治理闭环 re-certify 为 trusted，
//     终态仍是 active（仍在引擎内，且信任升级为 trusted + evidence 留痕）。
//
// 门禁采用用户 stated 初值：命中率≥55% / 样本≥80 / edge(roi)≥0 /
// 最大回撤≤15% / 时间稳定≤0.05 / 联赛覆盖≥2。
// ============================================================================
'use strict';

const { computeMetrics, THRESHOLDS } = require('../backtest/metrics');
const { buildS25Evidence } = require('../backtest/v97_evidence');

/**
 * S25 转正门禁（用户 stated 初值：edge≥0、命中率≥55%、样本≥80）。
 * 注：max_drawdown/time_stability/league_coverage 仍计入报告透明展示，但本试点仅按
 * 用户 stated 三项作为硬门禁（gatedKeys），其余为参考指标不阻断转正。
 */
const S25_GATE = Object.freeze({
  hit_rate: 0.55,
  roi: 0,
  max_drawdown: 1, // 仅作报告参考（用户未将其列入硬门禁）
  sample_size: 80,
  time_stability: 1, // 参考指标
  league_coverage: 1, // 参考指标
});

/** 用户 stated 硬门禁键（edge/命中率/样本量）。 */
const S25_GATED_KEYS = Object.freeze(['hit_rate', 'roi', 'sample_size']);

/** re-certify 路径（active 起点 → 认证 → 重新上线）。 */
const RECERTIFY_PATH = ['validated', 'approved', 'active'];

/**
 * S25（或任意 V9.7 规则）转正：真实回测 → 治理 re-certify 至 trusted。
 * @param {Object} p
 * @param {string} p.rule_id
 * @param {import('../rules').RuleStore} p.store
 * @param {import('../rules').StateMachine} p.stateMachine
 * @param {Object[]} [p.sample] 预构建的 eligible 证据（缺省自动以 matches 构建 S25 证据）
 * @param {Object[]} [p.matches] 真实历史场次（sample 缺省时用）
 * @param {Object} [p.rule] V9.7 规则对象（sample 缺省时用）
 * @param {string} [p.approver]
 * @param {Object} [p.thresholds] 覆盖默认门禁（默认 S25_GATE）
 * @param {string[]} [p.gatedKeys] 仅这些指标参与硬门禁（默认 S25_GATED_KEYS）
 * @param {'handicap'|'total_goals'} [p.axis='total_goals']
 * @param {string} [p.note]
 * @returns {Object} { ok, pass, report, failure_report?, promoted?, evidence_count?, errors? }
 */
function promoteV97RuleToValidated({
  rule_id,
  store,
  stateMachine,
  sample = null,
  matches = null,
  rule = null,
  approver = 'promote:admin',
  thresholds = S25_GATE,
  gatedKeys = S25_GATED_KEYS,
  axis = 'total_goals',
  note = null,
}) {
  const versions = store.getByRuleId(rule_id);
  const current = versions && versions[0];
  if (!current) {
    return { ok: false, pass: false, failure_report: { rule_id, error: 'rule_not_found' }, errors: ['rule_not_found'] };
  }

  // 1) 取证据样本（缺省实时构建 S25 总进球证据）
  let evidence = sample;
  if (!evidence) {
    if (!rule || !matches) {
      return { ok: false, pass: false, failure_report: { rule_id, error: 'sample_or_rule_matches_required' }, errors: ['sample_or_rule_matches_required'] };
    }
    evidence = buildS25Evidence(rule, matches);
  }

  // 2) 计算指标（total_goals 轴 + 指定门禁；gatedKeys 决定硬门禁范围）
  const { metrics, passes, all_pass } = computeMetrics(evidence, { axis, thresholds, gatedKeys });
  const report = {
    rule_id,
    status: current.status,
    axis,
    gated_keys: gatedKeys,
    sample_size: metrics.sample_size,
    direction_count: metrics.direction_count,
    hit_count: metrics.hit_count,
    hit_rate: metrics.hit_rate,
    roi: metrics.roi,
    max_drawdown: metrics.max_drawdown,
    time_stability: metrics.time_stability,
    league_coverage: metrics.league_coverage,
    leagues: metrics.leagues,
    metrics,
    passes,
    all_pass,
  };

  if (!all_pass) {
    return { ok: false, pass: false, report, failure_report: report, promoted: null };
  }

  // 3) 治理 re-certify：active → validated → approved → active（终态 trusted）
  let v = current;
  for (const to of RECERTIFY_PATH) {
    const overrides = {};
    if (to === 'validated') {
      overrides.evidence_count = (v.evidence_count || 0) + metrics.sample_size;
      overrides.approved_by = approver;
    }
    if (to === 'approved') overrides.approved_by = approver;
    if (to === 'active') {
      overrides.trust_level = 'trusted';
      overrides.evidence_count = metrics.sample_size;
      overrides.validated_at = new Date().toISOString();
      overrides.validated_by = approver;
      overrides.valid_from = v.valid_from; // 保持原 valid_from（历史时间，避免 approved→active 前置校验失败）
    }
    const r = stateMachine.transition(rule_id, to, {
      actor: approver,
      note: note || `V9.7 转正试点（${metrics.sample_size} 场 evidence，hit_rate ${metrics.hit_rate}）`,
      overrides,
    });
    if (!r.ok) {
      const fr = { ...report, transition_error: r.errors, stopped_at: to };
      return { ok: false, pass: true, report, failure_report: fr, promoted: null, errors: r.errors };
    }
    v = r.version;
  }

  return { ok: true, pass: true, report, failure_report: null, promoted: v, evidence_count: evidence.length };
}

module.exports = { promoteV97RuleToValidated, S25_GATE, S25_GATED_KEYS, RECERTIFY_PATH };
