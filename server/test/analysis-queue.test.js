// ============================================================================
// 分析任务队列测试 — MemoryAnalysisQueue
// ============================================================================
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { MemoryAnalysisQueue, createAnalysisQueue } = require('../src/queue/analysis_queue');

describe('MemoryAnalysisQueue', () => {
  let q;

  before(() => { q = new MemoryAnalysisQueue(); });

  it('enqueue/dequeue 基本操作', async () => {
    await q.enqueue({ taskId: 't1', matchId: 'm1', type: 'full' });
    await q.enqueue({ taskId: 't2', matchId: 'm2', type: 'features_only' });
    assert.strictEqual(await q.pending(), 2);
    const t1 = await q.dequeue();
    assert.strictEqual(t1.taskId, 't1');
    assert.strictEqual(await q.pending(), 1);
  });

  it('空队列 dequeue 返回 undefined', async () => {
    const empty = new MemoryAnalysisQueue();
    assert.strictEqual(await empty.dequeue(), undefined);
  });

  it('未指定 taskId 时自动生成', async () => {
    const fresh = new MemoryAnalysisQueue();
    await fresh.enqueue({ matchId: 'm3', type: 'full' });
    const t = await fresh.dequeue();
    assert.ok(t.taskId.startsWith('mem_'));
  });

  it('start/stop 消费循环', async () => {
    const results = [];
    const q2 = new MemoryAnalysisQueue({ concurrency: 2 });
    await q2.enqueue({ taskId: 'c1', matchId: 'm1', type: 'full' });
    await q2.enqueue({ taskId: 'c2', matchId: 'm2', type: 'full' });

    await new Promise((resolve) => {
      q2.start(async (task) => {
        results.push(task.taskId);
        if (results.length >= 2) {
          q2.stop();
          setTimeout(resolve, 50);
        }
      });
    });

    assert.strictEqual(results.length, 2);
    assert.ok(results.includes('c1'));
    assert.ok(results.includes('c2'));
  });
});

describe('createAnalysisQueue', () => {
  it('无参数时返回 MemoryAnalysisQueue', async () => {
    const q = await createAnalysisQueue();
    assert.ok(q instanceof MemoryAnalysisQueue);
  });

  it('无效 redisUrl 时降级到内存', async () => {
    const q = await createAnalysisQueue({ redisUrl: 'redis://127.0.0.1:63999' });
    assert.ok(q instanceof MemoryAnalysisQueue);
  });
});