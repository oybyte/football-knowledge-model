// ============================================================================
// 数据接入层 · 远程源适配器 —— 注册与工厂
// 统一入口：按 source_id 创建远端数据源适配器实例（当前实现：竞彩官方赛程）。
// 原则：真实源适配器只做「接线 + 归一化」；未配置端点诚实返回 not_configured，
//      拉取/归一化失败返回 degraded；绝不把占位/假数据当作真实数据。
// ============================================================================
'use strict';

const sporttery = require('./sporttery_schedule');
const sportteryOdds = require('./sporttery_odds');

/** 已注册的适配器构造器：source_id → factory */
const ADAPTERS = Object.freeze({
  [sporttery.SOURCE_ID]: sporttery.create,
  [sportteryOdds.SOURCE_ID]: sportteryOdds.create,
});

/**
 * 创建指定远程数据源适配器。
 * @param {string} sourceId
 * @param {Object} [opts] 透传给具体适配器（env / fetchImpl / now / actor）
 * @returns {Object}
 */
function createAdapter(sourceId, opts) {
  const factory = ADAPTERS[sourceId];
  if (!factory) throw new Error('adapter_not_registered:' + sourceId);
  return factory(opts || {});
}

/** @returns {string[]} */
function registeredSourceIds() {
  return Object.keys(ADAPTERS);
}

module.exports = { createAdapter, registeredSourceIds, sporttery, ADAPTERS };