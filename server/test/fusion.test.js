// ============================================================================
// 融合决策层 测试 —— 覆盖 权重 / 融合 / 方向仲裁 / 隔离 / G19 置信度时序 / 可追溯
// ============================================================================
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  fuseDecision,
  fuse,
  ConfidenceGate,
  confidenceProvider,
  computeBasisWeights,
  normalizeWeights,
  parseWeightsFromEnv,
  WEIGHTS_ENV,
  DEFAULT_WEIGHTS,
  resolveTrust,
  gateCheck,
  isValidConfidence,
} = require('../src/fusion');
const { ConfidenceProvider } = require('../src/fusion/confidence');
const { buildFusionDecision } = require('../src/fusion/decision');

const ruleOutput = (over = {}) => ({
  rule_id: 'R001',
  version_id: 'R001#1',
  direction: 'favor_upper',
  confidence: 0.6,
  exact: false,
  ...over,
});

/** 全新隔离的置信度 provider */
function freshProvider(gate) {
  return new ConfidenceProvider({ gate });
}

// ---------- 权重 ----------
test('权重 · 默认 {rule:0.5, model:0.3, anomaly:0.2}', () => {
  assert.deepEqual(DEFAULT_WEIGHTS, { rule: 0.5, model: 0.3, anomaly: 0.2 });
  const w = computeBasisWeights({});
  assert.equal(w.rule, 0.5);
  assert.equal(w.model, 0.3);
  assert.equal(w.anomaly, 0.2);
});

test('权重 · normalize 归一到总和 1', () => {
  const n = normalizeWeights({ rule: 1, model: 1, anomaly: 1 });
  assert.ok(Math.abs(n.rule + n.model + n.anomaly - 1) < 1e-9);
  assert.ok(Math.abs(n.rule - 1 / 3) < 1e-9);
});

test('权重 · rule exact 命中 → 规则话语权 ×1.2', () => {
  const w = computeBasisWeights({ rule_output: { exact: true } });
  // 0.6 / (0.6+0.3+0.2) = 0.6/1.1
  assert.ok(Math.abs(w.rule - 0.6 / 1.1) < 1e-9);
});

test('权重 · anomaly 主动触发 → 异常话语权 ×1.5', () => {
  const w = computeBasisWeights({ anomaly_output: { alert: 'drift' } });
  assert.ok(Math.abs(w.anomaly - 0.3 / 1.1) < 1e-9);
});

// ---------- 权重可配置性（关闭 G10「可配置性空白」）----------
test('权重 · 显式 weights 覆盖优先于默认', () => {
  const w = computeBasisWeights({ weights: { rule: 0.7, model: 0.2, anomaly: 0.1 } });
  assert.ok(Math.abs(w.rule - 0.7) < 1e-9);
  assert.ok(Math.abs(w.model - 0.2) < 1e-9);
  assert.ok(Math.abs(w.anomaly - 0.1) < 1e-9);
});

test('权重 · 显式 weights 允许部分键，缺失键回退默认并归一', () => {
  const w = computeBasisWeights({ weights: { model: 0.8 } });
  // model 0.8 + rule 0.5 + anomaly 0.2 = 1.5 → model=0.8/1.5
  assert.ok(Math.abs(w.model - 0.8 / 1.5) < 1e-9);
  assert.ok(Math.abs(w.rule - 0.5 / 1.5) < 1e-9);
});

test('权重 · env OE_FUSION_WEIGHTS 解析覆盖（仅覆盖给定键）', () => {
  const prev = process.env.OE_FUSION_WEIGHTS;
  try {
    process.env.OE_FUSION_WEIGHTS = 'model:0.6,anomaly:0.3';
    const w = computeBasisWeights({});
    // 缺失的 rule 回退默认 0.5 → 0.5/1.4, 0.6/1.4, 0.3/1.4
    assert.ok(Math.abs(w.rule - 0.5 / 1.4) < 1e-9);
    assert.ok(Math.abs(w.model - 0.6 / 1.4) < 1e-9);
    assert.ok(Math.abs(w.anomaly - 0.3 / 1.4) < 1e-9);
  } finally {
    if (prev === undefined) delete process.env.OE_FUSION_WEIGHTS;
    else process.env.OE_FUSION_WEIGHTS = prev;
  }
});

