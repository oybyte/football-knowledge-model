// ============================================================================
// DSL 引擎 · parser —— JSON 条件树 → 类型标注树 + 8 项编译期校验 + 错误码
// 校验：字段存在性(E1001) / 类型兼容(E1002) / 值域(E1003) / 锚点(E1003)
//       嵌套深度(E1003) / 条件总数(E1003) / 权重范围(E1003) / 外部引用+正则(E1004)
// 输出 { ok, tree?, errors:[{code,message,path}] }
// ============================================================================
'use strict';

const { FIELD_REGISTRY, OP_TYPE_SUPPORT, ALL_OPERATORS, ANCHORS, TYPES } = require('./registry');

const MAX_DEPTH = 8;
const MAX_CONDITIONS = 32;

const err = (code, message, path) => ({ code, message, path });

/** 外部引用路径形式：单个 $path 或 $pathA - $pathB */
function isExternalRef(field) {
  if (typeof field !== 'string') return false;
  return field.trim().startsWith('$');
}

/** 拆分外部引用表达式为路径段数组 */
function splitExternalExpr(field) {
  return field.split(/[+-]/).map((s) => s.trim());
}

/** 校验单个外部引用路径 */
function validateExternalPath(p, path) {
  const errors = [];
  if (p.startsWith('$') && p.length > 1) return errors;
  errors.push(err('E2003', `unresolvable_external_path: ${p}`, path));
  return errors;
}

/**
 * 编译 condition（递归）。
 * @param {Object} node
 * @param {string} path 节点路径（调试）
 * @param {number} depth
 * @param {Object} state { atomicCount, errors }
 * @returns {Object} 类型标注后的节点
 */
function compileNode(node, path, depth, state) {
  if (!node || typeof node !== 'object' || !node.type) {
    state.errors.push(err('E1002', 'missing_node_type', path));
    return null;
  }
  const base = { type: node.type, path };

  if (node.type === 'ATOMIC') {
    state.atomicCount += 1;
    if (state.atomicCount > MAX_CONDITIONS) {
      state.errors.push(err('E1003', `too_many_conditions:>${MAX_CONDITIONS}`, path));
    }
    return compileAtomic(node, path, state);
  }

  if (node.type === 'AND' || node.type === 'OR') {
    if (!Array.isArray(node.conditions) || node.conditions.length === 0) {
      state.errors.push(err('E1002', `${node.type}_requires_conditions`, path));
      return base;
    }
    return {
      ...base,
      conditions: node.conditions.map((c, i) => compileNode(c, `${path}[${i}]`, depth + 1, state)).filter(Boolean),
    };
  }

  if (node.type === 'NOT') {
    if (!node.conditions || node.conditions.length !== 1) {
      state.errors.push(err('E1002', 'NOT_requires_single_child', path));
      return base;
    }
    return { ...base, conditions: [compileNode(node.conditions[0], `${path}[0]`, depth + 1, state)].filter(Boolean) };
  }

  state.errors.push(err('E1002', `unknown_node_type:${node.type}`, path));
  return base;
}

