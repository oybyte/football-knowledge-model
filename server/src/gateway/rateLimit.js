// ============================================================================
// API 网关 · 限流中间件（内存固定窗口）
// 按客户端 IP 限流，超限返回 429 + Retry-After（生产网关形态，防单客户端打爆）。
// 单实例内存窗口即可满足单后端部署；多实例需换共享存储（Redis）实现。
// ============================================================================
'use strict';

const { defaultLogger } = require('../lib/logger');

/** 从 X-Forwarded-For 或 socket 提取客户端 IP。 */
function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** 惰性清理过期桶，防 Map 无限增长（仅当桶数超阈值时触发）。 */
function sweep(buckets, now) {
  if (buckets.size < 10_000) return;
  for (const [ip, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(ip);
  }
}

/**
 * 创建限流中间件（内存固定窗口）。
 * @param {{
 *   max?: number,        // 窗口内最大请求数（默认 300；<=0 禁用）
 *   windowMs?: number,   // 窗口毫秒（默认 60000）
 *   logger?: object,
 * }} [opts]
 * @returns {(req: object, res: object) => boolean} 返回 true 表示放行
 */
function createRateLimitMiddleware({ max = 300, windowMs = 60_000, logger = defaultLogger } = {}) {
  if (!(max > 0)) {
    logger.info('rate_limit_disabled');
    return (req, res) => true;
  }

  const buckets = new Map();

  return function rateLimit(req, res) {
    const now = Date.now();
    const ip = clientIp(req);
    sweep(buckets, now);

    let b = buckets.get(ip);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, b);
    }
    b.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));

    if (b.count > max) {
      const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      logger.warn('rate_limited', { ip, path: req.url, method: req.method });
      res.statusCode = 429;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'error', error: 'rate_limited', message: `请求过于频繁，请 ${retryAfter} 秒后重试` }));
      return false;
    }
    return true;
  };
}

module.exports = { createRateLimitMiddleware, clientIp };
