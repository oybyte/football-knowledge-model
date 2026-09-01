// ============================================================================
// 规则存储服务 · migrate —— 原型规则加载（已切换为 V9.7 registry 真规则）
//
// 历史：本文件曾承载原型 16 条 Mock 规则（R001–R016，含 R006/R010 占位）。
// 现状：所有 Mock 数据已清空；真实规则源为 V9.7 registry（server/src/rules/v97loader.js）。
//        loadPrototypeRules() 现委托 v97loader 载入 V9.7 真规则，保持对外接口不变。
//        mkVersion 保留为通用 RuleVersion 构造器（不再用于构造 Mock）。
// ============================================================================
'use strict';

const { loadV97Rules } = require('./v97loader');

const BASE_TIME = '2026-08-14T00:00:00+08:00';
const MIGRATOR = 'migrate:v97-loader';

/**
 * 通用 RuleVersion 构造器（保留，供后续程序化构造规则版本复用）。
 * @param {string} ruleId
 * @param {Object} data
 * @returns {Object} RuleVersion
 */
function mkVersion(ruleId, data) {
  const validFrom = data.valid_from || BASE_TIME;
  return {
    version_id: `${ruleId}#1`,
    rule_id: ruleId,
    version: 1,
    category: data.category,
    rule_type: data.rule_type || null,
    league_scope: [],
    team_scope: [],
    condition: data.condition,
    conclusion: data.conclusion,
    direction: data.direction,
    base_confidence: data.base_confidence ?? 0.5,
    priority: data.priority ?? 50,
    trust_level: data.trust_level ?? 'provisional',
    valid_from: validFrom,
    valid_to: null,
    evidence_refs: [],
    evidence_count: data.evidence_count ?? 0,
    status: data.status || 'active',
    previous_version_id: null,
    created_at: validFrom,
    created_by: data.created_by || MIGRATOR,
    approved_at: null,
    approved_by: null,
    approval_note: null,
    superseded_at: null,
    deprecated_at: null,
    source: data.source || 'v97_registry',
    ...(data.v97 ? { v97: data.v97 } : {}),
  };
}

/**
 * 载入当前生效的全部 RuleVersion（V9.7 真规则）。
 * @returns {Object[]}
 */
function loadPrototypeRules() {
  return loadV97Rules().rules.map((v) => ({ ...v }));
}

module.exports = { loadPrototypeRules, mkVersion };
