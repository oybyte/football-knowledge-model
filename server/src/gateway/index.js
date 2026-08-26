// ============================================================================
// API 网关入口
// 整合鉴权（多 Key / 撤销 / 常量时间 / 哈希）、限流、健康检查、指标端点。
// ============================================================================
'use strict';

const { createAuthMiddleware } = require('./auth');
const { createHealthHandler, createMetricsHandler } = require('./health');
const { createRateLimitMiddleware, createRateLimitRedisMiddleware } = require('./rateLimit');

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
 *   rateLimitStore?: 'memory' | 'redis',  // 默认 memory；redis=多实例共享计数
 *   redis?: object,                        // 共享 ioredis 客户端（redis 限流用）
 *   logger?: object,
 * }} [opts]
 */
function createGateway(service, opts = {}) {
  const auth = createAuthMiddleware(opts);
  const health = createHealthHandler(service, opts);
  const metrics = createMetricsHandler(service);
  const useRedis = opts.rateLimitStore === 'redis';
  const rateLimit = useRedis
    ? createRateLimitRedisMiddleware({
        max: opts.rateLimitMax,
        windowMs: opts.rateLimitWindowMs,
        redis: opts.redis,
        logger: opts.logger,
      })
    : createRateLimitMiddleware({
        max: opts.rateLimitMax,
        windowMs: opts.rateLimitWindowMs,
        logger: opts.logger,
      });

  return { auth, rateLimit, health, metrics };
}

module.exports = { createGateway };