// ============================================================================
// 预测发布/结果回填 · publisher —— 编排（publish + backfill）
// 发布：归一化 → 校验 → 幂等判重 → 落库 → 审计。
// 回填：定位 → once-only → 时间安全 → 判定 → 证据锁定 → 审计。
// ============================================================================
'use strict';

const { PredictionStore } = require('./store');
const { IdempotencyGuard } = require('./idempotency');
const { AuditLog } = require('./audit');
const { normalizePredictionInput, PublishError } = require('./schema');
const { backfillResult } = require('./backfill');
const { defaultLogger } = require('../lib/logger');

/**
 * 预测发布 / 结果回填 编排器。
 * @param {Object} [opts]
 * @param {PredictionStore} [opts.store]
 * @param {IdempotencyGuard} [opts.guard]
 * @param {AuditLog} [opts.audit]
 * @param {import('../lib/logger').Logger} [opts.logger]
 */
class PredictionPublisher {
  constructor(opts = {}) {
    this.store = opts.store || new PredictionStore();
    this.guard = opts.guard || new IdempotencyGuard();
    this.audit = opts.audit || new AuditLog();
    this.logger = opts.logger || defaultLogger;
  }

  /**
   * 发布一份预测（幂等、不可变）。
   * @param {Object} p
   * @param {Object} p.decision FusionDecision 或含匹配字段的对象
   * @param {string} [p.command_id]
   * @param {string} p.idempotency_key 幂等键（防重发）
   * @param {string} [p.created_by]
   * @returns {{ published: boolean, duplicate?: boolean, prediction: Object, existing?: Object }}
   */
  publish({ decision, command_id = null, idempotency_key, created_by = 'publish:engine' }) {
    const record = normalizePredictionInput({ ...decision, command_id, created_by });

    // 幂等判重（先于写入）
    const reg = this.guard.register({
      prediction_id: record.prediction_id,
      command_id,
      idempotency_key,
      match_id: record.match_id,
    });
    if (reg.duplicate) {
      const existing = this.store.get(reg.existing.prediction_id);
      this.logger.warn('prediction_publish_duplicate', { prediction_id: record.prediction_id });
      return { published: false, duplicate: true, prediction: existing, existing };
    }

    const prediction = this.store.insert(record);

    this.audit.append({
      event_type: 'prediction_generated',
      actor: created_by,
      target_id: prediction.prediction_id,
      details: {
        match_id: prediction.match_id,
        command_id: prediction.command_id,
        final_direction: prediction.final_direction,
        final_confidence: prediction.final_confidence,
        audit_trail_id: prediction.audit_trail_id,
      },
    });

    this.logger.info('prediction_published', {
      prediction_id: prediction.prediction_id,
      match_id: prediction.match_id,
      final_direction: prediction.final_direction,
    });

    return { published: true, prediction };
  }

  /**
   * 赛果回填（once-only + 时间安全 + 判定 + 证据锁定）。
   * @param {Object} p
   * @param {string} p.prediction_id
   * @param {Object} p.result ResultInput
   * @param {string} p.known_at
   * @param {string} [p.actor]
   * @returns {{ prediction: Object, result: Object, evidence: Object }}
   */
  backfill({ prediction_id, result, known_at, actor = 'result:ingest' }) {
    return backfillResult({
      store: this.store,
      audit: this.audit,
      prediction_id,
      result,
      known_at,
      actor,
      logger: this.logger,
    });
  }

  getPrediction(id) { return this.store.get(id); }
  predictionWithResult(id) { return this.store.predictionWithResult(id); }
  listPredictions() { return this.store.list(); }
  getAudit() { return this.audit.list(); }
}

module.exports = { PredictionPublisher };