test('权重 · env 格式非法/缺失 → 回退默认 {rule:0.5,model:0.3,anomaly:0.2}', () => {
  const prev = process.env.OE_FUSION_WEIGHTS;
  try {
    process.env.OE_FUSION_WEIGHTS = 'not-a-weight';
    const w = computeBasisWeights({});
    assert.ok(Math.abs(w.rule - 0.5) < 1e-9);
    assert.ok(Math.abs(w.model - 0.3) < 1e-9);
    assert.ok(Math.abs(w.anomaly - 0.2) < 1e-9);
  } finally {
    if (prev === undefined) delete process.env.OE_FUSION_WEIGHTS;
    else process.env.OE_FUSION_WEIGHTS = prev;
  }
});

test('权重 · parseWeightsFromEnv：无效键忽略，无有效数字 → null', () => {
  assert.equal(parseWeightsFromEnv({ OE_FUSION_WEIGHTS: 'foo:1,bar:2' }), null);
  const w = parseWeightsFromEnv({ OE_FUSION_WEIGHTS: 'rule:0.4' });
  assert.ok(w && Math.abs(w.rule - 0.4 / (0.4 + 0.3 + 0.2)) < 1e-9);
});

// ---------- 信任隔离 ----------
test('隔离 · rule 默认 trusted；model/anomaly 无证据视为 untrusted', () => {
  assert.equal(resolveTrust('rule', { confidence: 0.6 }), 'trusted');
  assert.equal(resolveTrust('model', { confidence: 0.9 }), 'untrusted');
  assert.equal(resolveTrust('anomaly', { confidence: 0.9 }), 'untrusted');
  // 显式 trusted + 证据（已转正模型）才可信
  assert.equal(resolveTrust('model', { trust: 'trusted', evidence: { id: 'm1' } }), 'trusted');
  assert.equal(resolveTrust('model', { trust: 'trusted', evidence: null }), 'untrusted');
});

test('隔离 · gateCheck 校验方向与置信度范围', () => {
  assert.equal(gateCheck({ direction: 'favor_upper', confidence: 0.7 }).allowed, true);
  assert.equal(gateCheck({ direction: 'unknown', confidence: 0.7 }).allowed, false);
  assert.equal(gateCheck({ direction: 'favor_upper', confidence: 1.5 }).allowed, false);
  assert.equal(isValidConfidence(1.2), false);
});

// ---------- 融合：单规则路（骨架版） ----------
test('融合 · placeholder 不参与，规则路主导（final_direction/confidence）', () => {
  const gate = new ConfidenceGate();
  const provider = freshProvider(gate);
  const d = fuseDecision({
    match_id: 'M001',
    rule_output: ruleOutput(),
    model_output: { direction: 'favor_lower', confidence: 0.9 }, // 无证据 → untrusted
    anomaly_output: { alert: 'x', confidence: 0.5 },
    context: { provider, rule_version_id: 'R001#1' },
  });

  assert.equal(d.final_direction, 'favor_upper');
  assert.equal(d.final_confidence, 0.6);          // 单路 → 规则置信度（base 0.6）
  assert.ok(d.excluded.includes('model'));
  assert.ok(d.excluded.includes('anomaly'));
  assert.equal(Object.isFrozen(d), true);
  assert.ok(d.prediction_id.startsWith('pred_M001_'));
  assert.ok(d.audit_trail_id.startsWith('fus_'));
});

// ---------- 方向仲裁 + 加权置信度 ----------
test('融合 · 两路 trusted 方向冲突按加权分值仲裁', () => {
  const gate = new ConfidenceGate();
  const provider = freshProvider(gate);
  const rule = ruleOutput({ direction: 'favor_upper', confidence: 0.6, exact: false });
  const model = {
    trust: 'trusted', evidence: { id: 'm1' },
    direction: 'favor_lower', confidence: 0.8,
  };
  const d = fuseDecision({
    match_id: 'M002', rule_output: rule, model_output: model, anomaly_output: null,
    context: { provider, rule_version_id: 'R001#1' },
  });

  // basis {0.5,0.3,0.2}，有效路 rule+model → rule=0.5/0.8=0.625, model=0.375
  // upper=0.625*0.6=0.375 > lower=0.375*0.8=0.3 → 上盘
  assert.equal(d.final_direction, 'favor_upper');
  assert.equal(d.final_confidence, 0.675);         // (0.625*0.6 + 0.375*0.8)
  assert.deepEqual(d.excluded, []);
  // rule included 权重 0.625
  const ruleNode = d.reasoning_chain.find((n) => n.source === 'rule:R001#1');
  assert.equal(ruleNode.included, true);
  assert.ok(Math.abs(ruleNode.weight - 0.625) < 1e-6);
});

