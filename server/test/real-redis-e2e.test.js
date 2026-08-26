// ============================================================================
// 真实 Redis 服务端端到端验收（可选运行）
// 与 redis-resp-integration.test.js（RESP 替身）互补：本文件连「真实 Redis
// 服务端」（本机 redis-server.exe 或 docker compose 的 redis 服务），验证
// OE_REDIS_URL 接线在真实服务端上生效：backend=redis、缓存写/读/删、Redis
// 排他锁 acquire→isLocked→release（含并发被拒）、分析队列入/出、以及两次
// 独立 createService「重启后缓存 KEY 仍在 / 锁仍持 / 队列任务仍在」。
//
// 运行前提：本机已起真实 Redis（默认 redis://127.0.0.1:16379，可用
// OE_REDIS_URL 覆盖）。未配置真实 Redis 时本文件自动跳过（不失败）。
// 启动示例（Windows，Redis-for-Windows）：
//   .tools\redis\extracted\redis-server.exe --port 16379 --save "" --appendonly no
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const { createService } = require('../src');

const REDIS_URL = process.env.OE_REDIS_URL || 'redis://127.0.0.1:16379';

/** 探测真实 Redis 是否可达；不可达则跳过（不失败）。 */
function redisReachable(url) {
  return new Promise((resolve) => {
    const m = /redis:\/\/[^:]+:(\d+)/.exec(url);
    const port = m ? Number(m[1]) : 6379;
    const sock = net.connect({ host: '127.0.0.1', port }, () => {
      sock.write('*1\r\n$4\r\nPING\r\n');
    });
    sock.setTimeout(1500);
    sock.on('data', (d) => { sock.destroy(); resolve(d.toString().includes('PONG')); });
    sock.on('error', () => { sock.destroy(); resolve(false); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-edge-realredis-'));
  return path.join(dir, 'svc.db');
}

/** 每个用例独立前缀，隔离共享真实 Redis 上的键（缓存/锁/队列）。 */
function uniquePrefix() {
  return `oe:test:${Date.now()}:${Math.random().toString(36).slice(2, 8)}:`;
}

test('真实 Redis · OE_REDIS_URL 建立 Redis backend（不可达则跳过）', async (t) => {
  if (!(await redisReachable(REDIS_URL))) {
    t.skip(`真实 Redis 不可达（${REDIS_URL}），跳过；启动方式见文件头注释`);
    return;
  }
  const svc = await createService({ dbPath: tmpDb(), redisUrl: REDIS_URL, queuePrefix: uniquePrefix() });
  t.after(() => svc.close());
  const st = svc.getStatus();
  assert.equal(st.infra.backend, 'redis');
  assert.match(st.infra.cache, /^RedisCacheAdapter$/);
  assert.match(st.infra.queue, /^RedisAnalysisQueue$/);
  assert.match(st.infra.lock, /^RedisLockManager$/);
});

test('真实 Redis · 缓存写/读/删', async (t) => {
  if (!(await redisReachable(REDIS_URL))) { t.skip('真实 Redis 不可达'); return; }
  const p = uniquePrefix();
  const svc = await createService({ dbPath: tmpDb(), redisUrl: REDIS_URL, queuePrefix: p });
  t.after(() => svc.close());
  await svc.cache.set(`${p}k1`, { a: 1 }, 60_000);
  assert.deepEqual(await svc.cache.get(`${p}k1`), { a: 1 });
  await svc.cache.del(`${p}k1`);
  assert.equal(await svc.cache.get(`${p}k1`), undefined);
});

test('真实 Redis · 规则级锁 acquire → isLocked → release（含并发被拒）', async (t) => {
  if (!(await redisReachable(REDIS_URL))) { t.skip('真实 Redis 不可达'); return; }
  const p = uniquePrefix();
  const svc = await createService({ dbPath: tmpDb(), redisUrl: REDIS_URL, queuePrefix: p });
  t.after(() => svc.close());
  const release = await svc.rules.lockManager.acquire(`${p}lock`, 'holder-A');
  assert.ok(release);
  assert.equal(await svc.rules.lockManager.isLocked(`${p}lock`), true);
  const other = await svc.rules.lockManager.acquire(`${p}lock`, 'holder-B');
  assert.equal(other, null, '已被持有，acquire 应失败');
  release();
  assert.equal(await svc.rules.lockManager.isLocked(`${p}lock`), false);
});

test('真实 Redis · 分析队列入/出', async (t) => {
  if (!(await redisReachable(REDIS_URL))) { t.skip('真实 Redis 不可达'); return; }
  const p = uniquePrefix();
  const svc = await createService({ dbPath: tmpDb(), redisUrl: REDIS_URL, queuePrefix: p });
  t.after(() => svc.close());
  await svc.analysisQueue.enqueue({ taskId: 'real-t1', matchId: '001', type: 'full' });
  await svc.analysisQueue.enqueue({ taskId: 'real-t2', matchId: '002', type: 'features_only' });
  assert.equal(await svc.analysisQueue.pending(), 2);
  const first = await svc.analysisQueue.dequeue();
  assert.equal(first.taskId, 'real-t1');
  assert.equal(await svc.analysisQueue.pending(), 1);
});

test('真实 Redis · 重启后缓存不丢（同一服务端，两次独立 createService）', async (t) => {
  if (!(await redisReachable(REDIS_URL))) { t.skip('真实 Redis 不可达'); return; }
  const db = tmpDb();
  const p = uniquePrefix();
  const svcA = await createService({ dbPath: db, redisUrl: REDIS_URL, queuePrefix: p });
  await svcA.cache.set(`${p}persist`, { v: 42 }, 120_000);
  await svcA.rules.lockManager.acquire(`${p}plock`, 'h1');
  await svcA.analysisQueue.enqueue({ taskId: 'real-pt', matchId: '9', type: 'full' });
  svcA.close();

  const svcB = await createService({ dbPath: db, redisUrl: REDIS_URL, queuePrefix: p });
  try {
    assert.equal(svcB.getStatus().infra.backend, 'redis');
    assert.deepEqual(await svcB.cache.get(`${p}persist`), { v: 42 }, '重启后缓存命中 → KEY 仍在真实 Redis');
    assert.equal(await svcB.rules.lockManager.isLocked(`${p}plock`), true, '重启后锁仍持');
    assert.equal(await svcB.analysisQueue.pending(), 1, '重启后队列任务仍在');
  } finally {
    svcB.close();
  }
});