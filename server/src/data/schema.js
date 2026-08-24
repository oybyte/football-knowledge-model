// ============================================================================
// 数据接入层 · schema —— MatchSchema 类型定义 + 三时间戳校验器
// 对齐 G12 data-model（qd_matches / qd_odds_snapshots）与 1.1 设计文档 §3
// 时间泄漏防护的数据前提：三时间戳缺一拒绝，received_at >= observed_at
// ============================================================================
'use strict';

/**
 * 信任级别
 * @typedef {"trusted"|"provisional"|"untrusted"} TrustLevel
 */

/**
 * 市场类型
 * @typedef {"handicap"|"european"|"over_under"|"bf"} Market
 */

/**
 * 数据源类型
 * @typedef {"odds"|"result"|"basic"|"mock"} SourceType
 */

/**
 * 单份盘口/赔率快照（对齐 qd_odds_snapshots 一行）
 * @typedef {Object} OddsSnapshot
 * @property {string} snapshot_id   全局唯一
 * @property {string} match_id      比赛 ID
 * @property {string} institution   归一化后机构名
 * @property {Market} market        handicap / european / over_under / bf
 * @property {string} source_id     数据源（FK → 注册表）
 * @property {TrustLevel} trust_level  信任级别（由注册表注入）
 * @property {string} observed_at   ISO 8601（观察时间）
 * @property {string} received_at   ISO 8601（接收时间）
 * @property {Object} data          具体结构以 dsl-syntax 字段注册表为准
 */

/**
 * 完整比赛采集快照（对齐 qd_matches + qd_odds_snapshots）
 * @typedef {Object} MatchSchema
 * @property {string} match_id
 * @property {string} league
 * @property {string} home_team
 * @property {string} away_team
 * @property {boolean} neutral
 * @property {string} match_time    开赛时间（ISO 8601）
 * @property {"scheduled"|"live"|"finished"|"cancelled"} status
 * @property {string} observed_at   本次采集观察时间
 * @property {string} received_at   本次采集接收时间
 * @property {OddsSnapshot[]} snapshots
 * @property {?("home_win"|"draw"|"away_win")} actual_result 赛后回填
 * @property {?number} home_score
 * @property {?number} away_score
 * @property {string[]} errors      校验未通过时的失败明细（P0 净化，不携带原始数据）
 */

const TRUST_LEVELS = Object.freeze(['trusted', 'provisional', 'untrusted']);
const MARKET_VALUES = Object.freeze(['handicap', 'european', 'over_under', 'bf']);
const STATUS_VALUES = Object.freeze(['scheduled', 'live', 'finished', 'cancelled']);
const SOURCE_TYPES = Object.freeze(['odds', 'result', 'basic', 'mock']);

const isISOTime = (s) => typeof s === 'string' && s.length > 0 && !Number.isNaN(Date.parse(s));

const ERROR_CODES = Object.freeze({
  MISSING_MATCH_TIME: 'missing_match_time',
  MISSING_OBSERVED: 'missing_observed_at',
  MISSING_RECEIVED: 'missing_received_at',
  RECEIVED_BEFORE_OBSERVED: 'received_before_observed',
  SNAPSHOT_AFTER_MATCH: 'snapshot_received_after_match_time',
  INVALID_STATUS: 'invalid_status',
  INVALID_MARKET: 'invalid_market',
  INVALID_TRUST: 'invalid_trust_level',
  EMPTY_SNAPSHOTS: 'empty_snapshots',
});

/**
 * 校验比赛顶层三时间戳与状态。
 * @param {MatchSchema} m
 * @param {string[]} errors
 */
function validateTop(m, errors) {
  if (!m.match_time || !isISOTime(m.match_time)) {
    errors.push(ERROR_CODES.MISSING_MATCH_TIME);
  }
  if (!STATUS_VALUES.includes(m.status)) {
    errors.push(ERROR_CODES.INVALID_STATUS);
  }
  if (!m.observed_at || !isISOTime(m.observed_at)) {
    errors.push(ERROR_CODES.MISSING_OBSERVED);
  }
  if (!m.received_at || !isISOTime(m.received_at)) {
    errors.push(ERROR_CODES.MISSING_RECEIVED);
  }
  if (m.observed_at && m.received_at && isISOTime(m.observed_at) && isISOTime(m.received_at)) {
    if (Date.parse(m.received_at) < Date.parse(m.observed_at)) {
      errors.push(ERROR_CODES.RECEIVED_BEFORE_OBSERVED);
    }
  }
}

/**
 * 校验每一份快照的三时间戳约束。
 * @param {MatchSchema} m
 * @param {string[]} errors
 */
function validateSnapshots(m, errors) {
  if (!Array.isArray(m.snapshots) || m.snapshots.length === 0) {
    // 允许：只有比赛元信息而无盘口快照（result/basic 源）时，用可读语义提示而非硬错误
    errors.push(ERROR_CODES.EMPTY_SNAPSHOTS);
    return;
  }
  const matchTimeMs = m.match_time && isISOTime(m.match_time) ? Date.parse(m.match_time) : NaN;
  for (const s of m.snapshots) {
    if (!MARKET_VALUES.includes(s.market)) errors.push(ERROR_CODES.INVALID_MARKET);
    if (!TRUST_LEVELS.includes(s.trust_level)) errors.push(ERROR_CODES.INVALID_TRUST);
    if (!s.observed_at || !isISOTime(s.observed_at)) errors.push(ERROR_CODES.MISSING_OBSERVED);
    if (!s.received_at || !isISOTime(s.received_at)) errors.push(ERROR_CODES.MISSING_RECEIVED);
    if (s.observed_at && s.received_at && isISOTime(s.observed_at) && isISOTime(s.received_at)) {
      if (Date.parse(s.received_at) < Date.parse(s.observed_at)) {
        errors.push(ERROR_CODES.RECEIVED_BEFORE_OBSERVED);
      }
    }
    if (!Number.isNaN(matchTimeMs)) {
      const rc = s.received_at && isISOTime(s.received_at) ? Date.parse(s.received_at) : NaN;
      if (!Number.isNaN(rc) && rc > matchTimeMs) {
        // 赛前快照的接收时间不得晚于开赛时间（防止赛后数据回灌被当作赛前可得）
        errors.push(ERROR_CODES.SNAPSHOT_AFTER_MATCH);
      }
    }
  }
}

/**
 * MatchSchema 校验入口（幂等、纯函数）。
 * @param {MatchSchema} match
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateMatch(match) {
  const errors = [];
  if (!match || typeof match !== 'object') {
    return { ok: false, errors: ['invalid_match_object'] };
  }
  validateTop(match, errors);
  validateSnapshots(match, errors);
  return { ok: errors.length === 0, errors };
}

module.exports = {
  TRUST_LEVELS,
  MARKET_VALUES,
  STATUS_VALUES,
  SOURCE_TYPES,
  isISOTime,
  validateMatch,
  ERROR_CODES,
};