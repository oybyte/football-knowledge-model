// ============================================================================
// 规则存储服务 · 入口 —— 整合 store + stateMachine + lockManager + migrate
// 对外暴露：RuleStore、StateMachine、LockManager、原型迁移、查询接口
// ============================================================================
'use strict';

const { RuleStore, ImmutableError } = require('./store');
const { StateMachine, IllegalTransitionError, PreconditionError } = require('./stateMachine');
const { LockManager, DEFAULT_TIMEOUT_MS, DEFAULT_HEARTBEAT_MS } = require('./lockManager');
const { loadPrototypeRules } = require('./migrate');
const {
  RULE_STATUSES,
  CATEGORIES,
  DIRECTIONS,
  LEGAL_TRANSITIONS,
  isLegalTransition,
  checkPrecondition,
  validateRuleVersion,
} = require('./schema');

// 单例（阶段 1 内存实例）
const store = new RuleStore();
const lockManager = new LockManager();
const stateMachine = new StateMachine({ store, lockManager });

let _seeded = false;

/** 初始化：迁移原型 16 条规则到存储 */
function seed() {
  if (_seeded) return;
  _seeded = true;
  for (const v of loadPrototypeRules()) {
    store.insert(v);
  }
}

/**
 * 获取活跃规则（status = active）。
 * 首次调用自动 seed。
 * @returns {Object[]}
 */
function getActiveRules() {
  if (!_seeded) seed();
  return store.getActive();
}

/**
 * 获取规则所有版本。
 * @param {string} ruleId
 * @returns {Object[]}
 */
function getRuleVersions(ruleId) {
  if (!_seeded) seed();
  return store.getByRuleId(ruleId);
}

module.exports = {
  // 单例
  store,
  lockManager,
  stateMachine,
  // 类
  RuleStore,
  StateMachine,
  LockManager,
  ImmutableError,
  IllegalTransitionError,
  PreconditionError,
  // 迁移
  loadPrototypeRules,
  seed,
  getActiveRules,
  getRuleVersions,
  // schema
  RULE_STATUSES,
  CATEGORIES,
  DIRECTIONS,
  LEGAL_TRANSITIONS,
  isLegalTransition,
  checkPrecondition,
  validateRuleVersion,
  // 常量
  DEFAULT_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_MS,
};
