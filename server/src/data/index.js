// ============================================================================
// 数据接入层 · 入口 —— ingest 管线（1.1 设计文档 §6.2 / §8）
// 流水线：mock/真实源 → MatchSchema → 三时间戳校验 → 信任分级 → 审计 → 输出
// 校验失败返回 { ok:false, errors }（P0 净化，不泄露原始数据）
// ============================================================================
'use strict';

const { validateMatch } = require('./schema');
const { recordAudit } = require('../vault/audit');
const { loadMockMatches, getMockMatch } = require('./mock');

/**
 * @typedef {Object} IngestResult
 * @property {boolean} ok
 * @property {?import('./schema').MatchSchema} match   通过校验的快照
 * @property {string[]} errors                         校验失败明细（错误码）
 */

/**
 * 校验一份 MatchSchema 并登记审计。
 * @param {import('./schema').MatchSchema} match
 * @returns {IngestResult}
 */
function ingestMatch(match) {
  const { ok, errors } = validateMatch(match);
  recordAudit({
    event_type: ok ? 'data_received_ok' : 'data_rejected',
    actor: 'ingest:system',
    target_id: match && match.match_id ? match.match_id : 'unknown',
    details: ok ? { snapshot_count: match.snapshots.length } : { errors },
  });
  if (!ok) {
    return { ok: false, match: null, errors };
  }
  // 校验通过：返回净化后的联赛/快照（不含 errors 字段；errors 仅失败侧存在）
  const clean = { ...match };
  delete clean.errors;
  return { ok: true, match: clean, errors: [] };
}

/**
 * 从统一 mock 源接入全部演示比赛。
 * @returns {IngestResult[]}
 */
function ingestMockAll() {
  return loadMockMatches().map(ingestMatch);
}

/**
 * 从统一 mock 源接入单个比赛。
 * @param {string} matchId
 * @returns {IngestResult}
 */
function ingestMockMatch(matchId) {
  const m = getMockMatch(matchId);
  if (!m) return { ok: false, match: null, errors: ['unknown_match'] };
  return ingestMatch(m);
}

/**
 * 查询数据源（供上层可观测 / 信任追溯）。
 * @param {string} [sourceId]
 * @returns {Object}
 */
function querySources(sourceId) {
  const { getSource, listSources } = require('./sources/registry');
  if (sourceId) {
    const s = getSource(sourceId);
    return s ? { ...s } : null;
  }
  return listSources().map((s) => ({ ...s }));
}

// ───────────────────────── 真实源适配器（赛程）─────────────────────────

/**
 * 创建指定远程数据源适配器（当前支持竞彩官方赛程 src_schedule_sporttery）。
 * @param {string} sourceId
 * @param {Object} [opts] env / fetchImpl / now / actor
 * @returns {Object}
 */
function createRemoteAdapter(sourceId, opts) {
  const { createAdapter } = require('./adapters');
  return createAdapter(sourceId, opts);
}

/**
 * 执行竞彩官方赛程同步（真实端点未配置时诚实返回 not_configured，绝无假数据）。
 * @param {Object} [opts] env / fetchImpl / now / actor
 * @returns {Promise<Object>} sync 结果（status: not_configured | degraded | ok）
 */
function syncSportterySchedule(opts) {
  const { create } = require('./adapters/sportterySchedule');
  return create(opts || {}).sync();
}

/**
 * 接入本地人工盘赔源（盘口数据.md）。根目录经 env:OE_MANUAL_ODDS_ROOT 动态配置。
 * @param {Object} [opts] env / actor / year
 * @returns {Object} scan 结果（status: not_configured | degraded | ok）
 */
function loadManualOdds(opts) {
  const { scanManualOddsRoot } = require('./manual');
  return scanManualOddsRoot(opts || {});
}

module.exports = {
  ingestMatch,
  ingestMockAll,
  ingestMockMatch,
  querySources,
  createRemoteAdapter,
  syncSportterySchedule,
  loadManualOdds,
  loadMockMatches,
};