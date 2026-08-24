// ============================================================================
// 预测发布/结果回填 · audit —— append-only 不可变审计日志
// 事件只增不改；event_type 覆盖 prediction_generated / prediction_backfilled / evidence_locked。
// ============================================================================
'use strict';

const { deepFreeze, ImmutableError } = require('./schema');

let auditSeq = 0;

/**
 * 不可变审计日志。
 */
class AuditLog {
  constructor() {
    /** @type {Object[]} 冻结的 AuditEvent[] */
    this.events = [];
    /** @type {Map<string, Object>} event_id → event */
    this.byId = new Map();
  }

  /**
   * 追加一条审计事件（唯一写入口）。
   * @param {Object} p
   * @param {string} p.event_type
   * @param {string} [p.actor]
   * @param {string} p.target_id
   * @param {Object} [p.details]
   * @returns {Object} 冻结的 AuditEvent
   */
  append({ event_type, actor = 'system', target_id, details = {} }) {
    if (!event_type || !target_id) throw new ImmutableError('event_type and target_id required');
    auditSeq += 1;
    const event = deepFreeze({
      event_id: `pub_aud_${String(auditSeq).padStart(6, '0')}`,
      event_type,
      timestamp: new Date().toISOString(),
      actor,
      target_id,
      details: deepFreeze({ ...details }),
    });
    this.events.push(event);
    this.byId.set(event.event_id, event);
    return event;
  }

  byType(event_type) {
    return this.events.filter((e) => e.event_type === event_type);
  }

  get(event_id) {
    return this.byId.get(event_id) || null;
  }

  list() {
    return [...this.events];
  }

  update() { throw new ImmutableError('AuditLog is append-only; UPDATE not allowed'); }
  delete() { throw new ImmutableError('AuditLog is append-only; DELETE not allowed'); }
}

module.exports = { AuditLog };