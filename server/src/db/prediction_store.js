// ============================================================================
// 持久化存储层 · predictionStore —— SQLite 版 append-only 预测库
// 与 publish/store.js PredictionStore 接口对齐（insert/get/list/setResult/
// getResult/setEvidence/getEvidence/predictionWithResult + 不可变护栏）。
// 幂等：INSERT OR IGNORE；回填 once-only：UNIQUE(prediction_id) 冲突抛错。
// ============================================================================
'use strict';

const { deepFreeze, ImmutableError, AlreadyBackfilledError } = require('../publish/schema');

/**
 * SQLite 版 append-only 存储：预测记录 + 回填结果 + 证据快照。
 */
class SqlitePredictionStore {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   */
  constructor(db) {
    this.db = db;
    this._insertPred = db.prepare(`INSERT OR IGNORE INTO predictions (
      prediction_id, match_id, final_direction, created_at, payload_json
    ) VALUES (?, ?, ?, ?, ?)`);
    this._getPred = db.prepare('SELECT payload_json FROM predictions WHERE prediction_id = ?');
    this._listPred = db.prepare('SELECT payload_json FROM predictions ORDER BY created_at');
    this._insertResult = db.prepare(`INSERT INTO backfill_results (
      prediction_id, backfilled_at, payload_json
    ) VALUES (?, ?, ?)`);
    this._getResult = db.prepare('SELECT payload_json FROM backfill_results WHERE prediction_id = ?');
    this._insertEvidence = db.prepare(`INSERT OR IGNORE INTO evidences (
      evidence_id, prediction_id, match_id, frozen_at, payload_json
    ) VALUES (?, ?, ?, ?, ?)`);
    this._getEvidence = db.prepare('SELECT payload_json FROM evidences WHERE evidence_id = ?');
  }

  /** 唯一写入口：发布预测记录。dup → 返回既有（幂等语义在上层判定）。 */
  insert(record) {
    if (!record || !record.prediction_id) throw new ImmutableError('prediction_id required');
    const frozen = deepFreeze(record);
    this._insertPred.run(
      frozen.prediction_id, frozen.match_id, frozen.final_direction || null,
      frozen.created_at || null, JSON.stringify(frozen),
    );
    return frozen;
  }

  /** @param {string} prediction_id @returns {?Object} 冻结 PredictionRecord */
  get(prediction_id) {
    const row = this._getPred.get(prediction_id);
    return row ? deepFreeze(JSON.parse(row.payload_json)) : null;
  }

  /** @returns {Object[]} 全部预测（按 created_at 升序） */
  list() {
    return this._listPred.all().map((r) => deepFreeze(JSON.parse(r.payload_json)));
  }

  /** 写入回填结果（once-only）。dup → 抛 AlreadyBackfilledError。 */
  setResult(result) {
    const frozen = deepFreeze(result);
    try {
      this._insertResult.run(
        frozen.prediction_id, frozen.backfilled_at || new Date().toISOString(), JSON.stringify(frozen),
      );
    } catch (err) {
      if (String(err.message).includes('UNIQUE constraint failed')) {
        throw new AlreadyBackfilledError(`already_backfilled:${frozen.prediction_id}`);
      }
      throw err;
    }
    return frozen;
  }

  /** @param {string} prediction_id @returns {?Object} 冻结 BackfillResult */
  getResult(prediction_id) {
    const row = this._getResult.get(prediction_id);
    return row ? deepFreeze(JSON.parse(row.payload_json)) : null;
  }

  /** 写入不可变证据快照。dup → 返回既有。 */
  setEvidence(evidence) {
    const frozen = deepFreeze(evidence);
    this._insertEvidence.run(
      frozen.evidence_id, frozen.prediction_id || null, frozen.match_id || null,
      frozen.frozen_at || null, JSON.stringify(frozen),
    );
    return this.getEvidence(frozen.evidence_id);
  }

  /** @param {string} evidence_id @returns {?Object} 冻结 EvidenceSnapshot */
  getEvidence(evidence_id) {
    const row = this._getEvidence.get(evidence_id);
    return row ? deepFreeze(JSON.parse(row.payload_json)) : null;
  }

  /** 只读合并视图：预测主体 + 回填结果 */
  predictionWithResult(prediction_id) {
    const p = this.get(prediction_id);
    if (!p) return null;
    const r = this.getResult(prediction_id);
    return r ? deepFreeze({ ...p, result: r }) : p;
  }

  // ── 不可变护栏：禁止改写 ──
  update() { throw new ImmutableError('PredictionStore is append-only; UPDATE not allowed'); }
  delete() { throw new ImmutableError('PredictionStore is append-only; DELETE not allowed'); }
  patch() { throw new ImmutableError('PredictionStore is append-only; PATCH not allowed'); }
}

module.exports = { SqlitePredictionStore };
