// ============================================================================
// DSL 引擎 · evaluator —— 时间泄漏先验 + 递归求值 + 推理链 + 外部引用
// evaluate(ruleVersion, data, context) → RuleMatch
//   data    : { features, match? }   特征快照 + 可选的原始数据视图
//   context : { evaluated_at: T, threshold?, compiled? }
// 确定性：同一输入 → 同一输出。
// ============================================================================
'use strict';

const { compile } = require('./parser');
const { applyOperator } = require('./operators');
const { weightedJaccard } = require('./matcher');
const { DEFAULT_MATCH_THRESHOLD, TYPES } = require('./registry');

/** 解析普通字段：从 features 查找 */
function resolveFeature(features, field) {
  if (!features) return { value: undefined, state: 'data_missing' };
  if (!Object.prototype.hasOwnProperty.call(features, field)) {
    return { value: undefined, state: 'data_missing' };
  }
  const v = features[field];
  if (v === undefined || v === null) return { value: undefined, state: 'data_missing' };
  return { value: v, state: 'hit' };
}

/** 沿点分隔路径解析根对象 */
function resolvePath(root, pathExpr) {
  const p = pathExpr.trim();
  if (!p.startsWith('$') || p.length === 1) return { value: undefined, ok: false };
  const segs = p.slice(1).split('.').filter(Boolean);
  let cur = root;
  for (const seg of segs) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) {
      return { value: undefined, ok: false };
    }
    cur = cur[seg];
  }
  return { value: cur, ok: cur !== undefined && cur !== null };
}

/** 解析字段（普通 或 外部引用表达式） → { value, state } */
function resolveField(node, data) {
  const { field } = node;
  if (field == null) return { value: undefined, state: 'data_missing' };

  // 外部引用
  if (typeof field === 'string' && field.trim().startsWith('$')) {
    const parts = field.split(/[+-]/).map((s) => s.trim());
    const ops = [];
    for (const ch of field) { if (ch === '-' || ch === '+') ops.push(ch); }

    const root = data || {};
    const vals = [];
    let unresolved = false;
    for (const part of parts) {
      const r = resolvePath(root, part);
      if (!r.ok) { unresolved = true; break; }
      const v = r.value;
      if (typeof v !== 'number') { unresolved = true; break; }
      vals.push(v);
    }
    if (unresolved) return { value: undefined, state: 'path_unresolved' };

    let acc = vals[0];
    for (let i = 1; i < vals.length; i++) {
      acc = ops[i - 1] === '-' ? acc - vals[i] : acc + vals[i];
    }
    return { value: acc, state: 'hit' };
  }

  return resolveFeature(data && data.features, field);
}

/**
 * 递归求值条件树，收集推理链。
 * @returns { { hit: boolean, worst: string|null } }
 */
function evalNode(node, data, chain, warnings) {
  const type = node.type;

  if (type === 'AND') {
    const childResults = node.conditions.map((c) => evalNode(c, data, chain, warnings));
    return { hit: childResults.every((r) => r.hit), worst: null };
  }
  if (type === 'OR') {
    const childResults = node.conditions.map((c) => evalNode(c, data, chain, warnings));
    return { hit: childResults.some((r) => r.hit), worst: null };
  }
  if (type === 'NOT') {
    const r = evalNode(node.conditions[0], data, chain, warnings);
    return { hit: !r.hit, worst: null };
  }
  // ATOMIC
  const w = node.weight === undefined ? 1 : node.weight;
  const { value: actual, state } = resolveField(node, data);

  if (state !== 'hit') {
    const code = state === 'path_unresolved' ? 'E2003' : 'E2002';
    const reason = state === 'path_unresolved'
      ? `${code}:${node.field}`
      : `${code}:${node.field}`;
    warnings.push(reason);
    chain.push({
      field: node.field, op: node.op, value: node.value, actual: undefined,
      hit: false, weight: w, state, warning: code,
    });
    return { hit: false, worst: code };
  }

  const hit = applyOperator(node.fieldType, node.op, actual, node.value);
  chain.push({
    field: node.field, op: node.op, value: node.value, actual,
    hit, weight: w, state: hit ? 'hit' : 'miss', warning: null,
  });
  return { hit, worst: null };
}

/**
 * 求值入口。
 * @param {Object} ruleVersion
 * @param {Object} data { features: object, match?: object }
 * @param {Object} context { evaluated_at, threshold?, compiled? }
 * @returns {Object} RuleMatch
 */
function evaluate(ruleVersion, data, context = {}) {
  const T = context.evaluated_at || new Date().toISOString();
  const threshold = context.threshold == null ? DEFAULT_MATCH_THRESHOLD : context.threshold;
  const warnings = [];
  let skipped = false;
  let skipReason = null;

  // 时间泄漏预校验
  if (ruleVersion.valid_from && Date.parse(ruleVersion.valid_from) > Date.parse(T)) {
    skipped = true; skipReason = 'E2001:valid_from_in_future';
    warnings.push(skipReason);
  } else if (ruleVersion.valid_to && Date.parse(ruleVersion.valid_to) < Date.parse(T)) {
    skipped = true; skipReason = 'E2001:valid_to_expired';
    warnings.push(skipReason);
  }

  const chain = [];
  let hit = false;
  let exact = false;
  let matchType = 'none';
  let degree = 0;

  if (!skipped) {
    // 编译
    const tree = context.compiled || compile(ruleVersion.condition || {}).tree;
    if (!tree) {
      skipped = true;
      skipReason = 'compile_failed';
      warnings.push('compile_failed');
    } else {
      const root = evalNode(tree, data, chain, warnings);
      hit = root.hit;
      const jj = weightedJaccard(chain, threshold);
      exact = jj.exact;
      matchType = jj.match_type;
      degree = jj.degree;
      hit = jj.hit;
    }
  }

  return {
    rule_id: ruleVersion.rule_id,
    version_id: ruleVersion.version_id,
    direction: ruleVersion.direction,
    category: ruleVersion.category,
    hit,
    exact,
    match_type: skipped ? 'none' : matchType,
    match_degree: skipped ? 0 : degree,
    chain,
    warnings,
    skipped,
    skip_reason: skipReason,
    evaluated_at: T,
  };
}

module.exports = { evaluate, resolveField, resolvePath };