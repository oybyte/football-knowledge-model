// ============================================================================
// 持久化存储层 · auditStore —— SQLite 版 G3 审计日志（append-only）
// 与 lib/logger.js 的 G3 结构化日志格式对齐；只增不删（DB 触发器兜底）。
// ============================================================================
'use strict';

/**
 * SQLite 版审计日志存储。
 */
class SqliteAuditStore {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   */
  constructor(db) {
    this.db = db;
    this._append = db.prepare(`INSERT INTO audit_logs (
      ts, level, service, trace_id, message, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)`);
    this._recent = db.prepare('SELECT seq, payload_json FROM audit_logs ORDER BY ts DESC, seq DESC LIMIT ?');
    this._all = db.prepare('SELECT seq, payload_json FROM audit_logs ORDER BY seq');
    this._count = db.prepare('SELECT COUNT(*) AS n FROM audit_logs');
  }

  /**
   * 追加一条审计记录。
   * @param {Object} entry G3 结构化日志条目
   * @returns {Object} 原条目
   */
  append(entry) {
    const e = entry || {};
    this._append.run(
      e.timestamp || new Date().toISOString(),
      e.level || 'INFO',
      e.service || null,
      e.trace_id || null,
      e.message || '',
      JSON.stringify(e),
    );
    return e;
  }

  /**
   * 查询最近审计记录（降序）。
   * @param {Object} [opts]
   * @param {number} [opts.limit]
   * @returns {Object[]}
   */
  query({ limit = 100 } = {}) {
    return this._recent.all(limit).map((r) => ({ ...JSON.parse(r.payload_json), seq: r.seq }));
  }

  /** @returns {Object[]} 全部审计记录（升序，供 G12 回填等批量只读） */
  listAll() {
    return this._all.all().map((r) => ({ ...JSON.parse(r.payload_json), seq: r.seq }));
  }

  /** @returns {number} */
  size() {
    return this._count.get().n;
  }
}

module.exports = { SqliteAuditStore };
