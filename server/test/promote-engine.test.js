// ============================================================================
// 2.2 / 2.3 对齐 · 回测转正 + 预测链接入 测试
// 2.2：draft 规则经回测达标 → 沿状态机转正至 active；不达标 → 失败报告。
// 2.3：matchExact/matchFuzzy/traceRuleChain（完整推理链）+ predict（含不可变证据）。
// 集成验证：2.1 入库的 draft 规则集 → 2.2 批量转正。
//
// 注意（2026-09-01）：原测试依赖 convert/catalog 的 Mock 文字规则（ODC001…）与
// 原型 R001–R016 DSL 规则；Phase 1 已将真实规则源切换为 V9.7 registry（catalog 已清空，
// loadPrototypeRules 改为返回 88 条 V9.7 真规则且 V9.7 规则在 Phase 1 对引擎 inert）。
// 故本文件改为自包含夹具：draft 规则由测试直接构造（不依赖已清空的 catalog），
// DSL 引擎验证用内联 R001 夹具（与 dsl-engine.test.js 同源形状），保持对回测转正
// 与 DSL 引擎真实能力的覆盖，同时与 V9.7 seed 解耦。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RuleStore, StateMachine, lockManager } = require('../src/rules');
const { promoteRule, batchPromote } = require('../src/promote');
const engine = require('../src/engine');

// ───────────────────────── 条件构造器（与 DSL 语法一致） ─────────────────────────
function a(field, op, value, extra = {}) { return { type: 'ATOMIC', field, op, value, ...extra }; }

// 内联 DSL 规则夹具：复刻原型 R001（升盘降水 favor_upper），验证 DSL 引擎真实能力。
const R001 = {
  version_id: 'R001#1',
  rule_id: 'R001',
  version: 1,
  category: 'odds_change',
  direction: 'favor_upper',
  condition: a('move_pattern', 'EQ', '升盘降水'),
  conclusion: '升盘降水 favor_upper',
  base_confidence: 0.6,
  priority: 80,
  trust_level: 'trusted',
  valid_from: '2026-08-14T00:00:00+08:00',
  valid_to: null,
  evidence_refs: [],
  evidence_count: 0,
  status: 'active',
  previous_version_id: null,
  created_at: '2026-08-14T00:00:00+08:00',
  created_by: 'test:promote',
};

// 构造一条合法 draft 规则（status=draft / trust_level=untrusted），用于回测转正流程。
function mkDraft(ruleId, overrides = {}) {
  return {
    version_id: `${ruleId}#1`,
    rule_id: ruleId,
    version: 1,
    category: 'odds_change',
    direction: 'favor_upper',
    condition: a('move_pattern', 'EQ', '升盘降水'),
    conclusion: '升盘降水 favor_upper',
    base_confidence: 0.6,
    priority: 80,
    trust_level: 'untrusted',
    valid_from: '2026-08-24T00:00:00+08:00',
    valid_to: null,
    evidence_refs: [],
    evidence_count: 0,
    status: 'draft',
    previous_version_id: null,
    created_at: '2026-08-24T00:00:00+08:00',
    created_by: 'test:promote',
    ...overrides,
  };
}

// ───────────────────────── 样本构造 ─────────────────────────
/** 达标样本：40 条方向样本全命中，跨 2 联赛 2 季度 */
function passingSample(n = 40) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      observed_at: i < 20 ? '2026-06-05T12:00:00+08:00' : '2026-09-05T12:00:00+08:00',
      verdict_direction: 'favor_upper',
      match_result: 'upper',
      odds: 1.05,
      league: i % 2 ? '日职联' : '韩K联',
    });
  }
  return arr;
}
/** 不达标样本：样本量小 + 命中率低 */
function failingSample(n = 10) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      observed_at: '2026-06-05T12:00:00+08:00',
      verdict_direction: 'favor_upper',
      match_result: i % 2 ? 'upper' : 'lower',
      odds: 1.05,
      league: '日职联',
    });
  }
  return arr;
}

// ───────────────────────── 2.2 回测转正 ─────────────────────────
test('2.2 达标规则经状态机转正至 active', () => {
  const store = new RuleStore();
  const sm = new StateMachine({ store, lockManager });
  // 2.1 入库一条 draft 规则（ODC001 = 升盘降水 favor_upper）
  store.insert(mkDraft('ODC001'));
  const odc1 = store.getByRuleId('ODC001')[0];
  assert.ok(odc1, 'ODC001 应存在');
  assert.equal(odc1.status, 'draft');
  assert.equal(odc1.trust_level, 'untrusted');

  const res = promoteRule({
    rule_id: 'ODC001',
    store, stateMachine: sm,
    sample: passingSample(),
    approver: 'analyst-01',
  });
  assert.equal(res.ok, true, JSON.stringify(res.errors || res.failure_report));
  assert.equal(res.pass, true);
  assert.equal(res.promoted.status, 'active');
  assert.equal(res.promoted.trust_level, 'untrusted'); // 转正上线但信任仍需后续数据积累
  // 状态转换已形成版本链
  const versions = store.getByRuleId('ODC001');
  const statuses = versions.map((v) => v.status);
  assert.ok(statuses.includes('draft'));
  assert.ok(statuses.includes('proposed'));
  assert.ok(statuses.includes('experiment'));
  assert.ok(statuses.includes('validated'));
  assert.ok(statuses.includes('approved'));
  assert.ok(statuses.includes('active'));
});

