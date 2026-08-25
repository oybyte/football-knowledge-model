// ============================================================================
// 分析任务队列 — 异步分析任务调度
// 对齐实施计划 0.3：Redis 作为分析任务队列。
// 支持内存队列（默认）和 Redis 队列（配置 REDIS_URL 后自动切换）。
// ============================================================================
'use strict';

const { defaultLogger } = require('../lib/logger');

const DEFAULT_POLL_MS = 1000;
const QUEUE_PREFIX = 'oe:queue:analysis:';

/**
 * 分析任务
 * @typedef {object} AnalysisTask
 * @property {string} taskId
 * @property {string} matchId
 * @property {string} type  'full' | 'features_only' | 'prediction_only'
 * @property {number} createdAt
 * @property {object} [context]
 */

/**
 * 分析任务队列基类
 */
class AnalysisQueue {
  /**
   * @param {{ logger?: object, concurrency?: number }} [opts]
   */
  constructor({ logger = defaultLogger, concurrency = 1 } = {}) {
    this.logger = logger;
    this.concurrency = concurrency;
    this._active = 0;
    this._stopped = false;
  }

  /** @param {AnalysisTask} task @returns {Promise<void>} */
  async enqueue(task) { throw new Error('not_implemented'); }

  /** @returns {Promise<AnalysisTask | undefined>} */
  async dequeue() { throw new Error('not_implemented'); }

  /** @returns {Promise<number>} */
  async pending() { throw new Error('not_implemented'); }

  /** 开始消费队列 */
  start(handler) {
    this._stopped = false;
    this._consumer = async () => {
      while (!this._stopped) {
        if (this._active >= this.concurrency) {
          await this._sleep(200);
          continue;
        }
        const task = await this.dequeue();
        if (!task) {
          await this._sleep(DEFAULT_POLL_MS);
          continue;
        }
        this._active++;
        this._runTask(task, handler).finally(() => { this._active--; });
      }
    };
    this._consumer().catch(e => {
      this.logger.error('queue_consumer_fatal', { error: e.message });
    });
  }

  /** 停止消费 */
  stop() {
    this._stopped = true;
  }

  async _runTask(task, handler) {
    const start = Date.now();
    try {
      this.logger.info('queue_task_start', { taskId: task.taskId, matchId: task.matchId, type: task.type });
      const result = await handler(task);
      this.logger.info('queue_task_complete', { taskId: task.taskId, matchId: task.matchId, durationMs: Date.now() - start });
      return result;
    } catch (e) {
      this.logger.error('queue_task_error', { taskId: task.taskId, matchId: task.matchId, error: e.message, durationMs: Date.now() - start });
    }
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

/**
 * 内存分析任务队列（默认，零依赖）
 */
class MemoryAnalysisQueue extends AnalysisQueue {
  constructor(opts = {}) {
    super(opts);
    /** @type {AnalysisTask[]} */
    this._tasks = [];
  }

  async enqueue(task) {
    if (!task.taskId) task.taskId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (!task.createdAt) task.createdAt = Date.now();
    this._tasks.push(task);
  }

  async dequeue() {
    return this._tasks.shift();
  }

  async pending() {
    return this._tasks.length;
  }
}

/**
 * Redis 分析任务队列
 */
class RedisAnalysisQueue extends AnalysisQueue {
  /**
   * @param {object} redis ioredis 实例
   * @param {{ logger?: object, concurrency?: number, prefix?: string }} [opts]
   */
  constructor(redis, { logger = defaultLogger, concurrency = 1, prefix = QUEUE_PREFIX } = {}) {
    super({ logger, concurrency });
    this.redis = redis;
    this.prefix = prefix;
  }

  _key(q) { return this.prefix + q; }

  async enqueue(task) {
    if (!task.taskId) task.taskId = `redis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (!task.createdAt) task.createdAt = Date.now();
    await this.redis.rpush(this._key('pending'), JSON.stringify(task));
  }

  async dequeue() {
    const raw = await this.redis.lpop(this._key('pending'));
    if (!raw) return undefined;
    return JSON.parse(raw);
  }

  async pending() {
    return this.redis.llen(this._key('pending'));
  }
}

/**
 * 创建分析任务队列（自动检测 Redis）
 * @param {{ redisUrl?: string, redis?: object, logger?: object, concurrency?: number }} [opts]
 * @returns {Promise<AnalysisQueue>}
 */
async function createAnalysisQueue(opts = {}) {
  const { redisUrl, redis, logger = defaultLogger, concurrency } = opts;

  if (redis) {
    logger.info('queue_using_redis');
    return new RedisAnalysisQueue(redis, { logger, concurrency });
  }

  if (redisUrl) {
    try {
      const { default: IORedis } = require('ioredis');
      const client = new IORedis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) { return Math.min(times * 200, 3000); },
        lazyConnect: true,
      });
      await client.connect();
      logger.info('queue_redis_connected');
      return new RedisAnalysisQueue(client, { logger, concurrency });
    } catch (e) {
      logger.warn('queue_redis_unavailable_fallback_memory', { error: e.message });
    }
  }

  logger.info('queue_using_memory_adapter');
  return new MemoryAnalysisQueue({ logger, concurrency });
}

module.exports = {
  AnalysisQueue,
  MemoryAnalysisQueue,
  RedisAnalysisQueue,
  createAnalysisQueue,
};