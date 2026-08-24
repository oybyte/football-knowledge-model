// ============================================================================
// 回测框架 · 可追溯回测报告（对齐设计文档 §8）
// 包含作业元数据、6 项指标 + 达标判定、准入统计、证据摘录与链路引用。
// ============================================================================
'use strict';

/**
 * 构建回测报告（冻结，不可改写）。
 * @param {Object} p
 * @param {Object} p.job
 * @param {Object} p.metrics
 * @param {Object} p.passes
 * @param {boolean} p.all_pass
 * @param {string} p.adjudication
 * @param {Object[]} p.eligible 合格证据
 * @param {Object[]} p.untrusted 不合格证据
 * @returns {Object} BacktestReport
 */
function buildReport({ job, metrics, passes, all_pass, adjudication, eligible, untrusted }) {
  const report_id = `rep_${job.job_id}`;

  const failedChecks = {};
  for (const e of untrusted) {
    for (const [key, ok] of Object.entries(e.eligible_checks)) {
      if (!ok) failedChecks[key] = (failedChecks[key] || 0) + 1;
    }
  }

  const summary = {
    total_evidence: eligible.length + untrusted.length,
    eligible_count: eligible.length,
    untrusted_count: untrusted.length,
    direction_count: metrics.direction_count,
    hit_count: metrics.hit_count,
    leagues: metrics.leagues,
  };

  const report = Object.freeze({
    report_id,
    job_id: job.job_id,
    rule_version_id: job.rule_version_id,
    date_range: { from: job.date_range.from, to: job.date_range.to },
    adjudication,
    metrics,
    passes,
    all_pass,
    summary,
    failed_checks_distribution: Object.freeze({ ...failedChecks }),
    evidence_refs: Object.freeze([
      ...eligible.map((e) => ({ evidence_id: e.evidence_id, eligible: true })),
      ...untrusted.map((e) => ({ evidence_id: e.evidence_id, eligible: false })),
    ]),
    created_at: new Date().toISOString(),
  });
  return report;
}

module.exports = { buildReport };