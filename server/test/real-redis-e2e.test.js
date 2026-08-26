// ============================================================================
// 生产形态 · 真实 Redis 守护进程运行时验收（可跳过式）
// 与 redis-resp-integration.test.js（内存替身）互补：本文件不新建替身，而是
// 直连一台真实 Redis daemon（OE_TEST_REDIS_URL 或默认 127.0.0.1:16379），
// 验证 createService({redisUrl}) 对真实 Redis 的接线信号 backend=redis，以及
// 「重启后缓存不丢」这条部署形态验收标准在真实 Redis 上成立。
//   - 无真实 Redis 可达 → t.skip（CI/无 Redis 机器不失败）。
//   - 低侵入：只写唯一前缀缓存键 + 短 TTL + 写后即删；不做队列 drain / 持锁，
//     避免污染共享开发 Redis。锁/队列的真实 RESP 行为已由 RESP 替身测试覆盖。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const Redis = require('ioredis');
const { createService } = require('../src');

const URL = process.env.OE_TEST_REDIS_URL || 'redis://127.0.0.1:16379';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-edge-realredis-'));
  return path.join(dir, 'svc.db');
}

async function redisReachable() {
  const probe = new Redis(URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  probe.on('error', () => {});
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    try { probe.disconnect(); } catch { /* noop */ }
  }
}

/** 发起一次 HTTP 请求。 */
function httpReq(port, path, extraHeaders) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'GET', path,
      headers: extraHeaders || {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('生产形态 · 真实 Redis 上 backend=redis 且重启后缓存不丢', async (t) => {
  if (!await redisReachable()) {
    t.skip(`未检测到真实 Redis（${URL}），跳过真实 Redis 运行时验收`);
    return;
  }

  // 唯一缓存键，避免与共享 Redis 上其它数据冲突；短 TTL 兜底自动清理。
  const NS = `oe-e2e-${Date.now()}`;

  // 「首次运行」：直连真实 Redis，写缓存
  const db = tmpDb();
  const svcA = await createService({ dbPath: db, redisUrl: URL });
  const stA = svcA.getStatus();
  assert.equal(stA.infra.backend, 'redis', '真实 Redis 下 backend 应为 redis');
  assert.match(stA.infra.cache, /^RedisCacheAdapter$/);
  assert.match(stA.infra.queue, /^RedisAnalysisQueue$/);
  assert.match(stA.infra.lock, /^RedisLockManager$/);

  await svcA.cache.set(`${NS}:persist`, { v: 42 }, 120_000);
  svcA.close();

  // 「重启」：新 service 连同一真实 Redis，缓存 KEY 仍在（验收：重启缓存不丢）
  const svcB = await createService({ dbPath: db, redisUrl: URL });
  t.after(() => { try { svcB.close(); } catch { /* noop */ } });
  try {
    assert.equal(svcB.getStatus().infra.backend, 'redis', '重启后仍为真实 Redis backend');
    assert.deepEqual(await svcB.cache.get(`${NS}:persist`), { v: 42 }, '重启后真实 Redis 缓存命中 → KEY 仍在');
  } finally {
    // 清理唯一测试键，避免残留
    try { await svcB.cache.del(`${NS}:persist`); } catch { /* noop */ }
  }
});

test('生产形态 · 真实 Redis 上 HTTP 鉴权 + Redis 共享限流接线在真实守护进程生效', async (t) => {
  if (!await redisReachable()) {
    t.skip(`未检测到真实 Redis（${URL}），跳过真实 Redis 运行时验收`);
    return;
  }

  const savedStore = process.env.OE_RATE_LIMIT_STORE;
  const savedMax = process.env.OE_RATE_LIMIT_MAX;
  // max 设高，避免本地共享 Redis 上 rl:127.0.0.1 既有计数干扰鉴权流程（本用例不断言 429；
  // 429/跨实例合并机制已由 deploy-smoke(mock) 与 rate-limit-redis.test.js 覆盖）。
  process.env.OE_RATE_LIMIT_STORE = 'redis';
  process.env.OE_RATE_LIMIT_MAX = '1000';
  t.after(() => {
    if (savedStore === undefined) delete process.env.OE_RATE_LIMIT_STORE;
    else process.env.OE_RATE_LIMIT_STORE = savedStore;
    if (savedMax === undefined) delete process.env.OE_RATE_LIMIT_MAX;
    else process.env.OE_RATE_LIMIT_MAX = savedMax;
  });

  const svc = await createService({
    dbPath: tmpDb(),
    http: { port: 0, apiKey: 'prod-key' },
    redisUrl: URL,
  });
  const server = svc.server;
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const { port } = server.address();
  t.after(() => { try { server.close(); } catch { /* noop */ } svc.close(); });

  const st = svc.getStatus();
  assert.equal(st.infra.backend, 'redis', '真实 Redis 下后端接线为 redis');
  assert.equal(st.infra.rateLimit, 'redis', 'OE_RATE_LIMIT_STORE=redis 且 Redis 已接线 → 共享限流走真实 Redis');

  // 生产形态 HTTP 运行时：health 免鉴权 → 缺 Key 401 → 带 Key 200
  const h = await httpReq(port, '/api/health');
  assert.equal(h.status, 200);
  const noKey = await httpReq(port, '/api/matches');
  assert.equal(noKey.status, 401);
  const ok = await httpReq(port, '/api/matches', { 'X-Api-Key': 'prod-key' });
  assert.equal(ok.status, 200);
});