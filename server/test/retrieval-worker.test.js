// ============================================================================
// 1.7 检索 Worker · 验收测试
// 覆盖实施计划 1.7：检索命中 / 冲突检测 / 三层仲裁 / 人工复核 / G19 置信度 / 可追溯
// 对应 design/retrieval-worker-1.7.0 §6~§9
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RetrievalWorker,
  retrieveHits,
  detectConflicts,
  isConflicting,
  CONFLICT_DIRECTIONS,
  arbitrate,
  computeScore,
  REVIEW_DIFF,
} = require('../src/worker');
const { ConfidenceGate } = require('../src/backtest/confidence_gate');
const { ConfidenceProvider } = require('../src/fusion/confidence');

// ───────────────────────── 测试辅助 ─────────────────────────

const T = '2026-08-14T17:45:00+08:00';

/** 自洽特征快照（key 对应 DSL 注册表数值字段） */
const FEATURES = {
  'kelly_index.max': 5,
  'kelly_index.min': 1,
  'kelly_index.divergence': 2.5,
  'kelly_index.home_max': 6,
  'time_to_match': 90,
  'water.upper.change': 0.05,
  'water.lower.change': -0.03,
  'handicap.change': 0.25,
  'odds.volatility': 1.2,
  'volume.ratio': 2.5,
};

/** 轻量可求值规则，默认 kelly_index.max GTE 3（在 FEATURES 下必命中） */
function mkRule(overrides = {}) {
  return {
    rule_id: 'R001',
    version_id: 'R001#1',
    version: 1,
    status: 'active',
    direction: 'favor_upper',
    priority: 80,
    base_confidence: 0.6,
    category: 'odds_change',
    condition: { type: 'ATOMIC', field: 'kelly_index.max', op: 'GTE', value: 3 },
    valid_from: '2026-08-01T00:00:00+08:00',
    valid_to: null,
    ...overrides,
  };
}

/** 造一条命中的 favor_lower 规则（field 独立） */
function mkLower(overrides = {}) {
  return mkRule({
    rule_id: 'R002',
    version_id: 'R002#1',
    direction: 'favor_lower',
    condition: { type: 'ATOMIC', field: 'kelly_index.divergence', op: 'GTE', value: 2 },
    ...overrides,
  });
}

const silentLogger = { info() {}, warn() {}, debug() {} };

// ───────────────────────── ① 检索命中（retrieval） ─────────────────────────

test('检索 · 空规则集 → 空命中', () => {
  assert.deepEqual(retrieveHits({ rules: [], featureSnapshot: FEATURES, at: T }), []);
  assert.deepEqual(retrieveHits({ rules: undefined, featureSnapshot: FEATURES, at: T }), []);
});

test('检索 · 仅 active 规则参与（非 active 跳过）', () => {
  const hitRule = mkRule();
  const inactive = mkRule({
    rule_id: 'R_in', version_id: 'R_in#1', status: 'proposed', direction: 'favor_lower',
  });
  const hits = retrieveHits({ rules: [hitRule, inactive], featureSnapshot: FEATURES, at: T });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule.rule_id, 'R001');
});

test('检索 · 命中的条件求值正确，未命中规则排除', () => {
  const hitRule = mkRule();
  const missRule = mkRule({
    rule_id: 'R_miss', version_id: 'R_miss#1',
    condition: { type: 'ATOMIC', field: 'kelly_index.max', op: 'GTE', value: 100 },
  });
  const hits = retrieveHits({ rules: [hitRule, missRule], featureSnapshot: FEATURES, at: T });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule.rule_id, 'R001');
  assert.equal(hits[0].match.hit, true);
  assert.equal(hits[0].direction, 'favor_upper');
});

test('检索 · 无 confidenceOf → 使用 base_confidence', () => {
  const rule = mkRule({ base_confidence: 0.72 });
  const hits = retrieveHits({ rules: [rule], featureSnapshot: FEATURES, at: T });
  assert.equal(hits[0].confidence, 0.72);
});

