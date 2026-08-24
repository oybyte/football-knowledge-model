// ============================================================================
// 1.8 预测发布/结果回填 · 验收测试
// 覆盖实施计划：发布幂等不可变 / 回填判定 / once-only / 时间安全 / 证据锁定 / 审计可追溯
// 对应 design/prediction-backfill-1.8.0 §4~§7
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PredictionPublisher,
  PredictionStore,
  IdempotencyGuard,
  AuditLog,
  lockEvidence,
  computeVerdict,
  deepFreeze,
  PublishError,
  ImmutableError,
  AlreadyBackfilledError,
} = require('../src/publish');

const CREATED_AT = '2026-08-14T17:45:00+08:00';

/** 构造一个 FusionDecision 风格的发布入参 */
function mkDecision(over = {}) {
  return {
    prediction_id: 'pred_M001_0001',
    match_id: 'M001',
    final_direction: 'favor_upper',
    final_confidence: 0.6,
    weights: { rule: 0.5, model: 0.3, anomaly: 0.2 },
    reasoning_chain: [{ step: 1, source: 'rule:R001#1', included: true, weight: 1, confidence: 0.6 }],
    audit_trail_id: 'fus_000001',
    created_at: CREATED_AT,
    created_by: 'fusion:engine',
    ...over,
  };
}

function freshPublisher(overStore) {
  const store = overStore || new PredictionStore();
  return new PredictionPublisher({ store, guard: new IdempotencyGuard(), audit: new AuditLog(), logger: { info() {}, warn() {} } });
}

const KNOWN = '2026-08-15T21:00:00+08:00'; // 晚于 CREATED_AT

// ───────────────────────── ① 方向判定（computeVerdict） ─────────────────────────

test('判定 · favor_upper 命中 upper', () => {
  const v = computeVerdict('favor_upper', 'upper');
  assert.equal(v.verifiable, true);
  assert.equal(v.prediction_correct, true);
});

test('判定 · favor_upper + lower → miss', () => {
  assert.equal(computeVerdict('favor_upper', 'lower').prediction_correct, false);
});

test('判定 · draw → miss（不计命中）', () => {
  assert.equal(computeVerdict('favor_upper', 'draw').prediction_correct, false);
  assert.equal(computeVerdict('favor_lower', 'draw').prediction_correct, false);
});

test('判定 · favor_lower + lower → 命中', () => {
  assert.equal(computeVerdict('favor_lower', 'lower').prediction_correct, true);
});

test('判定 · 不可判定方向（非 favorite 上/下）→ verifiable=false + correct=null', () => {
  const v = computeVerdict('warning', 'upper');
  assert.equal(v.verifiable, false);
  assert.equal(v.prediction_correct, null);
  assert.equal(v.expected_outcome, null);
});

// ───────────────────────── ② 发布（publish） ─────────────────────────

test('发布 · 成功落库为不可变预测记录 + 写审计', () => {
  const pub = freshPublisher();
  const { published, prediction } = pub.publish({ decision: mkDecision(), idempotency_key: 'k1', created_by: 'worker:retrieval' });
  assert.equal(published, true);

  assert.equal(prediction.prediction_id, 'pred_M001_0001');
  assert.equal(prediction.match_id, 'M001');
  assert.equal(prediction.final_direction, 'favor_upper');
  assert.equal(Object.isFrozen(prediction), true);
  assert.equal(Object.isFrozen(prediction.reasoning_chain), true);
  assert.throws(() => { prediction.final_confidence = 0; }, TypeError);

  // 审计
  const evs = pub.getAudit().filter((e) => e.event_type === 'prediction_generated');
  assert.equal(evs.length, 1);
  assert.equal(evs[0].target_id, 'pred_M001_0001');
  assert.equal(evs[0].actor, 'worker:retrieval');
});

test('发布 · 幂等键判重：重复提交返回既有，不重复写入', () => {
  const pub = freshPublisher();
  const d = mkDecision();
  const first = pub.publish({ decision: d, idempotency_key: 'key-A' });
  const second = pub.publish({ decision: d, idempotency_key: 'key-A' });

  assert.equal(first.published, true);
  assert.equal(second.published, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.prediction.prediction_id, 'pred_M001_0001');
  assert.equal(pub.listPredictions().length, 1);
  assert.equal(pub.getAudit().filter((e) => e.event_type === 'prediction_generated').length, 1);
});

