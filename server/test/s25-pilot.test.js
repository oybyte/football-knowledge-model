// ============================================================================
// P1 · S25 转正试点 —— 规则自我生长第一个完整闭环 测试（hermetic）
//
// 覆盖：
//  ① computeMetrics 总进球轴（axis=total_goals）方向/命中/ROI 计算
//  ② gatedKeys 语义：max_drawdown 仅作参考指标，不阻断硬门禁（用户 stated）
//  ③ totalGoalsLean 语义映射（大球→over / 小球→under / 无→null）
//  ④ buildS25Evidence 端到端：真实 V9.7 规则 + 合成 MatchSchema → 不可变 eligible 证据
//  ⑤ fuseV97Decision 透出 total_goals_direction（双轴：让球方向 + 总进球方向）
//  ⑥ 发布双轴：仅 total_goals_direction 可判 → 接受发布；赛果回填总进球轴判定正确
//  ⑦ promoteV97RuleToValidated 闭环：active+provisional → 回测达标 → re-certify 为 trusted
//  ⑧ promote 失败：命中率/edge 未达硬门禁 → pass=false，不伪造、不转正
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeMetrics, THRESHOLDS } = require('../src/backtest/metrics');
const { buildS25Evidence, totalGoalsLean } = require('../src/backtest/v97_evidence');
const { fuseV97Decision } = require('../src/fusion/v97_input');
const { promoteV97RuleToValidated, S25_GATE, S25_GATED_KEYS } = require('../src/promote');
const { RuleStore, StateMachine, lockManager } = require('../src/rules');
const { PredictionPublisher } = require('../src/publish');
const { createDb } = require('../src/db');
const { SqliteAuditAdapter } = require('../src/publish/db_audit_adapter');

// ───────────────────────── 合成 eligible 证据（total_goals 轴） ─────────────────────────
// 每条：over/under 方向 + 对应赛果 + 十进制赔付 odds + 联赛 + 时点。
function tgEvidence(n, opts = {}) {
  const { overWins = n, odds = 1.9, leagues = ['英超'] } = opts;
  const arr = [];
  for (let i = 0; i < n; i++) {
    const hit = i < overWins;
    arr.push({
      observed_at: '2026-06-05T12:00:00+08:00', // 单季内 → time_stability=0
      verdict_direction: 'over',
      match_result: hit ? 'over' : 'under',
      odds,
      league: leagues[i % leagues.length],
    });
  }
  return arr;
}

// ───────────────────────── V9.7 规则 + MatchSchema 夹具（供 buildS25Evidence） ─────────────────────────
function s25LikeRule() {
  return {
    id: 'S25',
    atoms: [{
      atom_id: 'S25.1',
      all_of: [{ field: 'competition_type', op: 'eq', value: '联赛' }], // 联赛名启发式 → 命中
      effects: [{ dimension: 'total_goals_signal', value: '赔付放开=略看小球' }], // → under
    }],
  };
}
function mkMatch(over = {}) {
  const base = {
    match_id: 'm1', league: '英超', home_team: 'A', away_team: 'B',
    match_time: '2026-08-14T18:00:00+08:00', status: 'scheduled',
    observed_at: '2026-08-14T10:00:00+08:00', received_at: '2026-08-14T10:00:00+08:00',
    actual_result: 'home_win', home_score: 2, away_score: 0,
    meta: { total_goals: 2, kickoff_display: '08-14 18:00' }, // 2 < 2.5 → under（与 lean 一致 → 命中）
    snapshots: [{
      snapshot_id: 's1', match_id: 'm1', institution: 'macau', market: 'over_under',
      source_id: 'src_manual_odds', trust_level: 'provisional',
      observed_at: '2026-08-14T10:00:00+08:00', received_at: '2026-08-14T10:00:00+08:00',
      data: { line: '2.5', over_odds: 0.9, under_odds: 0.9 }, // water 0.9 → odds=1.9
    }],
    errors: [],
  };
  return { ...base, ...over, snapshots: over.snapshots || base.snapshots };
}

