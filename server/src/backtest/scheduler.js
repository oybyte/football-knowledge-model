// ============================================================================
// 回测框架 · 回测调度器
// 在 backtestEnd 时间线纪律下顺序推进（设计文档 §7）：
// 建作业 → 按 observed_at 升序（point-in-time）→ 5 项准入 + 告警 → 冻结快照 →
// 仅 eligible 算 6 项指标 → 判定 validated/proposed → 生成报告 → completed + G19 写置信度。
// ============================================================================
'use strict';

const { createEvidenceSnapshot } = require('./evidence');
const { computeMetrics } = require('./metrics');
const { buildReport } = require('./report');
const { defaultLogger } = require('../lib/logger');

let jobSeq = 0;

/**
 * 由指标推导置信度：通过的指标比例（全达标 → 1.0）。
 * @param {{ passes: Object }} - 由 computeMetrics 内部统计，此处传入 passes 数组即可
 */
function passRatio(passes) {
  const list = Object.values(passes);
  return list.filter(Boolean).length / list.length;
}

class BacktestScheduler {
  /**
   * @param {Object} [opts]
   * @param {import('../lib/logger').Logger} [opts.logger]
   * @param {import('./confidenceGate').ConfidenceGate} [opts.confidenceGate]
   */
  constructor(opts = {}) {
    this.logger = opts.logger || defaultLogger;
    this.confidenceGate = opts.confidenceGate || null;
  }

  /**
   * 运行一次回测。
   * @param {Object} p
   * @param {string} p.rule_version_id
   * @param {{ from: string, to: string }} p.date_range
   * @param {Object[]} p.evidences 原始触发证据（含 match_result 等，可含未来数据）
   * @param {Object} p.rule RuleVersion
   * @param {string} [p.actor] 执行者
   * @returns {Object} BacktestJob（status=completed）
   */
  runBacktest({ rule_version_id, date_range, evidences, rule, actor = 'backtest:scheduler' }) {
    jobSeq += 1;
    const job = {
      job_id: `bt_${String(jobSeq).padStart(4, '0')}`,
      rule_version_id,
      date_range: { from: date_range.from, to: date_range.to },
      status: 'pending',
      metrics: null,
      report_ref: null,
      adjudication: null,
      created_at: new Date().toISOString(),
      created_by: actor,
      completed_at: null,
    };

    const backtestEnd = date_range.to;

    // 2) point-in-time：按 observed_at 升序，先排后生成快照保持顺序
    const ordered = [...evidences].sort(
      (a, b) => new Date(a.observed_at) - new Date(b.observed_at),
    );

    const snapshots = ordered.map((ev) =>
      createEvidenceSnapshot({ ...ev, rule_version_id, match_id: ev.match_id }, rule, backtestEnd),
    );

    const eligible = snapshots.filter((e) => e.statistics_eligible);
    const untrusted = snapshots.filter((e) => !e.statistics_eligible);

    // 3) 准入失败的证据告警日志（含时间泄漏，触发运维审查）
    for (const e of untrusted) {
      this.logger.warn('backtest_evidence_excluded', {
        rule_version_id,
        evidence_id: e.evidence_id,
        match_id: e.match_id,
        failed_checks: e.eligible_checks,
      });
    }

    // 4/5) 仅 eligible 计算 6 项指标
    const { metrics, passes, all_pass } = computeMetrics(eligible);

    // 6) 判定
    job.adjudication = all_pass ? 'validated' : 'proposed';

    // 7) 报告
    const report = buildReport({
      job,
      metrics,
      passes,
      all_pass,
      adjudication: job.adjudication,
      eligible,
      untrusted,
    });
    job.report_ref = report.report_id;

    // 作业完成 + G19：写-后-读
    job.status = 'completed';
    job.metrics = metrics;
    job.completed_at = new Date().toISOString();
    if (this.confidenceGate) {
      // 仅在 completed 后 commit，检索 get 才读到新置信度
      this.confidenceGate.commit(job, Math.round(passRatio(passes) * 1e3) / 1e3, {
        adjudication: job.adjudication,
      });
    }

    this.logger.info('backtest_completed', {
      job_id: job.job_id,
      rule_version_id,
      adjudication: job.adjudication,
      eligible: eligible.length,
      excluded: untrusted.length,
    });

    job.summary = report.summary;
    return job;
  }
}

module.exports = { BacktestScheduler, passRatio };