test('检索 · confidenceOf 回调被调用并注入返回值', () => {
  const calls = [];
  const rule = mkRule({ base_confidence: 0.6 });
  const hits = retrieveHits({
    rules: [rule],
    featureSnapshot: FEATURES,
    at: T,
    confidenceOf: (vid, base) => { calls.push([vid, base]); return base * 0.9; },
  });
  assert.deepEqual(calls, [['R001#1', 0.6]]);
  assert.equal(hits[0].confidence, 0.54);
});

// ───────────────────────── ② 冲突检测（conflict） ─────────────────────────

test('冲突 · CONFLICT_DIRECTIONS 覆盖对撞方向', () => {
  assert.ok(CONFLICT_DIRECTIONS.favor_upper.includes('favor_lower'));
  assert.ok(CONFLICT_DIRECTIONS.favor_lower.includes('favor_upper'));
  assert.ok(CONFLICT_DIRECTIONS.follow.includes('reversal'));
  assert.ok(CONFLICT_DIRECTIONS.reversal.includes('follow'));
});

test('冲突 · isConflicting 单向判定 + 对称性', () => {
  assert.equal(isConflicting('favor_upper', 'favor_lower'), true);
  assert.equal(isConflicting('favor_lower', 'favor_upper'), true);
  assert.equal(isConflicting('favor_upper', 'favor_upper'), false);
  assert.equal(isConflicting('favor_upper', 'caution'), false);
});

test('冲突 · 检测到格子对撞冲突并标记人工复核', () => {
  const hits = [
    { rule: mkRule(), direction: 'favor_upper', confidence: 0.6 },
    { rule: mkLower(), direction: 'favor_lower', confidence: 0.6 },
  ];
  const groups = detectConflicts(hits);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rule_version_ids.sort(), ['R001#1', 'R002#1']);
  assert.equal(groups[0].severity, 'high');
  assert.equal(groups[0].requires_review, true);
});

test('冲突 · 同向规则不产生冲突', () => {
  const hits = [
    { rule: mkRule(), direction: 'favor_upper', confidence: 0.6 },
    { rule: mkRule({ rule_id: 'R003', version_id: 'R003#1' }), direction: 'favor_upper', confidence: 0.6 },
  ];
  assert.equal(detectConflicts(hits).length, 0);
});

// ───────────────────────── ③ 三层仲裁（arbitrate） ─────────────────────────

test('仲裁 · 空命中 → emptyArbitration（无方向/无复核）', () => {
  const a = arbitrate([]);
  assert.equal(a.direction, null);
  assert.equal(a.confidence, 0);
  assert.equal(a.manual_review_required, false);
  assert.deepEqual(a.groups, []);
});

test('仲裁 · 命中 direction=null → 无贡献方向，保持空', () => {
  const hits = [{ rule: mkRule({ direction: null }), direction: null, confidence: 0.6 }];
  const a = arbitrate(hits);
  assert.equal(a.direction, null);
  assert.equal(a.confidence, 0);
});

test('仲裁 · 单方向命中 → 直接产出方向 + 加权置信度', () => {
  const hits = [{ rule: mkRule({ base_confidence: 0.6 }), match: {}, direction: 'favor_upper', confidence: 0.6 }];
  const a = arbitrate(hits);
  assert.equal(a.direction, 'favor_upper');
  assert.equal(a.confidence, 0.6);
  assert.equal(a.manual_review_required, false);
  assert.equal(a.dominant_rule_version_id, 'R001#1');
  assert.equal(a.groups.length, 1);
});

test('仲裁 · 同向多规则置信度加权合成（L2）', () => {
  const hits = [
    { rule: mkRule({ base_confidence: 0.6 }), match: {}, direction: 'favor_upper', confidence: 0.6 },
    { rule: mkRule({ rule_id: 'R003', version_id: 'R003#1', base_confidence: 0.8 }), match: {}, direction: 'favor_upper', confidence: 0.8 },
  ];
  const a = arbitrate(hits);
  assert.equal(a.direction, 'favor_upper');
  // confDen=160, confNum=80*0.6+80*0.8=112 → 0.7
  assert.equal(a.confidence, 0.7);
  assert.equal(a.manual_review_required, false);
  // dominant = 高分规则
  assert.equal(a.dominant_rule_version_id, 'R003#1');
});

