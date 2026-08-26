// ============================================================================
// API 网关 · 限流中间件（固定窗口；内存 / Redis 共享两种后端）
// 按客户端 IP 限流，超限返回 429 + Retry-After（生产网关形态，防单客户端打爆）。
// 单后端用内存窗口即可；多实例共享限流需 Redis（INCR+EXPIRE 固定窗口，
// 键 rl:<ip>，窗口锚定在首次请求的 EXPIRE，跨实例计数共享）。
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

/**
 * 创建限流中间件（Redis 共享固定窗口，多实例部署用）。
 * 计数与窗口统一存 Redis（键 rl:<ip>），跨实例共享；Redis 不可用时回退内存中间件。
 * 返回异步中间件：`(req, res) => Promise<boolean>`。true 表示放行；超限已写 429。
 * @param {{
 *   max?: number,            // 窗口内最大请求数（默认 300；<=0 禁用）
 *   windowMs?: number,       // 窗口毫秒（默认 60000）
 *   redis: object,           // ioredis 客户端
 *   logger?: object,
 *   fallback?: Function,     // 内存回退中间件（默认内部构造）
 * }} [opts]
 */
function createRateLimitRedisMiddleware({ max = 300, windowMs = 60_000, redis, logger = defaultLogger, fallback } = {}) {
  if (!(max > 0)) {
    logger.info('rate_limit_disabled');
    return (req, res) => true;
  }
  // Redis 未注入 → 直接回退内存
  if (!redis) {
    logger.warn('rate_limit_redis_missing_fallback_memory');
    return fallback || createRateLimitMiddleware({ max, windowMs, logger });
  }
  const memory = fallback || createRateLimitMiddleware({ max, windowMs, logger });
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const over = (res, ip, count) => {
    // 固定窗口无精确剩余秒（窗口锚定在首次 EXPIRE），用窗口上限作安全 Retry-After
    res.setHeader('Retry-After', String(windowSec));
    logger.warn('rate_limited', { ip, store: 'redis' });
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', error: 'rate_limited', message: `请求过于频繁，请 ${windowSec} 秒后重试` }));
  };

  return async function rateLimitRedis(req, res) {
    const ip = clientIp(req);
    let count;
    try {
      const key = `rl:${ip}`;
      count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);
    } catch (e) {
      // Redis 抖动/宕机时降级内存限流（不熔断开放），并记日志可观测
      logger.warn('rate_limit_redis_fallback_memory', { error: e.message });
      return memory(req, res);
    }
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));
    if (count > max) { over(res, ip, count); return false; }
    return true;
  };
}

module.exports = { createRateLimitMiddleware, createRateLimitRedisMiddleware, clientIp };
