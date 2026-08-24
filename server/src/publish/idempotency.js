// ============================================================================
// 预测发布/结果回填 · idempotency —— 幂等键判重（对齐 qd_analysis_commands）
// 同一 idempotency_key / command_id / prediction_id 重复发布 → 返回既有，不重复写入。
// ============================================================================
'use strict';

const { PublishError } = require('./schema');

/**
 * 幂等守卫。
 */
class IdempotencyGuard {
  constructor() {
    /** @type {Map<string, Object>} idempotency_key → 已登记记录 */
    this.byKey = new Map();
    /** @type {Map<string, Object>} command_id → 已登记记录 */
    this.byCommand = new Map();
    /** @type {Map<string, Object>} prediction_id → 已登记记录 */
    this.byPrediction = new Map();
  }

  /**
   * 登记发布意图；重复则返回 duplicate + existing。
   * @param {Object} p
   * @param {string} p.prediction_id
   * @param {string} [p.command_id]
   * @param {string} p.idempotency_key
   * @param {string} p.match_id
   * @returns {{ duplicate: boolean, existing: Object|null, registered: Object }}
   */
  register({ prediction_id, command_id = null, idempotency_key, match_id }) {
    if (!idempotency_key) throw new PublishError('E4001', 'idempotency_key required');

    const dup = (existing) => ({ duplicate: true, existing, registered: existing });

    if (this.byKey.has(idempotency_key)) return dup(this.byKey.get(idempotency_key));
    if (command_id && this.byCommand.has(command_id)) return dup(this.byCommand.get(command_id));
    if (this.byPrediction.has(prediction_id)) return dup(this.byPrediction.get(prediction_id));

    const registered = {
      prediction_id,
      command_id,
      idempotency_key,
      match_id,
      registered_at: new Date().toISOString(),
    };
    this.byKey.set(idempotency_key, registered);
    if (command_id) this.byCommand.set(command_id, registered);
    this.byPrediction.set(prediction_id, registered);
    return { duplicate: false, existing: null, registered };
  }
}

module.exports = { IdempotencyGuard };