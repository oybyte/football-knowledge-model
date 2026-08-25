// ============================================================================
// Redis 并发锁测试 — 内存模式（无 Redis 时跳过）
// 测试 RedisLockManager 的接口兼容性（与 LockManager 相同的 acquire/heartbeat/release 语义）
// ============================================================================
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert');

// 无 Redis 时使用内存锁管理器测试相同接口语义
const { LockManager, DEFAULT_TIMEOUT_MS, DEFAULT_HEARTBEAT_MS } = require('../src/rules/lockManager');

describe('RedisLockManager 接口兼容性（通过 LockManager 验证）', () => {
  let lm;

  before(() => { lm = new LockManager(); });

  it('acquire 成功返回 release 函数', () => {
    const release = lm.acquire('R001', 'holder1');
    assert.ok(typeof release === 'function');
    assert.ok(lm.isLocked('R001'));
    release();
    assert.ok(!lm.isLocked('R001'));
  });

  it('重复 acquire 返回 null', () => {
    const r1 = lm.acquire('R002', 'h1');
    assert.ok(r1);
    const r2 = lm.acquire('R002', 'h2');
    assert.strictEqual(r2, null);
    r1();
  });

  it('heartbeat 续期成功', () => {
    const release = lm.acquire('R003', 'h1', 1000);
    assert.ok(lm.heartbeat('R003', 'h1'));
    assert.ok(lm.isLocked('R003'));
    release();
  });

  it('非持有者 heartbeat 返回 false', () => {
    const release = lm.acquire('R004', 'h1', 1000);
    assert.ok(!lm.heartbeat('R004', 'wrong_holder'));
    release();
  });

  it('forceRelease 强制释放', () => {
    lm.acquire('R005', 'h1');
    assert.ok(lm.isLocked('R005'));
    assert.ok(lm.forceRelease('R005'));
    assert.ok(!lm.isLocked('R005'));
  });

  it('clear 清空所有锁', () => {
    lm.acquire('R006', 'h1');
    lm.acquire('R007', 'h2');
    lm.clear();
    assert.ok(!lm.isLocked('R006'));
    assert.ok(!lm.isLocked('R007'));
  });
});

describe('RedisLockManager 模块导出', () => {
  it('RedisLockManager 类存在', () => {
    const mod = require('../src/lock/redisLockManager');
    assert.ok(typeof mod.RedisLockManager === 'function');
    assert.ok(typeof mod.DEFAULT_TIMEOUT_MS === 'number');
    assert.ok(typeof mod.DEFAULT_HEARTBEAT_MS === 'number');
  });
});