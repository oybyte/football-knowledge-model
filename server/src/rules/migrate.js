// ============================================================================
// 规则存储服务 · migrate —— 原型 rules.js 16 条规则迁移为 RuleVersion
// 函数式 test(f) → ConditionDSL；direction 1/-1/0 → 语义枚举；
// family → category；占位规则标记 placeholder。
// 迁入 status=active（原型已在用），trust_level=provisional（未正式验证）。
// ============================================================================
'use strict';

const BASE_TIME = '2026-08-14T00:00:00+08:00';
const MIGRATOR = 'migrate:prototype-1.0.0';

/** @param {string} ruleId @param {Object} data @returns {Object} RuleVersion */
function mkVersion(ruleId, data) {
  return {
    version_id: `${ruleId}#1`,
    rule_id: ruleId,
    version: 1,
    category: data.category,
    league_scope: [],
    team_scope: [],
    condition: data.condition,
    conclusion: data.conclusion,
    direction: data.direction,
    base_confidence: data.base_confidence ?? 0.5,
    priority: data.priority ?? 50,
    trust_level: data.trust_level ?? 'provisional',
    valid_from: BASE_TIME,
    valid_to: null,
    evidence_refs: [],
    evidence_count: data.evidence_count ?? 0,
    status: 'active',
    previous_version_id: null,
    created_at: BASE_TIME,
    created_by: MIGRATOR,
    approved_at: null,
    approved_by: null,
    approval_note: null,
    superseded_at: null,
    deprecated_at: null,
  };
}

/** 原子条件快捷构造 */
function atomic(field, op, value, extra = {}) {
  return { type: 'ATOMIC', field, op, value, ...extra };
}

/** AND 逻辑 */
function and(...conditions) {
  return { type: 'AND', conditions };
}

/** OR 逻辑 */
function or(...conditions) {
  return { type: 'OR', conditions };
}

/** 永假条件（占位规则） */
const NEVER = atomic('time_to_match', 'GT', 999999);

const RULES_1_3 = [
  mkVersion('R001', {
    category: 'odds_change', direction: 'favor_upper',
    condition: atomic('move_pattern', 'EQ', '升盘降水'),
    conclusion: '盘口走势为升盘降水，看好上盘',
  }),
  mkVersion('R002', {
    category: 'odds_change', direction: 'favor_lower',
    condition: atomic('move_pattern', 'EQ', '降盘升水'),
    conclusion: '盘口走势为降盘升水，看好下盘',
  }),
  mkVersion('R003', {
    category: 'institution_diff', direction: 'favor_lower',
    condition: atomic('$match.handicap.macau.initial.line - $match.handicap.avg_others.initial.line', 'LTE', -0.25),
    conclusion: '澳门初盘比其余机构均值深 0.25 球以上',
  }),
  mkVersion('R004', {
    category: 'institution_diff', direction: 'follow',
    condition: atomic('institution.sync_count', 'GTE', 3),
    conclusion: '同向调盘机构 3 家以上，跟随共振方向',
  }),
  mkVersion('R005', {
    category: 'sensitivity', direction: 'warning',
    condition: atomic('volume.ratio', 'GTE', 2.5),
    conclusion: '量比均值 2.5x 以上，异常波动',
  }),
  mkVersion('R006', {
    category: 'league_feature', direction: 'warning',
    condition: NEVER,
    conclusion: '占位规则（用户尚未定义）',
    trust_level: 'untrusted',
    base_confidence: 0,
    priority: 1,
    evidence_count: 0,
  }),
  mkVersion('R007', {
    category: 'odds_change', direction: 'favor_upper',
    condition: and(
      atomic('stability_flag', 'EQ', true),
      atomic('move_pattern', 'EQ', '稳定'),
    ),
    conclusion: '盘口水位全程稳定，看好上盘',
  }),
  mkVersion('R008', {
    category: 'institution_diff', direction: 'warning',
    condition: atomic('water.upper.dispersion', 'GTE', 0.15),
    conclusion: '机构间主水离散度 0.15 以上',
  }),
  mkVersion('R009', {
    category: 'sensitivity', direction: 'warning',
    condition: or(
      atomic('kelly_index.max', 'GTE', 1.05),
      atomic('kelly_index.min', 'LTE', 0.90),
    ),
    conclusion: '凯利指数背离（max≥1.05 或 min≤0.90）',
  }),
  mkVersion('R010', {
    category: 'league_feature', direction: 'warning',
    condition: NEVER,
    conclusion: '占位规则（用户尚未定义）',
    trust_level: 'untrusted',
    base_confidence: 0,
    priority: 1,
    evidence_count: 0,
  }),
  mkVersion('R011', {
    category: 'odds_change', direction: 'favor_lower',
    condition: atomic('move_pattern', 'EQ', '升盘不降水'),
    conclusion: '升盘但主水未降，诱上盘风险',
  }),
  mkVersion('R012', {
    category: 'sensitivity', direction: 'warning',
    condition: atomic('volume.ratio', 'GTE', 2.5),
    conclusion: '成交量异常放量',
  }),
  mkVersion('R013', {
    category: 'odds_change', direction: 'favor_upper',
    condition: and(
      atomic('stability_flag', 'EQ', true),
      atomic('water.upper.drop_count', 'GTE', 2),
    ),
    conclusion: '盘口冻结，主水下调机构 2 家以上',
  }),
  mkVersion('R014', {
    category: 'odds_change', direction: 'favor_lower',
    condition: and(
      atomic('stability_flag', 'EQ', true),
      atomic('water.upper.rise_count', 'GTE', 2),
    ),
    conclusion: '盘口冻结，主水上调机构 2 家以上',
  }),
  mkVersion('R015', {
    category: 'sensitivity', direction: 'warning',
    condition: and(
      atomic('betfair.dominant_ratio', 'GT', 0.45),
      atomic('betfair.heat', 'ABS_GT', 50),
    ),
    conclusion: '必发资金过度集中且热度异常',
  }),
  mkVersion('R016', {
    category: 'sensitivity', direction: 'warning',
    condition: atomic('kelly_index.home_max', 'GTE', 0.98),
    conclusion: '欧指主胜凯利最大值 0.98 以上',
  }),
];

/** @returns {Object[]} 迁移后的全部 RuleVersion */
function loadPrototypeRules() {
  return RULES_1_3.map((v) => ({ ...v }));
}

module.exports = { loadPrototypeRules, RULES_1_3, mkVersion };
