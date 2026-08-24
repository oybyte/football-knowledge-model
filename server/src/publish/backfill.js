// ============================================================================
// 预测发布/结果回填 · backfill —— 结果回填判定
// once-only（防重复回填）+ 时间安全（known_at ≥ created_at）+ 方向判定 + 证据锁定。
// 判定不复写冻结的预测主体，写入独立 results/evidence 集合。
// ============================================================================
'use strict';

const { computeVerdict, normalizeResultInput, PublishError, AlreadyBackfilledError } = require('./schema');
const { lockEvidence } = require('./evidence');

/**
 * 执行一次结果回填。
 * @param {Object} p
 * @param {Object} p.store PredictionStore
 * @param {Object} p.audit AuditLog
 * @param {string} p.prediction_id
 * @param {Object} p.result ResultInput
 * @param {string} p.known_at 结果已知时刻（时间安全锚点）
 * @param {string} [p.actor]
 * @param {import('../lib/logger').Logger} [p.logger]
 * @returns {{ prediction: Object, result: Object, evidence: Object, event_id: string }}
 */
function backfillResult({ store, audit, prediction_id, result, known_at, actor = 'result:ingest', logger = null }) {
  const prediction = store.get(prediction_id);
  if (!prediction) throw new PublishError('E6001', `prediction_not_found:${prediction_id}`);

  // once-only：已回填 → 拒绝重复覆写
  if (store.getResult(prediction_id)) {
    throw new AlreadyBackfilledError(`already_backfilled:${prediction_id}`);
  }

  const norm = normalizeResultInput(result);

  // 时间安全：结果不可能早于预测产生
  const pCreated = Date.parse(prediction.created_at);
  const kAt = Date.parse(known_at);
  if (!Number.isFinite(kAt)) throw new PublishError('E6002', 'invalid_known_at');
  if (kAt < pCreated) {
    throw new PublishError('E6003', `result_earlier_than_prediction:known_at=${known_at}<created_at=${prediction.created_at}`);
  }

  // 方向判定
  const { verifiable, expected_outcome, prediction_correct } =
    computeVerdict(prediction.final_direction, norm.match_result);

  // 审计：prediction_backfilled（先记账，拿到 event_id 供证据引用）
  const backfillEvent = audit.append({
    event_type: 'prediction_backfilled',
    actor,
    target_id: prediction_id,
    details: { match_result: norm.match_result, prediction_correct, verifiable },
  });

  // 证据锁定（不可变）
  const evidence = lockEvidence({
    prediction_id,
    match_id: prediction.match_id,
    predicted_direction: prediction.final_direction,
    match_result: norm.match_result,
    outcome: norm.outcome,
    prediction_correct,
    frozen_at: backfillEvent.timestamp,
    audit_event_id: backfillEvent.event_id,
  }, store);

  // 证据锁定审计
  audit.append({
    event_type: 'evidence_locked',
    actor,
    target_id: evidence.evidence_id,
    details: { prediction_id, audit_event_id: backfillEvent.event_id },
  });

  // 回填结果（once-only 写入 independent results 集合）
  const resultRec = store.setResult({
    prediction_id,
    match_id: prediction.match_id,
    match_result: norm.match_result,
    outcome: norm.outcome,
    predicted_direction: prediction.final_direction,
    expected_outcome,
    verifiable,
    prediction_correct,
    backfilled_at: backfillEvent.timestamp,
    known_at,
    actor,
    evidence_id: evidence.evidence_id,
    audit_event_id: backfillEvent.event_id,
  });

  if (logger) {
    logger.info('prediction_backfilled', {
      prediction_id,
      prediction_correct,
      verifiable,
      match_result: norm.match_result,
      evidence_id: evidence.evidence_id,
    });
  }

  return { prediction, result: resultRec, evidence, event_id: backfillEvent.event_id };
}

module.exports = { backfillResult };