// ---------- 全空/全 untrusted → 无有效融合 ----------
test('融合 · 全部 untrusted/空 → final_direction=null + confidence=0', () => {
  const gate = new ConfidenceGate();
  const provider = freshProvider(gate);
  const d = fuseDecision({
    match_id: 'M003',
    rule_output: ruleOutput({ direction: 'invalid', confidence: 0.6 }), // 方向非法
    model_output: { direction: 'favor_lower', confidence: 0.9 },       // 未验证
    anomaly_output: null,
    context: { provider, rule_version_id: 'R001#1' },
  });
  assert.equal(d.final_direction, null);
  assert.equal(d.final_confidence, 0);
  assert.ok(d.excluded.includes('rule'));
  assert.ok(d.excluded.includes('model'));
});

// ---------- G19 置信度时序 ----------
test('G19 · gate 未提交 → base 置信度（source=base），读取旧值', () => {
  const gate = new ConfidenceGate();
  const provider = freshProvider(gate);
  const r = provider.resolve({ rule_version_id: 'R001#1', fallback: 0.6 });
  assert.equal(r.source, 'base');
  assert.equal(r.confidence, 0.6);
});

test('G19 · 回测完成提交后，规则置信度优先 backtest（写-后-读）', () => {
  const gate = new ConfidenceGate();
  const provider = freshProvider(gate);
  const doneJob = { job_id: 'bt_1', rule_version_id: 'R001#1', status: 'completed', report_ref: 'rep_1' };
  gate.commit(doneJob, 0.85); // 回测完成写入

  const r = provider.resolve({ rule_version_id: 'R001#1', fallback: 0.6 });
  assert.equal(r.source, 'backtest');
  assert.equal(r.confidence, 0.85);

  // 融合决策使用 backtest 置信度
  const d = fuseDecision({
    match_id: 'M004', rule_output: ruleOutput(), model_output: null, anomaly_output: null,
    context: { provider, rule_version_id: 'R001#1' },
  });
  assert.equal(d.final_confidence, 0.85);
});

// ---------- 决策可追溯 + 不可变 ----------
test('可追溯 · reasoning_chain 完整 + prediction_id/audit 存在', () => {
  const gate = new ConfidenceGate();
  const provider = freshProvider(gate);
  const nullLogger = { info() {}, warn() {} };
  const result = fuse({
    rule_output: ruleOutput(), model_output: null, anomaly_output: null,
    context: { provider, rule_version_id: 'R001#1' },
  });
  const d = buildFusionDecision({ match_id: 'M005', fused: result, logger: nullLogger });

  assert.ok(Object.isFrozen(d));
  assert.equal(d.reasoning_chain.length, 3);        // rule/model/anomaly 三节点
  assert.ok(d.reasoning_chain[0].included);
  const chainFrozen = d.reasoning_chain.every((n) => Object.isFrozen(n));
  assert.equal(chainFrozen, true);
  assert.throws(() => { d.final_confidence = 0; }, TypeError);
  assert.throws(() => { d.reasoning_chain.push({}); }, TypeError);
});

// ---------- 置信度范围保证 ----------
test('融合 · final_confidence 恒在 [0,1]', () => {
  const gate = new ConfidenceGate();
  const provider = freshProvider(gate);
  const d = fuseDecision({
    match_id: 'M006', rule_output: { ...ruleOutput(), confidence: 1 }, model_output: null,
    anomaly_output: null, context: { provider, rule_version_id: 'R001#1' },
  });
  assert.ok(d.final_confidence >= 0 && d.final_confidence <= 1);
});

// ---------- 入口 ----------
test('模块入口暴露全部契约', () => {
  assert.equal(typeof fuseDecision, 'function');
  assert.equal(typeof fuse, 'function');
  assert.equal(typeof computeBasisWeights, 'function');
  assert.equal(typeof ConfidenceGate, 'function');
  assert.ok(confidenceProvider.gate instanceof ConfidenceGate);
});