// ───────────────────────── V9.7 RuleVersion 夹具（S25 active+provisional） ─────────────────────────
function mkS25Version(ruleId = 'S25', overrides = {}) {
  return {
    version_id: `${ruleId}#1`,
    rule_id: ruleId,
    version: 1,
    category: '总进球',
    direction: 'signal',
    condition: { type: 'ATOMIC', field: 'x', op: 'eq', value: 1 },
    conclusion: '总进球盘阻诱逻辑对齐',
    base_confidence: 0.6,
    priority: 80,
    trust_level: 'provisional',
    valid_from: '2026-08-14T00:00:00+08:00', // 历史时点（past）→ approved→active 前置校验通过
    valid_to: null,
    evidence_refs: [],
    evidence_count: 0,
    status: 'active',
    previous_version_id: null,
    created_at: '2026-08-14T00:00:00+08:00',
    created_by: 'test:s25',
    ...overrides,
  };
}
function makeStore(ruleId = 'S25') {
  const store = new RuleStore();
  store.insert(mkS25Version(ruleId));
  return new StateMachine({ store, lockManager });
}

// ───────────────────────── ① computeMetrics 总进球轴 ─────────────────────────
test('① computeMetrics（total_goals 轴）：全命中 → 命中率 100% / 正 edge / 达标', () => {
  const ev = tgEvidence(84, { overWins: 84, odds: 1.9 }); // hit_rate=1.0, roi=(84*1.9-84)/84=0.9
  const { metrics, passes, all_pass, gated_keys } = computeMetrics(ev, {
    axis: 'total_goals', thresholds: S25_GATE, gatedKeys: S25_GATED_KEYS,
  });
  assert.equal(metrics.sample_size, 84);
  assert.equal(metrics.direction_count, 84);
  assert.equal(metrics.hit_count, 84);
  assert.equal(metrics.hit_rate, 1);
  assert.ok(metrics.roi > 0, 'edge 应为正（水位 0.9 → odds 1.9）');
  assert.equal(gated_keys.join(','), 'hit_rate,roi,sample_size');
  assert.equal(all_pass, true, JSON.stringify(passes));
});

// ───────────────────────── ② gatedKeys 语义：参考指标不阻断 ─────────────────────────
test('② gatedKeys：max_drawdown 超阈但仅作参考 → 硬门禁仍通过；全键判定则失败', () => {
  // 70 胜 30 负 → 资金曲线先升后落（drawdown≈0.47），命中率 0.7，edge 0.33，均在硬门禁内
  const ev = tgEvidence(100, { overWins: 70, odds: 1.9, leagues: ['英超', '西甲'] });

  // 仅按用户 stated 三项硬门禁（命中率/edge/样本） → 通过（max_drawdown 被排除）
  const gated = computeMetrics(ev, {
    axis: 'total_goals', thresholds: S25_GATE, gatedKeys: S25_GATED_KEYS,
  });
  assert.equal(gated.all_pass, true, '硬门禁应放行（参考指标不参与）');
  assert.equal(gated.metrics.max_drawdown > 0.15, true, '真实 drawdown 确已偏高（参考透明）');

  // 全键判定（默认） → max_drawdown(0.15) 不达标 → 不通过
  const full = computeMetrics(ev, { axis: 'total_goals', thresholds: THRESHOLDS });
  assert.equal(full.all_pass, false, '全键判定应因 drawdown 失败');
  assert.equal(full.passes.max_drawdown, false);
});

// ───────────────────────── ③ totalGoalsLean 映射 ─────────────────────────
test('③ totalGoalsLean：大球→over / 小球→under / 无→null', () => {
  assert.equal(totalGoalsLean({ total_goals_signal: ['赔付放开=略看大球'] }), 'over');
  assert.equal(totalGoalsLean({ total_goals_signal: ['阻大=真实看大球'] }), 'over');
  assert.equal(totalGoalsLean({ total_goals_signal: ['赔付放开=略看小球'] }), 'under');
  assert.equal(totalGoalsLean({ total_goals_signal: ['阻小=真实看小球'] }), 'under');
  assert.equal(totalGoalsLean({ gate: ['共振前置'] }), null, '非大小球语义不得臆造方向');
  assert.equal(totalGoalsLean({}), null);
});

