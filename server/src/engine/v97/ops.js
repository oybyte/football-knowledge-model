// ============================================================================
// V9.7 引擎 · ops —— 条件算子求值
//
// 注册表实测算子面：eq195 / gte52 / lte34 / in23 / custom13 / lt7 / gt3 / exists2 / ne1
// 本模块覆盖除 custom 外的全部算子；custom 语义由各规则自定义，未实现时返回
// null（无法判定），上层据此标 insufficient_data，绝不当成 false。
//
// 两处注册表不一致在此抹平：
//  1) 档位字面量不统一：R13 用「深盘」，R01 用「深盘(≥半一)」→ 比较前统一规范化。
//  2) 中文盘口名参与 lte/gte：handicap_depth lte "平半" / gte "主让半一"
//     → 两侧统一转序数（平半=0.25、半一=0.75…）后再比大小。
// ============================================================================
'use strict';

const { canonicalBand, toOrdinal, BAND_ALIASES } = require('./handicap');

/** 无法判定的哨兵（区别于 false）。 */
const UNKNOWN = null;

/** 是否受支持（custom 尚未实现）。 */
const SUPPORTED_OPS = new Set(['eq', 'ne', 'gte', 'lte', 'gt', 'lt', 'in', 'exists']);

/**
 * 比较前把两侧统一到同一语义空间。
 * @returns {{a:*, b:*}} 规范化后的两侧
 */
function normalize(actual, expected) {
  const looksBand = (x) => typeof x === 'string' && (x in BAND_ALIASES || /^[浅中深]盘/.test(x));
  const looksHandicapName = (x) =>
    typeof x === 'string' && (/^(主让|客让)/.test(x) || /^[平半一球两]/.test(x)) && toOrdinal(x) != null;

  if (looksBand(actual) || looksBand(expected)) {
    return { a: canonicalBand(actual), b: canonicalBand(expected) };
  }
  if (looksHandicapName(actual) || looksHandicapName(expected)) {
    const a = toOrdinal(actual);
    const b = toOrdinal(expected);
    if (a != null && b != null) return { a, b };
  }
  // 数值字符串（line 存的是 "-0.5" 这类字符串）
  if (typeof actual === 'string' && actual !== '' && Number.isFinite(Number(actual))) {
    return { a: Number(actual), b: typeof expected === 'string' && Number.isFinite(Number(expected)) ? Number(expected) : expected };
  }
  return { a: actual, b: expected };
}

/**
 * 单条件求值。
 * @param {string} op
 * @param {*} actual 字段实际值
 * @param {*} expected 规则期望值
 * @returns {boolean|null} true/false，null = 无法判定（算子未实现或语义不可比）
 */
function evaluate(op, actual, expected) {
  if (!SUPPORTED_OPS.has(op)) return UNKNOWN; // custom 等 → 上层标 insufficient_data

  if (op === 'exists') {
    return actual !== null && actual !== undefined;
  }
  if (actual === null || actual === undefined) return UNKNOWN;

  const { a, b } = normalize(actual, expected);

  switch (op) {
    case 'eq':
      // 布尔/数值/字符串等值；「true」与 true 视为相等（注册表里 dual_line 写作 true 布尔）
      if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
      return a === b;
    case 'ne':
      return String(a) !== String(b);
    case 'gte':
      return typeof a === typeof b || (typeof a === 'number' && typeof b === 'number') ? a >= b : UNKNOWN;
    case 'lte':
      return typeof a === typeof b || (typeof a === 'number' && typeof b === 'number') ? a <= b : UNKNOWN;
    case 'gt':
      return typeof a === 'number' && typeof b === 'number' ? a > b : UNKNOWN;
    case 'lt':
      return typeof a === 'number' && typeof b === 'number' ? a < b : UNKNOWN;
    case 'in':
      return Array.isArray(b) ? b.map((x) => normalize(a, x).b).includes(a) : UNKNOWN;
    default:
      return UNKNOWN;
  }
}

module.exports = { evaluate, SUPPORTED_OPS, UNKNOWN, normalize };
