// ============================================================================
// 特征工程服务 · 入口 —— 缓存优先 → 未命中计算（1.2 设计文档 §4.1）
// 流程：MatchSchema → adapt（point-in-time 过滤）→ 防御性校验 → compute → 缓存
// ============================================================================
'use strict';

const { adaptMatch } = require('./adapt');
const { computeFeatures } = require('./compute');
const { assertNoFutureData } = require('./pointInTime');
const { FeatureCache } = require('./cache');

const FEATURE_VERSION = '1.0.0';

const cache = new FeatureCache();

/**
 * @typedef {Object} FeatureResult
 * @property {boolean} ok
 * @property {?Object} snapshot  FeatureSnapshot
 * @property {string[]} errors
 */

/**
 * 计算某场比赛在 T 时点的特征快照（缓存优先）。
 * @param {import('../data/schema').MatchSchema} match
 * @param {string} t 分析时点（ISO 8601）
 * @returns {FeatureResult}
 */
function computeMatchFeatures(match, t) {
  if (!match || !match.match_id) return { ok: false, snapshot: null, errors: ['invalid_match'] };

  const cached = cache.get(match.match_id, t);
  if (cached) return { ok: true, snapshot: cached, errors: [] };

  const { markets, filtered_out, sources } = adaptMatch(match, t);
  const pit = assertNoFutureData(markets, t);
  if (!pit.ok) {
    return { ok: false, snapshot: null, errors: [`point_in_time_leak: ${pit.leaks.join(', ')}`] };
  }

  const features = computeFeatures(markets, match.match_time, t);
  const snapshot = {
    feature_id: `feat_${match.match_id}_${t.replace(/[-:TZ.]/g, '').slice(0, 14)}`,
    match_id: match.match_id,
    computed_at: t,
    feature_version: FEATURE_VERSION,
    features,
    meta: {
      snapshot_count: (match.snapshots || []).length,
      filtered_out,
      sources,
    },
  };

  cache.set(match.match_id, t, snapshot);
  return { ok: true, snapshot, errors: [] };
}

/** @returns {number} 缓存命中率 */
function cacheHitRate() {
  return cache.hitRate();
}

module.exports = { computeMatchFeatures, cacheHitRate, FEATURE_VERSION, FeatureCache };