test('发布 · 非法入参被拒（方向不可判定 / 置信度越界 / 缺 match_id）', () => {
  const pub = freshPublisher();
  assert.throws(() => pub.publish({ decision: mkDecision({ final_direction: null }), idempotency_key: 'x1' }), (e) => e.code === 'E2002');
  assert.throws(() => pub.publish({ decision: mkDecision({ final_confidence: 1.5 }), idempotency_key: 'x2' }), (e) => e.code === 'E2003');
  assert.throws(() => pub.publish({ decision: mkDecision({ match_id: undefined }), idempotency_key: 'x3' }), (e) => e.code === 'E2001');
});

test('发布 · 每次发布为独立记录（多场可并存）', () => {
  const pub = freshPublisher();
  pub.publish({ decision: mkDecision(), idempotency_key: 'k1' });
  pub.publish({ decision: mkDecision({ prediction_id: 'pred_M002_0001', match_id: 'M002' }), idempotency_key: 'k2' });
  assert.equal(pub.listPredictions().length, 2);
});

// ───────────────────────── ③ 回填（backfill + 判定） ─────────────────────────

test('回填 · favor_upper + upper → correct=true + 证据锁定 + 审计', () => {
  const pub = freshPublisher();
  pub.publish({ decision: mkDecision(), idempotency_key: 'k1' });

  const { prediction, result, evidence } = pub.backfill({
    prediction_id: 'pred_M001_0001',
    result: { match_result: 'upper', outcome: 'home_win' },
    known_at: KNOWN,
    actor: 'result:ingest',
  });

  assert.equal(result.prediction_correct, true);
  assert.equal(result.verifiable, true);
  assert.equal(result.expected_outcome, 'upper');
  assert.equal(result.match_result, 'upper');
  // 预测主体未变
  assert.equal(prediction.final_direction, 'favor_upper');

  // 证据冻结 + 引用审计
  assert.ok(evidence.evidence_id.startsWith('ev_'));
  assert.equal(evidence.prediction_correct, true);
  assert.equal(Object.isFrozen(evidence), true);

  // 合并视图携带 result
  const view = pub.predictionWithResult('pred_M001_0001');
  assert.equal(view.result.prediction_correct, true);

  // 审计：backfilled + evidence_locked
  const types = pub.getAudit().map((e) => e.event_type);
  assert.ok(types.includes('prediction_backfilled'));
  assert.ok(types.includes('evidence_locked'));
});

test('回填 · favor_lower + lower → correct=true', () => {
  const pub = freshPublisher();
  pub.publish({ decision: mkDecision({ prediction_id: 'pred_M002_0001', match_id: 'M002', final_direction: 'favor_lower' }), idempotency_key: 'k2' });
  const { result } = pub.backfill({ prediction_id: 'pred_M002_0001', result: { match_result: 'lower' }, known_at: KNOWN });
  assert.equal(result.prediction_correct, true);
});

test('回填 · 方向相反 → correct=false', () => {
  const pub = freshPublisher();
  pub.publish({ decision: mkDecision({ prediction_id: 'pred_M003_0001', match_id: 'M003' }), idempotency_key: 'k3' });
  const { result } = pub.backfill({ prediction_id: 'pred_M003_0001', result: { match_result: 'lower' }, known_at: KNOWN });
  assert.equal(result.prediction_correct, false);
});

test('回填 · once-only：重复回填抛 AlreadyBackfilled', () => {
  const pub = freshPublisher();
  pub.publish({ decision: mkDecision(), idempotency_key: 'k1' });
  pub.backfill({ prediction_id: 'pred_M001_0001', result: { match_result: 'upper' }, known_at: KNOWN });
  assert.throws(
    () => pub.backfill({ prediction_id: 'pred_M001_0001', result: { match_result: 'lower' }, known_at: KNOWN }),
    (e) => e instanceof AlreadyBackfilledError,
  );
});

test('回填 · 时间安全：known_at 早于 created_at → 拒绝', () => {
  const pub = freshPublisher();
  pub.publish({ decision: mkDecision(), idempotency_key: 'k1' });
  assert.throws(
    () => pub.backfill({ prediction_id: 'pred_M001_0001', result: { match_result: 'upper' }, known_at: '2026-08-14T10:00:00+08:00' }),
    (e) => e.code === 'E6003',
  );
});

test('回填 · 未发布的 prediction_id → PublishError', () => {
  const pub = freshPublisher();
  assert.throws(
    () => pub.backfill({ prediction_id: 'pred_GHOST_0001', result: { match_result: 'upper' }, known_at: KNOWN }),
    (e) => e.code === 'E6001',
  );
});