test('仲裁 · 冲突但分差足够 → 高分方向胜出（L1 优先级落地）', () => {
  const hits = [
    { rule: mkRule({ priority: 100, base_confidence: 0.6 }), match: {}, direction: 'favor_upper', confidence: 0.6 },
    { rule: mkLower({ priority: 40, base_confidence: 0.6 }), match: {}, direction: 'favor_lower', confidence: 0.6 },
  ];
  const a = arbitrate(hits);
  // score 0.6 vs 0.24，diff=0.36 ≥ REVIEW_DIFF
  assert.ok(Math.abs(a.groups[0].score - 0.6) < 1e-6);
  assert.equal(a.direction, 'favor_upper');
  assert.equal(a.manual_review_required, false);
  assert.equal(a.conflict_groups.length, 1);
});

test('仲裁 · 冲突且分差 < REVIEW_DIFF → 人工复核（方向置空）', () => {
  const hits = [
    { rule: mkRule({ priority: 80, base_confidence: 0.6 }), match: {}, direction: 'favor_upper', confidence: 0.6 },
    { rule: mkLower({ priority: 80, base_confidence: 0.6 }), match: {}, direction: 'favor_lower', confidence: 0.6 },
  ];
  const a = arbitrate(hits);
  assert.equal(a.manual_review_required, true);
  assert.equal(a.direction, null);
  assert.equal(a.confidence, 0);
  assert.ok(a.review_note.includes('manual review'));
  assert.ok(a.review_note.includes(String(REVIEW_DIFF)));
});

test('仲裁 · computeScore 归一化 (priority/100)·confidence', () => {
  assert.equal(computeScore(100, 0.5), 0.5);
  assert.equal(computeScore(80, 0.6), 0.48);
  assert.equal(computeScore(80, 0.6), 0.48);
  assert.equal(computeScore(undefined, 0.5), 0.005); // priority 兜底 1 → 1/100*0.5
  assert.equal(computeScore(100, NaN), 0);
});

// ───────────────────────── ④ 端到端 worker 编排 ─────────────────────────

test('worker · 无命中 → prediction null + 空仲裁 + 零冲突', () => {
  const missRule = mkRule({
    rule_id: 'R_miss', version_id: 'R_miss#1',
    condition: { type: 'ATOMIC', field: 'kelly_index.max', op: 'GTE', value: 100 },
  });
  const w = new RetrievalWorker({ getActiveRules: () => [missRule], logger: silentLogger });
  const { prediction, retrieval } = w.run({ match: 'M001', featureSnapshot: FEATURES, at: T });
  assert.equal(prediction, null);
  assert.equal(retrieval.match_id, 'M001');
  assert.equal(retrieval.at, T);
  assert.equal(retrieval.hits.length, 0);
  assert.equal(retrieval.arbitration.direction, null);
});

test('worker · 命中规则 → 产出可追溯预测（方向+置信度+推理链）', () => {
  const w = new RetrievalWorker({ getActiveRules: () => [mkRule({ base_confidence: 0.6 })], logger: silentLogger });
  const { prediction, retrieval } = w.run({ match: 'M002', featureSnapshot: FEATURES, at: T });
  assert.ok(prediction, '应产出预测');
  assert.equal(prediction.final_direction, 'favor_upper');
  assert.equal(prediction.final_confidence, 0.6);
  assert.ok(prediction.prediction_id.startsWith('pred_M002_'));
  assert.ok(Array.isArray(prediction.reasoning_chain));
  assert.ok(prediction.reasoning_chain.length >= 1);
  // 溯源：retrieval 汇聚 hits / conflicts / arbitration
  assert.equal(retrieval.hits.length, 1);
  assert.equal(retrieval.arbitration.direction, 'favor_upper');
  assert.equal(retrieval.arbitration.dominant_rule_version_id, 'R001#1');
});

