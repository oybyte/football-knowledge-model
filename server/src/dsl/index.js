// ============================================================================
// DSL 引擎 · 入口 —— DslEngine 封装 compile + evaluate + matchFuzzy
// 消费 1.3 规则的 condition 与 1.2 特征快照，产出 RuleMatch。
// ============================================================================
'use strict';

const { compile, MAX_DEPTH, MAX_CONDITIONS, isExternalRef, splitExternalExpr } = require('./parser');
const { evaluate, resolveField, resolvePath } = require('./evaluator');
const { weightedJaccard } = require('./matcher');
const { applyOperator, typeOfField, eq } = require('./operators');
const {
  FIELD_REGISTRY,
  OP_TYPE_SUPPORT,
  ALL_OPERATORS,
  ANCHORS,
  TYPES,
  DEFAULT_MATCH_THRESHOLD,
  EPSILON,
} = require('./registry');

/**
 * DslEngine —— DSL 解析 + 求值 + 模糊匹配。
 */
const DslEngine = Object.freeze({
  compile,
  evaluate,
  matchFuzzy: weightedJaccard,
  // 内部模块
  operators: { applyOperator, typeOfField, eq },
  registry: { FIELD_REGISTRY, OP_TYPE_SUPPORT, ALL_OPERATORS, ANCHORS, TYPES },
});

module.exports = {
  DslEngine,
  compile,
  evaluate,
  weightedJaccard,
  // 常量
  MAX_DEPTH,
  MAX_CONDITIONS,
  DEFAULT_MATCH_THRESHOLD,
  EPSILON,
  // 解析工具
  isExternalRef,
  splitExternalExpr,
  resolvePath,
};