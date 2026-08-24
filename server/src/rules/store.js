// ============================================================================
// 规则存储服务 · store —— append-only 内存存储
// 对齐 G12 §3.6 callout：状态转换 = INSERT 新版本，禁止 UPDATE/DELETE。
// 唯一写接口是 insert()；update()/delete() 抛 ImmutableError。
// ============================================================================
'use strict';

const { validateRuleVersion } = require('./schema');
const { defaultLogger } = require('../lib/logger');

class ImmutableError extends Error {
  constructor(op) { super(`immutable_violation: ${op} not allowed on rule_versions`); this.code = 'IMMUTABLE'; }
}

/**
 * Append-only 规则版本存储。
 */
class RuleStore {
  constructor({ logger = defaultLogger } = {}) {
    this.logger = logger;
    /** @type {Map<string, Object>} key = version_id */
    this.versions = new Map();
    /** @type {Map<string, string[]>} key = rule_id, value = version_id[] (降序) */
    this.byRule = new Map();
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
    if (this.versions.has(version.version_id)) {
      return { ok: false, errors: ['duplicate_version_id'] };
    }
    const frozen = Object.freeze({ ...version });
    this.versions.set(version.version_id, frozen);

    const list = this.byRule.get(version.rule_id) || [];
    list.push(version.version_id);
    this.byRule.set(version.rule_id, list);

    this.logger.info('rule_inserted', { version_id: version.version_id, rule_id: version.rule_id, status: version.status });
    return { ok: true, errors: [] };
  }

  /** @param {string} versionId @returns {?Object} */
  getById(versionId) {
    return this.versions.get(versionId) || null;
  }

  /** @param {string} ruleId @returns {Object[]} 按 version 降序 */
  getByRuleId(ruleId) {
    const ids = this.byRule.get(ruleId) || [];
    return ids
      .map((id) => this.versions.get(id))
      .filter(Boolean)
      .sort((a, b) => b.version - a.version);
  }

  /** @returns {Object[]} 所有 status=active 的规则 */
  getActive() {
    return [...this.versions.values()].filter((v) => v.status === 'active');
  }

  /** @param {string} status @returns {Object[]} */
  getByStatus(status) {
    return [...this.versions.values()].filter((v) => v.status === status);
  }

  /** @returns {number} */
  size() { return this.versions.size; }

  /** 禁止操作 */
  update() { throw new ImmutableError('update'); }
  delete() { throw new ImmutableError('delete'); }
  patch() { throw new ImmutableError('patch'); }

  clear() { this.versions.clear(); this.byRule.clear(); }
}

module.exports = { RuleStore, ImmutableError };
