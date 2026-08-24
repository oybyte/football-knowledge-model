// ============================================================================
// AI 引擎 · interpretation —— 单场解读
// 输入：单场 MatchSchema + 特征快照（供分析师参考）。
// 输出：结构化解读报告（中性化），一律 untrusted，仅参考，不入融合决策层。
// 引擎基于特征快照确定性组装信号表；LLM 仅生成叙述性文字，不参与数值。
// ============================================================================
'use strict';

const { chat } = require('./providers');
const { stampUntrusted } = require('./containment');
const { Logger } = require('../lib/logger');

const logger = new Logger({ service: 'ai-engine' });

/** 从特征快照选出的信号集（供解读展示）。 */
function buildSignals(snapshot) {
  const f = (snapshot && snapshot.features) || {};
  const picks = [
    ['move_pattern', f.move_pattern],
    ['handicap.change', f['handicap.change']],
    ['water.upper.change', f['water.upper.change']],
    ['volume.ratio', f['volume.ratio']],
    ['institution.sync_count', f['institution.sync_count']],
    ['water.upper.dispersion', f['water.upper.dispersion']],
    ['kelly_index.max', f['kelly_index.max']],
    ['betfair.dominant_ratio', f['betfair.dominant_ratio']],
    ['betfair.heat', f['betfair.heat']],
    ['odds.volatility', f['odds.volatility']],
    ['time_to_match', f.time_to_match],
    ['stability_flag', f.stability_flag],
  ].filter(([, v]) => v !== undefined && v !== null);
  return picks.map(([key, value]) => ({ field: key, value }));
}

/**
 * 单场解读入口。
 * @param {Object} options
 * @param {Object} options.match MatchSchema
 * @param {Object} [options.snapshot] 特征快照（computeMatchFeatures 产物）
 * @param {Object} [options.providerCfg]
 * @param {Object} [options.env]
 * @returns {Promise<Object>} 盖章 untrusted 的解读报告
 */
async function interpretMatch({ match, snapshot = null, providerCfg = null, env = process.env } = {}) {
  const features = (snapshot && snapshot.features) || {};
  const signals = buildSignals(snapshot);
  const context = {
    match_id: match.match_id,
    league: match.league,
    home_team: match.home_team,
    away_team: match.away_team,
    match_time: match.match_time,
  };

  const seed = {
    kind: 'interpret',
    narrative: `【${context.league}】${context.home_team} vs ${context.away_team}：本场共 ${signals.length} 项信号。盘口走势：${features.move_pattern ?? '未知'}；机构同向调盘 ${features['institution.sync_count'] ?? '—'} 家；上盘水位离散 ${features['water.upper.dispersion'] ?? '—'}。提示风险为参考，非投资建议。`,
  };

  const { text, provider, degraded } = await chat.call(null, {
    system: '你是足球数据分析助手，输出收益偏好中性的解读。',
    user: JSON.stringify({ kind: 'interpret', match: context, signals }),
    seed,
    config: providerCfg,
    env,
  });

  const report = {
    match_id: context.match_id,
    league: context.league,
    home_team: context.home_team,
    away_team: context.away_team,
    match_time: context.match_time,
    signals,
    narrative: (() => {
      try { return JSON.parse(text).narrative || text; } catch (e) { return text; }
    })(),
    provider,
  };

  const stamped = stampUntrusted(report);
  logger.info('ai_interpret_done', { match_id: report.match_id, provider, signals: signals.length, degraded });
  return stamped;
}

module.exports = { interpretMatch, buildSignals };