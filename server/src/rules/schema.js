// ============================================================================
// 规则存储服务 · schema —— RuleVersion 类型定义 + 状态机配置
// 对齐 G12 qd_rule_versions 表（§3.6）与 G9 dsl-syntax ConditionJSON（§6）
// 状态机：8 态 + 合法转换矩阵 + 前置条件
// ============================================================================
'use strict';

const RULE_STATUSES = Object.freeze([
  'draft', 'proposed', 'experiment', 'validated', 'approved', 'active', 'superseded', 'deprecated',
]);

// 原型 4 类（英文，向后兼容）；V9.7 registry 中文分类作为派生索引列（完整内容在 payload.v97）。
const CATEGORIES = Object.freeze([
  'odds_change', 'institution_diff', 'sensitivity', 'league_feature',
  '盘性', '让球盘', '总进球', '联赛专属', '平局冷门', '执行复盘', '执行规范', '杯赛专项', '杯赛专项（总进球）',
]);
// 原型 6 方向（英文）；V9.7 无单一方向语义，标量列仅作粗粒度角色标签（真实方向在 payload.v97.effects，Phase 2 引擎消费）。
const DIRECTIONS = Object.freeze([
  'favor_upper', 'favor_lower', 'reversal', 'warning', 'follow', 'favor_home',
  'rule', 'execution', 'signal',
]);
const TRUST_LEVELS = Object.freeze(['trusted', 'provisional', 'untrusted']);

/**
 * 合法状态转换矩阵。
 * key = from, value = Set<to>
 */
const LEGAL_TRANSITIONS = Object.freeze({
  draft: ['proposed', 'deprecated'],
  proposed: ['draft', 'experiment', 'deprecated'],
  experiment: ['proposed', 'validated', 'deprecated'],
  validated: ['experiment', 'approved', 'deprecated'],
  approved: ['validated', 'active', 'deprecated'],
  active: ['superseded', 'deprecated'],
  superseded: [],
  deprecated: [],
});

/**
 * 状态转换前置条件校验器。
 * 每个转换可定义一个校验函数，返回 { ok, reason }。
 * @param {Object} version 当前 RuleVersion
 * @param {string} toStatus 目标状态
 * @returns {{ ok: boolean, reason?: string }}
 */
function checkPrecondition(version, toStatus) {
  const checks = {
    'draft→proposed': () => {
      if (!version.condition) return { ok: false, reason: 'condition_required' };
      if (!version.conclusion) return { ok: false, reason: 'conclusion_required' };
      return { ok: true };
    },
    'proposed→experiment': () => {
      if (!version.approved_by) return { ok: false, reason: 'approver_required' };
      return { ok: true };
    },
    'experiment→validated': () => {
      if (!version.evidence_count || version.evidence_count < 1) return { ok: false, reason: 'evidence_required' };
      return { ok: true };
    },
    'validated→approved': () => {
      if (!version.approved_by) return { ok: false, reason: 'approver_required' };
      return { ok: true };
    },
    'approved→active': () => {
      if (version.valid_from && Date.parse(version.valid_from) > Date.now()) {
        return { ok: false, reason: 'valid_from_in_future' };
      }
      return { ok: true };
    },
    'active→superseded': () => {
      if (!version.successor_version_id) return { ok: false, reason: 'successor_required' };
      return { ok: true };
    },
  };
  const fn = checks[`${version.status}→${toStatus}`];
  return fn ? fn() : { ok: true };
}

/**
 * 校验转换合法性。
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function isLegalTransition(from, to) {
  const allowed = LEGAL_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * 验证 RuleVersion 必填字段。
 * @param {Object} v
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateRuleVersion(v) {
  const errors = [];
  if (!v || typeof v !== 'object') return { ok: false, errors: ['invalid_object'] };
  if (!v.version_id) errors.push('missing_version_id');
  if (!v.rule_id) errors.push('missing_rule_id');
  if (typeof v.version !== 'number' || v.version < 1) errors.push('invalid_version');
  if (!CATEGORIES.includes(v.category)) errors.push('invalid_category');
  if (!v.condition) errors.push('missing_condition');
  if (!v.conclusion) errors.push('missing_conclusion');
  if (!DIRECTIONS.includes(v.direction)) errors.push('invalid_direction');
  if (typeof v.base_confidence !== 'number' || v.base_confidence < 0 || v.base_confidence > 1) errors.push('invalid_base_confidence');
  if (typeof v.priority !== 'number' || v.priority < 1 || v.priority > 100) errors.push('invalid_priority');
  if (!TRUST_LEVELS.includes(v.trust_level)) errors.push('invalid_trust_level');
  if (!v.valid_from) errors.push('missing_valid_from');
  if (!RULE_STATUSES.includes(v.status)) errors.push('invalid_status');
  if (!v.created_at) errors.push('missing_created_at');
  if (!v.created_by) errors.push('missing_created_by');
  return { ok: errors.length === 0, errors };
}

module.exports = {
  RULE_STATUSES,
  CATEGORIES,
  DIRECTIONS,
  TRUST_LEVELS,
  LEGAL_TRANSITIONS,
  isLegalTransition,
  checkPrecondition,
  validateRuleVersion,
};
