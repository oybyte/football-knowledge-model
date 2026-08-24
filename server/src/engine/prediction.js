// ============================================================================
// 预测链 · engine/prediction —— 2.3 预测输出 + 不可变证据快照
// 对齐实施计划 2.3：预测输出（方向 + 置信度 + 推理链 + 审计 ID）+ 证据快照写入。
// 复用 1.7 RetrievalWorker（检索→冲突→三层仲裁→融合）+ 冻结证据快照。
// ============================================================================
'use strict';

const { RetrievalWorker } = require('../worker/worker');
const { ConfidenceProvider } = require('../fusion/confidence');

let seq = 0;

/** 冻结预测时刻的证据快照（方向 + 置信度 + 推理链摘要，不可变）。 */
function freezeEvidence({ prediction_id, match_id, predicted_direction, final_confidence, at, chain_summary }) {
  return Object.freeze({
    evidence_id: `pev_${String(seq).padStart(4, '0')}`,
    prediction_id,
    match_id,
    predicted_direction,
    final_confidence,
    frozen_at: at,
    chain_summary: Object.freeze(chain_summary || {}),
  });
}

/**
 * 单场预测（可追溯完整推理链）。
 * @param {Object} p
 * @param {string} p.match match_id
 * @param {Object} p.featureSnapshot point-in-time 特征
 * @param {string} p.at
 * @param {Function} [p.getActiveRules]
 * @param {Object} [p.confidenceGate] G19
 * @param {string} [p.created_by]
 * @param {Object} [p.worker] 注入 worker（测试）
 * @returns {Object} { prediction, retrieval, evidence, chain }
 */
function predict({ match, featureSnapshot, at, getActiveRules = () => [], confidenceGate = null, created_by = 'engine:prediction', worker = null }) {
  const w = worker || new RetrievalWorker({
    getActiveRules,
    confidenceProvider: new ConfidenceProvider({ gate: confidenceGate }),
  });
  const { prediction, retrieval } = w.run({ match, featureSnapshot, at, created_by });

  let evidence = null;
  if (prediction) {
    const chain_summary = {
      match_id: match,
      dominant_rule_version_id: retrieval.arbitration.dominant_rule_version_id,
      direction: prediction.final_direction,
      confidence: prediction.final_confidence,
      review_ticket_id: retrieval.review_ticket_id || null,
    };
    evidence = freezeEvidence({
      prediction_id: prediction.prediction_id,
      match_id: match,
      predicted_direction: prediction.final_direction,
      final_confidence: prediction.final_confidence,
      at,
      chain_summary,
    });
  }

  return { prediction, retrieval, evidence, chain: { hits: retrieval.hits, arbitration: retrieval.arbitration } };
}

module.exports = { predict, freezeEvidence };