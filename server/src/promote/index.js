// ============================================================================
// 回测转正 · 入口 —— 2.2 回测验证 → 转正上线
// 集成 2.1 入库的 draft 规则、1.5 回测指标、1.3 状态机。
// ============================================================================
'use strict';

const { promoteRule, batchPromote, LIFECYCLE } = require('./promote');
const { computeMetrics, THRESHOLDS } = require('../backtest/metrics');

module.exports = {
  promoteRule,
  batchPromote,
  LIFECYCLE,
  computeMetrics,
  THRESHOLDS,
};