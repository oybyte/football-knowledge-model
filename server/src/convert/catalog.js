// ============================================================================
// 文字规则 → DSL · catalog —— 规则清单 + DSL 映射（已废弃 / Mock 清空）
//
// 历史：本文件曾盘点一批手写文字规则（IDR/ODC/RST/KLI/VOL/SBL/EOC/LGD 等），
//       映射为 ConditionDSL 作为原型阶段的独立规则集。
// 现状：真实规则源已切换为 V9.7 registry（server/src/rules/v97loader.js），
//       本 catalog 的 Mock 条目已清空（TEXT_RULES = []），仅保留接口壳，
//       避免遗留 Mock 与 V9.7 真规则并存造成数据污染。
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
// 真实规则源已切换为 V9.7 registry；本 catalog 的 Mock 条目已清空，仅保留接口壳。
const TEXT_RULES = Object.freeze([]);

/** 深拷贝清单（避免调用方污染不可变条目） */
function listCatalog() {
  return TEXT_RULES.map((r) => JSON.parse(JSON.stringify(r)));
}

module.exports = { TEXT_RULES, listCatalog };