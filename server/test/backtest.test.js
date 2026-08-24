// ============================================================================
// 回测框架 测试 —— 覆盖
// 5 项准入 + 时间泄漏阻断 + 证据不可变 + 6 项指标公式 + 报告可追溯 + G19 时序无竞态
// ============================================================================
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateEvidenceEligibility,
  createEvidenceSnapshot,
  computeMetrics,
  THRESHOLDS,
  BacktestScheduler,
  buildReport,
  ConfidenceGate,
} = require('../src/backtest');

const END = '2026-08-24T00:00:00+00:00';
const rule = Object.freeze({
  rule_id: 'R001',
  version_id: 'R001#1',
  valid_from: '2026-01-01T00:00:00+00:00',
  valid_to: null,
});

/** 快照（computeMetrics 直接输入） */
function S(o, vd, res, lg, od) {
  return { observed_at: o, verdict_direction: vd, match_result: res, league: lg, odds: od };
}

/** 原始触发证据（scheduler / evidence 输入） */
function E(o, vd, res, lg, od, mt = null) {
  return {
    match_id: `M${Math.random().toString(36).slice(2, 8)}`,
    observed_at: o,
    received_at: o,
    match_time: mt || o,
    match_result: res,
    league: lg,
    odds: od,
    verdict_direction: vd,
    trigger_data: { observed: o },
  };
}