// ───────────────────────── ④ buildS25Evidence 端到端 ─────────────────────────
test('④ buildS25Evidence：V9.7 规则×合成 MatchSchema → 不可变 eligible 证据', () => {
  const ev = buildS25Evidence(s25LikeRule(), [mkMatch()]);
  assert.ok(Array.isArray(ev), '应返回证据数组');
  assert.equal(ev.length, 1, '联赛恒命中 + 总进球压 under 线 → 1 条');
  const e = ev[0];
  assert.equal(e.verdict_direction, 'under', '总进球信号→under 倾向');
  assert.equal(e.match_result, 'under', '实际总进球 2 < 线 2.5 → under 命中');
  assert.equal(e.odds, 1.9, '水位 0.9 → 十进制赔付 1.9');
  assert.equal(e.league, '英超');
  assert.equal(Object.isFrozen(e), true, '证据快照必须冻结不可变');
});

test('④b buildS25Evidence：无赛果/压线 → 不产生证据（不虚报）', () => {
  const noTg = mkMatch({ meta: { total_goals: null } }); // 无总进球 → 跳过
  assert.equal(buildS25Evidence(s25LikeRule(), [noTg]).length, 0);
  const push = mkMatch({ meta: { total_goals: 2.5 } }); // 压线 → 排除
  assert.equal(buildS25Evidence(s25LikeRule(), [push]).length, 0);
});

// ───────────────────────── ⑤ fuseV97Decision 透出 total_goals_direction ─────────────────────────
test('⑤ fuseV97Decision：S25 大小球信号 → total_goals_direction 透出（双轴之第二轴）', () => {
  const fused = fuseV97Decision({
    match_id: 'M1',
    v97: {
      rule_count: 88,
      rules: [{ rule_id: 'S25', status: 'hit', dimensions: { total_goals_signal: ['赔付放开=略看小球'] }, effects: [], missing: [] }],
      fields: Array.from({ length: 12 }, () => ({ field: 'x', status: 'ok' })),
    },
    rules: [{ rule_id: 'S25', base_confidence: 0.6 }],
  });
  assert.equal(fused.decision.final_direction, null, '无方向型维度 → 让球方向弃判');
  assert.equal(fused.total_goals_direction, 'under', '总进球轴方向应透出 under');
  assert.ok(fused.dimensions.total_goals_signal, '维度结论应保留');
});

test('⑤b fuseV97Decision：总进球大小球 → over', () => {
  const fused = fuseV97Decision({
    match_id: 'M2',
    v97: {
      rule_count: 88,
      rules: [{ rule_id: 'S25', status: 'hit', dimensions: { total_goals_signal: ['略看大球'] }, effects: [], missing: [] }],
      fields: Array.from({ length: 12 }, () => ({ field: 'x', status: 'ok' })),
    },
    rules: [{ rule_id: 'S25', base_confidence: 0.6 }],
  });
  assert.equal(fused.total_goals_direction, 'over');
});

