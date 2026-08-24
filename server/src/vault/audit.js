// ============================================================================
// 数据接入层 · 审计日志 —— 对齐 G12 qd_audit_log（event_type 含 credential_accessed）
// 阶段 1 以内存日志实现；阶段 1.3 持久化到 qd_audit_log 即替换此实现。
// 设计要点：审计记录为 append-only，不可被修改。
// ============================================================================
'use strict';

/**
 * @typedef {Object} AuditEntry
 * @property {string} event_id
 * @property {string} event_type
 * @property {string} timestamp
 * @property {string} actor
 * @property {string} target_id
 * @property {Object} details
 */

const ENTRIES = [];

let seq = 0;

/**
 * 记录一条审计事件（append-only）。
 * @param {{ event_type: string, actor: string, target_id: string, details?: Object }} e
 * @returns {AuditEntry}
 */
function recordAudit({ event_type, actor, target_id, details = {} }) {
  seq += 1;
  const entry = {
    event_id: `evt_${String(seq).padStart(6, '0')}`,
    event_type,
    timestamp: new Date().toISOString(),
    actor,
    target_id,
    details,
  };
  ENTRIES.push(entry);
  return entry;
}

/** @returns {AuditEntry[]} 只读视图（副本） */
function listAudit() {
  return ENTRIES.slice();
}

/** @param {string} eventType @returns {AuditEntry[]} */
function filterAudit(eventType) {
  return ENTRIES.filter((e) => e.event_type === eventType);
}

/** @param {string} actor @returns {AuditEntry[]} */
function byActor(actor) {
  return ENTRIES.filter((e) => e.actor === actor);
}

module.exports = { recordAudit, listAudit, filterAudit, byActor };