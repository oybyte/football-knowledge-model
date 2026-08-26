// ============================================================================
// API 网关入口
// 整合鉴权（多 Key / 撤销 / 常量时间 / 哈希）、限流、健康检查、指标端点。
// ============================================================================
'use strict';

const { createAuthMiddleware } = require('./auth');
const { createHealthHandler, createMetricsHandler } = require('./health');
const { createRateLimitMiddleware } = require('./rateLimit');

/**
 * 创建网关中间件集
 * @param {object} service
 * @param {{
 *   apiKey?: string,
 *   apiKeys?: string[],
 *   revokedKeys?: string[],
 *   audit?: (message: string, payload: object) => void,
 *   rateLimitMax?: number,
 *   rateLimitWindowMs?: number,
 *   logger?: object,
 * }} [opts]
 */
function createGateway(service, opts = {}) {
  const auth = createAuthMiddleware(opts);
  const health = createHealthHandler(service, opts);
  const metrics = createMetricsHandler(service);
  const rateLimit = createRateLimitMiddleware({
    max: opts.rateLimitMax,
    windowMs: opts.rateLimitWindowMs,
    logger: opts.logger,
  });

  return { auth, rateLimit, health, metrics };
}

module.exports = { createGateway };