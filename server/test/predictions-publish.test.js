// ============================================================================
// P0② 预测发布 / 幂等赛果回填 · 集成测试（hermetic）
// 覆盖：发布落库 + 审计 / 幂等重发 / 方向判定 / once-only 回填 / 非方向拒绝。
// 使用真实 SQLite 存储（:memory:）+ DB 审计适配器，模拟生产持久化语义。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDb } = require('../src/db');
const { PredictionPublisher } = require('../src/publish');
const { SqliteAuditAdapter } = require('../src/publish/db_audit_adapter');
const { fuseV97Decision } = require('../src/fusion/v97_input');

function makePublisher() {
  const db = createDb({ path: ':memory:' });
  const publisher = new PredictionPublisher({
    store: db.predictionStore,
    audit: new SqliteAuditAdapter(db.auditStore),
  });
  return { db, publisher };
}

// 构造一个带方向型维度命中的 v97 块 → 融合出 favor_upper 决策
function upperDecision(match_id = 'M_TEST', conf = 0.7) {
  const v97 = {
    rule_count: 88,
    rules: [
      { rule_id: 'R13', status: 'hit', dimensions: { direction: ['上盘'] }, effects: [], missing: [] },
    ],
    fields: Array.from({ length: 12 }, (_, i) => ({ field: 'f' + i, status: 'ok' })),
  };
  return fuseV97Decision({ match_id, v97, rules: [{ rule_id: 'R13', base_confidence: conf }] });
}

test('① 发布：V9.7→融合决策 落库 + 审计持久化', () => {
  const { db, publisher } = makePublisher();
  const fused = upperDecision('M_P1', 0.7);
  assert.ok(fused.rule_output && fused.decision.final_direction === 'favor_upper');

  const res = publisher.publish({
    decision: {
      prediction_id: fused.decision.prediction_id,
      match_id: 'M_P1',
      final_direction: fused.decision.final_direction,
      final_confidence: fused.decision.final_confidence,
      weights: fused.decision.weights,
      reasoning_chain: fused.decision.reasoning_chain,
      audit_trail_id: fused.decision.audit_trail_id,
      created_by: 'test',
    },
    idempotency_key: 'pred:M_P1',
    created_by: 'test',
  });

  assert.equal(res.published, true);
  assert.ok(res.prediction.prediction_id);
  assert.equal(res.prediction.final_direction, 'favor_upper');
  // 审计确实落库（跨调用可读）
  const aud = db.auditStore.query({ limit: 10 });
  assert.ok(aud.some((e) => e.event_type === 'prediction_generated'));
  db.close();
});

test('② 幂等：同 idempotency_key 重发 → duplicate，不新增记录', () => {
  const { db, publisher } = makePublisher();
  const fused = upperDecision('M_P2', 0.6);
  const dec = () => ({
    prediction_id: fused.decision.prediction_id,
    match_id: 'M_P2',
    final_direction: fused.decision.final_direction,
    final_confidence: fused.decision.final_confidence,
    weights: {},
    reasoning_chain: [],
    audit_trail_id: fused.decision.audit_trail_id,
    created_by: 'test',
  });
  const a = publisher.publish({ decision: dec(), idempotency_key: 'pred:M_P2' });
  const b = publisher.publish({ decision: dec(), idempotency_key: 'pred:M_P2' });
  assert.equal(a.published, true);
  assert.equal(b.published, false);
  assert.equal(b.duplicate, true);
  assert.equal(publisher.listPredictions().length, 1, '仅一条预测记录');
  db.close();
});

