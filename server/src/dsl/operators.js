// ============================================================================
// DSL 引擎 · operators —— 11 算子求值实现
// 对齐 dsl-syntax 算子表。number EQ/NEQ 用 epsilon 比较（1e-9）。
// 所有算子返回布尔。actual 为 undefined/null 时统一判 false（调用方处理）。
// ============================================================================
'use strict';

const { TYPES, EPSILON } = require('./registry');

const typeOfField = (v) => (typeof v === 'string' ? TYPES.STRING
  : typeof v === 'boolean' ? TYPES.BOOLEAN
    : Number.isInteger(v) ? TYPES.INTEGER
      : typeof v === 'number' ? TYPES.NUMBER
        : null);

const eq = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= EPSILON;
  return a === b;
};

/**
 * 执行单算子求值。
 * @param {import('./registry').TYPES} type 字段类型
 * @param {string} op 算子
 * @param {*} actual 数据侧实际值
 * @param {*} value 规则侧阈值
 * @returns {boolean}
 */
function applyOperator(type, op, actual, value) {
  if (actual === undefined || actual === null) return false;
  switch (op) {
    case 'EQ': return eq(actual, value);
    case 'NEQ': return !eq(actual, value);
    case 'GT': return actual > value;
    case 'GTE': return actual >= value;
    case 'LT': return actual < value;
    case 'LTE': return actual <= value;
    case 'BETWEEN':
      return Array.isArray(value) && value.length === 2 && actual >= value[0] && actual <= value[1];
    case 'IN':
      return Array.isArray(value) && value.includes(actual);
    case 'PATTERN':
      return typeof actual === 'string' && new RegExp(value).test(actual);
    case 'ABS_GT': return Math.abs(actual) > value;
    case 'ABS_LT': return Math.abs(actual) < value;
    default: return false;
  }
}

module.exports = { applyOperator, typeOfField, eq };