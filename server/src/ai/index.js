// ============================================================================
// AI 引擎 · 入口 —— provider + mining + interpretation + review 聚合
// 阶段 2.4。信任边界：全部输出 untrusted，仅隔离区运行，不入融合决策层。
// 凭证隔离：API Key 一律经 providers 从环境变量读取，本模块无数据源凭证访问权。
// ============================================================================
'use strict';

const providers = require('./providers');
const { mineCandidates } = require('./mining');
const { interpretMatch, buildSignals } = require('./interpretation');
const { escalateToProposed, buildConclusion } = require('./review');
const {
  AI_TRUST,
  CANDIDATE_STATUS,
  AI_ACCESS_ISOLATED,
  stampUntrusted,
  isUntrusted,
} = require('./containment');
const { validateCandidate, toCondition } = require('./schema');

// 冻结隔离面：AI 引擎可引用的下游能力清单（仅供审计/文档）。
Object.freeze(AI_ACCESS_ISOLATED);

module.exports = {
  providers,
  // 规则挖掘
  mineCandidates,
  // 单场解读
  interpretMatch,
  buildSignals,
  // 审核转正
  escalateToProposed,
  buildConclusion,
  // 候选 schema / DSL
  validateCandidate,
  toCondition,
  // 信任边界
  containment: { AI_TRUST, CANDIDATE_STATUS, AI_ACCESS_ISOLATED, stampUntrusted, isUntrusted },
};