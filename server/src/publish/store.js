// ============================================================================
// 预测发布/结果回填 · store —— append-only 预测库 + 结果/证据库
// insert() 是唯一写入口；update/delete/patch 一律抛 ImmutableError。
// 回填判定不覆写冻结的预测主体，写入独立的 results/evidence 集合（append-only）。
// ============================================================================
'use strict';

const { deepFreeze, ImmutableError, AlreadyBackfilledError } = require('./schema');

/**
 * 内存 append-only 存储：预测记录 + 回填结果 + 证据快照。
 */
class PredictionStore {
  constructor() {
    /** @type {Map<string, Object>} prediction_id → 冻结 PredictionRecord */
    this.predictions = new Map();
    /** @type {Map<string, Object>} prediction_id → 冻结 BackfillResult（恰一条） */
    this.results = new Map();
    /** @type {Map<string, Object>} evidence_id → 冻结 EvidenceSnapshot */
    this.evidences = new Map();
  }

  /** 唯一写入口：发布预测记录。dup → 返回既有（幂等语义在上层判定）。 */
  insert(record) {
    if (!record || !record.prediction_id) throw new ImmutableError('prediction_id required');
    const frozen = deepFreeze(record);
    this.predictions.set(frozen.prediction_id, frozen);
    return frozen;
  }

  get(prediction_id) {
    return this.predictions.get(prediction_id) || null;
  }

  list() {
    return [...this.predictions.values()];
  }

  /** 写入回填结果（once-only） */
  setResult(result) {
    if (this.results.has(result.prediction_id)) {
      throw new AlreadyBackfilledError(`already_backfilled:${result.prediction_id}`);
    }
    const frozen = deepFreeze(result);
    this.results.set(frozen.prediction_id, frozen);
    return frozen;
  }

  getResult(prediction_id) {
    return this.results.get(prediction_id) || null;
  }

  /** 写入不可变证据快照 */
  setEvidence(evidence) {
    if (this.evidences.has(evidence.evidence_id)) return this.evidences.get(evidence.evidence_id);
    const frozen = deepFreeze(evidence);
    this.evidences.set(frozen.evidence_id, frozen);
    return frozen;
  }

  getEvidence(evidence_id) {
    return this.evidences.get(evidence_id) || null;
  }

  /** 只读合并视图：预测主体 + 回填结果 */
  predictionWithResult(prediction_id) {
    const p = this.predictions.get(prediction_id);
    if (!p) return null;
    const r = this.results.get(prediction_id) || null;
    return r ? deepFreeze({ ...p, result: r }) : p;
  }

  // ── 不可变护栏：禁止改写 ──
  update() { throw new ImmutableError('PredictionStore is append-only; UPDATE not allowed'); }
  delete() { throw new ImmutableError('PredictionStore is append-only; DELETE not allowed'); }
  patch() { throw new ImmutableError('PredictionStore is append-only; PATCH not allowed'); }
}

module.exports = { PredictionStore };