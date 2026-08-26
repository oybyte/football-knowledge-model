// ============================================================================
// 持久化存储层 · db-persistence —— SQLite 落库验证
// 覆盖：迁移/不可变触发器 / 规则幂等 / DB 层不可变 / 状态机经 SQLite store 全生命周期
// / 跨连接持久化 / 预测落库 / 回填 once-only / 证据幂等 / 审计 / 事务回滚 / 冻结契约。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDb, withTransaction } = require('../src/db');
const { createRuleService } = require('../src/rules');
const { normalizePredictionInput, normalizeResultInput, computeVerdict } = require('../src/publish/schema');

/** 构造一条合法 RuleVersion（对齐 validateRuleVersion 必填项） */
function mkRule(overrides = {}) {
  return {
    version_id: 'R001#1',
    rule_id: 'R001',
    version: 1,
    status: 'draft',
    category: 'odds_change',
    condition: { type: 'ATOMIC', field: 'kelly_index.max', op: 'GTE', value: 3 },
    conclusion: { type: 'DIRECTION', value: 'favor_upper' },
    direction: 'favor_upper',
    base_confidence: 0.6,
    priority: 80,
    trust_level: 'untrusted',
    valid_from: '2026-08-01T00:00:00+08:00',
    valid_to: null,
    created_at: '2026-08-01T00:00:00+08:00',
    created_by: 'test:db',
    ...overrides,
  };
}

function tmpDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-edge-db-'));
  return path.join(dir, 'test.db');
}

// ───────────────────────── ① 迁移与不可变触发器 ─────────────────────────

test('迁移 · 建 17 张表（5 运行时 + 12 G12 qd_*）+ 16 个不可变触发器', () => {
  const { db, close } = createDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, [
    'audit_logs', 'backfill_results', 'evidences', 'predictions',
    'qd_ai_candidates', 'qd_analysis_commands', 'qd_audit_log', 'qd_backtest_jobs',
    'qd_data_sources', 'qd_evidence_snapshots', 'qd_field_registry', 'qd_match_features',
    'qd_matches', 'qd_odds_snapshots', 'qd_predictions', 'qd_rule_versions',
    'rule_versions',
  ]);
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all().map((r) => r.name);
  assert.equal(triggers.length, 16);
  close();
});

test('迁移 · 幂等可重复执行', () => {
  const { db, close } = createDb();
  assert.doesNotThrow(() => require('../src/db/schema').migrate(db));
  close();
});

// ───────────────────────── ② 规则落库 ─────────────────────────

test('规则 · insert → getById 返回冻结对象', () => {
  const { ruleStore, close } = createDb();
  const r = ruleStore.insert(mkRule());
  assert.deepEqual(r, { ok: true, errors: [] });
  const got = ruleStore.getById('R001#1');
  assert.ok(got);
  assert.equal(got.rule_id, 'R001');
  assert.equal(Object.isFrozen(got), true, '读取结果必须冻结');
  assert.equal(ruleStore.size(), 1);
  close();
});

test('规则 · 幂等：重复 version_id 拒绝', () => {
  const { ruleStore, close } = createDb();
  ruleStore.insert(mkRule());
  const dup = ruleStore.insert(mkRule());
  assert.equal(dup.ok, false);
  assert.deepEqual(dup.errors, ['duplicate_version_id']);
  assert.equal(ruleStore.size(), 1);
  close();
});

test('规则 · 非法版本被校验拒绝（不入库）', () => {
  const { ruleStore, close } = createDb();
  const bad = mkRule({ direction: 'not_a_direction' });
  const r = ruleStore.insert(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('invalid_direction'));
  assert.equal(ruleStore.size(), 0);
  close();
});

test('规则 · getByRuleId 按 version 降序 / getActive / getByStatus', () => {
  const { ruleStore, close } = createDb();
  ruleStore.insert(mkRule());
  ruleStore.insert(mkRule({ version_id: 'R001#2', version: 2, status: 'active', valid_to: null }));
  const versions = ruleStore.getByRuleId('R001');
  assert.equal(versions.length, 2);
  assert.equal(versions[0].version, 2, '最高版本在前');
  assert.equal(ruleStore.getActive().length, 1);
  assert.equal(ruleStore.getByStatus('draft').length, 1);
  close();
});

