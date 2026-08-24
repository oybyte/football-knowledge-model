// ============================================================================
// 回测转正 · promote —— 2.2 规则回测 → 转正上线
// 对齐实施计划 2.2：draft → proposed → experiment → validated → approved → active。
// 对规则专属的 eligible 样本跑 1.5 回测指标；全部阈值达标 → 沿状态机逐级转正；
// 任一不达标 → 产出失败报告（指标明细），规则保持未转正。
// 全程由 stateMachine.transition 驱动，记录每次状态转换审计。
// ============================================================================
'use strict';

const { computeMetrics } = require('../backtest/metrics');
const { Logger } = require('../lib/logger');

const logger = new Logger({ service: 'promote' });

const LIFECYCLE = ['proposed', 'experiment', 'validated', 'approved', 'active'];

/**
 * 单条规则转正。
 * @param {Object} p
 * @param {string} p.rule_id
 * @param {import('../rules').RuleStore} p.store
 * @param {import('../rules').StateMachine} p.stateMachine
 * @param {Object[]} p.sample 该规则的 eligible 证据快照（仅 statistics_eligible）
 * @param {string} p.approver 人工审批人
 * @param {string} [p.note]
 * @param {Function} [p.metricsFn] 默认 computeMetrics
 * @returns {Object} { ok, pass, report, failure_report?, promoted? , errors? }
 */
function promoteRule({ rule_id, store, stateMachine, sample = [], approver = 'promote:admin', note = null, metricsFn = computeMetrics }) {
  const versions = store.getByRuleId(rule_id);
  const current = versions && versions[0];
  if (!current) return { ok: false, pass: false, report: { rule_id }, failure_report: { rule_id, error: 'rule_not_found' }, errors: ['rule_not_found'] };

  const { metrics, passes, all_pass } = metricsFn(sample);
  const report = {
    rule_id,
    status: current.status,
    sample_size: metrics.sample_size,
    direction_count: metrics.direction_count,
    hit_rate: metrics.hit_rate,
    roi: metrics.roi,
    max_drawdown: metrics.max_drawdown,
    time_stability: metrics.time_stability,
    league_coverage: metrics.league_coverage,
    metrics,
    passes,
    all_pass,
  };

  if (!all_pass) {
    logger.warn('promote_failed', { rule_id, pass: false, sample_size: metrics.sample_size });
    return { ok: false, pass: false, report, failure_report: report, promoted: null };
  }

  // 沿生命周期逐级推进（含审核）
  let v = current;
  for (const to of LIFECYCLE) {
    const overrides = {};
    if (to === 'experiment' || to === 'approved') overrides.approved_by = approver;
    if (to === 'validated') overrides.evidence_count = (v.evidence_count || 0) + metrics.sample_size;
    if (to === 'active' && !v.valid_from) overrides.valid_from = new Date().toISOString().slice(0, 19) + '+08:00';
    const r = stateMachine.transition(rule_id, to, { actor: approver, note, overrides });
    if (!r.ok) {
      const fr = { ...report, transition_error: r.errors, stopped_at: to };
      logger.warn('promote_transition_failed', { rule_id, to, errors: r.errors });
      return { ok: false, pass: true, report, failure_report: fr, promoted: null, errors: r.errors };
    }
    v = r.version;
  }

  logger.info('promote_succeeded', { rule_id, status: 'active', sample_size: metrics.sample_size });
  return { ok: true, pass: true, report, failure_report: null, promoted: v };
}

/**
 * 批量转正：对一批 draft 规则逐一回测转正。
 * @param {Object} p
 * @param {string[]} p.ruleIds
 * @param {import('../rules').RuleStore} p.store
 * @param {import('../rules').StateMachine} p.stateMachine
 * @param {Function} p.sampleOf (ruleId) => Object[] 每规则 eligible 样本
 * @param {string} [p.approver]
 * @returns {{ promoted:Object[], failure_reports:Object[], reports:Object[] }}
 */
function batchPromote({ ruleIds, store, stateMachine, sampleOf, approver = 'promote:admin', note = null }) {
  const promoted = [];
  const failure_reports = [];
  const reports = [];
  for (const rid of ruleIds) {
    const sample = sampleOf ? sampleOf(rid) || [] : [];
    const res = promoteRule({ rule_id: rid, store, stateMachine, sample, approver, note });
    reports.push(res.report);
    if (res.pass && res.promoted) promoted.push(res.promoted);
    else if (res.failure_report) failure_reports.push(res.failure_report);
  }
  return { promoted, failure_reports, reports };
}

module.exports = { promoteRule, batchPromote, LIFECYCLE };