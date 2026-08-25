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
const { defaultLogger } = require('./lib/logger');

/** 默认 SQLite 文件路径（可用环境变量 OE_DB_PATH 覆盖） */
const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'odds-edge.db');

/** 默认 HTTP 端口（可用环境变量 OE_PORT 覆盖） */
const DEFAULT_HTTP_PORT = 3000;

/**
 * 创建服务上下文。
 * @param {Object} [opts]
 * @param {string} [opts.dbPath] SQLite 文件路径；默认 server/data/odds-edge.db
 * @param {boolean} [opts.seed] 是否迁移原型规则（默认 true；幂等，重启安全）
 * @param {boolean|number|{port:number}} [opts.http] 是否启动 HTTP 层（默认 false）
 * @param {import('./lib/logger').Logger} [opts.logger]
 * @returns {{
 *   db: import('node:sqlite').DatabaseSync,
 *   ruleStore: import('./db/ruleStore').SqliteRuleStore,
 *   predictionStore: import('./db/predictionStore').SqlitePredictionStore,
 *   auditStore: import('./db/auditStore').SqliteAuditStore,
 *   rules: { store, lockManager, stateMachine, seed, getActiveRules, getRuleVersions },
 *   server?: import('node:http').Server,
 *   port?: number,
 *   getStatus: () => Object,
 *   close: () => void,
 * }}
 */
function createService({ dbPath = process.env.OE_DB_PATH || DEFAULT_DB_PATH, seed: doSeed = true, http = false, logger = defaultLogger } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const persistence = createDb({ path: dbPath, logger });
  const rules = createRuleService({ store: persistence.ruleStore });
  if (doSeed) rules.seed();

  const svc = {
    ...persistence,
    rules,
    getStatus() {
      return {
        dbPath,
        ruleVersions: persistence.ruleStore.size(),
        activeRules: persistence.ruleStore.getActive().length,
        predictions: persistence.predictionStore.list().length,
        auditEntries: persistence.auditStore.size(),
        httpPort: svc.port || null,
      };
    },
    close() { persistence.close(); },
  };

  if (http) {
    // 显式 port（含 0 = 随机端口）优先；否则 OE_PORT / 默认 3000
    let requested;
    if (typeof http === 'number') requested = http;
    else if (http && http.port != null) requested = http.port;
    else requested = Number(process.env.OE_PORT) || DEFAULT_HTTP_PORT;
    const server = createHttpServer(svc, { logger });
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

module.exports = { createService, DEFAULT_DB_PATH, DEFAULT_HTTP_PORT };
