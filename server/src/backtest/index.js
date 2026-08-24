// ============================================================================
// 回测框架 · 入口 —— 整合 eligibility / evidence / metrics / scheduler / report / gate
// 对外暴露：5 项准入、证据快照、6 项指标、回测调度、置信度门（G19）
// ============================================================================
'use strict';

const { validateEvidenceEligibility } = require('./eligibility');
const { createEvidenceSnapshot } = require('./evidence');
const { computeMetrics, THRESHOLDS } = require('./metrics');
const { BacktestScheduler, passRatio } = require('./scheduler');
const { buildReport } = require('./report');
const { ConfidenceGate } = require('./confidenceGate');

const scheduler = new BacktestScheduler();
const confidenceGate = new ConfidenceGate();

/**
 * 便捷入口：以默认调度器 + 默认置信度门运行一次回测。
 * @param {Object} args 透传 runBacktest 参数
 * @returns {Object} BacktestJob
 */
function runBacktest(args) {
  return scheduler.runBacktest({ confidenceGate: scheduler.confidenceGate ?? confidenceGate, ...args });
}

module.exports = {
  // 5 项准入
  validateEvidenceEligibility,
  // 证据快照（不可变）
  createEvidenceSnapshot,
  // 6 项指标
  computeMetrics,
  THRESHOLDS,
  // 调度
  BacktestScheduler,
  scheduler,
  runBacktest,
  passRatio,
  // 报告
  buildReport,
  // G19 时序
  ConfidenceGate,
  confidenceGate,
};