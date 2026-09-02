// ============================================================================
// 数据接入层 · CredentialVault —— 凭证隔离（G1 §11.3 / 1.1 设计文档 §5）
// 三类凭证域：data_source / system / aimodel
// 铁律：AI 引擎（actor.role === 'ai'）无 data_source 权限；所有读取写审计。
// 阶段 1 以环境变量为后端；生产可替换为 Vault/KMS，接口不变。
// ============================================================================
'use strict';

const { recordAudit } = require('./audit');

/**
 * @typedef {"data_source"|"system"|"aimodel"} CredentialDomain
 */

/**
 * @typedef {Object} Actor
 * @property {string} id
 * @property {"ingest"|"api"|"ai"|"admin"} role
 */

/**
 * 权限矩阵：actor.role × 凭证域。
 * 设计文档 §5.3 —— ai 角色对 data_source 为 false（不可访问）。
 * @type {Record<string, Record<CredentialDomain, boolean>>}
 */
const PERMISSION_MATRIX = Object.freeze({
  ingest: { data_source: true, system: true, aimodel: false },
  api: { data_source: false, system: true, aimodel: false },
  ai: { data_source: false, system: false, aimodel: true },
  admin: { data_source: true, system: true, aimodel: true },
});

const DOMAINS = Object.freeze(['data_source', 'system', 'aimodel']);

/** 凭证域 → 环境变量前缀（演示映射，生产由 config_ref 解析） */
const DOMAIN_ENV_PREFIX = Object.freeze({
  data_source: 'ODDS_',
  system: 'SYS_',
  aimodel: 'AI_',
});

class UnauthorizedVaultError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnauthorizedVaultError';
    this.code = 'VAULT_UNAUTHORIZED';
  }
}

class CredentialVault {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.env] 注入环境变量表（默认 process.env，测试可注入）
   */
  constructor({ env = process.env } = {}) {
    this.env = env;
  }

  /**
   * 判定某角色是否可访问某凭证域。
   * @param {Actor} actor
   * @param {CredentialDomain} domain
   * @returns {boolean}
   */
  canAccess(actor, domain) {
    if (!DOMAINS.includes(domain)) return false;
    const row = PERMISSION_MATRIX[actor.role];
    return !!(row && row[domain]);
  }

  /**
   * 读取凭证明文。无权限时抛 UnauthorizedVaultError；成功读取写审计。
   * @param {Actor} actor
   * @param {string} ref 如 "env:ODDS_MACAU_API_KEY"
   * @returns {string}
   */
  get(actor, ref) {
    const domain = this.#domainOf(ref);
    if (!this.canAccess(actor, domain)) {
      throw new UnauthorizedVaultError(
        `actor ${actor.role}:${actor.id} 无权访问凭证域 ${domain}`
      );
    }
    const secret = this.#resolve(ref);
    recordAudit({
      event_type: 'credential_accessed',
      actor: `${actor.role}:${actor.id}`,
      target_id: ref,
      details: { domain },
    });
    return secret;
  }

  /**
   * 是否持有某凭证（不触发审计，用于能力探测）。
   * @param {Actor} actor
   * @param {string} ref
   * @returns {boolean}
   */
  has(actor, ref) {
    const domain = this.#domainOf(ref);
    if (!this.canAccess(actor, domain)) return false;
    return this.#resolve(ref) != null;
  }

  /**
   * 解析数据源凭证引用（config_ref）。
   * @param {string} sourceId
   * @returns {?string}
   */
  resolveDataSourceRef(sourceId) {
    const { resolveConfigRef } = require('../data/sources/registry');
    return resolveConfigRef(sourceId);
  }

  /** @returns {import('./audit').AuditEntry[]} */
  auditEntries() {
    const { listAudit } = require('./audit');
    return listAudit();
  }

  /** @param {string} ref @returns {CredentialDomain} */
  #domainOf(ref) {
    if (typeof ref !== 'string' || !ref.startsWith('env:')) {
      throw new UnauthorizedVaultError(`不支持的凭证引用格式: ${ref}`);
    }
    const name = ref.slice(4);
    if (name.startsWith(DOMAIN_ENV_PREFIX.data_source)) return 'data_source';
    if (name.startsWith(DOMAIN_ENV_PREFIX.system)) return 'system';
    if (name.startsWith(DOMAIN_ENV_PREFIX.aimodel)) return 'aimodel';
    return 'data_source';
  }

  /** @param {string} ref @returns {string} */
  #resolve(ref) {
    const name = ref.slice(4);
    const v = this.env[name];
    if (v == null) throw new UnauthorizedVaultError(`凭证未配置: ${ref}`);
    return String(v);
  }
}

module.exports = { CredentialVault, UnauthorizedVaultError, PERMISSION_MATRIX, DOMAINS };