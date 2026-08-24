// ============================================================================
// 文字规则 → DSL · catalog —— 规则清单 + DSL 映射
// 阶段 2.1：盘点积累的文字规则，映射为可入库的 ConditionDSL（draft / untrusted）。
// 每条规则含：编号 / 原文 / 要素拆解 / category / direction / conclusion / DSL 条件。
// 字段名与算子严格对齐 1.4 DSL 字段注册表（23 特征字段 + 2 match 元字段）。
// ============================================================================
'use strict';

// 原子条件快捷构造（weight 置于条件上，与 migrate.js 一致）
function a(field, op, value, extra = {}) {
  return { type: 'ATOMIC', field, op, value, ...extra };
}
function and(...conditions) {
  return { type: 'AND', conditions };
}
function or(...conditions) {
  return { type: 'OR', conditions };
}

/**
 * 规则条目：
 *   original    文字规则原文
 *   decomposed  要素拆解（字段要素 / 市场环境 / 阈值 / 方向判定）
 *   category    odds_change | institution_diff | sensitivity | league_feature
 *   direction   favor_upper | favor_lower | warning | follow
 *   condition   DSL 条件树（必须通过 DslEngine.compile）
 *   conclusion  入库结论文本
 */
const TEXT_RULES = Object.freeze([
  Object.freeze({
    id: 'IDR001',
    original: '澳门初盘让球比其他机构开盘均值深 0.25 球以上，庄家看好下盘',
    decomposed: ['澳门初盘-其余机构初盘均值 ≤ -0.25', '深让方向 → 看好下盘'],
    category: 'institution_diff',
    direction: 'favor_lower',
    base_confidence: 0.62,
    priority: 70,
    condition: a('$match.handicap.macau.initial.line - $match.handicap.avg_others.initial.line', 'LTE', -0.25),
    conclusion: '澳门初盘比其余机构均值深 0.25 球以上，倾向下盘',
  }),
  Object.freeze({
    id: 'IDR002',
    original: '机构间主流盘口让球极差超过 1 球，市场对强弱判断严重分歧',
    decomposed: ['机构让球极差(institution.diff_max) ≥ 1 球', '分歧放大 → 谨慎/警示'],
    category: 'institution_diff',
    direction: 'warning',
    base_confidence: 0.5,
    priority: 55,
    condition: a('institution.diff_max', 'GTE', 1.0),
    conclusion: '机构间让球极差 1 球以上，判断严重分歧，提示风险',
  }),
  Object.freeze({
    id: 'ODC001',
    original: '盘口走势为升盘降水，水位持续向主队倾斜，看好上盘',
    decomposed: ['move_pattern = 升盘降水', '主队盘口向上 → 看好上盘'],
    category: 'odds_change',
    direction: 'favor_upper',
    base_confidence: 0.6,
    priority: 65,
    condition: a('move_pattern', 'EQ', '升盘降水'),
    conclusion: '盘口走势为升盘降水，看好上盘',
  }),
  Object.freeze({
    id: 'ODC002',
    original: '盘口走势为降盘升水，主力资金撤出主队，倾向下盘',
    decomposed: ['move_pattern = 降盘升水', '主队盘口向下 → 倾向下盘'],
    category: 'odds_change',
    direction: 'favor_lower',
    base_confidence: 0.6,
    priority: 65,
    condition: a('move_pattern', 'EQ', '降盘升水'),
    conclusion: '盘口走势为降盘升水，倾向下盘',
  }),
  Object.freeze({
    id: 'ODC003',
    original: '各机构上盘水位离散度达到 0.15 以上，机构定价不一致，提示冷门风险',
    decomposed: ['上盘水位离散度(water.upper.dispersion) ≥ 0.15', '机构定价分歧 → 警示'],
    category: 'institution_diff',
    direction: 'warning',
    base_confidence: 0.52,
    priority: 58,
    condition: a('water.upper.dispersion', 'GTE', 0.15),
    conclusion: '机构间主水离散度 0.15 以上，提示冷门风险',
  }),
  Object.freeze({
    id: 'RST001',
    original: '三家以上机构同向调整让球盘口，跟随共振方向操作',
    decomposed: ['同向调盘机构数(institution.sync_count) ≥ 3', '共振成立 → 跟随方向'],
    category: 'institution_diff',
    direction: 'follow',
    base_confidence: 0.58,
    priority: 60,
    condition: a('institution.sync_count', 'GTE', 3),
    conclusion: '同向调盘机构 3 家以上，跟随共振方向',
  }),
  Object.freeze({
    id: 'KLI001',
    original: '凯利指数最大值达到 1.05 以上或最小值跌破 0.90，市场分歧明显',
    decomposed: ['凯利最大值 ≥ 1.05 或 凯利最小值 ≤ 0.90', '任一侧触发 → 分歧警示'],
    category: 'sensitivity',
    direction: 'warning',
    base_confidence: 0.5,
    priority: 60,
    condition: or(a('kelly_index.max', 'GTE', 1.05), a('kelly_index.min', 'LTE', 0.90)),
    conclusion: '凯利指数背离（max≥1.05 或 min≤0.90），市场分歧明显',
  }),
  Object.freeze({
    id: 'VOL001',
    original: '成交量比均值放大到 2.5 倍以上，资金异常涌入',
    decomposed: ['量比(volume.ratio) ≥ 2.5', '放量 → 异常波动警示'],
    category: 'sensitivity',
    direction: 'warning',
    base_confidence: 0.55,
    priority: 62,
    condition: a('volume.ratio', 'GTE', 2.5),
    conclusion: '量比均值 2.5x 以上，资金异常涌入',
  }),
  Object.freeze({
    id: 'SBL001',
    original: '必发主导资金占比超 45% 且热度绝对值超过 50，资金过度集中于单一方向',
    decomposed: ['必发主导占比(betfair.dominant_ratio) > 0.45', '热度绝对值(betfair.heat) > 50', '双条件同时满足'],
    category: 'sensitivity',
    direction: 'warning',
    base_confidence: 0.53,
    priority: 55,
    condition: and(a('betfair.dominant_ratio', 'GT', 0.45), a('betfair.heat', 'ABS_GT', 50)),
    conclusion: '必发资金过度集中且热度异常',
  }),
  Object.freeze({
    id: 'EOC001',
    original: '欧指主胜凯利指数最大值达到 0.98 以上，主胜赔率价值被吃透',
    decomposed: ['欧指主胜凯利(kelly_index.home_max) ≥ 0.98', '主胜无套利空间 → 提示'],
    category: 'sensitivity',
    direction: 'warning',
    base_confidence: 0.5,
    priority: 50,
    condition: a('kelly_index.home_max', 'GTE', 0.98),
    conclusion: '欧指主胜凯利最大值 0.98 以上，主胜价值吃透',
  }),
  Object.freeze({
    id: 'LGD001',
    original: '比赛属于小球联赛（法乙）且各机构上盘水位离散度高，倾向下盘',
    decomposed: ['match.league = 法乙', '上盘水位离散度(water.upper.dispersion) ≥ 0.12', '小球联赛 + 离散 → 下盘'],
    category: 'league_feature',
    direction: 'favor_lower',
    base_confidence: 0.57,
    priority: 55,
    condition: and(a('match.league', 'EQ', '法乙'), a('water.upper.dispersion', 'GTE', 0.12)),
    conclusion: '法乙小球联赛且主水离散高，倾向下盘',
  }),
  Object.freeze({
    id: 'ODC004',
    original: '盘口全程冻结（水位稳定）且主水下调节点达到 2 家以上，看好上盘',
    decomposed: ['stability_flag = true', '主水下调节点数(water.upper.drop_count) ≥ 2', '冻结 + 主水下调 → 上盘'],
    category: 'odds_change',
    direction: 'favor_upper',
    base_confidence: 0.6,
    priority: 62,
    condition: and(a('stability_flag', 'EQ', true), a('water.upper.drop_count', 'GTE', 2)),
    conclusion: '盘口冻结且主水下调机构 2 家以上，看好上盘',
  }),
  Object.freeze({
    id: 'ODC005',
    original: '盘口全程冻结（水位稳定）但主水上调节点达 2 家以上，诱上盘风险，倾向下盘',
    decomposed: ['stability_flag = true', '主水上调节点数(water.upper.rise_count) ≥ 2', '冻结 + 主水上调 → 诱上，偏下'],
    category: 'odds_change',
    direction: 'favor_lower',
    base_confidence: 0.6,
    priority: 62,
    condition: and(a('stability_flag', 'EQ', true), a('water.upper.rise_count', 'GTE', 2)),
    conclusion: '盘口冻结但主水上调机构 2 家以上，诱上盘风险，倾向下盘',
  }),
  Object.freeze({
    id: 'ODC006',
    original: '距离开赛不足 180 分钟且让球盘波动剧烈，临场方向未定型，谨慎对待',
    decomposed: ['距开赛时间(time_to_match) ≤ 180 分钟', '波动率(odds.volatility) ≥ 3.0', '临场未定型 → 谨慎警示'],
    category: 'odds_change',
    direction: 'warning',
    base_confidence: 0.48,
    priority: 45,
    condition: and(
      a('time_to_match', 'LTE', 180, { weight: 0.6 }),
      a('odds.volatility', 'GTE', 3.0, { weight: 0.4 }),
    ),
    conclusion: '临场 180 分钟内波动剧烈，方向未定型，谨慎对待',
  }),
  Object.freeze({
    id: 'VOL002',
    original: '必发市场换手量超过 5000 万且主导资金占比超 50%，巨额资金押注单一方向',
    decomposed: ['必发换手(betfair.turnover) ≥ 50000000', '主导占比(betfair.dominant_ratio) > 0.5', '巨额集中押注 → 警示'],
    category: 'sensitivity',
    direction: 'warning',
    base_confidence: 0.52,
    priority: 54,
    condition: and(a('betfair.turnover', 'GTE', 50000000), a('betfair.dominant_ratio', 'GT', 0.5)),
    conclusion: '必发换手过亿且主导资金占比过半，巨额押注警示',
  }),
]);

/** 深拷贝清单（避免调用方污染不可变条目） */
function listCatalog() {
  return TEXT_RULES.map((r) => JSON.parse(JSON.stringify(r)));
}

module.exports = { TEXT_RULES, listCatalog };