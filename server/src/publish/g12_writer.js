// ============================================================================
// 预测发布/结果回填 · g12_writer —— G12 qd_predictions 写路径适配器
// A1 方案 B：qd_predictions 为预测唯一写路径（运行时 predictions 降只读兼容）。
// 与 backfillG12 的锚点补全逻辑严格对齐：
//   · match_id      → qd_matches（NOT NULL FK）：缺失 = 诚实失败（E2005），绝不捏造。
//   · audit_trail_id→ qd_audit_log（NOT NULL FK）：缺失补占位 prediction_published 锚点。
//   · command_id    → qd_analysis_commands（可空 FK）：缺失预置 completed 命令锚点。
// 事务原子：qd_predictions(+analysis_commands / audit_log 锚点)在同一事务内。
// 幂等：INSERT OR IGNORE，重复 publish 返回既有记录（inserted=false）。
// ============================================================================
'use strict';

const { PublishError } = require('./schema');
const { withTransaction } = require('../db/connection');
const { defaultLogger } = require('../lib/logger');

function nowIso() { return new Date().toISOString(); }

/**
 * 创建 G12 预测写路径适配器。
 * @param {Object} p
 * @param {import('node:sqlite').DatabaseSync} p.db
 * @param {Object} p.qd createG12Repository(db) 返回值
 * @param {import('../lib/logger').Logger} [p.logger]
 */
function createG12PredictionWriter({ db, qd, logger = defaultLogger }) {
  if (!db || !qd) throw new Error('createG12PredictionWriter: db & qd required');

  /**
   * 写入一条 G12 预测（事务内，FK 锚点补全；幂等）。
   * @param {Object} rec 已 normalize 的 PredictionRecord（prediction_id/match_id 必填）
   * @returns {{ inserted: boolean, prediction: Object, existing?: Object }}
   */
  function write(rec) {
    if (!rec || !rec.prediction_id) throw new PublishError('E2001', 'prediction_id required');
    if (!rec.match_id) throw new PublishError('E2001', 'match_id required');

    return withTransaction(db, () => {
      // 幂等：同 prediction_id 已存在 → 返回既有
      const existing = qd.predictions.get(rec.prediction_id);
      if (existing) {
        logger.info('g12_prediction_duplicate', { prediction_id: rec.prediction_id });
        return { inserted: false, prediction: existing, existing };
      }

      // FK 1 · match_id → qd_matches：缺失即诚实失败（不捏造），与 backfill 语义一致
      if (!qd.matches.get(rec.match_id)) {
        throw new PublishError('E2005', `missing_match:${rec.match_id}`);
      }

      // FK 2 · audit_trail_id → qd_audit_log：缺失补占位锚点（prediction_published）
      const auditId = rec.audit_trail_id || `auto_pub_${rec.prediction_id}`;
      if (!qd.audit_log.get(auditId)) {
        qd.audit_log.insert({
          event_id: auditId, event_type: 'prediction_published',
          timestamp: rec.created_at || nowIso(), actor: rec.created_by || 'publish:engine',
          target_id: rec.prediction_id, details: { prediction_id: rec.prediction_id },
          prev_state: null, new_state: null,
        });
      }

      // FK 3 · command_id → qd_analysis_commands（可空）：缺失预置 completed 命令锚点
      let commandId = rec.command_id || null;
      if (commandId && !qd.analysis_commands.get(commandId)) {
        qd.analysis_commands.insert({
          command_id: commandId, match_id: rec.match_id, status: 'completed',
          idempotency_key: commandId, requested_at: rec.created_at || nowIso(),
          requested_by: rec.created_by || 'publish:engine', completed_at: rec.created_at || nowIso(),
          result_ref: null, error: null,
        });
      }

      const inserted = qd.predictions.insert({
        prediction_id: rec.prediction_id, match_id: rec.match_id, command_id: commandId,
        final_direction: rec.final_direction, final_confidence: rec.final_confidence,
        weights: rec.weights || {}, reasoning_chain: rec.reasoning_chain || [],
        audit_trail_id: auditId, created_at: rec.created_at || nowIso(), created_by: rec.created_by || 'publish:engine',
      });

      if (!inserted.inserted) {
        // 竞态兜底：并发同 id 已被写入 → 返回既有
        const raced = qd.predictions.get(rec.prediction_id);
        return { inserted: false, prediction: raced, existing: raced };
      }

      const prediction = qd.predictions.get(rec.prediction_id);
      logger.info('g12_prediction_written', {
        prediction_id: prediction.prediction_id, match_id: prediction.match_id,
        final_direction: prediction.final_direction,
      });
      return { inserted: true, prediction };
    });
  }

  /** 读取一条 G12 预测（供幂等分支与只读兼容层复用）。 */
  function get(prediction_id) {
    return qd.predictions.get(prediction_id);
  }

  return { write, get };
}

module.exports = { createG12PredictionWriter };