test('规则 · 应用层不可变护栏：update/delete/patch 抛错', () => {
  const { ruleStore, close } = createDb();
  assert.throws(() => ruleStore.update(), /immutable_violation/);
  assert.throws(() => ruleStore.delete(), /immutable_violation/);
  assert.throws(() => ruleStore.patch(), /immutable_violation/);
  close();
});

test('规则 · DB 层不可变：触发器拒绝 UPDATE/DELETE', () => {
  const { db, ruleStore, close } = createDb();
  ruleStore.insert(mkRule());
  assert.throws(
    () => db.prepare("UPDATE rule_versions SET status='active' WHERE version_id='R001#1'").run(),
    /immutable_violation/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM rule_versions WHERE version_id='R001#1'").run(),
    /immutable_violation/,
  );
  assert.equal(ruleStore.size(), 1, '数据未被篡改');
  close();
});

// ───────────────────────── ③ 状态机经 SQLite store 全生命周期 ─────────────────────────

test('状态机 · SqliteRuleStore 驱动 draft→…→active 全生命周期', () => {
  const { ruleStore, close } = createDb();
  const svc = createRuleService({ store: ruleStore });
  // 自建 draft 规则（避免依赖原型数据状态）
  const r = svc.store.insert(mkRule({ rule_id: 'R900', version_id: 'R900#1' }));
  assert.equal(r.ok, true);
  const draft = svc.store.getByRuleId('R900')[0];
  assert.equal(draft.status, 'draft');

  const steps = [
    ['proposed', { actor: 'analyst-01' }],
    ['experiment', { actor: 'analyst-01', overrides: { approved_by: 'analyst-01' } }],
    ['validated', { actor: 'analyst-01', overrides: { evidence_count: 30 } }],
    ['approved', { actor: 'reviewer-01' }],
    ['active', { actor: 'reviewer-01' }],
  ];
  for (const [to, opts] of steps) {
    const tr = svc.stateMachine.transition('R900', to, opts);
    assert.equal(tr.ok, true, `${to} 转换应成功: ${JSON.stringify(tr.errors)}`);
  }
  const active = svc.store.getByRuleId('R900')[0];
  assert.equal(active.status, 'active');
  assert.equal(active.version, 6, '每次转换 INSERT 新版本');
  assert.equal(ruleStore.size(), 6);
  close();
});

// ───────────────────────── ④ 跨连接持久化（重启不丢） ─────────────────────────