/** 编译单个原子条件 */
function compileAtomic(node, path, state) {
  const { op, value } = node;
  const field = node.field;

  // 校验算子
  if (!ALL_OPERATORS.includes(op)) {
    state.errors.push(err('E1002', `unknown_operator:${op}`, path));
    return null;
  }

  // 外部引用 vs 注册字段
  if (isExternalRef(field)) {
    let arity = 1;
    const parts = splitExternalExpr(field);
    if (parts.length > 2) {
      state.errors.push(err('E1003', 'external_expr_arity:>2', path));
    }
    for (const p of parts) {
      const subErr = validateExternalPath(p, path);
      state.errors.push(...subErr);
    }
    arity = parts.length;
    // 类型：数值表达式；校验值类型（需与求值结果比较）
    if (typeof value !== 'number') {
      state.errors.push(err('E1002', 'external_expr_value_must_be_number', path));
    }
    return { ...node, fieldType: 'expr', arity };
  }

  const meta = FIELD_REGISTRY[field];
  if (!meta) {
    state.errors.push(err('E1001', `unknown_field:${field}`, path));
    return null;
  }

  // 算子与字段类型兼容
  if (!OP_TYPE_SUPPORT[op].includes(meta.type)) {
    state.errors.push(err('E1002', `operator_not_compatible:${op}@${meta.type}`, path));
  }

  // 值类型校验
  const valueTypeOk = checkValueType(op, meta.type, value, path, state);
  void valueTypeOk;

  // 值域校验
  if (typeof value === 'number' && meta.min !== undefined && value < meta.min) {
    state.errors.push(err('E1003', `value_below_min:${value}<${meta.min}`, path));
  }
  if (typeof value === 'number' && meta.max !== undefined && value > meta.max) {
    state.errors.push(err('E1003', `value_above_max:${value}>${meta.max}`, path));
  }

  // 权重范围
  const w = node.weight === undefined ? 1 : node.weight;
  if (typeof w !== 'number' || w < 0 || w > 1) {
    state.errors.push(err('E1003', `invalid_weight:${w}`, path));
  }

  // time_window 锚点合法性
  if (node.time_window && !ANCHORS.includes(node.time_window.anchor)) {
    state.errors.push(err('E1003', `invalid_anchor:${node.time_window.anchor}`, path));
  }

  return { ...node, fieldType: meta.type, registryMeta: meta };
}

/** 校验值类型与算子/字段兼容 */
function checkValueType(op, fieldType, value, path, state) {
  if (op === 'IN') {
    if (!Array.isArray(value)) {
      state.errors.push(err('E1002', `IN_value_must_be_array`, path));
    }
    return;
  }
  if (op === 'BETWEEN') {
    if (!Array.isArray(value) || value.length !== 2) {
      state.errors.push(err('E1002', `BETWEEN_value_must_be_[a,b]`, path));
    }
    return;
  }
  if (op === 'PATTERN') {
    if (typeof value !== 'string') {
      state.errors.push(err('E1002', `PATTERN_value_must_be_string`, path));
    } else {
      try { new RegExp(value); } catch (e) {
        state.errors.push(err('E1004', `invalid_regex:${value}`, path));
      }
    }
    return;
  }
  // 数值/布尔比较
  if (fieldType === TYPES.STRING) {
    if (typeof value !== 'string') state.errors.push(err('E1002', `string_field_requires_string_value`, path));
  } else if (fieldType === TYPES.BOOLEAN) {
    if (typeof value !== 'boolean') state.errors.push(err('E1002', `boolean_field_requires_boolean_value`, path));
  } else {
    if (typeof value !== 'number') state.errors.push(err('E1002', `numeric_field_requires_number_value`, path));
  }
}

/**
 * 编译期校验入口。
 * @param {Object} condition
 * @param {Object} [options]
 * @returns {{ ok: boolean, tree?: Object, errors: Array }}
 */
function compile(condition, options = {}) {
  const state = { atomicCount: 0, errors: [] };
  const tree = compileNode(condition || {}, 'root', 0, state);

  // 嵌套深度校验（编译第一条 error 时已由递归深度控制，这里显式检查结构）
  if (!state.errors.length) checkDepth(condition, state);

  const errors = state.errors;
  const fail = errors.length > 0;
  if (options.throwOnError && fail) {
    const e = new Error(`dsl_compile_failed: ${errors.map((x) => x.code).join(',')}`);
    e.errors = errors;
    throw e;
  }
  return { ok: !fail, tree: fail ? null : tree, errors };
}

/** 校验嵌套深度 */
function checkDepth(node, state, depth = 0) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'AND' || node.type === 'OR' || node.type === 'NOT') {
    if (depth >= MAX_DEPTH) {
      state.errors.push(err('E1003', `depth_exceeds:${MAX_DEPTH}`, 'root'));
      return;
    }
    for (const c of node.conditions || []) checkDepth(c, state, depth + 1);
  }
}

module.exports = { compile, MAX_DEPTH, MAX_CONDITIONS, isExternalRef, splitExternalExpr };