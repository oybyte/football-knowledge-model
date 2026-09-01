// ============================================================================
// V9.7 引擎 · index —— 模块出口（垂直切片）
//
// 当前覆盖范围（刻意做窄，用于端到端验证架构）：
//   已实现字段 5 个：handicap_depth_band / handicap_depth / water_level
//                    core_bookmaker_count / kelly_range
//   已实现算子 8 个：eq ne gte lte gt lt in exists（custom 未实现 → insufficient_data）
//   可完整求值的规则：R13（深盘超高水分级）
//   R01 需要 kelly_range —— 已实现，但源数据无让球盘凯利，走派生估算
//
// 未覆盖的 203 个字段一律返回 insufficient_data，规则因此「不出结论」而非乱判。
// ============================================================================
'use strict';

const envelope = require('./envelope');
const handicap = require('./handicap');
const fields = require('./fields');
const ops = require('./ops');
const evaluate = require('./evaluate');
const run = require('./run');

module.exports = {
  envelope,
  handicap,
  fields,
  ops,
  evaluate,
  run,
  // 常用快捷
  getField: fields.getField,
  listFields: fields.listFields,
  runRule: run.runRule,
  runRules: run.runRules,
  evaluateMatch: run.evaluateMatch,
  STATUS: run.STATUS,
};
