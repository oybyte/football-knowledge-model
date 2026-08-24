// ============================================================================
// 1.3 规则存储服务 · 验收测试
// 覆盖实施计划 1.3 的 5 条验收标准 + 原型迁移：
//   ① 非法状态转换被拒绝  ② 并发转换安全（锁生效）
//   ③ 审计记录完整可追溯  ④ DB 层 UPDATE/DELETE 被阻止
//   ⑤ 日志行含强制字段，敏感信息脱敏  ⑥ 原型 16 条规则迁移
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RuleStore, ImmutableError } = require('../src/rules/store');
const { StateMachine } = require('../src/rules/stateMachine');
const { LockManager } = require('../src/rules/lockManager');
const { Logger, LEVELS, mask } = require('../src/lib/logger');
const { loadPrototypeRules } = require('../src/rules/migrate');
const {
  isLegalTransition,
  checkPrecondition,
  validateRuleVersion,
  LEGAL_TRANSITIONS,
} = require('../src/rules/schema');
const { recordAudit, filterAudit } = require('../src/vault/audit');

// ───────────────────────── 测试辅助 ─────────────────────────

/** 构造一份合法 RuleVersion 的最小样例 */
function validVersion(overrides = {}) {
  return {
    version_id: 'R_TEST#1',
    rule_id: 'R_TEST',
    version: 1,
    category: 'odds_change',
    league_scope: [],
    team_scope: [],
    condition: { type: 'ATOMIC', field: 'move_pattern', op: 'EQ', value: '升盘降水' },
    conclusion: '测试结论',
    direction: 'favor_upper',
    base_confidence: 0.5,
    priority: 50,
    trust_level: 'provisional',
    valid_from: '2026-08-14T00:00:00+08:00',
    valid_to: null,
    evidence_refs: [],
    evidence_count: 0,
    status: 'draft',
    previous_version_id: null,
    created_at: '2026-08-14T00:00:00+08:00',
    created_by: 'tester',
    approved_at: null,
    approved_by: null,
    approval_note: null,
    superseded_at: null,
    deprecated_at: null,
    ...overrides,
  };
}

/** 构造一个带 store + lockManager + stateMachine 的隔离测试环境 */
function setupEnv() {
  const store = new RuleStore();
  const lockManager = new LockManager();
  const sm = new StateMachine({ store, lockManager });
  return { store, lockManager, sm };
}

// ───────────────────────── 验收① 非法状态转换被拒绝 ─────────────────────────

test('验收① draft→proposed 合法转换成功', () => {
  const { store, sm } = setupEnv();
  store.insert(validVersion());
  const r = sm.transition('R_TEST', 'proposed', { actor: 'analyst' });
  assert.equal(r.ok, true);
  assert.equal(r.version.status, 'proposed');
  assert.equal(r.version.version, 2);
  assert.equal(r.version.previous_version_id, 'R_TEST#1');
  // 旧版本不变
  const old = store.getById('R_TEST#1');
  assert.equal(old.status, 'draft');
});

test('验收① draft→active 非法转换被拒绝', () => {
  const { store, sm } = setupEnv();
  store.insert(validVersion());
  const r = sm.transition('R_TEST', 'active', { actor: 'analyst' });
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes('illegal_transition'));
});

test('验收① superseded→active 不可复活', () => {
  const { store, sm } = setupEnv();
  store.insert(validVersion({ status: 'superseded' }));
  const r = sm.transition('R_TEST', 'active', { actor: 'analyst' });
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes('illegal_transition'));
});

test('验收① 合法转换矩阵全覆盖', () => {
  for (const [from, tos] of Object.entries(LEGAL_TRANSITIONS)) {
    for (const to of tos) {
      assert.ok(isLegalTransition(from, to), `${from}→${to} 应为合法`);
    }
  }
  // 非法转换示例
  assert.equal(isLegalTransition('draft', 'active'), false);
  assert.equal(isLegalTransition('superseded', 'draft'), false);
  assert.equal(isLegalTransition('deprecated', 'active'), false);
});

// ───────────────────────── 验收② 并发转换安全（锁生效）─────────────────────────

test('验收② 并发获取锁只有一个成功', () => {
  const lockManager = new LockManager();
  const release = lockManager.acquire('R001', 'worker-A');
  assert.ok(typeof release === 'function');
  const release2 = lockManager.acquire('R001', 'worker-B');
  assert.equal(release2, null); // 被锁阻塞
  release();
  // 释放后可再次获取
  const release3 = lockManager.acquire('R001', 'worker-C');
  assert.ok(release3);
  release3();
});

test('验收② 心跳续期', () => {
  const lockManager = new LockManager();
  const release = lockManager.acquire('R001', 'worker-A');
  assert.ok(lockManager.heartbeat('R001', 'worker-A'));
  assert.equal(lockManager.heartbeat('R001', 'worker-B'), false); // 非持锁者
  release();
});

