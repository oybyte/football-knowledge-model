// ============================================================================
// 1.4 DSL 引擎 · 验收测试
// 覆盖实施计划 1.4 的 4 条验收标准：
//   ① 14 条规则求值全部正确  ② 时间泄漏校验阻断生效
//   ③ 推理链输出完整（每个原子条件结果）  ④ 错误码与 dsl-syntax 一致（7 个）
// 附加：编译期校验（8 项）、算子语义、加权 Jaccard、外部引用
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { compile, evaluate, weightedJaccard, MAX_DEPTH, MAX_CONDITIONS } = require('../src/dsl');
const { applyOperator } = require('../src/dsl/operators');
const { getMockMatch } = require('../src/data/mock');
const { computeMatchFeatures } = require('../src/features');
const { FIELD_REGISTRY, TYPES } = require('../src/dsl/registry');

// ───────────────────────── 测试辅助 ─────────────────────────

const T = '2026-08-14T17:45:00+08:00';

// M007 特征快照 + match 外部引用视图（供 R003）
const DATA = (() => {
  const m = getMockMatch('M007');
  const fs = computeMatchFeatures(m, T);
  return {
    features: fs.snapshot.features,
    match: { handicap: { macau: { initial: { line: -0.5 } }, avg_others: { initial: { line: -0.5 } } } },
  };
})();

// DSL 条件构造器（与 DSL 语法一致；本测试自包含，不依赖生产 seed 数据）
function a(field, op, value, extra = {}) { return { type: 'ATOMIC', field, op, value, ...extra }; }
function and(...conditions) { return { type: 'AND', conditions }; }
function or(...conditions) { return { type: 'OR', conditions }; }
const NEVER = a('time_to_match', 'GT', 999999);

// 内联 DSL 规则夹具：复刻原 16 条原型规则（R006/R010 为占位 NEVER）。
// 注意：DSL 引擎验收用自包含夹具，避免与 V9.7 seed（88 条真规则）耦合。
const FIXTURE = [
  { rule_id: 'R001', version_id: 'R001#1', direction: 'favor_upper', valid_from: '2026-08-14T00:00:00+08:00', condition: a('move_pattern', 'EQ', '升盘降水') },
  { rule_id: 'R002', version_id: 'R002#1', direction: 'favor_lower', valid_from: '2026-08-14T00:00:00+08:00', condition: a('move_pattern', 'EQ', '降盘升水') },
  { rule_id: 'R003', version_id: 'R003#1', direction: 'favor_lower', valid_from: '2026-08-14T00:00:00+08:00', condition: a('$match.handicap.macau.initial.line - $match.handicap.avg_others.initial.line', 'LTE', -0.25) },
  { rule_id: 'R004', version_id: 'R004#1', direction: 'follow', valid_from: '2026-08-14T00:00:00+08:00', condition: a('institution.sync_count', 'GTE', 3) },
  { rule_id: 'R005', version_id: 'R005#1', direction: 'warning', valid_from: '2026-08-14T00:00:00+08:00', condition: a('volume.ratio', 'GTE', 2.5) },
  { rule_id: 'R006', version_id: 'R006#1', direction: 'warning', valid_from: '2026-08-14T00:00:00+08:00', condition: NEVER },
  { rule_id: 'R007', version_id: 'R007#1', direction: 'favor_upper', valid_from: '2026-08-14T00:00:00+08:00', condition: and(a('stability_flag', 'EQ', true), a('move_pattern', 'EQ', '稳定')) },
  { rule_id: 'R008', version_id: 'R008#1', direction: 'warning', valid_from: '2026-08-14T00:00:00+08:00', condition: a('water.upper.dispersion', 'GTE', 0.15) },
  { rule_id: 'R009', version_id: 'R009#1', direction: 'warning', valid_from: '2026-08-14T00:00:00+08:00', condition: or(a('kelly_index.max', 'GTE', 1.05), a('kelly_index.min', 'LTE', 0.90)) },
  { rule_id: 'R010', version_id: 'R010#1', direction: 'warning', valid_from: '2026-08-14T00:00:00+08:00', condition: NEVER },
  { rule_id: 'R011', version_id: 'R011#1', direction: 'favor_lower', valid_from: '2026-08-14T00:00:00+08:00', condition: a('move_pattern', 'EQ', '升盘不降水') },
  { rule_id: 'R012', version_id: 'R012#1', direction: 'warning', valid_from: '2026-08-14T00:00:00+08:00', condition: a('volume.ratio', 'GTE', 2.5) },
  { rule_id: 'R013', version_id: 'R013#1', direction: 'favor_upper', valid_from: '2026-08-14T00:00:00+08:00', condition: and(a('stability_flag', 'EQ', true), a('water.upper.drop_count', 'GTE', 2)) },
  { rule_id: 'R014', version_id: 'R014#1', direction: 'favor_lower', valid_from: '2026-08-14T00:00:00+08:00', condition: and(a('stability_flag', 'EQ', true), a('water.upper.rise_count', 'GTE', 2)) },
  { rule_id: 'R015', version_id: 'R015#1', direction: 'warning', valid_from: '2026-08-14T00:00:00+08:00', condition: and(a('betfair.dominant_ratio', 'GT', 0.45), a('betfair.heat', 'ABS_GT', 50)) },
  { rule_id: 'R016', version_id: 'R016#1', direction: 'warning', valid_from: '2026-08-14T00:00:00+08:00', condition: a('kelly_index.home_max', 'GTE', 0.98) },
];

