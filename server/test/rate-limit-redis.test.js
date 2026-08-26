// ============================================================================
// API 网关 · Redis 共享限流中间件测试
// 覆盖：走真实 RESP 协议（MinimalRedisServer）共享计数；超限 429+Retry-After；
// 跨实例（两个中间件对象）计数合并；窗口过期后重置；Redis 不可用回退内存。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MinimalRedisServer } = require('./helpers/resp-server');
const { createRateLimitRedisMiddleware, createRateLimitMiddleware } = require('../src/gateway/rateLimit');
const Redis = require('ioredis');

function mkReq(ip) {
  return { headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: '0.0.0.0' }, url: '/api/matches', method: 'GET' };
}
function mkRes() {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end() { this.ended = true; } };
  return res;
}
function quiet() { return { info() {}, warn() {}, error() {} }; }

function connect(server) {
  return new Redis(server.port, { host: '127.0.0.1', lazyConnect: false, maxRetriesPerRequest: 1 });
}

test('Redis 限流 · 未超限放行 + X-RateLimit 头（真实 RESP）', async (t) => {
  const server = new MinimalRedisServer();
  await server.listen();
  t.after(() => server.close());
  const redis = connect(server);
  t.after(() => redis.disconnect());

  const rl = createRateLimitRedisMiddleware({ max: 3, windowMs: 60_000, redis, logger: quiet() });
  for (let i = 0; i < 3; i++) {
    const res = mkRes();
    assert.equal(await rl(mkReq('10.0.0.1'), res), true, `第 ${i + 1} 次应放行`);
    assert.equal(res.headers['x-ratelimit-limit'], '3');
  }
  const res4 = mkRes();
  assert.equal(await rl(mkReq('10.0.0.1'), res4), false, '第 4 次应超限');
  assert.equal(res4.statusCode, 429);
  assert.ok(Number(res4.headers['retry-after']) >= 1);
});

test('Redis 限流 · 跨实例共享计数（两中间件同 IP 计数合并）', async (t) => {
  const server = new MinimalRedisServer();
  await server.listen();
  t.after(() => server.close());
  const redis = connect(server);
  t.after(() => redis.disconnect());

  // 模拟两个后端实例共享同一 Redis
  const rlA = createRateLimitRedisMiddleware({ max: 2, windowMs: 60_000, redis, logger: quiet() });
  const rlB = createRateLimitRedisMiddleware({ max: 2, windowMs: 60_000, redis, logger: quiet() });

  assert.equal(await rlA(mkReq('10.0.0.2'), mkRes()), true, '实例A 第1次');
  assert.equal(await rlB(mkReq('10.0.0.2'), mkRes()), true, '实例B 第2次（共享计数）');
  assert.equal(await rlA(mkReq('10.0.0.2'), mkRes()), false, '实例A 第3次超限（计数来自 B 的 +1）');
  // 不同 IP 独立计数
  assert.equal(await rlB(mkReq('10.0.0.3'), mkRes()), true, '其他 IP 不受影响');
});

test('Redis 限流 · 窗口过期后重置（EXPIRE 锚定）', async (t) => {
  const server = new MinimalRedisServer();
  await server.listen();
  t.after(() => server.close());
  const redis = connect(server);
  t.after(() => redis.disconnect());

  // windowSec 向上取整到秒：窗口至少 1s，故用 1000ms 并等 1.1s 验证真实 EXPIRE
  const rl = createRateLimitRedisMiddleware({ max: 1, windowMs: 1000, redis, logger: quiet() });
  assert.equal(await rl(mkReq('10.0.0.9'), mkRes()), true);
  assert.equal(await rl(mkReq('10.0.0.9'), mkRes()), false);
  await new Promise((r) => setTimeout(r, 1150)); // 等窗口过期
  assert.equal(await rl(mkReq('10.0.0.9'), mkRes()), true, '窗口过期后应重置放行');
});

test('Redis 限流 · Redis 不可用时回退内存限流', async () => {
  // 注入一个 incr 抛错的假 redis → 应调用回退中间件而非放行
  const memory = createRateLimitMiddleware({ max: 1, windowMs: 60_000, logger: quiet() });
  const rl = createRateLimitRedisMiddleware({
    max: 10,
    windowMs: 60_000,
    redis: { incr() { throw new Error('connection refused'); }, expire() { throw new Error('down'); } },
    logger: quiet(),
    fallback: memory,
  });
  assert.equal(await rl(mkReq('10.0.0.4'), mkRes()), true, '回退内存第1次放行');
  assert.equal(await rl(mkReq('10.0.0.4'), mkRes()), false, '回退内存第2次超限（max=1）');
});