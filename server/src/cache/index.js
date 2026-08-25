// ============================================================================
// 缓存层集成入口 — 规则缓存 / 特征缓存 / 工厂函数
// 对齐实施计划 1.2（特征缓存 TTL）、1.3（规则缓存 TTL）。
// ============================================================================
'use strict';

const { createCacheAdapter, MemoryCacheAdapter } = require('./adapter');
const { defaultLogger } = require('../lib/logger');

const RULE_CACHE_TTL_MS = 5 * 60 * 1000;   // 5 分钟
const FEATURE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟

/**
 * 规则缓存包装
 */
class RuleCache {
  /** @param {import('./adapter').CacheAdapter} adapter @param {object} [logger] */
  constructor(adapter, logger = defaultLogger) {
    this.adapter = adapter;
    this.logger = logger;
  }

  /** 缓存活跃规则列表 */
  async getActiveRules() {
    return this.adapter.get('rules:active');
  }
  async setActiveRules(rules) {
    await this.adapter.set('rules:active', rules, RULE_CACHE_TTL_MS);
  }

  /** 缓存规则版本 */
  async getRuleVersions(ruleId) {
    return this.adapter.get(`rules:versions:${ruleId}`);
  }
  async setRuleVersions(ruleId, versions) {
    await this.adapter.set(`rules:versions:${ruleId}`, versions, RULE_CACHE_TTL_MS);
  }

  /** 失效规则缓存 */
  async invalidateRule(ruleId) {
    await this.adapter.del(`rules:active`);
    await this.adapter.del(`rules:versions:${ruleId}`);
  }

  async invalidateAll() {
    await this.adapter.del('rules:active');
  }
}

/**
 * 特征缓存包装
 */
class FeatureCache {
  /** @param {import('./adapter').CacheAdapter} adapter @param {object} [logger] */
  constructor(adapter, logger = defaultLogger) {
    this.adapter = adapter;
    this.logger = logger;
  }

  /** 缓存比赛特征 */
  async getFeatures(matchId) {
    return this.adapter.get(`features:${matchId}`);
  }
  async setFeatures(matchId, features) {
    await this.adapter.set(`features:${matchId}`, features, FEATURE_CACHE_TTL_MS);
  }

  /** 缓存分析结果 */
  async getAnalysis(matchId) {
    return this.adapter.get(`analysis:${matchId}`);
  }
  async setAnalysis(matchId, result) {
    await this.adapter.set(`analysis:${matchId}`, result, FEATURE_CACHE_TTL_MS);
  }

  /** 失效 */
  async invalidate(matchId) {
    await this.adapter.del(`features:${matchId}`);
    await this.adapter.del(`analysis:${matchId}`);
  }

  async invalidateAll() {
    // 不支持批量扫描时 fallback 清全库
    await this.adapter.clear();
  }
}

/**
 * 创建缓存层（自动检测 Redis）
 * @param {{ redisUrl?: string, redis?: object, logger?: object }} [opts]
 * @returns {Promise<{ cache: import('./adapter').CacheAdapter, rules: RuleCache, features: FeatureCache }>}
 */
async function createCacheLayer(opts = {}) {
  const adapter = await createCacheAdapter(opts);
  return {
    cache: adapter,
    rules: new RuleCache(adapter, opts.logger || defaultLogger),
    features: new FeatureCache(adapter, opts.logger || defaultLogger),
  };
}

module.exports = {
  createCacheLayer,
  RuleCache,
  FeatureCache,
  RULE_CACHE_TTL_MS,
  FEATURE_CACHE_TTL_MS,
};