// 14 条真实规则（排除占位 R006/R010）
const REAL_RULES = FIXTURE.filter((r) => !['R006', 'R010'].includes(r.rule_id));

/** make a lightweight valid rule for time-leak tests */
function mkRule(overrides = {}) {
  return {
    version_id: 'R_T#1',
    rule_id: 'R_T',
    version: 1,
    category: 'odds_change',
    direction: 'favor_upper',
    condition: { type: 'ATOMIC', field: 'time_to_match', op: 'LTE', value: 30 },
    valid_from: '2026-08-01T00:00:00+08:00',
    valid_to: null,
    ...overrides,
  };
}

// M007 下应命中的规则（基于实际特征值推导）
const EXPECT_HIT = ['R007', 'R008', 'R013', 'R015', 'R016'];

// ───────────────────────── 验收① 14 条规则求值全部正确 ─────────────────────────

test('验收① 14 条真实规则编译全部通过', () => {
  assert.equal(REAL_RULES.length, 14);
  for (const r of REAL_RULES) {
    const c = compile(r.condition);
    assert.ok(c.ok, `${r.rule_id} 编译失败: ${c.errors.map((e) => `${e.code}:${e.message}`).join(', ')}`);
  }
});

test('验收① 14 条真实规则求值全部返回有效 RuleMatch', () => {
  for (const r of REAL_RULES) {
    const rm = evaluate(r, DATA, { evaluated_at: T });
    assert.equal(typeof rm.hit, 'boolean', r.rule_id);
    assert.equal(rm.rule_id, r.rule_id);
    assert.equal(rm.version_id, r.version_id);
    assert.equal(rm.evaluated_at, T);
    assert.ok(Array.isArray(rm.chain), r.rule_id);
    assert.ok(!rm.skipped, `${r.rule_id} 不应被跳过`);
  }
});

test('验收① M007 命中规则与预期一致', () => {
  const hits = [];
  for (const r of REAL_RULES) {
    const rm = evaluate(r, DATA, { evaluated_at: T });
    if (rm.hit) hits.push(r.rule_id);
  }
  assert.deepEqual(hits.sort(), EXPECT_HIT.sort());
});

test('验收① 命中规则为 exact 命中（match_degree=1）', () => {
  for (const id of EXPECT_HIT) {
    const r = REAL_RULES.find((x) => x.rule_id === id);
    const rm = evaluate(r, DATA, { evaluated_at: T });
    assert.equal(rm.exact, true, id);
    assert.equal(rm.match_degree, 1, id);
    assert.equal(rm.match_type, 'exact', id);
  }
});

test('验收① 未命中规则 match_type=none 或 fuzzy（非 exact）', () => {
  for (const r of REAL_RULES) {
    if (EXPECT_HIT.includes(r.rule_id)) continue;
    const rm = evaluate(r, DATA, { evaluated_at: T });
    assert.equal(rm.exact, false, r.rule_id);
    assert.notEqual(rm.match_type, 'exact', r.rule_id);
  }
});

