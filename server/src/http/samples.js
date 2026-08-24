// ============================================================================
// HTTP 层 · samples —— 从 mock 场次构造回测证据 / AI 挖掘样本
// mock 场无真实赛果，故 settlement/match_result 为确定性合成（标注 synthetic）。
// 仅用于演示与联调；真实数据接入后由真实赛果替换。
// ============================================================================
'use strict';

const { loadMockMatches } = require('../data/mock');
const { computeMatchFeatures } = require('../features');

/** 确定性字符串哈希（同输入恒同输出，保证可复现）。 */
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 合成赛果：upper 40% / lower 30% / draw 30%。 */
function syntheticResult(matchId) {
  const r = hashStr(matchId) % 10;
  return r < 4 ? 'upper' : r < 7 ? 'lower' : 'draw';
}

/** 合成赛前共识方向。 */
function syntheticConsensus(matchId) {
  return hashStr(`${matchId}:c`) % 2 ? 'upper' : 'lower';
}

/**
 * 构造 AI 挖掘样本（含特征快照 + 合成赛果/共识）。
 * @returns {Object[]} [{ id, league, features, settlement, consensus, synthetic }]
 */
function buildSamples() {
  return loadMockMatches().map((m) => {
    const feat = computeMatchFeatures(m, m.match_time);
    return {
      id: m.match_id,
      league: m.league,
      features: feat.ok ? feat.snapshot.features : {},
      settlement: syntheticResult(m.match_id),
      consensus: syntheticConsensus(m.match_id),
      synthetic: true,
    };
  });
}

/**
 * 构造回测原始触发证据（含三时间戳 + 合成赛果）。
 * @param {Object} rule RuleVersion（取 direction 作为判定方向）
 * @returns {Object[]}
 */
function buildEvidence(rule) {
  return loadMockMatches().map((m) => ({
    match_id: m.match_id,
    observed_at: m.observed_at,
    received_at: m.received_at,
    match_time: m.match_time,
    match_result: syntheticResult(m.match_id),
    league: m.league,
    odds: 1.0,
    verdict_direction: rule.direction,
    trigger_data: { synthetic: true },
  }));
}

module.exports = { buildSamples, buildEvidence, syntheticResult, syntheticConsensus, hashStr };
