// ============================================================================
// 缓存适配器测试 — MemoryCacheAdapter
// ============================================================================
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { MemoryCacheAdapter, RedisCacheAdapter, createCacheAdapter, CacheEntry } = require('../src/cache/adapter');

describe('CacheEntry', () => {
  it('不设 TTL 永不过期', () => {
    const e = new CacheEntry('x');
    assert.strictEqual(e.alive, true);
  });
  it('设 TTL 后过期', () => {
    const e = new CacheEntry('x', -1000);
    assert.strictEqual(e.alive, false);
  });
});

describe('MemoryCacheAdapter', () => {
  let c;

  before(() => { c = new MemoryCacheAdapter({ defaultTtlMs: 500 }); });
  after(() => c.clear());

  it('set/get 基本存取', async () => {
    await c.set('k1', { a: 1 });
    assert.deepStrictEqual(await c.get('k1'), { a: 1 });
  });

  it('不存在的键返回 undefined', async () => {
    assert.strictEqual(await c.get('noexist'), undefined);
  });

  it('del 删除键', async () => {
    await c.set('k2', 'v2');
    await c.del('k2');
    assert.strictEqual(await c.get('k2'), undefined);
  });

  it('TTL 过期后返回 undefined', async () => {
    await c.set('k3', 'v3', 10);
    assert.strictEqual(await c.get('k3'), 'v3');
    // 等待过期
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(await c.get('k3'), undefined);
  });

  it('getOrSet 未命中时调用 factory', async () => {
    let calls = 0;
    const v = await c.getOrSet('gs1', async () => { calls++; return 'factory_val'; });
    assert.strictEqual(v, 'factory_val');
    assert.strictEqual(calls, 1);
  });

  it('getOrSet 命中时返回缓存值', async () => {
    let calls = 0;
    const v1 = await c.getOrSet('gs2', async () => { calls++; return 'first'; });
    const v2 = await c.getOrSet('gs2', async () => { calls++; return 'second'; });
    assert.strictEqual(v1, 'first');
    assert.strictEqual(v2, 'first');
    assert.strictEqual(calls, 1);
  });

  it('size 返回正确数量', async () => {
    await c.clear();
    await c.set('s1', 1);
    await c.set('s2', 2);
    assert.strictEqual(await c.size(), 2);
  });

  it('clear 清空所有', async () => {
    await c.set('c1', 1);
    await c.clear();
    assert.strictEqual(await c.size(), 0);
  });
});

describe('createCacheAdapter', () => {
  it('无参数时返回 MemoryCacheAdapter', async () => {
    const a = await createCacheAdapter();
    assert.ok(a instanceof MemoryCacheAdapter);
    await a.clear();
  });

  it('传入无效 redisUrl 时降级到内存', async () => {
    const a = await createCacheAdapter({ redisUrl: 'redis://localhost:16379' });
    assert.ok(a instanceof MemoryCacheAdapter);
    await a.clear();
  });
});

describe('RuleCache', () => {
  const { RuleCache } = require('../src/cache');
  let rc, mem;

  before(() => { mem = new MemoryCacheAdapter(); rc = new RuleCache(mem); });
  after(() => mem.clear());

  it('get/set 活跃规则', async () => {
    assert.strictEqual(await rc.getActiveRules(), undefined);
    await rc.setActiveRules([{ id: 'R001' }]);
    assert.deepStrictEqual(await rc.getActiveRules(), [{ id: 'R001' }]);
  });

  it('invalidateRule 清除规则缓存', async () => {
    await rc.setActiveRules([{ id: 'R001' }]);
    await rc.invalidateRule('R001');
    assert.strictEqual(await rc.getActiveRules(), undefined);
  });
});

describe('FeatureCache', () => {
  const { FeatureCache } = require('../src/cache');
  let fc, mem;

  before(() => { mem = new MemoryCacheAdapter(); fc = new FeatureCache(mem); });
  after(() => mem.clear());

  it('get/set 特征', async () => {
    await fc.setFeatures('m1', { home_goals: 2 });
    assert.deepStrictEqual(await fc.getFeatures('m1'), { home_goals: 2 });
  });

  it('get/set 分析结果', async () => {
    await fc.setAnalysis('m1', { direction: 'favor_upper' });
    assert.deepStrictEqual(await fc.getAnalysis('m1'), { direction: 'favor_upper' });
  });
});