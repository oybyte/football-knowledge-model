// ============================================================================
// 文字规则 → DSL · 入口
// 对外暴露：规则清单 + DSL 映射 + 编译校验 + 入库脚本。
// ============================================================================
'use strict';

const { TEXT_RULES, listCatalog } = require('./catalog');
const { buildRuleVersion, compileAll, ingest, BASE_TIME, MIGRATOR } = require('./text2dsl');

module.exports = {
  // 规则清单 + DSL 映射
  TEXT_RULES,
  listCatalog,
  // 转换 + 校验 + 入库
  buildRuleVersion,
  compileAll,
  ingest,
  // 常量
  BASE_TIME,
  MIGRATOR,
};