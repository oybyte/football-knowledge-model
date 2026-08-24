// ============================================================================
// 融合决策层 · 入口 —— 整合 weights / containment / confidence / fuse / decision
// 对外暴露 ConfidenceProvider（G19）+ fuseDecision() 便捷函数。
// ============================================================================
'use strict';

const { DEFAULT_WEIGHTS, STREAMS, normalizeWeights, computeBasisWeights } = require('./weights');
const { resolveTrust, gateCheck, isValidDirection, isValidConfidence } = require('./containment');
const { ConfidenceProvider } = require('./confidence');
const { fuse } = require('./fuse');
const { buildFusionDecision } = require('./decision');
const { ConfidenceGate } = require('../backtest/confidenceGate');
const { defaultLogger } = require('../lib/logger');

// 默认单例：共享回测置信度门（G19）
const confidenceGate = new ConfidenceGate();
const confidenceProvider = new ConfidenceProvider({ gate: confidenceGate });

/**
 * 执行一次融合决策（复用默认 provider + logger）。
 * @param {Object} p
 * @param {string} p.match_id
 * @param {Object|null} p.rule_output DSL RuleMatch
 * @param {Object|null} p.model_output
 * @param {Object|null} p.anomaly_output
 * @param {Object} [p.context] { provider?, rule_version_id?, rule_base_confidence? }
 * @param {string} [p.created_by]
 * @returns {Object} 冻结的 FusionDecision
 */
function fuseDecision(params) {
  const { match_id, rule_output, model_output, anomaly_output, context = {}, created_by } = params;
  const mergedContext = { ...context, provider: context.provider || confidenceProvider };
  const fused = fuse({
    rule_output,
    model_output,
    anomaly_output,
    context: mergedContext,
  });
  return buildFusionDecision({
    match_id,
    fused,
    created_by,
    logger: context.logger || defaultLogger,
  });
}

module.exports = {
  // 便捷入口
  fuseDecision,
  // G19 置信度门
  ConfidenceGate,
  confidenceGate,
  confidenceProvider,
  // 算法
  fuse,
  // 权重
  DEFAULT_WEIGHTS,
  STREAMS,
  normalizeWeights,
  computeBasisWeights,
  // 隔离
  resolveTrust,
  gateCheck,
  isValidDirection,
  isValidConfidence,
  // 决策组装
  buildFusionDecision,
};