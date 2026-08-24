// ============================================================================
// 预测发布/结果回填 · evidence —— 不可变证据快照
// 回填判定成功后原子冻结，生成后不可修改（append-only 语义）。
// ============================================================================
'use strict';

const { deepFreeze, PublishError } = require('./schema');

let evidenceSeq = 0;

/**
 * 生成并记录一条不可变证据快照。
 * @param {Object} p
 * @param {string} p.prediction_id
 * @param {string} p.match_id
 * @param {string} p.predicted_direction
 * @param {string} p.match_result
 * @param {boolean|null} p.prediction_correct
 * @param {string} [p.outcome]
 * @param {string} p.frozen_at
 * @param {string} p.audit_event_id
 * @param {Object} store PredictionStore（写 evidences 集合）
 * @returns {Object} 冻结的 EvidenceSnapshot
 */
function lockEvidence({ prediction_id, match_id, predicted_direction, match_result, prediction_correct, outcome = null, frozen_at, audit_event_id }, store) {
  if (!prediction_id || !audit_event_id) throw new PublishError('E5001', 'prediction_id & audit_event_id required');
  evidenceSeq += 1;
  const evidence = deepFreeze({
    evidence_id: `ev_${String(evidenceSeq).padStart(6, '0')}`,
    prediction_id,
    match_id,
    predicted_direction,
    match_result,
    outcome,
    prediction_correct,
    frozen_at,
    audit_event_id,
  });
  return store.setEvidence(evidence);
}

module.exports = { lockEvidence };