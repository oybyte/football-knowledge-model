// ============================================================================
// V9.7 引擎 · run —— 规则运行器（atom → effects → 维度）
//
// 规则级状态由 atom 级汇聚，优先级：hit > insufficient_data > miss
//   有 atom 命中       → hit（输出 effects）
//   否则有 atom 无结论 → insufficient_data（不出结论，留痕缺失字段）
//   否则               → miss（真实不适用）
// ============================================================================
'use strict';

const { evaluateAtom, STATUS } = require('./evaluate');
const { adaptMatch } = require('../../features/adapt');

/**
 * 归一化为引擎可消费的规则形态。
 *
 * 兼容两种输入：
 *  ① registry 原始规则：{ id, name, category, type, atoms: [...] }
 *  ② 内部 RuleVersion（v97loader 产物）：{ rule_id, rule_type, condition, v97: <原始规则> }
 *
 * **必须兼容**：RuleVersion 上没有 atoms（在 v97 里）。若只认 rule.atoms，
 * 会静默取到空数组并把所有规则判成 miss——不报错、无日志，是极危险的错配。
 *
 * @param {Object} rule
 * @returns {{id:string, name:string, category:string, type:string, atoms:Array}}
 */
function normalizeRule(rule) {
  if (!rule) return { id: null, name: null, category: null, type: null, atoms: [] };
  const raw = rule.atoms ? rule : (rule.v97 || {});
  return {
    id: rule.rule_id || rule.id || null,
    name: rule.name || raw.name || null,
    category: rule.category || raw.category || null,
    type: rule.rule_type || rule.type || raw.type || null,
    atoms: raw.atoms || [],
  };
}

/**
 * 跑单条 V9.7 规则。
 * @param {Object} rule V9.7 规则对象（registry 原始规则或 RuleVersion 均可）
 * @param {{markets:Object, match?:Object, t?:string}} ctx
 * @returns {{rule_id:string, name:string, category:string, type:string,
 *            status:string, atoms:Array, effects:Array, dimensions:Object,
 *            missing:string[]}}
 */
function runRule(rule, ctx) {
  const norm = normalizeRule(rule);
  const atoms = norm.atoms.map((a) => evaluateAtom(a, ctx));
  const hitAtoms = atoms.filter((a) => a.status === STATUS.HIT);
  const insuffAtoms = atoms.filter((a) => a.status === STATUS.INSUFFICIENT);

  // 规则无任何 atom：多半是形态错配（如误传 RuleVersion），必须报无结论而非 miss
  const status = hitAtoms.length
    ? STATUS.HIT
    : (insuffAtoms.length || norm.atoms.length === 0)
      ? STATUS.INSUFFICIENT
      : STATUS.MISS;

  // 汇聚 effects 到维度（同维度多 atom 命中时保留全部取值，交由上层仲裁）
  const effects = hitAtoms.flatMap((a) => a.effects);
  const dimensions = {};
  for (const e of effects) {
    if (!(e.dimension in dimensions)) dimensions[e.dimension] = [];
    dimensions[e.dimension].push(e.value);
  }

  return {
    rule_id: norm.id,
    name: norm.name,
    category: norm.category,
    type: norm.type,
    status,
    atoms,
    effects,
    dimensions,
    missing: [...new Set(atoms.flatMap((a) => a.missing))],
    no_atoms: norm.atoms.length === 0, // 形态错配的显式信号
  };
}

/**
 * 批量跑规则。
 * @param {Object[]} rules
 * @param {{markets:Object, match?:Object, t?:string}} ctx
 */
function runRules(rules, ctx) {
  return (rules || []).map((r) => runRule(r, ctx));
}

/**
 * 便捷入口：直接吃 MatchSchema 比赛对象（内部完成 adaptMatch）。
 * @param {import('../../data/schema').MatchSchema} match
 * @param {Object[]} rules
 * @param {string} t 分析时点（ISO 8601）
 */
function evaluateMatch(match, rules, t) {
  const { markets, filtered_out } = adaptMatch(match, t);
  const ctx = { markets, match, t };
  const results = runRules(rules, ctx);
  return { match_id: match.match_id, t, filtered_out, results, ctx };
}

module.exports = { runRule, runRules, evaluateMatch, normalizeRule, STATUS };
