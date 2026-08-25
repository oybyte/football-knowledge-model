// ============================================================================
// API 网关入口
// 整合鉴权、健康检查、指标端点。
// ============================================================================
'use strict';

const { createAuthMiddleware } = require('./auth');
const { createHealthHandler, createMetricsHandler } = require('./health');

/**
 * 创建网关中间件集
 * @param {object} service
 * @param {{ apiKey?: string, logger?: object }} [opts]
 */
function createGateway(service, opts = {}) {
  const auth = createAuthMiddleware(opts);
  const health = createHealthHandler(service, opts);
  const metrics = createMetricsHandler(service);

  return { auth, health, metrics };
}

module.exports = { createGateway };