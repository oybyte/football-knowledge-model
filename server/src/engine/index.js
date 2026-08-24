// ============================================================================
// 预测链 · engine 入口 —— 2.3 预测链接入（retrieval + arbitration + prediction）
// 交付路径对齐实施计划 2.3：server/src/engine/*
// ============================================================================
'use strict';

const { matchExact, matchFuzzy, traceRuleChain, traceMatchChain } = require('./retrieval');
const { predict, freezeEvidence } = require('./prediction');
// 冲突仲裁（三层）直接复用 1.7 worker 实现
const { arbitrate, computeScore, REVIEW_DIFF, detectConflicts, isConflicting, CONFLICT_DIRECTIONS } = require('../worker');

module.exports = {
  // 检索引擎
  matchExact,
  matchFuzzy,
  traceRuleChain,
  traceMatchChain,
  // 冲突仲裁（三层）
  arbitrate,
  computeScore,
  REVIEW_DIFF,
  detectConflicts,
  isConflicting,
  CONFLICT_DIRECTIONS,
  // 预测输出 + 证据快照
  predict,
  freezeEvidence,
};