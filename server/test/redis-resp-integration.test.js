// ============================================================================
// 真实 Redis 协议端到端验收 —— 用 MinimalRedisServer（真实 TCP + RESP）替身
// 跑通 createService({redisUrl}) 的完整接线：backend=redis、缓存读/写/
// 清空、Redis 排他锁获取/释放、Redis 队列入/出、以及「重启后缓存 KEY 仍在」
// （验收标准：重启缓存不丢）。
// 不依赖 Redis 守护进程；纯 Node。数据在服务器进程内存.
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MinimalRedisServer } = require('./helpers/resp-server');
const { createService } = require('../src');
const Redis = require('ioredis');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-edge-resp-'));
  return path.join(dir, 'svc.db');
}

test('端到端 · OE_REDIS_URL 走真实 RESP 协议建立 Redis backend', async (t) => {
  const server = new MinimalRedisServer();
  const port = await server.listen();
  t.after(() => server.close());

  const svc = await createService({ dbPath: tmpDb(), redisUrl: `redis://127.0.0.1:${port}` });
  const st = svc.getStatus();
  assert.equal(st.infra.backend, 'redis', 'backend 应为 redis');
  assert.match(st.infra.cache, /^RedisCacheAdapter$/);
  assert.match(st.infra.queue, /^RedisAnalysisQueue$/);
  assert.match(st.infra.lock, /^RedisLockManager$/);
  assert.ok(svc.cache, 'cache 已装配');
  svc.close();
});

test('端到端 · 缓存经 RESP 写/读/清空', async (t) => {
  const server = new MinimalRedisServer();
  const port = await server.listen();
  t.after(() => server.close());

  const svc = await createService({ dbPath: tmpDb(), redisUrl: `redis://127.0.0.1:${port}` });
  t.after(() => svc.close());

  await svc.cache.set('k1', { a: 1 }, 60_000);
  const got = await svc.cache.get('k1');
  assert.deepEqual(got, { a: 1 });
  await svc.cache.del('k1');
  assert.equal(await svc.cache.get('k1'), undefined);
});

test('端到端 · 规则级 Redis 锁 acquire → isLocked → release', async (t) => {
  const server = new MinimalRedisServer();
  const port = await server.listen();
  t.after(() => server.close());

  const svc = await createService({ dbPath: tmpDb(), redisUrl: `redis://127.0.0.1:${port}` });
  t.after(() => svc.close());

  const release = await svc.rules.lockManager.acquire('rule-001', 'test-holder');
  assert.ok(release, 'acquire 应成功');
  assert.equal(await svc.rules.lockManager.isLocked('rule-001'), true);

  // 第二个 holder 相同 rule 应拿不到锁
  const other = await svc.rules.lockManager.acquire('rule-001', 'other');
  assert.equal(other, null, '已被持有，acquire 应失败');

  release();
  assert.equal(await svc.rules.lockManager.isLocked('rule-001'), false);
});

test('端到端 · 分析队列入/出', async (t) => {
  const server = new MinimalRedisServer();
  const port = await server.listen();
  t.after(() => server.close());

  const svc = await createService({ dbPath: tmpDb(), redisUrl: `redis://127.0.0.1:${port}` });
  t.after(() => svc.close());

  await svc.analysisQueue.enqueue({ taskId: 't1', matchId: '001', type: 'full' });
  await svc.analysisQueue.enqueue({ taskId: 't2', matchId: '002', type: 'features_only' });
  assert.equal(await svc.analysisQueue.pending(), 2);
  const first = await svc.analysisQueue.dequeue();
  assert.equal(first.taskId, 't1');
  assert.equal(await svc.analysisQueue.pending(), 1);
});

test('端到端 · 重启后缓存不丢（同一 RESP 服务器，两次独立 createService）', async (t) => {
  const server = new MinimalRedisServer();
  const port = await server.listen();
  t.after(() => server.close());

  // 「首次运行」：写缓存
  const db = tmpDb();
  const svcA = await createService({ dbPath: db, redisUrl: `redis://127.0.0.1:${port}` });
  await svcA.cache.set('persist-key', { v: 42 }, 120_000);
  await svcA.rules.lockManager.acquire('persist-lock', 'h1');
  await svcA.analysisQueue.enqueue({ taskId: 'pt', matchId: '9', type: 'full' });
  svcA.close();

  // 「重启」：新 service 连同一服务器，缓存 KEY 仍在（验收：重启缓存不丢）
  const svcB = await createService({ dbPath: db, redisUrl: `redis://127.0.0.1:${port}` });
  try {
    assert.equal(svcB.getStatus().infra.backend, 'redis');
    assert.deepEqual(await svcB.cache.get('persist-key'), { v: 42 }, '重启后缓存命中 → KEY 仍在 Redis');
    assert.equal(await svcB.rules.lockManager.isLocked('persist-lock'), true, '重启后锁仍持');
    assert.equal(await svcB.analysisQueue.pending(), 1, '重启后队列任务仍在');
  } finally {
    svcB.close();
  }
});