test('worker · G19 回测置信度写-后-读（backtest 优先 base）', () => {
  const gate = new ConfidenceGate();
  // 回测未提交 → base
  const w0 = new RetrievalWorker({
    getActiveRules: () => [mkRule({ base_confidence: 0.6 })],
    confidenceProvider: new ConfidenceProvider({ gate }),
    logger: silentLogger,
  });
  assert.equal(w0.run({ match: 'M010', featureSnapshot: FEATURES, at: T }).prediction.final_confidence, 0.6);

  // 回测完成提交 0.85 → 检索解析到 backtest 置信度
  gate.commit({ job_id: 'bt_1', rule_version_id: 'R001#1', status: 'completed', report_ref: 'rep_1' }, 0.85);
  const w1 = new RetrievalWorker({
    getActiveRules: () => [mkRule({ base_confidence: 0.6 })],
    confidenceProvider: new ConfidenceProvider({ gate }),
    logger: silentLogger,
  });
  const pred = w1.run({ match: 'M011', featureSnapshot: FEATURES, at: T }).prediction;
  assert.equal(pred.final_confidence, 0.85);
});

test('worker · 冲突需人工复核 → 生成复核工单（prediction null）', () => {
  const rules = [
    mkRule({ priority: 80, base_confidence: 0.6 }),
    mkLower({ priority: 80, base_confidence: 0.6 }),
  ];
  const w = new RetrievalWorker({ getActiveRules: () => rules, logger: silentLogger });
  const { prediction, retrieval } = w.run({ match: 'M003', featureSnapshot: FEATURES, at: T });
  assert.equal(prediction, null);
  assert.ok(retrieval.review_ticket_id, '应生成复核工单');
  assert.match(retrieval.review_ticket_id, /^rev_\d{4}$/);
  assert.equal(retrieval.arbitration.manual_review_required, true);
  assert.equal(retrieval.conflicts.length, 1);
});

test('worker · 复核工单登记到 worker.reviewTickets（含完整仲裁上下文）', () => {
  const w = new RetrievalWorker({
    getActiveRules: () => [
      mkRule({ priority: 80, base_confidence: 0.6 }),
      mkLower({ priority: 80, base_confidence: 0.6 }),
    ],
    logger: silentLogger,
  });
  const before = w.reviewTickets.length;
  const { retrieval } = w.run({ match: 'M004', featureSnapshot: FEATURES, at: T });
  assert.equal(w.reviewTickets.length, before + 1);
  const ticket = w.reviewTickets[w.reviewTickets.length - 1];
  assert.equal(ticket.match_id, 'M004');
  assert.equal(ticket.review_ticket_id, retrieval.review_ticket_id);
  assert.equal(ticket.arbitration.manual_review_required, true);
});

test('worker · 无仲裁方向且无需复核（未命中）→ 记录 no_prediction，不产工单', () => {
  const w = new RetrievalWorker({
    getActiveRules: () => [mkRule({ rule_id: 'R_m', version_id: 'R_m#1', direction: null, base_confidence: 0.6 })],
    logger: silentLogger,
  });
  const before = w.reviewTickets.length;
  const { prediction, retrieval } = w.run({ match: 'M012', featureSnapshot: FEATURES, at: T });
  assert.equal(prediction, null);
  assert.equal(retrieval.review_ticket_id, null);
  assert.equal(w.reviewTickets.length, before);
});

// ───────────────────────── ⑤ 入口契约 ─────────────────────────

test('入口 · 对外暴露全部契约', () => {
  assert.equal(typeof RetrievalWorker, 'function');
  assert.equal(typeof retrieveHits, 'function');
  assert.equal(typeof detectConflicts, 'function');
  assert.equal(typeof isConflicting, 'function');
  assert.equal(typeof arbitrate, 'function');
  assert.equal(typeof computeScore, 'function');
  assert.equal(typeof REVIEW_DIFF, 'number');
  assert.ok(CONFLICT_DIRECTIONS && typeof CONFLICT_DIRECTIONS === 'object');
});