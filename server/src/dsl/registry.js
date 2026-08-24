// ============================================================================
// DSL 引擎 · registry —— 字段注册表（类型/单位/值域）+ 算子类型支持表
// 基于 1.2 特征工程 §3 的 23 个输出字段 + 2 个 match 元字段。
// 外部引用（$path）不进注册表，作为运行时路径引用单独处理（见 evaluator）。
// ============================================================================
'use strict';

const EPSILON = 1e-9;

/** 字段类型代号 */
const TYPES = Object.freeze({
  NUMBER: 'number',
  INTEGER: 'integer',
  STRING: 'string',
  BOOLEAN: 'boolean',
});

/**
 * 字段注册表：field → { type, unit?, min?, max? }
 */
const FIELD_REGISTRY = Object.freeze({
  // 横截面
  'institution.diff_max': { type: TYPES.NUMBER, unit: 'goal' },
  'water.upper.dispersion': { type: TYPES.NUMBER, unit: 'point' },
  'water.lower.dispersion': { type: TYPES.NUMBER, unit: 'point' },
  // 时序
  'handicap.change': { type: TYPES.NUMBER, unit: 'goal' },
  'handicap.current': { type: TYPES.NUMBER, unit: 'goal' },
  'water.upper.change': { type: TYPES.NUMBER, unit: 'point' },
  'water.lower.change': { type: TYPES.NUMBER, unit: 'point' },
  'water.upper.drop_count': { type: TYPES.INTEGER, min: 0 },
  'water.upper.rise_count': { type: TYPES.INTEGER, min: 0 },
  'time_to_match': { type: TYPES.INTEGER, unit: 'minutes', min: 0 },
  'move_pattern': { type: TYPES.STRING },
  'stability_flag': { type: TYPES.BOOLEAN },
  // 共振
  'institution.sync_count': { type: TYPES.INTEGER, min: 0 },
  'consensus_direction': { type: TYPES.STRING },
  // 异常
  'kelly_index.max': { type: TYPES.NUMBER },
  'kelly_index.min': { type: TYPES.NUMBER },
  'kelly_index.divergence': { type: TYPES.NUMBER },
  'volume.ratio': { type: TYPES.NUMBER, min: 0, max: 10 },
  'odds.volatility': { type: TYPES.NUMBER, min: 0, max: 15 },
  // 欧指 + 必发
  'kelly_index.home_max': { type: TYPES.NUMBER },
  'betfair.dominant_ratio': { type: TYPES.NUMBER, min: 0, max: 1 },
  'betfair.heat': { type: TYPES.NUMBER },
  'betfair.turnover': { type: TYPES.NUMBER, min: 0 },
  // match 元信息
  'match.league': { type: TYPES.STRING },
  'match.home_team': { type: TYPES.STRING },
});

/** 算子 → 适用字段类型 */
const OP_TYPE_SUPPORT = Object.freeze({
  EQ: [TYPES.NUMBER, TYPES.INTEGER, TYPES.STRING, TYPES.BOOLEAN],
  NEQ: [TYPES.NUMBER, TYPES.INTEGER, TYPES.STRING, TYPES.BOOLEAN],
  GT: [TYPES.NUMBER, TYPES.INTEGER],
  GTE: [TYPES.NUMBER, TYPES.INTEGER],
  LT: [TYPES.NUMBER, TYPES.INTEGER],
  LTE: [TYPES.NUMBER, TYPES.INTEGER],
  BETWEEN: [TYPES.NUMBER, TYPES.INTEGER],
  IN: [TYPES.STRING, TYPES.INTEGER],
  PATTERN: [TYPES.STRING],
  ABS_GT: [TYPES.NUMBER],
  ABS_LT: [TYPES.NUMBER],
});

const ALL_OPERATORS = Object.freeze(Object.keys(OP_TYPE_SUPPORT));

/** 合法 time_window.anchor 枚举 */
const ANCHORS = Object.freeze(['kickoff', 'now', 'match_start']);

/** 默认模糊匹配阈值 */
const DEFAULT_MATCH_THRESHOLD = 0.6;

module.exports = {
  TYPES,
  FIELD_REGISTRY,
  OP_TYPE_SUPPORT,
  ALL_OPERATORS,
  ANCHORS,
  DEFAULT_MATCH_THRESHOLD,
  EPSILON,
};