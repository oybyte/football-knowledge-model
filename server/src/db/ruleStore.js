// ============================================================================
// 持久化存储层 · ruleStore —— SQLite 版 append-only 规则存储
// 与 rules/store.js RuleStore 接口对齐（insert/getById/getByRuleId/getActive/
// getByStatus/size + 不可变护栏），可注入状态机使用。
// 不可变性双保险：应用层 update/delete/patch 抛错 + DB 触发器拒绝 UPDATE/DELETE。
// ============================================================================
'use strict';

const { validateRuleVersion } = require('../rules/schema');
const { deepFreeze } = require('../publish/schema');
const { defaultLogger } = require('../lib/logger');

class ImmutableError extends Error {
  constructor(op) { super(`immutable_violation: ${op} not allowed on rule_versions`); this.code = 'IMMUTABLE'; }
}

/**
 * SQLite 版 append-only 规则版本存储。
 */
class SqliteRuleStore {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   * @param {Object} [opts]
   * @param {import('../lib/logger').Logger} [opts.logger]
   */
  constructor(db, { logger = defaultLogger } = {}) {
    this.db = db;
    this.logger = logger;
    this._insert = db.prepare(`INSERT OR IGNORE INTO rule_versions (
      version_id, rule_id, version, status, direction, priority, base_confidence,
      category, trust_level, valid_from, valid_to, created_at, created_by, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this._byId = db.prepare('SELECT payload_json FROM rule_versions WHERE version_id = ?');
    this._byRule = db.prepare('SELECT payload_json FROM rule_versions WHERE rule_id = ? ORDER BY version DESC');
    this._active = db.prepare("SELECT payload_json FROM rule_versions WHERE status = 'active'");
    this._byStatus = db.prepare('SELECT payload_json FROM rule_versions WHERE status = ?');
    this._count = db.prepare('SELECT COUNT(*) AS n FROM rule_versions');
  }

  /**
   * 写入新版本（唯一写接口）。
   * @param {Object} version RuleVersion
   * @returns {{ ok: boolean, errors: string[] }}
   */
  insert(version) {
    const { ok, errors } = validateRuleVersion(version);
    if (!ok) {
      this.logger.warn('rule_insert_rejected', { rule_id: version?.rule_id, errors });
      return { ok: false, errors };
    }
    const r = this._insert.run(
      version.version_id, version.rule_id, version.version, version.status, version.direction,
      version.priority, version.base_confidence, version.category, version.trust_level,
      version.valid_from, version.valid_to || null, version.created_at, version.created_by,
      JSON.stringify(version),
    );
    if (r.changes === 0) return { ok: false, errors: ['duplicate_version_id'] };
    this.logger.info('rule_inserted', { version_id: version.version_id, rule_id: version.rule_id, status: version.status });
    return { ok: true, errors: [] };
  }

  /** @param {string} versionId @returns {?Object} 冻结的 RuleVersion */
  getById(versionId) {
    const row = this._byId.get(versionId);
    return row ? deepFreeze(JSON.parse(row.payload_json)) : null;
  }

  /** @param {string} ruleId @returns {Object[]} 按 version 降序 */
  getByRuleId(ruleId) {
    return this._byRule.all(ruleId).map((r) => deepFreeze(JSON.parse(r.payload_json)));
  }

  /** @returns {Object[]} 所有 status=active 的规则 */
  getActive() {
    return this._active.all().map((r) => deepFreeze(JSON.parse(r.payload_json)));
  }

  /** @param {string} status @returns {Object[]} */
  getByStatus(status) {
    return this._byStatus.all(status).map((r) => deepFreeze(JSON.parse(r.payload_json)));
  }

  /** @returns {number} */
  size() {
    return this._count.get().n;
  }

  /** 禁止操作（应用层护栏；DB 触发器兜底） */
  update() { throw new ImmutableError('update'); }
  delete() { throw new ImmutableError('delete'); }
  patch() { throw new ImmutableError('patch'); }
}

module.exports = { SqliteRuleStore, ImmutableError };