// ───────────────────────── 验收② 时间泄漏校验阻断 ─────────────────────────

test('验收② valid_from 在未来 → skipped + E2001', () => {
  const r = mkRule({ valid_from: '2026-08-20T00:00:00+08:00' }); // T 之后
  const rm = evaluate(r, DATA, { evaluated_at: T });
  assert.equal(rm.skipped, true);
  assert.equal(rm.hit, false);
  assert.ok(rm.warnings.some((w) => w.includes('E2001')));
  assert.ok(rm.skip_reason.includes('valid_from_in_future'));
});

test('验收② valid_to 已过期 → skipped + E2001', () => {
  const r = mkRule({ valid_to: '2026-08-01T00:00:00+08:00' }); // T 之前
  const rm = evaluate(r, DATA, { evaluated_at: T });
  assert.equal(rm.skipped, true);
  assert.equal(rm.hit, false);
  assert.ok(rm.skip_reason.includes('E2001'));
});

test('验收② valid 窗内不跳过', () => {
  const r = mkRule(); // valid_from in past, valid_to null
  const rm = evaluate(r, DATA, { evaluated_at: T });
  assert.equal(rm.skipped, false);
});

// ───────────────────────── 验收③ 推理链输出完整 ─────────────────────────

test('验收③ 推理链包含每个原子条件结果', () => {
  const r = REAL_RULES.find((x) => x.rule_id === 'R013'); // AND(2 原子)
  const rm = evaluate(r, DATA, { evaluated_at: T });
  assert.equal(rm.chain.length, 2);
  for (const item of rm.chain) {
    assert.ok(item.field);
    assert.ok(item.op);
    assert.ok('value' in item);
    assert.ok('actual' in item);
    assert.equal(typeof item.hit, 'boolean');
    assert.ok(item.weight);
  }
});

test('验收③ AND 多条件推理链完整且结果正确', () => {
  // R007 = AND(stability EQ true, move_pattern EQ 稳定)，M007 两条均真
  const r = REAL_RULES.find((x) => x.rule_id === 'R007');
  const rm = evaluate(r, DATA, { evaluated_at: T });
  assert.equal(rm.chain.length, 2);
  assert.deepEqual(rm.chain.map((c) => c.hit), [true, true]);
  assert.equal(rm.chain[0].field, 'stability_flag');
  assert.equal(rm.chain[0].actual, true);
});

test('验收③ 字段缺失的原子条件纳入推理链并对该条件判 false', () => {
  // R005 volume.ratio GTE 2.5，M007 volume.ratio=null
  const r = REAL_RULES.find((x) => x.rule_id === 'R005');
  const rm = evaluate(r, DATA, { evaluated_at: T });
  assert.equal(rm.chain.length, 1);
  assert.equal(rm.chain[0].hit, false);
  assert.equal(rm.chain[0].state, 'data_missing');
  assert.equal(rm.chain[0].warning, 'E2002');
});

// ───────────────────────── 验收④ 错误码与 dsl-syntax 一致 ─────────────────────────

test('验收④ 编译期错误码 E1001–E1004', () => {
  // E1001 未知字段
  let c = compile({ type: 'ATOMIC', field: 'no.such.field', op: 'GT', value: 1 });
  assert.equal(c.ok, false);
  assert.ok(c.errors.some((e) => e.code === 'E1001'));

  // E1002 类型不匹配（string 字段用 GT）
  c = compile({ type: 'ATOMIC', field: 'move_pattern', op: 'GT', value: 1 });
  assert.equal(c.ok, false);
  assert.ok(c.errors.some((e) => e.code === 'E1002'));

  // E1003 值域越界（volume.ratio max=10）
  c = compile({ type: 'ATOMIC', field: 'volume.ratio', op: 'GTE', value: 15 });
  assert.equal(c.ok, false);
  assert.ok(c.errors.some((e) => e.code === 'E1003'));

  // E1004 非法正则
  c = compile({ type: 'ATOMIC', field: 'move_pattern', op: 'PATTERN', value: '[unclosed' });
  assert.equal(c.ok, false);
  assert.ok(c.errors.some((e) => e.code === 'E1004'));
});