test('2.2 不达标规则产出失败报告，保持未转正', () => {
  const single = new RuleStore();
  const sm2 = new StateMachine({ store: single, lockManager });
  single.insert(mkDraft('ODC002'));
  const someRule = single.getByRuleId('ODC002')[0];
  assert.ok(someRule, 'ODC002 应存在');
  const res = promoteRule({
    rule_id: 'ODC002',
    store: single, stateMachine: sm2,
    sample: failingSample(),
    approver: 'analyst-01',
  });
  assert.equal(res.pass, false);
  assert.equal(res.promoted, null);
  assert.ok(res.failure_report, '应有失败报告');
  assert.ok(res.failure_report.all_pass === false);
  assert.equal(res.failure_report.sample_size, 10);
  // 未产生 active 版本
  assert.equal(checkNoActive(single, 'ODC002'), true);
});

function checkNoActive(store, ruleId) {
  return store.getByRuleId(ruleId).every((v) => v.status !== 'active');
}

test('2.2 批量转正：从 2.1 规则集选出达标者，其余进入报告库', () => {
  const store = new RuleStore();
  const sm = new StateMachine({ store, lockManager });
  // 注入多条 draft 候选（模拟 2.1 入库）；不依赖已清空的 convert/catalog
  const ids = Array.from({ length: 10 }, (_, i) => `ODC${String(i + 1).padStart(3, '0')}`);
  ids.forEach((id) => store.insert(mkDraft(id)));
  assert.ok(ids.length >= 10);

  const sampleOf = (rid) => (rid === 'ODC001' ? passingSample() : []);
  const { promoted, failure_reports } = batchPromote({
    ruleIds: ids, store, stateMachine: sm,
    sampleOf, approver: 'analyst-01',
  });
  // 仅 ODC001（升盘降水 favor_upper）有合法样本并达标 → 转正
  assert.deepEqual(promoted.map((v) => v.rule_id), ['ODC001']);
  assert.equal(promoted[0].status, 'active');
  // 其余均有失败报告
  assert.ok(failure_reports.length >= ids.length - 1, '应有失败报告');
  assert.ok(failure_reports.every((fr) => fr.pass === undefined || fr.all_pass === false || fr.error === 'rule_not_found' || fr.sample_size === 0));
});

// ───────────────────────── 2.3 预测链接入 ─────────────────────────
test('2.3 matchExact / matchFuzzy / traceRuleChain（单规则推理链）', () => {
  const snap = { move_pattern: '升盘降水' };
  assert.equal(engine.matchExact(R001, snap, '2026-08-14T17:00:00+08:00'), true);
  const chain = engine.traceRuleChain(R001, snap, '2026-08-14T17:00:00+08:00');
  assert.equal(chain.hit, true);
  assert.ok(Array.isArray(chain.chain) && chain.chain.length >= 1, '应含条件级推理链');
  assert.equal(chain.chain[0].field, 'move_pattern');
  // 不命中场景
  assert.equal(engine.matchExact(R001, { move_pattern: '稳定' }, '2026-08-14T17:00:00+08:00'), false);
  assert.equal(engine.matchFuzzy(R001, { move_pattern: '稳定' }, '2026-08-14T17:00:00+08:00'), false);
});

test('2.3 predict 输出可追溯推理链 + 不可变证据快照 + 预测', () => {
  const activeRules = [R001];
  const snap = { move_pattern: '升盘降水' };
  const res = engine.predict({
    match: 'M007',
    featureSnapshot: snap,
    at: '2026-08-14T17:00:00+08:00',
    getActiveRules: () => activeRules,
    created_by: 'engine:test',
  });
  assert.ok(res.prediction, '应产出预测');
  assert.equal(res.prediction.match_id, 'M007');
  assert.ok(res.chain.hits.length >= 1, '应有检索命中');
  assert.equal(res.prediction.final_direction, 'favor_upper');
  // 不可变证据
  assert.ok(res.evidence, '应有证据快照');
  assert.equal(Object.isFrozen(res.evidence), true, '证据必须 Object.freeze');
  assert.equal(res.evidence.predicted_direction, 'favor_upper');
  assert.ok(res.evidence.chain_summary.dominant_rule_version_id);
  // 完整推理链可追溯
  assert.ok(Array.isArray(res.retrieval.hits));
  assert.ok(res.retrieval.arbitration.dominant_rule_version_id.startsWith('R001#'));
});

test('2.3 冲突仲裁（三层）经 engine 复用可用', () => {
  const hits = [
    { direction: 'favor_upper', confidence: 0.5, rule: { priority: 80, rule_id: 'A', version_id: 'A#1', direction: 'favor_upper' } },
    { direction: 'favor_lower', confidence: 0.5, rule: { priority: 79, rule_id: 'B', version_id: 'B#1', direction: 'favor_lower' } },
  ];
  const arb = engine.arbitrate(hits);
  assert.equal(arb.manual_review_required, true); // 冲突双方分差 < 0.1 → 人工复核
  assert.equal(arb.direction, null);
});
