// ============================================================================
// 服务启动入口 · service-bootstrap —— createService 装配验证
// 覆盖：默认/自定义路径落库、seed 幂等（重启不丢不重）、状态机经启动入口可用、
// 优雅关闭、getStatus 计数、seed:false 不迁移。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createService, DEFAULT_DB_PATH } = require('../src');
const { loadPrototypeRules } = require('../src/rules');

const PROTOTYPE_COUNT = loadPrototypeRules().length;

function tmpDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-edge-svc-'));
  return path.join(dir, 'svc.db');
}

function rmDir(file) {
  try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}

test('启动 · 默认路径创建文件 DB + 种子规则落库', async () => {
  const svc = await createService({ dbPath: tmpDbPath() });
  const dbPath = svc.getStatus().dbPath;
  assert.ok(fs.existsSync(dbPath), 'DB 文件应存在');
  assert.equal(svc.ruleStore.size(), PROTOTYPE_COUNT, '原型规则全部落库');
  assert.equal(svc.rules.getActiveRules().length, PROTOTYPE_COUNT);
  assert.ok(svc.rules.getActiveRules().some((r) => r.rule_id === 'R001'));
  assert.equal(svc.auditStore.size(), 0);
  svc.close();
  rmDir(dbPath);
});

test('启动 · seed 幂等：重启同一文件不重复不丢失', async () => {
  const file = tmpDbPath();
  const a = await createService({ dbPath: file });
  assert.equal(a.ruleStore.size(), PROTOTYPE_COUNT);
  // 重启前写入一条自定义规则，验证重启后仍在
  a.ruleStore.insert({
    version_id: 'R900#1', rule_id: 'R900', version: 1, status: 'draft',
    category: 'odds_change', condition: { type: 'ATOMIC', field: 'kelly_index.max', op: 'GTE', value: 3 },
    conclusion: { type: 'DIRECTION', value: 'favor_upper' }, direction: 'favor_upper',
    base_confidence: 0.6, priority: 80, trust_level: 'untrusted',
    valid_from: '2026-08-01T00:00:00+08:00', valid_to: null,
    created_at: '2026-08-01T00:00:00+08:00', created_by: 'test:bootstrap',
  });
  a.close();

  const b = await createService({ dbPath: file });
  assert.equal(b.ruleStore.size(), PROTOTYPE_COUNT + 1, '重启 seed 不重复');
  assert.ok(b.ruleStore.getById('R900#1'), '重启后自定义规则仍在');
  b.close();
  rmDir(file);
});

test('启动 · 状态机经启动入口 rules.stateMachine 可用（落库转换）', async () => {
  const file = tmpDbPath();
  const svc = await createService({ dbPath: file });
  const r = svc.rules.store.insert({
    version_id: 'R901#1', rule_id: 'R901', version: 1, status: 'draft',
    category: 'odds_change', condition: { type: 'ATOMIC', field: 'kelly_index.max', op: 'GTE', value: 3 },
    conclusion: { type: 'DIRECTION', value: 'favor_upper' }, direction: 'favor_upper',
    base_confidence: 0.6, priority: 80, trust_level: 'untrusted',
    valid_from: '2026-08-01T00:00:00+08:00', valid_to: null,
    created_at: '2026-08-01T00:00:00+08:00', created_by: 'test:bootstrap',
  });
  assert.equal(r.ok, true);
  const tr = svc.rules.stateMachine.transition('R901', 'proposed', { actor: 'analyst-01' });
  assert.equal(tr.ok, true, JSON.stringify(tr.errors));
  assert.equal(svc.rules.getRuleVersions('R901')[0].status, 'proposed');
  svc.close();
  rmDir(file);
});

test('启动 · seed:false 不迁移原型规则', async () => {
  const svc = await createService({ dbPath: tmpDbPath(), seed: false });
  const dbPath = svc.getStatus().dbPath;
  assert.equal(svc.ruleStore.size(), 0);
  svc.close();
  rmDir(dbPath);
});

test('启动 · getStatus 返回各存储计数', async () => {
  const svc = await createService({ dbPath: tmpDbPath() });
  const st = svc.getStatus();
  assert.ok(st.dbPath);
  assert.equal(st.ruleVersions, PROTOTYPE_COUNT);
  assert.equal(st.activeRules, PROTOTYPE_COUNT);
  assert.equal(st.predictions, 0);
  assert.equal(st.auditEntries, 0);
  svc.close();
  rmDir(st.dbPath);
});

test('启动 · close 后 DB 文件仍存在（数据已落盘）', async () => {
  const file = tmpDbPath();
  const svc = await createService({ dbPath: file });
  svc.close();
  assert.ok(fs.existsSync(file), 'close 后文件保留，数据持久化');
  rmDir(file);
});

test('启动 · DEFAULT_DB_PATH 指向 server/data/odds-edge.db', () => {
  assert.ok(DEFAULT_DB_PATH.endsWith(path.join('data', 'odds-edge.db')));
});