test('回填 · 非法 match_result 被拒', () => {
  const pub = freshPublisher();
  pub.publish({ decision: mkDecision(), idempotency_key: 'k1' });
  assert.throws(
    () => pub.backfill({ prediction_id: 'pred_M001_0001', result: { match_result: 'over' }, known_at: KNOWN }),
    (e) => e.code === 'E3002',
  );
});

// ───────────────────────── ④ 不可变护栏（store / audit） ─────────────────────────

test('不可变 · 预测主体禁止 UPDATE/DELETE/PATCH', () => {
  const store = new PredictionStore();
  store.insert(mkDecision());
  const call = (op) => () => store[op]();
  assert.throws(call('update'), ImmutableError);
  assert.throws(call('delete'), ImmutableError);
  assert.throws(call('patch'), ImmutableError);
});

test('不可变 · 审计日志禁止 UPDATE/DELETE', () => {
  const aud = new AuditLog();
  aud.append({ event_type: 'prediction_generated', target_id: 't1' });
  assert.throws(() => aud.update(), ImmutableError);
  assert.throws(() => aud.delete(), ImmutableError);
  assert.equal(aud.list().length, 1);
});

test('不可变 · deepFreeze 深度冻结嵌套', () => {
  const obj = deepFreeze({ a: { b: [1, 2] }, c: [{ d: 1 }] });
  assert.equal(Object.isFrozen(obj), true);
  assert.equal(Object.isFrozen(obj.a), true);
  assert.equal(Object.isFrozen(obj.a.b), true);
  assert.throws(() => { obj.a.b.push(3); }, TypeError);
});

test('不可变 · 证据记录为 append-only（lockEvidence）', () => {
  const store = new PredictionStore();
  const ev1 = lockEvidence({ prediction_id: 'p1', match_id: 'M', predicted_direction: 'favor_upper', match_result: 'upper', prediction_correct: true, frozen_at: 't', audit_event_id: 'e1' }, store);
  const ev2 = lockEvidence({ prediction_id: 'p2', match_id: 'M', predicted_direction: 'favor_lower', match_result: 'lower', prediction_correct: true, frozen_at: 't', audit_event_id: 'e2' }, store);
  assert.notEqual(ev1.evidence_id, ev2.evidence_id);
  assert.equal(Object.isFrozen(ev1), true);
  assert.throws(() => { ev1.prediction_correct = false; }, TypeError);
});

// ───────────────────────── ⑤ 可追溯（预测 ↔ 审计 ↔ 证据） ─────────────────────────

test('可追溯 · 完整链路：预测记录 → 审计 → 证据 → 合并视图', () => {
  const pub = freshPublisher();
  const dec = mkDecision();
  const { prediction } = pub.publish({ decision: dec, idempotency_key: 'k-trace' });
  const { result, evidence } = pub.backfill({ prediction_id: dec.prediction_id, result: { match_result: 'upper' }, known_at: KNOWN });

  // prediction_generated 审计引用 prediction_id
  const gen = pub.getAudit().find((e) => e.event_type === 'prediction_generated');
  assert.equal(gen.target_id, dec.prediction_id);
  assert.equal(gen.details.audit_trail_id, dec.audit_trail_id);

  // 回填结果与证据交叉索引一致
  assert.equal(result.evidence_id, evidence.evidence_id);
  assert.equal(result.audit_event_id, evidence.audit_event_id);
  assert.equal(evidence.prediction_id, dec.prediction_id);
  assert.equal(result.prediction_correct, prediction.final_direction === 'favor_upper' ? true : false);

  // 合并视图完整
  const view = pub.predictionWithResult(dec.prediction_id);
  assert.equal(view.final_direction, 'favor_upper');
  assert.equal(view.result.prediction_correct, true);
});

// ───────────────────────── ⑥ 入口契约 ─────────────────────────

test('入口 · 对外暴露全部契约', () => {
  assert.equal(typeof PredictionPublisher, 'function');
  assert.equal(typeof PredictionStore, 'function');
  assert.equal(typeof IdempotencyGuard, 'function');
  assert.equal(typeof AuditLog, 'function');
  assert.equal(typeof lockEvidence, 'function');
  assert.equal(typeof computeVerdict, 'function');
  assert.equal(typeof deepFreeze, 'function');
  assert.ok(PublishError && ImmutableError && AlreadyBackfilledError);
});