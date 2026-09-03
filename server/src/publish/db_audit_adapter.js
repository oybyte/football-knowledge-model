// ============================================================================
// 预测发布/结果回填 · DB 审计适配器 —— 把 SqliteAuditStore 适配为 publisher 期望的
// AuditLog 接口（append 返回 { event_id, timestamp, ... } 且持久化；list 可读）。
// 让预测发布/回填审计跨重启存活，与预测库同生命周期。
// ============================================================================
'use strict';

const { defaultLogger } = require('../lib/logger');

let seq = 0;
function nextEventId() {
  seq += 1;
  return `pub_aud_${String(seq).padStart(6, '0')}`;
}

class SqliteAuditAdapter {
  /**
   * @param {import('../db/audit_store').SqliteAuditStore} store
   * @param {Object} [opts]
   * @param {import('../lib/logger').Logger} [opts.logger]
   */
  constructor(store, opts = {}) {
    this.store = store;
    this.logger = opts.logger || defaultLogger;
  }

  /**
   * 追加一条审计事件（兼容 publisher 的 AuditLog.append 契约）。
   * @param {Object} p
   * @param {string} p.event_type
   * @param {string} [p.actor]
   * @param {string} p.target_id
   * @param {Object} [p.details]
   * @returns {Object} 冻结的审计事件（含 event_id / timestamp）
   */
  append({ event_type, actor = 'system', target_id, details = {} }) {
    if (!event_type || !target_id) throw new Error('event_type and target_id required');
    const event_id = nextEventId();
    const timestamp = new Date().toISOString();
    const entry = { event_id, event_type, timestamp, actor, target_id, details };
    this.store.append(entry); // SqliteAuditStore 存 payload_json（含 event_id）
    return entry;
  }

  /** @returns {Object[]} */
  list() {
    try {
      return this.store.query({ limit: 1000 });
    } catch (e) {
      this.logger.warn('audit_adapter_list_failed', { error: String((e && e.message) || e) });
      return [];
    }
  }
}

module.exports = { SqliteAuditAdapter };
