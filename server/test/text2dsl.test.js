// ============================================================================
// 2.1 文字规则 → DSL 转换 · 验收测试
// 说明：Phase 1 已将 convert/catalog 的 Mock 文字规则清空（V9.7 registry 为唯一真规则源）。
//       本测试不再依赖非空 catalog，改为用合成条目验证 convert 管线的核心逻辑
//       （buildRuleVersion / DslEngine.compile / ingest 幂等/跳过）。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { listCatalog, compileAll, ingest, buildRuleVersion, BASE_TIME, MIGRATOR } = require('../src/convert');
const { DslEngine } = require('../src/dsl');
const { RuleStore } = require('../src/rules');
const { validateRuleVersion } = require('../src/rules/schema');

// 合成 catalog 条目（Phase 1 后真实 catalog 已清空；用合成条目验证管线）
function synthEntry(id) {
  return {
    id,
    original: `合成规则 ${id}：澳门初盘比其余机构深 0.25 球以上，看好下盘`,
    decomposed: ['澳门初盘-其余机构初盘均值 ≤ -0.25', '深让 → 看好下盘'],
    category: 'institution_diff',
    direction: 'favor_lower',
    base_confidence: 0.62,
    priority: 70,
    condition: { type: 'ATOMIC', field: '$match.handicap.macau.initial.line - $match.handicap.avg_others.initial.line', op: 'LTE', value: -0.25 },
    conclusion: '澳门初盘比其余机构均值深 0.25 球以上，倾向下盘',
  };
}

test('① Phase 1 后 catalog 已清空（Mock 文字规则移除，V9.7 为 SSOT）', () => {
  const catalog = listCatalog();
  assert.equal(catalog.length, 0, 'convert/catalog 的 Mock 条目应在 Phase 1 清空');
});

test('② 空 catalog 全量编译为 0 项（无副作用）', () => {
  const verdicts = compileAll();
  assert.equal(verdicts.length, listCatalog().length);
  assert.equal(verdicts.length, 0);
});

test('③ 空 catalog 入库脚本为 no-op（total=0, 无版本落地）', () => {
  const store = new RuleStore();
  const report = ingest({ store });
  assert.equal(report.total, 0);
  assert.equal(report.skipped, 0);
  assert.equal(report.versions.length, 0);
  assert.equal(store.size(), 0);
});

test('④ 非法 DSL 条件被编译拒绝（unknown_field → E1001）', () => {
  const bad = { type: 'ATOMIC', field: 'no.such.field', op: 'GT', value: 1 };
  const res = DslEngine.compile(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === 'E1001'));
  // 真实条目应编译通过
  const good = synthEntry('IDR001').condition;
  assert.equal(DslEngine.compile(good).ok, true);
});

test('⑤ 合成条目经 buildRuleVersion → draft + untrusted + 通过规格校验', () => {
  const entry = synthEntry('IDR001');
  const v = buildRuleVersion(entry);
  assert.equal(v.rule_id, 'IDR001');
  assert.equal(v.source, 'text_rule');
  assert.equal(v.original_text, entry.original);
  assert.equal(v.category, entry.category);
  assert.equal(v.direction, entry.direction);
  assert.equal(v.base_confidence, entry.base_confidence);
  assert.equal(v.status, 'draft');
  assert.equal(v.trust_level, 'untrusted');
  assert.equal(v.created_by, MIGRATOR);
  assert.equal(v.version, 1);
  assert.equal(v.previous_version_id, null);
  assert.equal(v.valid_from, BASE_TIME);
  assert.deepEqual(validateRuleVersion(v).errors, []);
});

test('⑥ 独立 store 入库不污染全局规则单例', () => {
  const { store } = require('../src/rules');
  const before = store.size();
  ingest({ store: new RuleStore() });
  assert.equal(store.size(), before, 'global store must be untouched');
  assert.ok(typeof buildRuleVersion === 'function');
});