test('验收② 锁超时自动释放', () => {
  const lockManager = new LockManager({ timeoutMs: 50 });
  lockManager.acquire('R001', 'worker-A');
  // 不 release，等超时
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(lockManager.isLocked('R001'), false);
      resolve();
    }, 200);
  });
});

test('验收② 状态转换期间规则被锁', () => {
  const { store, lockManager, sm } = setupEnv();
  store.insert(validVersion());
  // 手动持锁，模拟并发
  const blockRelease = lockManager.acquire('R_TEST', 'other-process');
  const r = sm.transition('R_TEST', 'proposed', { actor: 'analyst' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('lock_busy'));
  blockRelease();
  // 锁释放后可转换
  const r2 = sm.transition('R_TEST', 'proposed', { actor: 'analyst' });
  assert.equal(r2.ok, true);
});

// ───────────────────────── 验收③ 审计记录完整可追溯 ─────────────────────────

test('验收③ 状态转换写审计日志', () => {
  const { store, sm } = setupEnv();
  store.insert(validVersion());
  sm.transition('R_TEST', 'proposed', { actor: 'analyst', note: '提交审核' });
  const audits = filterAudit('rule_status_transitioned');
  assert.ok(audits.length >= 1);
  const last = audits[audits.length - 1];
  assert.equal(last.actor, 'analyst');
  assert.equal(last.details.from_status, 'draft');
  assert.equal(last.details.to_status, 'proposed');
  assert.equal(last.details.note, '提交审核');
});

test('验收③ 非法转换写拒绝审计', () => {
  const { store, sm } = setupEnv();
  store.insert(validVersion());
  sm.transition('R_TEST', 'active', { actor: 'hacker' });
  const rejected = filterAudit('rule_status_transition_rejected');
  assert.ok(rejected.length >= 1);
  assert.equal(rejected[rejected.length - 1].details.reason, 'illegal');
});

// ───────────────────────── 验收④ Append-only ─────────────────────────

test('验收④ store.insert 写入成功', () => {
  const store = new RuleStore();
  const r = store.insert(validVersion());
  assert.equal(r.ok, true);
  assert.equal(store.size(), 1);
});

test('验收④ store.update 抛 ImmutableError', () => {
  const store = new RuleStore();
  assert.throws(() => store.update(), ImmutableError);
});

test('验收④ store.delete 抛 ImmutableError', () => {
  const store = new RuleStore();
  assert.throws(() => store.delete(), ImmutableError);
});

test('验收④ store.patch 抛 ImmutableError', () => {
  const store = new RuleStore();
  assert.throws(() => store.patch(), ImmutableError);
});

test('验收④ 重复 version_id 拒绝', () => {
  const store = new RuleStore();
  store.insert(validVersion());
  const r = store.insert(validVersion());
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('duplicate_version_id'));
});

test('验收④ 写入后版本不可变（Object.freeze）', () => {
  const store = new RuleStore();
  store.insert(validVersion());
  const v = store.getById('R_TEST#1');
  assert.ok(Object.isFrozen(v));
});

// ───────────────────────── 验收⑤ 结构化日志 + 脱敏 ─────────────────────────

test('验收⑤ 日志行含强制字段', () => {
  const lines = [];
  const logger = new Logger({ service: 'test-svc', sink: (l) => lines.push(l) });
  logger.info('test message', { rule_id: 'R001' });
  const entry = JSON.parse(lines[0]);
  assert.ok(entry.timestamp);
  assert.equal(entry.level, 'INFO');
  assert.equal(entry.service, 'test-svc');
  assert.ok(entry.trace_id);
  assert.equal(entry.message, 'test message');
  assert.equal(entry.rule_id, 'R001');
});

test('验收⑤ DEBUG 级别在 INFO 阈值下不输出', () => {
  const lines = [];
  const logger = new Logger({ service: 'test', minLevel: LEVELS.INFO, sink: (l) => lines.push(l) });
  logger.debug('should skip');
  logger.info('should pass');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).level, 'INFO');
});

test('验收⑤ 敏感字段自动脱敏', () => {
  const lines = [];
  const logger = new Logger({ service: 'test', sink: (l) => lines.push(l) });
  logger.info('ctx with secret', { api_key: 'sk-12345', token: 'tok-abc', normal_field: 42 });
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.api_key, '***');
  assert.equal(entry.token, '***');
  assert.equal(entry.normal_field, 42);
});

test('验收⑤ mask 函数递归脱敏', () => {
  const obj = { nested: { password: 'secret', data: 1 }, list: [{ token: 'x' }] };
  const masked = mask(obj);
  assert.equal(masked.nested.password, '***');
  assert.equal(masked.nested.data, 1);
  assert.equal(masked.list[0].token, '***');
});

// ───────────────────────── 验收⑥ 原型 16 条规则迁移 ─────────────────────────

