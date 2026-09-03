// ============================================================================
// 融合决策层 · v97 输入适配 —— 让 V9.7 真规则结果进入融合链
//
// 背景（2026-09-03 系统审视结论）：融合层（fusion/）已实现且已接线，但 V9.7 真规则
// 的结果此前只作为 `v97` 块旁路输出，融合层的 rule 流仍吃旧 DSL → 空转（prediction=null）。
//
// 本模块把 v97 命中结果适配为融合层的 rule 流输入：
//   · 方向：仅 direction/signal_direction 等「方向型维度」能产出 favor_upper/favor_lower/draw；
//     其余维度（gate/weight/signal/classification/total_goals_signal…）**不构成让球方向**，
//     没有方向型维度时 direction=null（融合层判「弃判」），绝不臆造方向。
//   · 置信度：取命中规则 base_confidence 均值 × 未回测折扣（V9.7 全为 provisional）。
//   · 信任：规则流按可参与合成处理，但置信度已折价 + evidence 留痕 provisional 身份。
//   · 维度结论：总进球/权重/门禁等维度原样透出，供四维框架分维度消费。
// ============================================================================
'use strict';

const { fuseDecision } = require('./index');

/** 能产出「让球方向」的维度（其余维度为非方向信号）。 */
const DIRECTION_DIMS = ['direction', 'signal_direction', 'handicap_direction', 'wdl_direction'];

/** 未回测转正（provisional）的置信度折扣。 */
const PROVISIONAL_DISCOUNT = 0.8;
/** 命中规则缺省 base_confidence（规则未标注时的保守值）。 */
const DEFAULT_RULE_CONFIDENCE = 0.6;

/**
 * V9.7 维度取值 → 融合层方向枚举。
 * @param {string[]} values 维度取值（中文或英文）
 * @returns {'favor_upper'|'favor_lower'|'draw'|'warning'|null}
 */
function mapDirection(values) {
  const blob = (values || []).join('、');
  if (!blob) return null;
  if (/上盘|让球方|主让|favor_upper/i.test(blob)) return 'favor_upper';
  if (/下盘|受让|客让|favor_lower/i.test(blob)) return 'favor_lower';
  if (/^平|平局|走盘|\bdraw\b/i.test(blob)) return 'draw';
  if (/弃判|风险|警告|异常|warning/i.test(blob)) return 'warning';
  return null;
}

/** 汇总所有命中规则的维度：dimension → 取值数组。 */
function aggregateDimensions(hits) {
  const dims = {};
  for (const h of hits) {
    for (const [k, vals] of Object.entries(h.dimensions || {})) {
      dims[k] = (dims[k] || []).concat(vals || []);
    }
  }
  return dims;
}

/**
 * v97 结果 → 融合层 rule 流输入。
 * @param {Object} p
 * @param {Object|null} p.v97 merged/analysis 的 v97 块（含 rules/fields）
 * @param {Object[]} [p.rules] 规则版本列表（取 base_confidence）
 * @returns {Object|null} rule 流输入（无命中时返回 null）
 */
function v97ToRuleOutput({ v97 = null, rules = [] } = {}) {
  if (!v97 || !Array.isArray(v97.rules)) return null;
  const hits = v97.rules.filter((r) => r.status === 'hit');
  if (!hits.length) return null;

  const dims = aggregateDimensions(hits);
  let direction = null;
  for (const d of DIRECTION_DIMS) {
    if (dims[d]) {
      direction = mapDirection(dims[d]);
      if (direction) break;
    }
  }

  const confById = new Map();
  for (const r of rules || []) {
    const id = r.rule_id || (r.v97 && r.v97.id) || r.id;
    if (id && typeof r.base_confidence === 'number') confById.set(id, r.base_confidence);
  }
  const confs = hits.map((h) => (confById.has(h.rule_id) ? confById.get(h.rule_id) : DEFAULT_RULE_CONFIDENCE));
  const avg = confs.reduce((a, b) => a + b, 0) / confs.length;
  const confidence = Math.min(1, Math.max(0, +(avg * PROVISIONAL_DISCOUNT).toFixed(4)));

  const fields = v97.fields || [];
  const usableFields = fields.filter((f) => f.status !== 'insufficient_data').length;

  return {
    direction,
    confidence,
    // 规则流参与合成（V9.7 为在用规则集）；provisional 身份已在置信度折价 + evidence 留痕
    trust: 'trusted',
    match_type: 'v97_atoms',
    rule_version_id: hits.map((h) => h.rule_id).join(','),
    evidence: {
      source: 'v97',
      hit_rule_ids: hits.map((h) => h.rule_id),
      hit_count: hits.length,
      dimensions: dims,
      non_direction_dims: Object.keys(dims).filter((d) => !DIRECTION_DIMS.includes(d)),
      field_coverage: `${usableFields}/${fields.length}`,
      trust_note: 'V9.7 规则均为 provisional（未回测转正），置信度已按未回测折价',
    },
  };
}

/**
 * 执行一次「V9.7 → 融合」决策。
 * @param {Object} p
 * @param {string} p.match_id
 * @param {Object|null} p.v97 v97 块
 * @param {Object[]} [p.rules] 规则版本列表
 * @param {Object} [p.context] 透传 fusion context
 * @param {string} [p.created_by]
 * @returns {{ decision: Object, rule_output: Object|null, dimensions: Object, note: string }}
 */
function fuseV97Decision({ match_id, v97 = null, rules = [], context = {}, created_by = 'fusion:v97' } = {}) {
  const ruleOutput = v97ToRuleOutput({ v97, rules });
  const dims = v97 ? aggregateDimensions(v97.rules.filter((r) => r.status === 'hit')) : {};
  const decision = fuseDecision({
    match_id,
    rule_output: ruleOutput,
    model_output: null,   // 统计模型：placeholder，未转正 → 融合层按 untrusted 排除
    anomaly_output: null, // 异常检测：placeholder，同上
    context,
    created_by,
  });
  const note = ruleOutput
    ? (ruleOutput.direction
      ? 'V9.7 命中规则含方向型维度 → 参与方向融合'
      : 'V9.7 命中规则无方向型维度（仅门禁/权重/信号）→ 方向弃判，维度结论见 dimensions')
    : 'V9.7 无规则命中 → 融合层无输入，方向弃判';
  return { decision, rule_output: ruleOutput, dimensions: dims, note };
}

module.exports = {
  fuseV97Decision,
  v97ToRuleOutput,
  mapDirection,
  aggregateDimensions,
  DIRECTION_DIMS,
  PROVISIONAL_DISCOUNT,
};
