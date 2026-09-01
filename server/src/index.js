// ============================================================================
// 服务启动入口 —— 装配持久化存储 + 规则服务 + 预测/审计存储
// createRuleService 注入 SqliteRuleStore：规则全生命周期落库（重启不丢）。
// 用法：const { createService } = require('./src'); const svc = createService();
// ============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createDb } = require('./db');
const { reconcileManualOddsToDb } = require('./db/g12/manualReconcile');
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
    let client;
    try {
      const { default: IORedis } = require('ioredis');
      client = new IORedis(redisUrl, {
        maxRetriesPerRequest: 3,
        // 快速失败：RetryStrategy 在有限次重试后返回 null → connect() 拒绝 → 上层降级内存。
        // 绝不能无限重试，否则 await connect() 永不 resolve，createService 挂起/进程不退出。
        retryStrategy(times) { return times > 3 ? null : Math.min(times * 200, 3000); },
        lazyConnect: true,
      });
      // 主动挂 error 监听：连接/重连失败时避免 ioredis 抛「Unhandled error event」
      client.on('error', () => {});
      await client.connect();
      logger.info('infra_redis_connected', { url: redisUrl.replace(/\/\/.*@/, '//***@') });
      return { client, type: 'redis' };
    } catch (e) {
      // 失败必须断开：disconnect() 停止 retryStrategy 重连定时器，否则句柄不释放、
      // 事件循环不退出（回归/部署进程挂起），也无残留 error 冒泡。
      if (client) { try { client.disconnect(); } catch { /* noop */ } }
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
async function createService({ dbPath = process.env.OE_DB_PATH || DEFAULT_DB_PATH, seed: doSeed = true, http = false, logger = defaultLogger, redisUrl, redis, queuePrefix } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const persistence = createDb({ path: dbPath, logger });

  // Redis 基础设施（缓存 / 队列 / 锁），可用则接真实 Redis，否则回退内存
  const { client: redisClient, type: backendType } = await connectRedis({ redisUrl, redis, logger });
  const cacheLayer = await createCacheLayer(redisClient ? { redis: redisClient, logger } : { logger });
  const analysisQueue = await createAnalysisQueue(redisClient ? { redis: redisClient, logger, prefix: queuePrefix } : { logger, prefix: queuePrefix });
  const lockManager = redisClient ? new RedisLockManager(redisClient, { logger }) : undefined;

  const rules = createRuleService({ store: persistence.ruleStore, lockManager });
  if (doSeed) rules.seed();

  // 启动期 reconciled：把磁盘人工盘赔落库为整场版本（派生层，扫盘即写入）。
  // 失败不阻断启动；失败时合并池端点会回退磁盘扫描，功能不丢。
  try {
    const rec = reconcileManualOddsToDb({
      db: persistence.db, qd: persistence.qd, env: process.env,
      actor: { id: 'boot:reconcile', role: 'ingest' },
      year: new Date().getFullYear(), logger,
    });
    logger.info('manual_odds_reconciled_on_boot', rec);
  } catch (e) {
    logger.warn('manual_odds_reconcile_failed', { error: e.message });
  }

  // 限流存储后端（函数体作用域，getStatus 可观测；http 分支内再按环境变量定值）
  let rateLimitStore = 'memory';
  // TLS 终止是否启用（.env: OE_TLS_CERT / OE_TLS_KEY 同设即 HTTPS）
  let tlsOn = false;

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
        scheme: tlsOn ? 'https' : 'http',
        infra: {
          cache: cacheLayer.cache.constructor.name,
          queue: analysisQueue.constructor.name,
          lock: lockManager ? lockManager.constructor.name : 'MemoryLockManager',
          backend: backendType,
          rateLimit: rateLimitStore,
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
      if (redisClient) {
        // 强制断开：disconnect() 立即关 socket（相比异步 quit() 无竞态、不出 QUIT），
        // 否则测试/回归进程残留连接句柄不退出。
        if (typeof redisClient.disconnect === 'function') { try { redisClient.disconnect(); } catch { /* noop */ } }
        else if (typeof redisClient.quit === 'function') redisClient.quit();
      }
    },
  };

  if (http) {
    // 显式 port（含 0 = 随机端口）优先；否则 OE_PORT / 默认 3000
    const requested = resolveHttpPort(http, process.env);
    const apiKey = (typeof http === 'object' && http.apiKey) || process.env.OE_API_KEY;
    // 限流配置（OE_RATE_LIMIT_MAX / OE_RATE_LIMIT_WINDOW_MS；未设置走中间件默认值）
    const rateLimitMax = Number(process.env.OE_RATE_LIMIT_MAX) || undefined;
    const rateLimitWindowMs = Number(process.env.OE_RATE_LIMIT_WINDOW_MS) || undefined;
    // 限流存储：memory（默认，单实例）| redis（多实例共享计数，需 Redis 已接线）
    rateLimitStore = process.env.OE_RATE_LIMIT_STORE === 'redis' && redisClient ? 'redis' : 'memory';
    // TLS 终止：OE_TLS_CERT / OE_TLS_KEY 同设即 HTTPS（缺任一即视为未启用并告警提示）
    const tlsCertificate = (typeof http === 'object' && http.tlsCertificate) || process.env.OE_TLS_CERT;
    const tlsKey = (typeof http === 'object' && http.tlsKey) || process.env.OE_TLS_KEY;
    tlsOn = !!(tlsCertificate && tlsKey);
    if ((tlsCertificate && !tlsKey) || (!tlsCertificate && tlsKey)) {
      logger.warn('tls_misconfigured_ignored', { hasCert: !!tlsCertificate, hasKey: !!tlsKey });
      tlsOn = false;
    }
    const server = createHttpServer(svc, {
      logger, apiKey, rateLimitMax, rateLimitWindowMs, rateLimitStore, redis: redisClient,
      tlsCertificate: tlsOn ? tlsCertificate : undefined,
      tlsKey: tlsOn ? tlsKey : undefined,
    });
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