test('持久化 · 规则跨连接存活（写文件 → 重开 → 可读）', () => {
  const file = tmpDbPath();
  const a = createDb({ path: file });
  a.ruleStore.insert(mkRule());
  a.ruleStore.insert(mkRule({ version_id: 'R001#2', version: 2, status: 'active' }));
  a.close();

  const b = createDb({ path: file });
  assert.equal(b.ruleStore.size(), 2);
  const got = b.ruleStore.getById('R001#2');
  assert.equal(got.status, 'active');
  assert.equal(Object.isFrozen(got), true);
  b.close();
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('持久化 · 预测/回填/证据跨连接存活', () => {
  const file = tmpDbPath();
  const a = createDb({ path: file });
  const pred = normalizePredictionInput({
    prediction_id: 'pred_M001_1', match_id: 'M001', final_direction: 'favor_upper', final_confidence: 0.62,
  });
  a.predictionStore.insert(pred);
  const result = {
    prediction_id: 'pred_M001_1', match_id: 'M001', match_result: 'upper',
    outcome: 'home_win', prediction_correct: true, backfilled_at: '2026-08-02T00:00:00+08:00',
  };
  a.predictionStore.setResult(result);
  a.predictionStore.setEvidence({
    evidence_id: 'ev_000001', prediction_id: 'pred_M001_1', match_id: 'M001',
    predicted_direction: 'favor_upper', match_result: 'upper', prediction_correct: true,
    frozen_at: '2026-08-02T00:00:00+08:00', audit_event_id: 'aud_1',
  });
  a.close();

  const b = createDb({ path: file });
  const p = b.predictionStore.get('pred_M001_1');
  assert.equal(p.final_direction, 'favor_upper');
  assert.equal(Object.isFrozen(p), true);
  assert.equal(b.predictionStore.getResult('pred_M001_1').prediction_correct, true);
  assert.equal(b.predictionStore.getEvidence('ev_000001').match_id, 'M001');
  const merged = b.predictionStore.predictionWithResult('pred_M001_1');
  assert.equal(merged.result.match_result, 'upper');
  b.close();
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

// ───────────────────────── ⑤ 预测 / 回填 / 证据 ─────────────────────────

test('预测 · insert/get/list + 冻结契约', () => {
  const { predictionStore, close } = createDb();
  const pred = normalizePredictionInput({
    prediction_id: 'pred_M001_1', match_id: 'M001', final_direction: 'favor_lower', final_confidence: 0.55,
  });
  const frozen = predictionStore.insert(pred);
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(predictionStore.get('pred_M001_1').final_direction, 'favor_lower');
  assert.equal(predictionStore.list().length, 1);
  close();
});

test('回填 · once-only：重复 setResult 抛 AlreadyBackfilledError', () => {
  const { predictionStore, close } = createDb();
  predictionStore.insert(normalizePredictionInput({
    prediction_id: 'pred_M001_1', match_id: 'M001', final_direction: 'favor_upper', final_confidence: 0.6,
  }));
  const result = {
    prediction_id: 'pred_M001_1', match_id: 'M001', match_result: 'upper',
    outcome: 'home_win', prediction_correct: true, backfilled_at: '2026-08-02T00:00:00+08:00',
  };
  predictionStore.setResult(result);
  assert.throws(() => predictionStore.setResult(result), /already_backfilled/);
  assert.equal(predictionStore.getResult('pred_M001_1').prediction_correct, true, '首次结果未被覆盖');
  close();
});

test('证据 · 幂等：同 evidence_id 重复写入返回既有', () => {
  const { predictionStore, close } = createDb();
  const ev = {
    evidence_id: 'ev_000001', prediction_id: 'pred_M001_1', match_id: 'M001',
    predicted_direction: 'favor_upper', match_result: 'upper', prediction_correct: true,
    frozen_at: '2026-08-02T00:00:00+08:00', audit_event_id: 'aud_1',
  };
  const first = predictionStore.setEvidence(ev);
  const second = predictionStore.setEvidence({ ...ev, match_result: 'lower' });
  assert.equal(second.match_result, 'upper', '重复写入返回既有，不覆盖');
  assert.equal(Object.isFrozen(second), true);
  close();
});

test('预测 · 应用层不可变护栏：update/delete/patch 抛错', () => {
  const { predictionStore, close } = createDb();
  assert.throws(() => predictionStore.update(), /append-only/);
  assert.throws(() => predictionStore.delete(), /append-only/);
  assert.throws(() => predictionStore.patch(), /append-only/);
  close();
});

// ───────────────────────── ⑥ 审计 ─────────────────────────

test('审计 · append/query/size + 只增', () => {
  const { db, auditStore, close } = createDb();
  auditStore.append({ timestamp: '2026-08-02T00:00:00+08:00', level: 'INFO', service: 'rule-storage', trace_id: 't1', message: 'rule_inserted', rule_id: 'R001' });
  auditStore.append({ timestamp: '2026-08-02T00:00:01+08:00', level: 'WARN', service: 'rule-storage', trace_id: 't2', message: 'rule_insert_rejected', errors: ['x'] });
  assert.equal(auditStore.size(), 2);
  const q = auditStore.query({ limit: 1 });
  assert.equal(q.length, 1);
  assert.equal(q[0].message, 'rule_insert_rejected', '降序取最新');
  assert.throws(() => db.prepare("DELETE FROM audit_logs").run(), /immutable_violation/);
  close();
});

// ───────────────────────── ⑦ 事务 ─────────────────────────

test('事务 · 中途抛错回滚，无部分写入', () => {
  const { db, ruleStore, close } = createDb();
  assert.throws(() => {
    withTransaction(db, () => {
      ruleStore.insert(mkRule());
      ruleStore.insert(mkRule({ version_id: 'R001#2', version: 2, status: 'active' }));
      throw new Error('boom');
    });
  }, /boom/);
  assert.equal(ruleStore.size(), 0, '事务回滚后无残留');
  close();
});

test('事务 · 成功提交全部生效', () => {
  const { db, ruleStore, close } = createDb();
  withTransaction(db, () => {
    ruleStore.insert(mkRule());
    ruleStore.insert(mkRule({ version_id: 'R001#2', version: 2, status: 'active' }));
  });
  assert.equal(ruleStore.size(), 2);
  close();
});
