// ============================================================================
// 检索 Worker · worker —— RetrievalWorker 编排
// 检索 → 冲突检测 → 三层仲裁 → 融合决策 → 审计 + 可选人工复核工单。
// ============================================================================
'use strict';

const { retrieveHits } = require('./retrieval');
const { detectConflicts } = require('./conflict');
const { arbitrate, emptyArbitration } = require('./arbitrate');
const { ConfidenceProvider } = require('../fusion/confidence');
const { fuseDecision } = require('../fusion');
const { defaultLogger } = require('../lib/logger');

let reviewSeq = 0;

/**
 * 检索 Worker —— 单场预测链编排。
 * @param {Object} [opts]
 * @param {Function} [opts.getActiveRules] () => RuleVersion[]
 * @param {ConfidenceProvider} [opts.confidenceProvider] G19 置信度
 * @param {import('../lib/logger').Logger} [opts.logger]
 */
class RetrievalWorker {
  constructor(opts = {}) {
    this.getActiveRules = opts.getActiveRules || (() => []);
    this.confidenceProvider = opts.confidenceProvider || new ConfidenceProvider({ gate: null });
    this.logger = opts.logger || defaultLogger;
    // 注入空 gate 的 provider，保留仲裁置信度（G19 已在检索阶段解析），避免融合层二次覆盖
    this.fusionProvider = new ConfidenceProvider({ gate: null });
    this.reviewTickets = [];
  }

  /**
   * 执行单场检索 + 仲裁 + 融合。
   * @param {Object} p
   * @param {string} p.match match_id
   * @param {Object} p.featureSnapshot point-in-time 特征
   * @param {string} p.at 时刻
   * @param {string} [p.created_by]
   * @returns {{ prediction: Object|null, retrieval: Object }}
   */
  run({ match, featureSnapshot, at, created_by = 'worker:retrieval' }) {
    const rules = this.getActiveRules() || [];
    const hits = retrieveHits({
      rules,
      featureSnapshot,
      at,
      confidenceOf: (versionId, baseConf) =>
        this.confidenceProvider.resolve({ rule_version_id: versionId, fallback: baseConf }).confidence,
    });

    const conflicts = detectConflicts(hits);
    const arbitration = hits.length ? arbitrate(hits) : emptyArbitration();

    let prediction = null;
    let reviewTicket = null;

    if (arbitration.direction !== null && arbitration.dominant_rule_version_id) {
      const rule_output = {
        version_id: arbitration.dominant_rule_version_id,
        direction: arbitration.direction,
        confidence: arbitration.confidence,
        exact: hits.some((h) => h.match.exact === true),
        trust: 'trusted',
      };
      prediction = fuseDecision({
        match_id: match,
        rule_output,
        model_output: null,
        anomaly_output: null,
        context: { provider: this.fusionProvider, logger: this.logger },
        created_by,
      });
    } else if (arbitration.manual_review_required) {
      reviewSeq += 1;
      reviewTicket = {
        review_ticket_id: `rev_${String(reviewSeq).padStart(4, '0')}`,
        match_id: match,
        created_at: new Date().toISOString(),
        created_by,
        arbitration,
      };
      this.reviewTickets.push(reviewTicket);
      this.logger.warn('retrieval_manual_review_required', {
        match_id: match,
        ticket_id: reviewTicket.review_ticket_id,
        conflicts: conflicts.length,
      });
    } else {
      this.logger.info('retrieval_no_prediction', { match_id: match, hits: hits.length });
    }

    const retrieval = {
      match_id: match,
      at,
      hits,
      conflicts,
      arbitration,
      review_ticket_id: reviewTicket ? reviewTicket.review_ticket_id : null,
    };

    if (prediction) {
      this.logger.info('retrieval_prediction_created', {
        match_id: match,
        prediction_id: prediction.prediction_id,
        direction: prediction.final_direction,
        confidence: prediction.final_confidence,
        dominant_rule: arbitration.dominant_rule_version_id,
      });
    }

    return { prediction, retrieval };
  }
}

module.exports = { RetrievalWorker };