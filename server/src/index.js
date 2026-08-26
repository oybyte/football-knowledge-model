// ============================================================================
// 服务启动入口 —— 装配持久化存储 + 规则服务 + 预测/审计存储
// createRuleService 注入 SqliteRuleStore：规则全生命周期落库（重启不丢）。
// 用法：const { createService } = require('./src'); const svc = createService();
// ============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createDb } = require('./db');
const { createRuleService } = require('./rules');
const { createHttpServer } = require('./http');
const { createCacheLayer } = require('./cache');
const { createAnalysisQueue } = require('./queue/analysisQueue');
const { RedisLockManager } = require('./lock/redisLockManager');
const { defaultLogger } = require('./lib/logger');

/** 默认 SQLite 文件路径（可用环境变量 OE_DB_PATH 覆盖） */
const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'odds-edge.db');

/** 默认 HTTP 端口（可用环境变量 OE_PORT 覆盖） */
const DEFAULT_HTTP_PORT = 3000;

/**
 * 创建共享 Redis 客户端。
 * 注入实例（redis）优先；否则按 OE_REDIS_URL 惰性连接 ioredis；都不存在则返回 undefined。
 * 连接失败记日志并返回 undefined（上层回退内存实现），不抛致命错误。
 * @param {{ redisUrl?: string, redis?: object, logger?: object }} [opts]
 * @returns {Promise<{ client: object, type: string } | { client: null, type: 'memory' }>}
 */
async function connectRedis({ redisUrl, redis, logger = defaultLogger } = {}) {
  if (redis) {
    logger.info('infra_redis_using_instance');
    return { client: redis, type: 'redis' };
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
      logger.info('infra_redis_connected', { url: redisUrl.replace(/\/\/.*@/, '//***@') });
      return { client, type: 'redis' };
    } catch (e) {
      logger.warn('infra_redis_unavailable_fallback_memory', { error: e.message });
    }
  }
  logger.info('infra_redis_memory');
  return { client: null, type: 'memory' };
}

/**
 * 创建服务上下文。
 * @param {Object} [opts]
 * @param {string} [opts.dbPath] SQLite 文件路径；默认 server/data/odds-edge.db
 * @param {boolean} [opts.seed] 是否迁移原型规则（默认 true；幂等，重启安全）
 * @param {boolean|number|{port:number}} [opts.http] 是否启动 HTTP 层（默认 false）
 * @param {string} [opts.redisUrl] Redis 连接串（设置后启用 Redis 缓存/队列/锁；失败回退内存）
 * @param {object} [opts.redis] 注入的 ioredis 实例（测试用，优先于 redisUrl）
 * @param {import('./lib/logger').Logger} [opts.logger]
 * @returns {Promise<{
 *   db: import('node:sqlite').DatabaseSync,
 *   ruleStore: import('./db/ruleStore').SqliteRuleStore,
 *   predictionStore: import('./db/predictionStore').SqlitePredictionStore,
 *   auditStore: import('./db/auditStore').SqliteAuditStore,
 *   rules: { store, lockManager, stateMachine, seed, getActiveRules, getRuleVersions },
 *   cache?: import('./cache').RuleCache,
 *   server?: import('node:http').Server,
 *   port?: number,
 *   getStatus: () => Object,
 *   close: () => void,
 * }}
 */
async function createService({ dbPath = process.env.OE_DB_PATH || DEFAULT_DB_PATH, seed: doSeed = true, http = false, logger = defaultLogger, redisUrl, redis } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const persistence = createDb({ path: dbPath, logger });

  // Redis 基础设施（缓存 / 队列 / 锁），可用则接真实 Redis，否则回退内存
  const { client: redisClient, type: backendType } = await connectRedis({ redisUrl, redis, logger });
  const cacheLayer = await createCacheLayer(redisClient ? { redis: redisClient, logger } : { logger });
  const analysisQueue = await createAnalysisQueue(redisClient ? { redis: redisClient, logger } : { logger });
  const lockManager = redisClient ? new RedisLockManager(redisClient, { logger }) : undefined;

  const rules = createRuleService({ store: persistence.ruleStore, lockManager });
  if (doSeed) rules.seed();

  const svc = {
    ...persistence,
    rules,
    cache: cacheLayer.cache,
    ruleCache: cacheLayer.rules,
    featureCache: cacheLayer.features,
    analysisQueue,
    backendType,
    getStatus() {
      return {
        dbPath,
        infra: {
          cache: cacheLayer.cache.constructor.name,
          queue: analysisQueue.constructor.name,
          lock: lockManager ? lockManager.constructor.name : 'MemoryLockManager',
          backend: backendType,
        },
        ruleVersions: persistence.ruleStore.size(),
        activeRules: persistence.ruleStore.getActive().length,
        predictions: persistence.predictionStore.list().length,
        auditEntries: persistence.auditStore.size(),
        httpPort: svc.port || null,
      };
    },
    close() {
      if (lockManager && typeof lockManager.clear === 'function') lockManager.clear();
      persistence.close();
      if (redisClient && typeof redisClient.quit === 'function') redisClient.quit();
    },
  };

  if (http) {
    // 显式 port（含 0 = 随机端口）优先；否则 OE_PORT / 默认 3000
    const requested = resolveHttpPort(http, process.env);
    const apiKey = (typeof http === 'object' && http.apiKey) || process.env.OE_API_KEY;
    const server = createHttpServer(svc, { logger, apiKey });
    server.listen(requested, () => {
      svc.port = server.address().port; // port 0 → 实际分配端口
    });
    svc.server = server;
    svc.port = requested;
    const origClose = svc.close;
    svc.close = () => {
      server.close();
      origClose();
    };
  }

  return svc;
}

/** 解析 HTTP 监听端口（纯函数，便于测试，不触碰真实绑定）。 */
function resolveHttpPort(http, env) {
  if (typeof http === 'number') return http;
  if (http && http.port != null) return http.port;
  return Number((env && env.OE_PORT) || '') || DEFAULT_HTTP_PORT;
}

module.exports = { createService, connectRedis, resolveHttpPort, DEFAULT_DB_PATH, DEFAULT_HTTP_PORT };
