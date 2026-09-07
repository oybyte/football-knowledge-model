// ============================================================================
// A1·T3 发布事务原子化 · publisher 接入 g12_writer 集成测试
// 覆盖：G12 事务写路径（qd_predictions + qd_analysis_commands + qd_audit_log 锚点
// 同一事务原子提交）、缺 match 诚实失败（E2005）且 qd_* 无残留、幂等双层
// （guard 同 key / G12 INSERT OR IGNORE 同 prediction_id）、审计锚点复用。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDb } = require('../src/db');
const { PredictionPublisher } = require('../src/publish');
const { createG12PredictionWriter } = require('../src/publish/g12_writer');

const silent = { info() {}, warn() {}, error() {} };

/** 构造 db + qd match + g12Writer + publisher。 */
function setup() {
  const db = createDb({ path: ':memory:' });
  db.qd.matches.insert({
    match_id: 'M001', league: '日职联', home_team: '东京绿茵', away_team: '柏太阳神',
    match_time: '2026-08-14T18:00:00+08:00', status: 'scheduled',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });
  const writer = createG12PredictionWriter({ db: db.db, qd: db.qd, logger: silent });
  const publisher = new PredictionPublisher({ g12Writer: writer, logger: silent });
  return { db, writer, publisher };
}

function decision(over = {}) {
  return {
    prediction_id: 'pred_t3_1', match_id: 'M001', command_id: 'cmd_t3_1',
    final_direction: 'favor_upper', final_confidence: 0.7,
    weights: { r1: 0.6 }, reasoning_chain: ['handicap.change=-0.3'],
    audit_trail_id: 'aud_t3_1', created_by: 'test',
    ...over,
  };
}

test('T3 · publisher(g12Writer) 发布 → qd_predictions + qd_analysis_commands + qd_audit_log 同事务落库', () => {
  const { db, publisher } = setup();
  const res = publisher.publish({ decision: decision(), command_id: 'cmd_t3_1', idempotency_key: 'k1', created_by: 'test' });
  assert.equal(res.published, true);
  assert.equal(res.prediction.final_direction, 'favor_upper');
  // 三表同事务落库
  assert.equal(db.qd.predictions.count(), 1);
  assert.ok(db.qd.audit_log.get('aud_t3_1'), '审计锚点落库');
  assert.equal(db.qd.audit_log.get('aud_t3_1').event_type, 'prediction_published');
  assert.ok(db.qd.analysis_commands.get('cmd_t3_1'), '命令锚点落库');
  const pred = db.qd.predictions.get('pred_t3_1');
  assert.equal(pred.audit_trail_id, 'aud_t3_1');
  assert.equal(pred.command_id, 'cmd_t3_1');
  db.close();
});

test('T3 · 缺 match → 发布抛 E2005，qd_predictions/audit_log/analysis_commands 三表无残留（事务原子回滚）', () => {
  const { db, publisher } = setup();
  assert.throws(
    () => publisher.publish({ decision: decision({ prediction_id: 'pred_t3_orphan', match_id: 'NOEXIST' }), idempotency_key: 'k2' }),
    (e) => e.code === 'E2005' && /missing_match:NOEXIST/.test(e.message),
  );
  assert.equal(db.qd.predictions.count(), 0);
  assert.equal(db.qd.audit_log.count(), 0);
  assert.equal(db.qd.analysis_commands.count(), 0);
  db.close();
});

test('T3 · 幂等层 1：同 idempotency_key 重发 → guard duplicate，不新增', () => {
  const { db, publisher } = setup();
  const a = publisher.publish({ decision: decision(), idempotency_key: 'k3' });
  const b = publisher.publish({ decision: decision(), idempotency_key: 'k3' });
  assert.equal(a.published, true);
  assert.equal(b.published, false);
  assert.equal(b.duplicate, true);
  assert.equal(db.qd.predictions.count(), 1);
  db.close();
});

test('T3 · 幂等层 2：不同 key 同 prediction_id → G12 INSERT OR IGNORE 返回既有（inserted=false 兜底）', () => {
  const { db, publisher } = setup();
  const a = publisher.publish({ decision: decision(), idempotency_key: 'k4a' });
  const b = publisher.publish({ decision: decision({ final_confidence: 0.9 }), idempotency_key: 'k4b' });
  assert.equal(a.published, true);
  assert.equal(b.published, false);
  assert.equal(b.duplicate, true);
  assert.equal(b.prediction.prediction_id, 'pred_t3_1');
  assert.equal(db.qd.predictions.count(), 1);
  assert.equal(db.qd.predictions.get('pred_t3_1').final_confidence, 0.7, '首次内容不被覆盖');
  db.close();
});

test('T3 · 审计锚点复用：已存在的 audit_trail_id 不重复插入 prediction_published', () => {
  const { db, publisher } = setup();
  db.qd.audit_log.insert({
    event_id: 'aud_exist', event_type: 'prediction_published',
    timestamp: '2026-08-13T12:00:00Z', actor: 'pre',
    target_id: 'x', details: {}, prev_state: null, new_state: null,
  });
  const res = publisher.publish({ decision: decision({ audit_trail_id: 'aud_exist', command_id: null }), idempotency_key: 'k5' });
  assert.equal(res.published, true);
  assert.equal(db.qd.audit_log.count(), 1, '复用既有锚点，不重复插入');
  assert.equal(db.qd.predictions.get('pred_t3_1').audit_trail_id, 'aud_exist');
  db.close();
});

test('T3 · 无 g12Writer 时原路径不受影响（运行时 store + 审计仍工作）', () => {
  const db = createDb({ path: ':memory:' });
  const { SqliteAuditAdapter } = require('../src/publish/db_audit_adapter');
  const publisher = new PredictionPublisher({
    store: db.predictionStore,
    audit: new SqliteAuditAdapter(db.auditStore),
    logger: silent,
  });
  const res = publisher.publish({
    decision: { prediction_id: 'pred_legacy_1', match_id: 'M001', final_direction: 'favor_upper', final_confidence: 0.6, weights: {}, reasoning_chain: [], audit_trail_id: 'aud_legacy_1', created_by: 'test' },
    idempotency_key: 'k_legacy',
  });
  assert.equal(res.published, true);
  assert.equal(db.predictionStore.get('pred_legacy_1').final_direction, 'favor_upper');
  const aud = db.auditStore.query({ limit: 10 });
  assert.ok(aud.some((e) => e.event_type === 'prediction_generated'), '原路径审计仍写 prediction_generated');
  db.close();
});
