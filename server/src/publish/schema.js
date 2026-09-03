// ============================================================================
// 预测发布/结果回填 · schema —— 记录类型校验 + 方向判定常量
// 对齐 G12 qd_predictions / qd_evidence_snapshots；判定复回测 §6 方向判定。
// ============================================================================
'use strict';

/** 归一化让球方向（判定词汇，同 backtest match_result） */
const MATCH_RESULTS = Object.freeze(['upper', 'lower', 'draw']);

/** 总进球方向结果（对照大小球盘口中线） */
const TOTAL_GOALS_RESULTS = Object.freeze(['over', 'under']);

/** 实际赛果枚举（data-model actual_result） */
const OUTCOMES = Object.freeze(['home_win', 'draw', 'away_win']);

/** 可判定方向 → 期望让球方向（其余方向不可判定，不计命中分母） */
const VERIFIABLE = Object.freeze({
  favor_upper: 'upper',
  favor_lower: 'lower',
});

/** 可判定的总进球方向 → 期望总进球结果 */
const TOTAL_GOALS_VERIFIABLE = Object.freeze({
  over: 'over',
  under: 'under',
});

const VALID_DIRECTIONS = Object.freeze(Object.keys(VERIFIABLE));
const VALID_TOTAL_GOALS_DIRECTIONS = Object.freeze(Object.keys(TOTAL_GOALS_VERIFIABLE));

/**
 * 方向判定（按轴）。
 * @param {string} direction 让球方向或总进球方向
 * @param {string} match_result 对应轴的结果（upper/lower/draw 或 over/under）
 * @param {'handicap'|'total_goals'} [axis='handicap']
 * @returns {{ verifiable: boolean, expected_outcome: string|null, prediction_correct: boolean|null }}
 */
function computeVerdictFor(direction, match_result, axis = 'handicap') {
  const map = axis === 'total_goals' ? TOTAL_GOALS_VERIFIABLE : VERIFIABLE;
  const expected = map[direction];
  if (!expected) return { verifiable: false, expected_outcome: null, prediction_correct: null };
  if (axis === 'handicap' && match_result === 'draw') {
    return { verifiable: true, expected_outcome: expected, prediction_correct: false };
  }
  return { verifiable: true, expected_outcome: expected, prediction_correct: match_result === expected };
}

/** 向后兼容：默认让球盘判定。 */
function computeVerdict(final_direction, match_result) {
  return computeVerdictFor(final_direction, match_result, 'handicap');
}

/** 领域错误基类 */
class PublishError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
  }
}

/** 不可变违规（禁止 UPDATE/DELETE/PATCH） */
class ImmutableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImmutableError';
  }
}

/** 重复回填 */
class AlreadyBackfilledError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AlreadyBackfilledError';
  }
}

/**
 * 深度冻结（含数组与嵌套对象）。
 * @param {Object} obj
 * @returns {Object} 冻结后的对象
 */
function deepFreeze(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  for (const v of Object.values(obj)) deepFreeze(v);
  return Object.freeze(obj);
}

/**
 * 校验发布入参并映射为 PredictionRecord。
 * @param {Object} d
 * @returns {Object} 规范化后、未冻结的发布记录（prediction_id/match_id 必填）
 */
function normalizePredictionInput(d) {
  if (!d || typeof d !== 'object') throw new PublishError('invalid_input', 'decision required');
  const record = {
    prediction_id: d.prediction_id,
    match_id: d.match_id,
    command_id: d.command_id || null,
    final_direction: d.final_direction,
    total_goals_direction: d.total_goals_direction || null,
    final_confidence: d.final_confidence,
    weights: d.weights || {},
    reasoning_chain: d.reasoning_chain || [],
    audit_trail_id: d.audit_trail_id || null,
    created_at: d.created_at || new Date().toISOString(),
    created_by: d.created_by || 'publish:engine',
  };

  if (!record.match_id) throw new PublishError('E2001', 'match_id required');

  // 双轴：让球方向（handicap）与总进球方向（total_goals）任一可判即可发布。
  const hasHandicap = VALID_DIRECTIONS.includes(record.final_direction);
  const hasTotalGoals = VALID_TOTAL_GOALS_DIRECTIONS.includes(record.total_goals_direction);
  if (!hasHandicap && !hasTotalGoals) {
    throw new PublishError('E2002', `direction_not_verifiable:handicap=${record.final_direction},total_goals=${record.total_goals_direction}`);
  }
  if (record.final_direction && !hasHandicap) {
    throw new PublishError('E2002', `handicap_direction_invalid:${record.final_direction}`);
  }
  if (record.total_goals_direction && !hasTotalGoals) {
    throw new PublishError('E2002', `total_goals_direction_invalid:${record.total_goals_direction}`);
  }
  const c = record.final_confidence;
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) {
    throw new PublishError('E2003', `confidence_out_of_range:${c}`);
  }
  if (!Array.isArray(record.reasoning_chain)) {
    throw new PublishError('E2004', 'reasoning_chain_must_be_array');
  }
  if (!record.prediction_id) record.prediction_id = `pred_${record.match_id}_${Date.now()}`;
  if (!record.audit_trail_id) record.audit_trail_id = `pub_${Date.now()}`;
  return record;
}

/**
 * 校验赛果输入。
 * @param {Object} r
 * @returns {Object} 规范化 ResultInput
 */
function normalizeResultInput(r) {
  if (!r || typeof r !== 'object') throw new PublishError('E3001', 'result required');
  if (!MATCH_RESULTS.includes(r.match_result)) {
    throw new PublishError('E3002', `invalid_match_result:${r.match_result}`);
  }
  if (r.outcome !== undefined && r.outcome !== null && !OUTCOMES.includes(r.outcome)) {
    throw new PublishError('E3003', `invalid_outcome:${r.outcome}`);
  }
  return {
    match_result: r.match_result,
    outcome: r.outcome || null,
    total_goals_result: r.total_goals_result || null,
    observed_at: r.observed_at || null,
    received_at: r.received_at || null,
  };
}

module.exports = {
  MATCH_RESULTS,
  TOTAL_GOALS_RESULTS,
  OUTCOMES,
  VERIFIABLE,
  TOTAL_GOALS_VERIFIABLE,
  VALID_DIRECTIONS,
  VALID_TOTAL_GOALS_DIRECTIONS,
  computeVerdict,
  computeVerdictFor,
  PublishError,
  ImmutableError,
  AlreadyBackfilledError,
  deepFreeze,
  normalizePredictionInput,
  normalizeResultInput,
};