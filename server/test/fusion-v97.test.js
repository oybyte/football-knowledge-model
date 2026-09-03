// ============================================================================
// 融合决策层 · v97 输入适配 测试（hermetic）
// 覆盖：方向映射（仅方向型维度） / 无方向→弃判 / 置信度折价 / 融合输出契约 / 无命中
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fuseV97Decision, v97ToRuleOutput, mapDirection, DIRECTION_DIMS } = require('../src/fusion/v97_input');

function v97(hits, fields = 12) {
  return {
    rule_count: 88,
    rules: hits,
    fields: Array.from({ length: fields }, () => ({ field: 'x', status: 'ok' })),
  };
}
function hit(rule_id, dimensions) {
  return { rule_id, status: 'hit', dimensions, effects: [], missing: [] };
}

test('① 方向型维度 → 融合方向 favor_upper', () => {
  assert.equal(mapDirection(['上盘']), 'favor_upper');
  assert.equal(mapDirection(['受让方']), 'favor_lower');
  assert.equal(mapDirection(['平局']), 'draw');
  assert.equal(mapDirection(['风险提示']), 'warning');
  assert.equal(mapDirection(['略看小球']), null, '非方向语义不得臆造方向');
});

test('② 无方向型维度（门禁/信号）→ direction=null，融合判弃判', () => {
  const out = v97ToRuleOutput({
    v97: v97([hit('E14', { gate: ['共振前置'] }), hit('S25', { total_goals_signal: ['赔付放开=略看小球'] })]),
    rules: [],
  });
  assert.ok(out, '有命中应产出 rule 流输入');
  assert.equal(out.direction, null, '无方向型维度不得臆造方向');
  assert.ok(out.confidence > 0 && out.confidence < 1);
  assert.equal(out.evidence.hit_count, 2);
  assert.ok(out.evidence.non_direction_dims.includes('total_goals_signal'));
});

test('③ 方向型维度命中 → 融合决策带方向与置信度', () => {
  const { decision, rule_output, dimensions } = fuseV97Decision({
    match_id: 'M1',
    v97: v97([hit('R13', { direction: ['上盘'] }), hit('S25', { total_goals_signal: ['略看小球'] })]),
    rules: [{ rule_id: 'R13', base_confidence: 0.7 }, { rule_id: 'S25', base_confidence: 0.6 }],
  });
  assert.equal(rule_output.direction, 'favor_upper');
  assert.ok(rule_output.confidence > 0 && rule_output.confidence <= 1);
  assert.equal(decision.final_direction, 'favor_upper');
  assert.ok(decision.final_confidence > 0);
  assert.ok(decision.prediction_id && decision.audit_trail_id);
  assert.ok(Array.isArray(decision.reasoning_chain) && decision.reasoning_chain.length > 0);
  assert.ok(dimensions.total_goals_signal, '维度结论应透出');
  assert.ok(DIRECTION_DIMS.includes('direction'));
});

test('④ 无命中 → rule 流为 null，融合仍返回决策（方向弃判 + excluded 留痕）', () => {
  const { decision, rule_output, note } = fuseV97Decision({ match_id: 'M2', v97: v97([]), rules: [] });
  assert.equal(rule_output, null);
  assert.equal(decision.final_direction, null, '无输入不得产出方向');
  assert.match(note, /无规则命中/);
  assert.ok(Array.isArray(decision.excluded));
});

test('⑤ 置信度按未回测折价（provisional 0.8 折扣）', () => {
  const out = v97ToRuleOutput({
    v97: v97([hit('R13', { direction: ['上盘'] })]),
    rules: [{ rule_id: 'R13', base_confidence: 0.7 }],
  });
  assert.equal(+out.confidence.toFixed(3), +(0.7 * 0.8).toFixed(3));
});
