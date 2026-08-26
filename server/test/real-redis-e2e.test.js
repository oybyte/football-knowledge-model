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