// ───────────────────────── ⑥ 发布双轴：仅总进球方向可判 ─────────────────────────
test('⑥ 发布：仅 total_goals_direction（无让球方向）→ 接受发布；赛果回填总进球轴判定正确', () => {
  const { db, publisher } = makePublisher();
  const fused = fuseV97Decision({
    match_id: 'M_TG',
    v97: {
      rule_count: 88,
      rules: [{ rule_id: 'S25', status: 'hit', dimensions: { total_goals_signal: ['略看大球'] }, effects: [], missing: [] }],
      fields: Array.from({ length: 12 }, () => ({ field: 'x', status: 'ok' })),
    },
    rules: [{ rule_id: 'S25', base_confidence: 0.6 }],
  });
  assert.equal(fused.total_goals_direction, 'over');
  assert.equal(fused.decision.final_direction, null);

  const res = publisher.publish({
    decision: {
      prediction_id: fused.decision.prediction_id,
      match_id: 'M_TG',
      final_direction: null, // 让球方向弃判
      total_goals_direction: fused.total_goals_direction, // 总进球轴可判 → 允许发布
      final_confidence: fused.decision.final_confidence,
      weights: fused.decision.weights,
      reasoning_chain: fused.decision.reasoning_chain,
      audit_trail_id: fused.decision.audit_trail_id,
      created_by: 'test',
    },
    idempotency_key: 'pred:M_TG',
    created_by: 'test',
  });
  assert.equal(res.published, true);
  assert.equal(res.prediction.total_goals_direction, 'over', '总进球方向应落库');

  // 回填：让球赛果随便填（final_direction 为 null 不计入），总进球轴 over 命中
  const r = publisher.backfill({
    prediction_id: res.prediction.prediction_id,
    result: { match_result: 'upper', total_goals_result: 'over' },
    known_at: new Date().toISOString(),
  });
  assert.equal(r.result.total_goals_verifiable, true);
  assert.equal(r.result.total_goals_correct, true, '总进球轴 over→over 应判中');
  db.close();
});

// ───────────────────────── ⑦ promote 闭环：re-certify 为 trusted ─────────────────────────
test('⑦ promoteV97RuleToValidated：回测达标 → active+provisional 经闭环 re-certify 为 active+trusted', () => {
  const sm = makeStore('S25');
  const evidence = tgEvidence(84, { overWins: 84, odds: 1.9 }); // 命中率 100% / edge 正 / 样本 84 ≥ 80

  const res = promoteV97RuleToValidated({
    rule_id: 'S25',
    store: sm.store,
    stateMachine: sm,
    sample: evidence,
    approver: 'script:s25-pilot',
  });

  assert.equal(res.ok, true, JSON.stringify(res.errors || res.failure_report));
  assert.equal(res.pass, true);
  assert.equal(res.promoted.status, 'active', '终态仍是 active（仍在引擎内）');
  assert.equal(res.promoted.trust_level, 'trusted', '信任升级为 trusted');
  assert.equal(res.evidence_count, 84, '证据留痕 84 场');
  assert.equal(res.report.hit_rate, 1);
  assert.ok(res.report.roi > 0);

  // 版本链：原始 active + validated + approved + 终态 active（含 trusted 版本）
  const versions = sm.store.getByRuleId('S25');
  const statuses = versions.map((v) => v.status);
  assert.ok(statuses.includes('validated'));
  assert.ok(statuses.includes('approved'));
  assert.ok(versions.some((v) => v.trust_level === 'trusted'), '应存在 trusted 版本');
});

// ───────────────────────── ⑧ promote 失败：不达标不伪造 ─────────────────────────
test('⑧ promoteV97RuleToValidated：命中率/edge 未达硬门禁 → 失败报告，不转正、不伪造', () => {
  const sm = makeStore('S25');
  // 40/100 命中（<55%）且 edge 负 → 硬门禁失败
  const evidence = tgEvidence(100, { overWins: 40, odds: 1.9, leagues: ['英超', '西甲'] });

  const res = promoteV97RuleToValidated({
    rule_id: 'S25',
    store: sm.store,
    stateMachine: sm,
    sample: evidence,
    approver: 'script:s25-pilot',
  });

  assert.equal(res.pass, false, '硬门禁未过');
  assert.equal(res.ok, false);
  assert.equal(res.promoted, null, '不得制造 active 版本');
  assert.ok(res.failure_report, '应有失败报告');
  assert.equal(res.failure_report.sample_size, 100);
  // 规则保持原状（active + provisional），未产生新版本
  const versions = sm.store.getByRuleId('S25');
  assert.equal(versions.length, 1, '不应新增版本');
  assert.equal(versions[0].status, 'active');
  assert.equal(versions[0].trust_level, 'provisional');
});

// ───────────────────────── helpers ─────────────────────────
function makePublisher() {
  const db = createDb({ path: ':memory:' });
  const publisher = new PredictionPublisher({
    store: db.predictionStore,
    audit: new SqliteAuditAdapter(db.auditStore),
  });
  return { db, publisher };
}
