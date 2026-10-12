// ============================================================================
// 特征工程服务 · 入口 —— 缓存优先 → 未命中计算（1.2 设计文档 §4.1）
// 流程：MatchSchema → adapt（point-in-time 过滤）→ 防御性校验 → compute → 缓存
// ============================================================================
'use strict';

const { adaptMatch } = require('./adapt');
const { computeFeatures, minutesUntil } = require('./compute');
const { assertNoFutureData } = require('./point_in_time');
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
 * 以本次分析时刻覆写 `time_to_match`（返回浅拷贝，不改动缓存对象）。
 * 缓存键 (match_id, T) 中的 T 是数据截取上界、同场次稳定；而 time_to_match 依赖
 * 「分析时刻」，每次请求都不同，故不可进缓存，须在读取时覆写。
 */
function withAnalyzedAt(snapshot, matchTime, analyzedAt) {
  return {
    ...snapshot,
    features: { ...snapshot.features, time_to_match: minutesUntil(matchTime, analyzedAt) },
  };
}

/**
 * 计算某场比赛在 T 时点的特征快照（缓存优先）。
 *
 * 注意两个时点的语义差异，切勿混用：
 *   · `t` 数据截取上界（赛前分析锚点，通常 = match_time）→ 决定纳入哪些快照，可缓存
 *   · `opts.analyzedAt` 分析时刻 → 仅决定 `time_to_match`，每次请求不同，不缓存
 *
 * @param {import('../data/schema').MatchSchema} match
 * @param {string} t 数据截取上界（ISO 8601）
 * @param {{analyzedAt?:string}} [opts] analyzedAt = 分析时刻（ISO 8601），默认当前时刻。
 *        **回测 / 复盘复用必须显式传入其回测时点**，否则构成时间泄漏。
 * @returns {FeatureResult}
 */
function computeMatchFeatures(match, t, opts = {}) {
  if (!match || !match.match_id) return { ok: false, snapshot: null, errors: ['invalid_match'] };
  const analyzedAt = opts.analyzedAt || new Date().toISOString();

  const cached = cache.get(match.match_id, t);
  if (cached) return { ok: true, snapshot: withAnalyzedAt(cached, match.match_time, analyzedAt), errors: [] };

  const { markets, filtered_out, sources } = adaptMatch(match, t);
  const pit = assertNoFutureData(markets, t);
  if (!pit.ok) {
    return { ok: false, snapshot: null, errors: [`point_in_time_leak: ${pit.leaks.join(', ')}`] };
  }

  const features = computeFeatures(markets, match.match_time, { analyzedAt });
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