test('验收⑥ 迁移 16 条规则全部有效', () => {
  const rules = loadPrototypeRules();
  assert.equal(rules.length, 16);
  for (const v of rules) {
    const { ok, errors } = validateRuleVersion(v);
    assert.ok(ok, `${v.rule_id} 校验失败: ${errors.join(', ')}`);
  }
});

test('验收⑥ 迁移后全部 status=active', () => {
  const rules = loadPrototypeRules();
  for (const v of rules) {
    assert.equal(v.status, 'active', `${v.rule_id} 应为 active`);
  }
});

test('验收⑥ 占位规则 R006/R010 标记 untrusted + base_confidence=0', () => {
  const rules = loadPrototypeRules();
  const r006 = rules.find((r) => r.rule_id === 'R006');
  const r010 = rules.find((r) => r.rule_id === 'R010');
  assert.equal(r006.trust_level, 'untrusted');
  assert.equal(r006.base_confidence, 0);
  assert.equal(r010.trust_level, 'untrusted');
  assert.equal(r010.base_confidence, 0);
});

test('验收⑥ R001 ConditionDSL 正确', () => {
  const rules = loadPrototypeRules();
  const r001 = rules.find((r) => r.rule_id === 'R001');
  assert.equal(r001.condition.type, 'ATOMIC');
  assert.equal(r001.condition.field, 'move_pattern');
  assert.equal(r001.condition.op, 'EQ');
  assert.equal(r001.condition.value, '升盘降水');
});

test('验收⑥ R009 OR 条件正确', () => {
  const rules = loadPrototypeRules();
  const r009 = rules.find((r) => r.rule_id === 'R009');
  assert.equal(r009.condition.type, 'OR');
  assert.equal(r009.condition.conditions.length, 2);
  assert.equal(r009.condition.conditions[0].field, 'kelly_index.max');
  assert.equal(r009.condition.conditions[1].field, 'kelly_index.min');
});

test('验收⑥ R013 AND 条件正确', () => {
  const rules = loadPrototypeRules();
  const r013 = rules.find((r) => r.rule_id === 'R013');
  assert.equal(r013.condition.type, 'AND');
  assert.equal(r013.condition.conditions[0].field, 'stability_flag');
  assert.equal(r013.condition.conditions[1].field, 'water.upper.drop_count');
});

test('验收⑥ R004 direction=follow（动态方向）', () => {
  const rules = loadPrototypeRules();
  const r004 = rules.find((r) => r.rule_id === 'R004');
  assert.equal(r004.direction, 'follow');
});

test('验收⑥ 迁移规则可全部插入 store', () => {
  const store = new RuleStore();
  for (const v of loadPrototypeRules()) {
    const r = store.insert(v);
    assert.ok(r.ok, `${v.rule_id} 插入失败: ${r.errors.join(', ')}`);
  }
  assert.equal(store.size(), 16);
  assert.equal(store.getActive().length, 16);
});

// ───────────────────────── 附加：前置条件 ─────────────────────────

test('前置条件：draft→proposed 需要 condition + conclusion', () => {
  const v = validVersion({ condition: null, conclusion: null });
  const pre = checkPrecondition(v, 'proposed');
  assert.equal(pre.ok, false);
  assert.equal(pre.reason, 'condition_required');
});

test('前置条件：experiment→validated 需要 evidence', () => {
  const v = validVersion({ status: 'experiment', evidence_count: 0 });
  const pre = checkPrecondition(v, 'validated');
  assert.equal(pre.ok, false);
  assert.equal(pre.reason, 'evidence_required');
});

test('前置条件：validated→approved 需要 approver', () => {
  const v = validVersion({ status: 'validated', approved_by: null });
  const pre = checkPrecondition(v, 'approved');
  assert.equal(pre.ok, false);
  assert.equal(pre.reason, 'approver_required');
});

test('完整生命周期：draft → proposed → experiment → validated → approved → active', () => {
  const { store, sm } = setupEnv();
  store.insert(validVersion());
  const actor = 'analyst';

  // draft → proposed
  let r = sm.transition('R_TEST', 'proposed', { actor });
  assert.equal(r.ok, true);

  // proposed → experiment（需要 approved_by）
  r = sm.transition('R_TEST', 'experiment', { actor, overrides: { approved_by: 'reviewer' } });
  assert.equal(r.ok, true);

  // experiment → validated（需要 evidence）
  r = sm.transition('R_TEST', 'validated', { actor, overrides: { evidence_count: 5, evidence_refs: ['ev1', 'ev2'] } });
  assert.equal(r.ok, true);

  // validated → approved
  r = sm.transition('R_TEST', 'approved', { actor: 'reviewer', overrides: { approved_by: 'reviewer' } });
  assert.equal(r.ok, true);
  assert.ok(r.version.approved_at);

  // approved → active
  r = sm.transition('R_TEST', 'active', { actor });
  assert.equal(r.ok, true);
  assert.equal(r.version.status, 'active');

  // 版本号递增
  assert.equal(r.version.version, 6);
});
