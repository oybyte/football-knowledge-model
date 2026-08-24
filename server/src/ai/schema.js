// ============================================================================
// AI 引擎 · schema —— AI 结构化候选规则校验
// AI 输出 → 结构化候选 { id / field / op / value / direction / rationale / metrics }
// 校验：结构完整性 + DSL 编译通过（条件可解析为合法 DSL）+ 方向/算子合法。
// ============================================================================
'use strict';

const { DslEngine } = require('../dsl');
const { DIRECTIONS } = require('../rules/schema');

/**
 * 从候选要素构造 DSL 条件树（单原子，外部引用除外）。
 * @param {Object} c { field, op, value }
 * @returns {Object} ConditionDSL
 */
function toCondition(c) {
  return { type: 'ATOMIC', field: c.field, op: c.op, value: c.value };
}

/**
 * 校验 AI 候选的合法性与 DSL 可编译性。
 * @param {Object} c 候选要素
 * @returns {{ ok:boolean, condition?:Object, errors:string[], warnings?:string[] }}
 */
function validateCandidate(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return { ok: false, condition: null, errors: ['candidate_not_object'] };
  if (!c.id || typeof c.id !== 'string') errors.push('missing_id');
  if (!c.field || typeof c.field !== 'string') errors.push('missing_field');
  if (!c.op) errors.push('missing_op');
  if (c.value === undefined || c.value === null) errors.push('missing_value');
  if (c.direction && !DIRECTIONS.includes(c.direction)) errors.push(`invalid_direction:${c.direction}`);
  if (typeof c.expected !== 'string') errors.push('missing_expected'); // 结算方向枚举，供命中率计算

  if (errors.length) return { ok: false, condition: null, errors };

  const condition = toCondition(c);
  const comp = DslEngine.compile(condition);
  if (!comp.ok) {
    return { ok: false, condition, errors: comp.errors.map((e) => e.code) };
  }
  return { ok: true, condition, errors: [] };
}

module.exports = { toCondition, validateCandidate };