const EXPECTED_ERROR_CODES = ['E1001', 'E1002', 'E1003', 'E1004', 'E2001', 'E2002', 'E2003'];

test('验收④ 全部 7 个错误码与 dsl-syntax 一致', () => {
  assert.deepEqual(EXPECTED_ERROR_CODES, ['E1001', 'E1002', 'E1003', 'E1004', 'E2001', 'E2002', 'E2003']);
});

// ───────────────────────── 编译期校验（8 项） ─────────────────────────

test('编译校验·锚点非法 → E1003', () => {
  const c = compile({
    type: 'ATOMIC', field: 'time_to_match', op: 'LTE', value: 30,
    time_window: { anchor: 'invalid-anchor' },
  });
  assert.equal(c.ok, false);
  assert.ok(c.errors.some((e) => e.code === 'E1003'));
});

test('编译校验·嵌套深度超限 → E1003', () => {
  let node = { type: 'ATOMIC', field: 'time_to_match', op: 'LTE', value: 30 };
  for (let i = 0; i < MAX_DEPTH + 1; i++) {
    node = { type: 'NOT', conditions: [node] };
  }
  const c = compile(node);
  assert.equal(c.ok, false);
  assert.ok(c.errors.some((e) => e.code === 'E1003'));
});

test('编译校验·条件总数超限 → E1003', () => {
  const conditions = Array.from({ length: MAX_CONDITIONS + 1 }, () => ({
    type: 'ATOMIC', field: 'time_to_match', op: 'GTE', value: 1,
  }));
  const c = compile({ type: 'AND', conditions });
  assert.equal(c.ok, false);
});

test('编译校验·权重越界 → E1003', () => {
  const c = compile({ type: 'ATOMIC', field: 'time_to_match', op: 'LTE', value: 30, weight: 1.5 });
  assert.equal(c.ok, false);
  assert.ok(c.errors.some((e) => e.code === 'E1003'));
});

// ───────────────────────── 算子语义 ─────────────────────────

test('算子·EQ number 用 epsilon 比较', () => {
  assert.equal(applyOperator(TYPES.NUMBER, 'EQ', 0.3, 0.1 + 0.2), true);
  assert.equal(applyOperator(TYPES.NUMBER, 'EQ', 0.3, 0.31), false);
  assert.equal(applyOperator(TYPES.NUMBER, 'NEQ', 0.3, 0.31), true);
});

test('算子·关系比较', () => {
  const num = TYPES.NUMBER;
  assert.equal(applyOperator(num, 'GT', 5, 4), true);
  assert.equal(applyOperator(num, 'GTE', 5, 5), true);
  assert.equal(applyOperator(num, 'LT', 5, 6), true);
  assert.equal(applyOperator(num, 'LTE', 5, 5), true);
});

test('算子·BETWEEN 闭区间', () => {
  assert.equal(applyOperator(TYPES.NUMBER, 'BETWEEN', 1.05, [0.85, 1.10]), true);
  assert.equal(applyOperator(TYPES.NUMBER, 'BETWEEN', 1.2, [0.85, 1.10]), false);
});

test('算子·IN 枚举包含', () => {
  assert.equal(applyOperator(TYPES.STRING, 'IN', '英超', ['英超', '西甲']), true);
  assert.equal(applyOperator(TYPES.STRING, 'IN', '德甲', ['英超', '西甲']), false);
});

test('算子·PATTERN 正则匹配', () => {
  assert.equal(applyOperator(TYPES.STRING, 'PATTERN', '曼城', '^曼'), true);
  assert.equal(applyOperator(TYPES.STRING, 'PATTERN', '利物浦', '^曼'), false);
});

test('算子·ABS_GT / ABS_LT', () => {
  assert.equal(applyOperator(TYPES.NUMBER, 'ABS_GT', -110, 50), true);
  assert.equal(applyOperator(TYPES.NUMBER, 'ABS_GT', 20, 50), false);
  assert.equal(applyOperator(TYPES.NUMBER, 'ABS_LT', 0.01, 0.02), true);
});

