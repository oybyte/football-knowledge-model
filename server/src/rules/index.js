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

// 单例（阶段 1 内存实例；持久化场景可用 createRuleService 注入 SqliteRuleStore）
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

/**
 * 装配规则服务（store 可注入，持久化场景传 SqliteRuleStore）。
 * @param {Object} [opts]
 * @param {Object} [opts.store] 实现 RuleStore 接口的存储
 * @param {Object} [opts.lockManager]
 * @returns {{ store, lockManager, stateMachine, seed, getActiveRules, getRuleVersions }}
 */
function createRuleService({ store: injectedStore, lockManager: injectedLock } = {}) {
  const s = injectedStore || new RuleStore();
  const lm = injectedLock || new LockManager();
  const sm = new StateMachine({ store: s, lockManager: lm });
  let seeded = false;
  function seedService() {
    if (seeded) return;
    seeded = true;
    for (const v of loadPrototypeRules()) s.insert(v);
  }
  function active() { if (!seeded) seedService(); return s.getActive(); }
  function versions(ruleId) { if (!seeded) seedService(); return s.getByRuleId(ruleId); }
  return { store: s, lockManager: lm, stateMachine: sm, seed: seedService, getActiveRules: active, getRuleVersions: versions };
}

module.exports = {
  // 单例
  store,
  lockManager,
  stateMachine,
  // 工厂（持久化注入）
  createRuleService,
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