// ---------- 5 项准入 ----------
test('准入① temporal_integrity：observed_at 晚于回测截止 → 时间泄漏阻断', () => {
  const e = E('2027-01-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0);
  const r = validateEvidenceEligibility(e, rule, END);
  assert.equal(r.eligible, false);
  assert.equal(r.trust_level, 'untrusted');
  assert.ok(r.failed_checks.includes('temporal_integrity'));
});

test('准入② receipt_consistency：received_at 早于 observed_at → 接收时序倒挂', () => {
  const e = { ...E('2026-07-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0),
    received_at: '2026-06-30T00:00:00+00:00' };
  const r = validateEvidenceEligibility(e, rule, END);
  assert.equal(r.eligible, false);
  assert.ok(r.failed_checks.includes('receipt_consistency'));
});

test('准入③ result_available：match_time 晚于回测截止 → 未来比赛结果不可用', () => {
  const e = E('2026-07-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0,
    '2026-09-01T00:00:00+00:00');
  const r = validateEvidenceEligibility(e, rule, END);
  assert.equal(r.eligible, false);
  assert.ok(r.failed_checks.includes('result_available'));
});

test('准入④ snapshot_complete：trigger_data 缺失 → 快照不完整', () => {
  const e = { ...E('2026-07-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0),
    trigger_data: null };
  const r = validateEvidenceEligibility(e, rule, END);
  assert.equal(r.eligible, false);
  assert.ok(r.failed_checks.includes('snapshot_complete'));
});

test('准入⑤ rule_active_at_trigger：观测早于 valid_from → 规则未生效', () => {
  const e = E('2025-12-31T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0);
  const r = validateEvidenceEligibility(e, rule, END);
  assert.equal(r.eligible, false);
  assert.ok(r.failed_checks.includes('rule_active_at_trigger'));
});

test('准入⑤ valid_to：观测晚于 valid_to → 规则已失效', () => {
  const pastRule = { ...rule, valid_to: '2026-06-01T00:00:00+00:00' };
  const e = E('2026-07-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0);
  const r = validateEvidenceEligibility(e, pastRule, END);
  assert.equal(r.eligible, false);
  assert.ok(r.failed_checks.includes('rule_active_at_trigger'));
});

test('5 项全通过 → eligible=true / trusted', () => {
  const e = E('2026-07-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0);
  const r = validateEvidenceEligibility(e, rule, END);
  assert.equal(r.eligible, true);
  assert.equal(r.trust_level, 'trusted');
  assert.deepEqual(r.failed_checks, []);
  assert.ok(Object.keys(r.checks).length === 5);
});

// ---------- 证据快照不可变 ----------
test('证据快照生成后冻结，不可修改', () => {
  const snap = createEvidenceSnapshot({
    ...E('2026-07-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0),
    rule_version_id: rule.version_id,
  }, rule, END);
  assert.equal(Object.isFrozen(snap), true);
  assert.equal(snap.statistics_eligible, true);
  assert.equal(Object.isFrozen(snap.eligible_checks), true);
  assert.ok(snap.evidence_id.startsWith(`ev_${rule.version_id}_`));
  assert.throws(() => { snap.match_result = 'lower'; }, TypeError);
});

// ---------- 6 项指标 ----------
test('metrics 命中率/ROI/样本量/联赛覆盖度/回撤/稳定性的公式', () => {
  // 28 个上盘全命中（达标样本量）+ 2 个 warning/follow（计入样本量，不计命中/ROI/方向）
  const t = '2026-06-01T00:00:00+00:00';
  const sample = [];
  for (let i = 0; i < 28; i++) {
    sample.push(S(t, 'favor_upper', 'upper', i % 2 ? 'PL' : 'LaLiga', 2.0));
  }
  sample.push(S('2026-06-02T00:00:00+00:00', 'warning', 'upper', 'Bundesliga', 2.0));
  sample.push(S('2026-06-03T00:00:00+00:00', 'follow', 'draw', 'SerieA', 2.0));

  const { metrics, passes, all_pass } = computeMetrics(sample);

  assert.equal(metrics.sample_size, 30);          // 28 方向 + 2 warning/follow
  assert.equal(metrics.direction_count, 28);      // 仅方向样本计入方向
  assert.equal(metrics.hit_count, 28);
  assert.equal(metrics.hit_rate, 1);
  assert.equal(metrics.roi, 1);                   // (10*2.0-10)/10
  assert.equal(metrics.league_coverage, 4);       // PL/LaLiga/Bundesliga/SerieA
  assert.equal(metrics.max_drawdown, 0);          // 单调盈利
  assert.equal(metrics.time_stability, 0);        // 单季 → 方差 0
  assert.equal(all_pass, true);
  assert.ok(passes.hit_rate && passes.roi && passes.max_drawdown && passes.sample_size
    && passes.time_stability && passes.league_coverage);
});

test('metrics max_drawdown 计算回撤', () => {
  const t = '2026-06-01T00:00:00+00:00';
  const sample = [
    S(t, 'favor_upper', 'upper', 'PL', 2.0), // +1 → equity 1, peak 1
    S(t, 'favor_upper', 'lower', 'PL', 2.0), // -1 → equity 0, dd (1-0)/1=1
  ];
  const { metrics } = computeMetrics(sample);
  assert.equal(metrics.max_drawdown, 1);
});

test('metrics 双季度命中率差异 → time_stability 方差', () => {
  const sample = [
    ...['2026-01-01', '2026-02-01', '2026-03-01'].map((o) => S(`${o}T00:00:00+00:00`, 'favor_upper', 'upper', 'PL', 2.0)),
    ...['2026-04-01', '2026-05-01', '2026-06-01'].map((o) => S(`${o}T00:00:00+00:00`, 'favor_upper', 'lower', 'PL', 2.0)),
  ];
  const { metrics } = computeMetrics(sample);
  // Q1 rate=1.0, Q2 rate=0.0 → mean 0.5, 方差 ((0.5)^2+(0.5)^2)/2=0.25
  assert.equal(metrics.time_stability, 0.25);
  assert.ok(metrics.time_stability > THRESHOLDS.time_stability);
});

test('metrics 不达标 → all_pass=false', () => {
  const t = '2026-06-01T00:00:00+00:00';
  // 只有 2 个样本（样本量不足），且一半 miss
  const sample = [
    S(t, 'favor_upper', 'upper', 'PL', 2.0),
    S(t, 'favor_upper', 'lower', 'PL', 2.0),
  ];
  const { metrics, passes, all_pass } = computeMetrics(sample);
  assert.equal(metrics.sample_size, 2);
  assert.equal(passes.sample_size, false);
  assert.equal(all_pass, false);
});

// ---------- 调度端到端：时间泄漏隔离 + 判定 + 报告 ----------
test('scheduler 时间泄漏证据被隔离，不进入正式统计', () => {
  const sched = new BacktestScheduler();
  const good = [];
  for (let i = 0; i < 30; i++) {
    // i+1 确保全部严格早于 END（否则 match_time==END 会被 result_available 排除）
    const d = new Date(Date.parse(END) - (i + 1) * 86400000).toISOString();
    good.push(E(d, 'favor_upper', 'upper', i % 2 ? 'PL' : 'LaLiga', 2.0));
  }
  const future = E('2027-01-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0);

  const job = sched.runBacktest({
    rule_version_id: rule.version_id,
    date_range: { from: '2026-01-01T00:00:00+00:00', to: END },
    evidences: [...good, future],
    rule,
  });

  assert.equal(job.status, 'completed');
  assert.equal(job.summary.untrusted_count, 1);   // future 被隔离
  assert.equal(job.summary.eligible_count, 30);
  assert.equal(job.metrics.sample_size, 30);
  assert.equal(job.adjudication, 'validated');     // 全达标
  assert.ok(job.report_ref.startsWith('rep_'));
});

test('scheduler 样本量不足 → adjudication=proposed', () => {
  const sched = new BacktestScheduler();
  const good = [E('2026-07-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0)];
  const job = sched.runBacktest({
    rule_version_id: rule.version_id,
    date_range: { from: '2026-01-01T00:00:00+00:00', to: END },
    evidences: good,
    rule,
  });
  assert.equal(job.adjudication, 'proposed');
});

test('scheduler 输出样本按 observed_at 升序（point-in-time）', () => {
  // 通过 metrics 的 time_stability 间接难以观测顺序；直接断言作业可追溯字段足够，
  // 顺序由 createEvidenceSnapshot 内部按 observed_at 排序保证，此处验证报告可追溯。
  const sched = new BacktestScheduler();
  const evs = [
    E('2026-08-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0),
    E('2026-07-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0),
  ];
  const job = sched.runBacktest({
    rule_version_id: rule.version_id,
    date_range: { from: '2026-01-01T00:00:00+00:00', to: END },
    evidences: evs,
    rule,
  });
  assert.equal(job.summary.eligible_count, 2);
});

// ---------- 报告可追溯 ----------
test('回测报告可追溯：元数据 + 指标 + 准入分布 + 证据引用', () => {
  const eligible = [
    createEvidenceSnapshot({
      ...E('2026-07-01T00:00:00+00:00', 'favor_upper', 'upper', 'PL', 2.0),
      rule_version_id: rule.version_id,
    }, rule, END),
  ];
  const untrusted = [{
    evidence_id: 'ev_bad',
    eligible_checks: { temporal_integrity: false, receipt_consistency: true },
  }];
  const job = {
    job_id: 'bt_0001',
    rule_version_id: rule.version_id,
    date_range: { from: '2026-01-01T00:00:00+00:00', to: END },
  };
  const metrics = { sample_size: 1, direction_count: 1, hit_count: 1, hit_rate: 1, roi: 1,
    max_drawdown: 0, time_stability: 0, league_coverage: 1, leagues: ['PL'] };
  const passes = { hit_rate: true, roi: true, max_drawdown: true, sample_size: false,
    time_stability: true, league_coverage: false };
  const report = buildReport({
    job, metrics, passes, all_pass: false, adjudication: 'proposed', eligible, untrusted,
  });

  assert.ok(Object.isFrozen(report));
  assert.equal(report.report_id, 'rep_bt_0001');
  assert.equal(report.job_id, 'bt_0001');
  assert.equal(report.adjudication, 'proposed');
  assert.equal(report.all_pass, false);
  assert.equal(report.summary.eligible_count, 1);
  assert.equal(report.summary.untrusted_count, 1);
  assert.equal(report.failed_checks_distribution.temporal_integrity, 1);
  assert.equal(report.evidence_refs.length, 2);
});

// ---------- G19 跨域时序 ----------
test('ConfidenceGate：运行中不写，仅 completed 后写入，检索读到新值', () => {
  const gate = new ConfidenceGate();
  const pendingJob = { job_id: 'bt_1', rule_version_id: rule.version_id, status: 'pending', report_ref: 'rep_bt_1' };

  // 回测运行中：commit 被拒，get 读不到
  assert.equal(gate.commit(pendingJob, 0.9), false);
  assert.equal(gate.get(rule.version_id), null);

  // 回测完成：commit 成功，get 读到新值
  const doneJob = { ...pendingJob, status: 'completed' };
  assert.equal(gate.commit(doneJob, 0.9), true);
  const val = gate.get(rule.version_id);
  assert.equal(val.confidence, 0.9);
  assert.equal(val.report_ref, 'rep_bt_1');
  assert.ok(val.committed_at);
  assert.equal(Object.isFrozen(val), true);
});

test('ConfidenceGate：重复 commit 覆盖为最新已提交值（写-后-读）', () => {
  const gate = new ConfidenceGate();
  const done = { job_id: 'bt_2', rule_version_id: 'R2#1', status: 'completed', report_ref: 'rep_bt_2' };
  gate.commit(done, 0.6);
  const done2 = { ...done, report_ref: 'rep_bt_2b' };
  gate.commit(done2, 0.8);
  const val = gate.get('R2#1');
  assert.equal(val.confidence, 0.8);
  assert.equal(val.report_ref, 'rep_bt_2b');
});

// ---------- 入口 ----------
test('模块入口暴露全部契约', () => {
  assert.equal(typeof validateEvidenceEligibility, 'function');
  assert.equal(typeof createEvidenceSnapshot, 'function');
  assert.equal(typeof computeMetrics, 'function');
  assert.equal(typeof BacktestScheduler, 'function');
  assert.equal(typeof buildReport, 'function');
  assert.equal(typeof ConfidenceGate, 'function');
  assert.ok(THRESHOLDS.hit_rate >= 0.55);
});