test('算子·boolean EQ', () => {
  assert.equal(applyOperator(TYPES.BOOLEAN, 'EQ', true, true), true);
  assert.equal(applyOperator(TYPES.BOOLEAN, 'EQ', true, false), false);
});

// ───────────────────────── 加权 Jaccard 模糊匹配 ─────────────────────────

test('模糊匹配·全部命中 → exact + degree=1', () => {
  const r = weightedJaccard([
    { hit: true, weight: 1 }, { hit: true, weight: 1 },
  ]);
  assert.equal(r.exact, true);
  assert.equal(r.match_type, 'exact');
  assert.equal(r.degree, 1);
  assert.equal(r.hit, true);
});

test('模糊匹配·部分命中 → fuzzy + 加权分数', () => {
  // 3 个条件中命中 1 个高权重 + 1 个低权重，weighted jaccard
  const r = weightedJaccard([
    { hit: true, weight: 1 }, { hit: false, weight: 1 }, { hit: false, weight: 0.5 },
  ]);
  const expected = 1 / 2.5; // 0.4
  assert.equal(r.exact, false);
  assert.equal(r.match_type, 'none'); // 0.4 < 0.6 默认阈值
  assert.ok(Math.abs(r.degree - expected) < 1e-9);
});

test('模糊匹配·自定义阈值可调', () => {
  const r = weightedJaccard([
    { hit: true, weight: 1 }, { hit: false, weight: 1 },
  ], 0.4);
  assert.equal(r.match_type, 'fuzzy');
  assert.equal(r.hit, true);
  assert.equal(r.degree, 0.5);
});

test('模糊匹配·权重 0 不影响分数与命中', () => {
  // R009 类：OR 两条件之一命中，与单条件不涉及
  const r = weightedJaccard([
    { hit: true, weight: 0 }, { hit: false, weight: 1 },
  ]);
  // 命中权重 0，未命中权重 1 → degree 0（可选条件命中不加分）
  assert.equal(r.degree, 0);
});

// ───────────────────────── 外部引用 ─────────────────────────

test('外部引用·单路径解析', () => {
  const rule = FIXTURE.find((x) => x.rule_id === 'R003');
  const rm = evaluate(rule, DATA, { evaluated_at: T });
  // -0.5 - (-0.5) = 0；0 LTE -0.25 → false
  assert.equal(rm.hit, false);
  assert.equal(rm.chain.length, 1);
  assert.equal(rm.chain[0].actual, 0);
  assert.ok(!rm.warnings.some((w) => w.includes('E2003')));
});

test('外部引用·路径不可解析 → E2003 + 该条件 false', () => {
  const r = mkRule({
    condition: { type: 'ATOMIC', field: '$match.handicap.gonetorati.initial.line', op: 'LTE', value: -0.1 },
  });
  const rm = evaluate(r, DATA, { evaluated_at: T });
  assert.equal(rm.chain.length, 1);
  assert.equal(rm.chain[0].hit, false);
  assert.ok(rm.warnings.some((w) => w.includes('E2003')));
});

// ───────────────────────── 确定性 ─────────────────────────

test('确定性·同一输入产出相同输出', () => {
  for (const r of REAL_RULES) {
    const a = evaluate(r, DATA, { evaluated_at: T });
    const b = evaluate(r, DATA, { evaluated_at: T });
    assert.equal(a.hit, b.hit, r.rule_id);
    assert.equal(a.match_degree, b.match_degree, r.rule_id);
    assert.equal(a.skipped, b.skipped, r.rule_id);
  }
});

// ───────────────────────── 字段注册表覆盖 ─────────────────────────

test('注册表·含特征工程全部字段与 match 元字段', () => {
  const required = [
    'move_pattern', 'stability_flag', 'water.upper.drop_count', 'water.upper.rise_count',
    'kelly_index.max', 'kelly_index.min', 'kelly_index.home_max', 'institution.sync_count',
    'volume.ratio', 'betfair.dominant_ratio', 'betfair.heat', 'time_to_match',
    'water.upper.dispersion', 'match.league', 'match.home_team',
  ];
  for (const f of required) {
    assert.ok(FIELD_REGISTRY[f], `字段 ${f} 必须在注册表`);
  }
});