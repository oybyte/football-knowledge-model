// ============================================================================
// Redis 接线测试 —— createService({redis}) 基础设施装配
// 覆盖：注入 redis 实例时缓存/队列/锁走 Redis backend；
//      注入明文 redisUrl 但连接失败时优雅降级内存；getStatus 上报 infra。
// 不依赖真实 Redis 守护进程（用假实例模拟 ioredis 命令接口）。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createService, connectRedis } = require('../src');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-edge-redis-'));
  return path.join(dir, 'svc.db');
}

/**
 * 最小 ioredis 假实例：覆盖 RedisRedisCacheAdapter / RedisAnalysisQueue /
 * RedisLockManager 用到的命令。各命令均为可观测的内存实现。
 */
function fakeRedis() {
  const store = new Map();           // key -> string
  const lists = new Map();           // queue key -> string[]
  const counters = { set: 0, get: 0, del: 0, setex: 0, rpush: 0, lpop: 0, eval: 0, quit: 0 };
  const scanKeys = [];
  const redis = {
    _store: store,
    _counters: counters,
    async set(key, val, ...rest) { counters.set++; store.set(key, val); return 'OK'; },
    async get(key) { counters.get++; return store.has(key) ? store.get(key) : null; },
    async del(...keys) { counters.del++; let n = 0; for (const k of keys) { if (store.delete(k) || lists.delete(k)) n++; } return n; },
    async setex(key, ttl, val) { counters.setex++; store.set(key, val); return 'OK'; },
    async rpush(key, val) { counters.rpush++; if (!lists.has(key)) lists.set(key, []); lists.get(key).push(val); return lists.get(key).length; },
    async lpop(key) { counters.lpop++; const q = lists.get(key) || []; const v = q.shift(); if (q.length === 0) lists.delete(key); return v === undefined ? null : v; },
    async llen(key) { return (lists.get(key) || []).length; },
    async eval(script, n, ...args) { counters.eval++; return script.includes('pexpire') || script.includes('del') ? 1 : 0; },
    scanStream() { const q = [cloneKeys()]; let done = false; return { [Symbol.asyncIterator]() { return { next() { if (done) return Promise.resolve({ done: true }); done = true; return Promise.resolve({ value: q.shift() || [], done: false }); } }; } }; },
    async exists(key) { return store.has(key) ? 1 : 0; },
    async quit() { counters.quit++; return 'OK'; },
  };
  function cloneKeys() { return Array.from({ length: scanKeys.length ? 1 : 0 }, () => ['x']); }
  return redis;
}

test('connectRedis · 无配置返回 memory', async () => {
  const { client, type } = await connectRedis({});
  assert.equal(client, null);
  assert.equal(type, 'memory');
});

test('connectRedis · 注入实例直接复用（type=redis）', async () => {
  const r = fakeRedis();
  const { client, type } = await connectRedis({ redis: r });
  assert.equal(client, r);
  assert.equal(type, 'redis');
});

test('createService({redis}) · 注入 fake redis → 缓存/队列/锁走 Redis backend', async () => {
  const svc = await createService({ dbPath: tmpDb(), redis: fakeRedis() });
  const st = svc.getStatus();
  assert.equal(st.infra.backend, 'redis');
  assert.match(st.infra.cache, /^RedisCacheAdapter$/);
  assert.match(st.infra.queue, /^RedisAnalysisQueue$/);
  assert.match(st.infra.lock, /^RedisLockManager$/);
  assert.ok(svc.cache, 'cache 已装配');
  assert.ok(svc.ruleCache, 'ruleCache 已装配');
  assert.ok(svc.featureCache, 'featureCache 已装配');
  assert.ok(svc.analysisQueue, 'analysisQueue 已装配');
  svc.close();
});

test('createService(默认) · 无 Redis → 内存 backend，getStatus 上报 memory', async () => {
  const svc = await createService({ dbPath: tmpDb() });
  const st = svc.getStatus();
  assert.equal(st.infra.backend, 'memory');
  assert.match(st.infra.cache, /^MemoryCacheAdapter$/);
  assert.match(st.infra.queue, /^MemoryAnalysisQueue$/);
  assert.match(st.infra.lock, /^MemoryLockManager$/);
  svc.close();
});

test('createService({redisUrl:' + "'')" + '}) · 连接失败优雅降级内存，不抛异常', async () => {
  // 指向必不存在的端口，ioredis 连接失败 → connectRedis 回退 memory
  const svc = await createService({ dbPath: tmpDb(), redisUrl: 'redis://127.0.0.1:63999' });
  const st = svc.getStatus();
  assert.equal(st.infra.backend, 'memory');
  assert.match(st.infra.cache, /^MemoryCacheAdapter$/);
  svc.close();
});