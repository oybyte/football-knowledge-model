// ============================================================================
// 融合决策层 · FusionDecision —— 组装 + 冻结（不可变）+ 审计追踪
// 对齐 G12 qd_preditions：prediction_id / final_direction / final_confidence /
// weights / reasoning_chain / audit_trail_id。生成后 Object.freeze。
// ============================================================================
'use strict';

let predSeq = 0;
let auditSeq = 0;

/**
 * 组装并冻结 FusionDecision，写 G3 审计日志。
 * @param {Object} p
 * @param {string} p.match_id
 * @param {Object} p.fused fuse() 中间结果
 * @param {string} [p.created_by]
 * @param {import('../lib/logger').Logger} [p.logger]
 * @returns {Object} 冻结的 FusionDecision
 */
function buildFusionDecision({ match_id, fused, created_by = 'fusion:engine', logger = null }) {
  predSeq += 1;
  auditSeq += 1;
  const created_at = new Date().toISOString();
  const prediction_id = `pred_${match_id}_${String(predSeq).padStart(4, '0')}`;
  const audit_trail_id = `fus_${String(auditSeq).padStart(6, '0')}`;

  const decision = Object.freeze({
    prediction_id,
    match_id,
    final_direction: fused.final_direction,
    final_confidence: fused.final_confidence,
    weights: Object.freeze({ ...fused.weights }),
    basis_weights: Object.freeze({ ...fused.basis }),
    reasoning_chain: Object.freeze(fused.chain.map((n) => Object.freeze({ ...n }))),
    audit_trail_id,
    excluded: Object.freeze([...fused.excluded]),
    created_at,
    created_by,
  });

  if (logger) {
    const ctx = {
      prediction_id,
      audit_trail_id,
      final_direction: decision.final_direction,
      final_confidence: decision.final_confidence,
      weights: decision.weights,
      excluded: decision.excluded,
    };
    if (decision.final_direction === null) {
      logger.warn('fusion_decision_rejected', ctx);
    } else {
      logger.info('fusion_decision_created', ctx);
    }
  }

  return decision;
}

module.exports = { buildFusionDecision };