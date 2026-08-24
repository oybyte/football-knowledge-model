// ============================================================================
// 数据接入层 · 数据源注册表 —— 对齐 G2 / G12 qd_data_sources（§4.1）
// 信任分级可追溯：任何快照的 trust_level 均由此处按其 source_id 解析
// ============================================================================
'use strict';

/** @typedef {import('../schema')} */

/**
 * @typedef {Object} DataSource
 * @property {string} source_id
 * @property {string} source_name
 * @property {import('./schema').SourceType} source_type
 * @property {import('./schema').TrustLevel} trust_level
 * @property {"active"|"inactive"|"degraded"} status
 * @property {?string} config_ref       凭证引用（不在本表存明文）
 * @property {Object} quality_metrics   { missing_rate, anomaly_rate, latency_ms }
 */

/**
 * 1.1 设计文档 §4.3 数据源注册表初始数据（原型机构 → 归一化源）。
 * 仅 hardcode 演示阶段；正式环境应从 qd_data_sources 查询。
 * @type {Record<string, DataSource>}
 */
const SOURCES = Object.freeze({
  src_odds_macau: {
    source_id: 'src_odds_macau', source_name: '澳门盘口', source_type: 'odds',
    trust_level: 'trusted', status: 'active', config_ref: 'env:ODDS_MACAU_API_KEY',
    quality_metrics: { missing_rate: 0, anomaly_rate: 0, latency_ms: 120 },
  },
  src_odds_ct366: {
    source_id: 'src_odds_ct366', source_name: '36 竞彩盘口', source_type: 'odds',
    trust_level: 'provisional', status: 'degraded', config_ref: 'env:ODDS_CT366_API_KEY',
    quality_metrics: { missing_rate: 0.02, anomaly_rate: 0.01, latency_ms: 300 },
  },
  src_odds_william: {
    source_id: 'src_odds_william', source_name: '威廉希尔', source_type: 'odds',
    trust_level: 'trusted', status: 'active', config_ref: 'env:ODDS_WILLIAM_API_KEY',
    quality_metrics: { missing_rate: 0, anomaly_rate: 0, latency_ms: 150 },
  },
  src_odds_ladbrokes: {
    source_id: 'src_odds_ladbrokes', source_name: '立博', source_type: 'odds',
    trust_level: 'trusted', status: 'active', config_ref: 'env:ODDS_LADBROKES_API_KEY',
    quality_metrics: { missing_rate: 0, anomaly_rate: 0, latency_ms: 160 },
  },
  src_odds_crown: {
    source_id: 'src_odds_crown', source_name: '皇冠', source_type: 'odds',
    trust_level: 'trusted', status: 'active', config_ref: 'env:ODDS_CROWN_API_KEY',
    quality_metrics: { missing_rate: 0, anomaly_rate: 0, latency_ms: 140 },
  },
  src_odds_bet365: {
    source_id: 'src_odds_bet365', source_name: 'Bet365', source_type: 'odds',
    trust_level: 'trusted', status: 'active', config_ref: 'env:ODDS_BET365_API_KEY',
    quality_metrics: { missing_rate: 0, anomaly_rate: 0, latency_ms: 150 },
  },
  src_bf_betfair: {
    source_id: 'src_bf_betfair', source_name: '必发交易', source_type: 'odds',
    trust_level: 'trusted', status: 'active', config_ref: 'env:BF_BETFAIR_API_KEY',
    quality_metrics: { missing_rate: 0, anomaly_rate: 0, latency_ms: 200 },
  },
  src_odds_interwetten: {
    source_id: 'src_odds_interwetten', source_name: 'Interwetten', source_type: 'odds',
    trust_level: 'provisional', status: 'degraded', config_ref: 'env:ODDS_INTERWETTEN_API_KEY',
    quality_metrics: { missing_rate: 0.01, anomaly_rate: 0.02, latency_ms: 350 },
  },
  src_result_sporttery: {
    source_id: 'src_result_sporttery', source_name: '竞彩官方赛果', source_type: 'result',
    trust_level: 'trusted', status: 'active', config_ref: 'env:SELFTICKET_SC_API_KEY',
    quality_metrics: { missing_rate: 0, anomaly_rate: 0, latency_ms: 100 },
  },
  src_mock_demo: {
    source_id: 'src_mock_demo', source_name: '本地模拟演示源', source_type: 'mock',
    trust_level: 'untrusted', status: 'active', config_ref: null,
    quality_metrics: { missing_rate: 0, anomaly_rate: 0, latency_ms: 0 },
  },
});

/**
 * 机构名 → source_id 归一化映射（设计文档 §4.3）。
 * @type {Record<string, string>}
 */
const INSTITUTION_TO_SOURCE = Object.freeze({
  macau: 'src_odds_macau',
  ct366: 'src_odds_ct366',
  william: 'src_odds_william',
  ladbrokes: 'src_odds_ladbrokes',
  crown: 'src_odds_crown',
  bet365: 'src_odds_bet365',
  betfair: 'src_bf_betfair',
  interwetten: 'src_odds_interwetten',
});

/**
 * 查询数据源。
 * @param {string} sourceId
 * @returns {?DataSource}
 */
function getSource(sourceId) {
  return SOURCES[sourceId] || null;
}

/**
 * 按归一化机构名查数据源。
 * @param {string} institution
 * @returns {?DataSource}
 */
function getSourceByInstitution(institution) {
  const id = INSTITUTION_TO_SOURCE[institution];
  return id ? getSource(id) : null;
}

/**
 * 解析某数据源所需凭证引用（供 CredentialVault 使用）。
 * @param {string} sourceId
 * @returns {?string}
 */
function resolveConfigRef(sourceId) {
  const s = getSource(sourceId);
  return s ? s.config_ref : null;
}

/** @returns {DataSource[]} */
function listSources() {
  return Object.values(SOURCES);
}

module.exports = {
  SOURCES,
  INSTITUTION_TO_SOURCE,
  getSource,
  getSourceByInstitution,
  resolveConfigRef,
  listSources,
};