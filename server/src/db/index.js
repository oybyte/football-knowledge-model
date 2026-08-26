// ============================================================================
// 持久化存储层 · 入口 —— createDb 工厂
// 打开连接 → 迁移（建表 + 不可变触发器）→ 装配三个 SQLite store。
// 默认 :memory:（测试），生产传入文件路径即可获得跨重启持久化。
// ============================================================================
'use strict';

const { openDb, withTransaction } = require('./connection');
const { migrate } = require('./schema');
const { SqliteRuleStore } = require('./ruleStore');
const { SqlitePredictionStore } = require('./predictionStore');
const { SqliteAuditStore } = require('./auditStore');
const { createG12Repository } = require('./g12/repository');
const { backfillG12 } = require('./g12/backfill');

/**
 * 创建持久化存储实例。
 * @param {Object} [opts]
 * @param {string} [opts.path] SQLite 文件路径；默认 ':memory:'
 * @param {import('../lib/logger').Logger} [opts.logger]
 * @returns {{
 *   db: import('node:sqlite').DatabaseSync,
 *   ruleStore: SqliteRuleStore,
 *   predictionStore: SqlitePredictionStore,
 *   auditStore: SqliteAuditStore,
 *   qd: ReturnType<typeof createG12Repository>,   // G12 数据访问层
 *   backfillG12: typeof backfillG12,               // G12 迁移回填（事务+幂等）
 *   close: () => void,
 * }}
 */
function createDb({ path = ':memory:', logger } = {}) {
  const db = openDb({ path });
  migrate(db);
  return {
    db,
    ruleStore: new SqliteRuleStore(db, { logger }),
    predictionStore: new SqlitePredictionStore(db),
    auditStore: new SqliteAuditStore(db),
    qd: createG12Repository(db),
    backfillG12,
    close() { db.close(); },
  };
}

module.exports = { createDb, openDb, migrate, withTransaction };