test('③ 回填：预测上盘 + 赛果 upper → 命中；once-only 重复回填抛错', () => {
  const { db, publisher } = makePublisher();
  const fused = upperDecision('M_P3', 0.65);
  const res = publisher.publish({
    decision: {
      prediction_id: fused.decision.prediction_id, match_id: 'M_P3',
      final_direction: fused.decision.final_direction, final_confidence: fused.decision.final_confidence,
      weights: {}, reasoning_chain: [], audit_trail_id: fused.decision.audit_trail_id, created_by: 'test',
    },
    idempotency_key: 'pred:M_P3', created_by: 'test',
  });
  const pid = res.prediction.prediction_id;

  const r1 = publisher.backfill({ prediction_id: pid, result: { match_result: 'upper', outcome: 'home_win' }, known_at: new Date().toISOString() });
  assert.equal(r1.result.prediction_correct, true);
  assert.equal(r1.result.verifiable, true);

  // 重复回填必须失败（once-only 护栏）
  assert.throws(
    () => publisher.backfill({ prediction_id: pid, result: { match_result: 'upper' }, known_at: new Date().toISOString() }),
    (e) => e.name === 'AlreadyBackfilledError',
  );
  db.close();
});

test('④ 回填：预测上盘 + 赛果 lower → 未命中（方向判负）', () => {
  const { db, publisher } = makePublisher();
  const fused = upperDecision('M_P4', 0.6);
  const res = publisher.publish({
    decision: {
      prediction_id: fused.decision.prediction_id, match_id: 'M_P4',
      final_direction: fused.decision.final_direction, final_confidence: fused.decision.final_confidence,
      weights: {}, reasoning_chain: [], audit_trail_id: fused.decision.audit_trail_id, created_by: 'test',
    },
    idempotency_key: 'pred:M_P4', created_by: 'test',
  });
  const r = publisher.backfill({
    prediction_id: res.prediction.prediction_id,
    result: { match_result: 'lower', outcome: 'away_win' },
    known_at: new Date().toISOString(),
  });
  assert.equal(r.result.prediction_correct, false);
  assert.equal(r.result.verifiable, true);
  db.close();
});

test('⑤ 非方向型维度命中 → 融合 direction=null → 发布被拒（须 verifiable 方向）', () => {
  // 仅门禁/信号维度，无 direction → fuseV97Decision.decision.final_direction = null
  const v97 = {
    rule_count: 88,
    rules: [
      { rule_id: 'S25', status: 'hit', dimensions: { total_goals_signal: ['略看小球'] }, effects: [], missing: [] },
    ],
    fields: Array.from({ length: 12 }, () => ({ field: 'f', status: 'ok' })),
  };
  const fused = fuseV97Decision({ match_id: 'M_P5', v97, rules: [] });
  assert.equal(fused.decision.final_direction, null, '无方向型维度不得臆造方向');

  // 即使强行调用 publish，schema 也应拒绝非 verifiable 方向（模拟 handler 前置校验）
  const { db, publisher } = makePublisher();
  assert.throws(
    () => publisher.publish({
      decision: {
        prediction_id: 'pred_M_P5', match_id: 'M_P5',
        final_direction: null, final_confidence: 0.5,
        weights: {}, reasoning_chain: [], audit_trail_id: 'x', created_by: 'test',
      },
      idempotency_key: 'pred:M_P5', created_by: 'test',
    }),
    (e) => e.name === 'PublishError' && e.code === 'E2002',
  );
  db.close();
});

test('⑥ predictionWithResult：回填后合并视图含 result', () => {
  const { db, publisher } = makePublisher();
  const fused = upperDecision('M_P6', 0.7);
  const res = publisher.publish({
    decision: {
      prediction_id: fused.decision.prediction_id, match_id: 'M_P6',
      final_direction: fused.decision.final_direction, final_confidence: fused.decision.final_confidence,
      weights: {}, reasoning_chain: [], audit_trail_id: fused.decision.audit_trail_id, created_by: 'test',
    },
    idempotency_key: 'pred:M_P6', created_by: 'test',
  });
  publisher.backfill({
    prediction_id: res.prediction.prediction_id,
    result: { match_result: 'upper', outcome: 'home_win' },
    known_at: new Date().toISOString(),
  });
  const merged = publisher.predictionWithResult(res.prediction.prediction_id);
  assert.ok(merged.result, '回填结果应出现在合并视图');
  assert.equal(merged.result.match_result, 'upper');
  db.close();
});
