// ============================================================================
// A1·T2 G12 预测写入适配器 · g12_writer 测试
// 覆盖：FK 锚点补全（audit_log / analysis_commands）、缺 match 诚实失败（E2005）、
// 幂等（重复写返回既有）、事务原子回滚、与 backfillG12 锚点语义对齐。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDb } = require('../src/db');
const { createG12PredictionWriter } = require('../src/publish/g12_writer');

/** 构造带 match + writer 的 db。 */
function setup() {
  const db = createDb({ path: ':memory:' });
  db.qd.matches.insert({
    match_id: 'M001', league: '日职联', home_team: '东京绿茵', away_team: '柏太阳神',
    match_time: '2026-08-14T18:00:00+08:00', status: 'scheduled',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });
  const writer = createG12PredictionWriter({ db: db.db, qd: db.qd, logger: { info() {}, warn() {} } });
  return { db, writer };
}

function rec(over = {}) {
  return {
    prediction_id: 'pred_1', match_id: 'M001', command_id: 'cmd_1',
    final_direction: 'favor_upper', final_confidence: 0.7,
    weights: { ruleR001: 0.6 }, reasoning_chain: ['handicap.change=-0.3'],
    audit_trail_id: 'aud_hl', created_at: '2026-08-13T12:00:00Z', created_by: 'publish:engine',
    ...over,
  };
}

test('T2 · 写入 qd_predictions 并自动补全 audit_log / analysis_commands 锚点', () => {
  const { db, writer } = setup();
  const res = writer.write(rec());
  assert.equal(res.inserted, true);
  assert.equal(res.prediction.match_id, 'M001');
  assert.equal(db.qd.predictions.count(), 1);
  // FK 锚点：审计 + 分析命令均已落库
  assert.ok(db.qd.audit_log.get('aud_hl'), '已有审计锚点优先复用');
  assert.ok(db.qd.analysis_commands.get('cmd_1'), '命令锚点预置');
  const pred = db.qd.predictions.get('pred_1');
  assert.equal(pred.audit_trail_id, 'aud_hl');
  assert.equal(pred.command_id, 'cmd_1');
});

test('T2 · 缺 audit_trail_id 时补占位审计锚点（与 backfill 一致）', () => {
  const { db, writer } = setup();
  const r = rec({ audit_trail_id: null });
  const res = writer.write(r);
  assert.equal(res.inserted, true);
  const pred = db.qd.predictions.get('pred_1');
  assert.ok(pred.audit_trail_id, '应生成审计锚点 id');
  assert.ok(db.qd.audit_log.get(pred.audit_trail_id), '占位审计锚点落库');
});

test('T2 · 缺 match → 诚实失败 E2005（不捏造），事务无残留', () => {
  const { db, writer } = setup();
  assert.throws(
    () => writer.write(rec({ prediction_id: 'pred_orphan', match_id: 'NOEXIST' })),
    (e) => e.code === 'E2005' && /missing_match:NOEXIST/.test(e.message),
  );
  assert.equal(db.qd.predictions.count(), 0, '失败事务回滚：predictions 无残留');
  assert.equal(db.qd.audit_log.count(), 0, '失败事务回滚：审计锚点无残留');
});

test('T2 · 幂等：同 prediction_id 重复写返回既有（inserted=false），不产生重复行', () => {
  const { db, writer } = setup();
  const first = writer.write(rec());
  assert.equal(first.inserted, true);
  const second = writer.write(rec({ final_confidence: 0.9 })); // 内容变化也应被幂等挡下
  assert.equal(second.inserted, false);
  assert.equal(second.prediction.prediction_id, 'pred_1');
  assert.equal(db.qd.predictions.count(), 1);
  assert.equal(db.qd.predictions.get('pred_1').final_confidence, 0.7, '首次内容未被覆盖');
});

test('T2 · 事务原子性：中途抛错整体回滚（缺 match 后不残留任何锚点）', () => {
  const { db, writer } = setup();
  // 缺 match 在锚点补全之前抛错 → 若事务未回滚，此前不会有任何 qd_* 行残留
  assert.throws(
    () => writer.write(rec({ prediction_id: 'pred_x', match_id: 'NOEXIST', command_id: 'cmd_x', audit_trail_id: null })),
    (e) => e.code === 'E2005',
  );
  assert.equal(db.qd.predictions.count(), 0);
  assert.equal(db.qd.audit_log.count(), 0);
  assert.equal(db.qd.analysis_commands.count(), 0);
});
