// ============================================================================
// AI 引擎 · containment —— AI 输出信任边界
// 原则（architecture + project_memory）：
//   AI/model 输出一律 untrusted，仅隔离区运行，不入融合决策层。
// 本模块是 AI 输出的「盖章」与「边界」约束，禁止绕过。
// ============================================================================
'use strict';

/** AI 输出的固定信任级别（不可覆盖为 trusted）。 */
const AI_TRUST = 'untrusted';

/** AI 候选状态：未审核、未进入规则生命周期。 */
const CANDIDATE_STATUS = 'candidate';

/** AI 引擎允许引用的下游能力（隔离面）。 */
const AI_ACCESS_ISOLATED = Object.freeze([
  'dsl:compile',        // 校验候选 DSL 合法（只读校验，不改数据）
  'features:compute',   // 读取特征快照（只读）
  'rules:store',        // 审核通过后经 review 写出一条 proposed 规则
]);

/**
 * 为 AI 产物盖章：强制 untrusted + candidate 状态，防止误入正式链。
 * 任何调用方不得传入已存在的 trust/status 覆盖。
 * @param {Object} obj
 * @returns {Object} 盖章后的冻结副本
 */
function stampUntrusted(obj) {
  const stamped = {
    ...obj,
    trust: AI_TRUST,
    candidate_status: obj.candidate_status || CANDIDATE_STATUS,
    __ai_boundary: true,
  };
  delete stamped.status; // AI 产物不带规则生命周期状态
  return Object.freeze(stamped);
}

/**
 * 审核转正确认：检查该候选是否仍保持 AI 边界。
 * @param {Object} candidate
 * @returns {boolean}
 */
function isUntrusted(candidate) {
  return !!candidate && candidate.trust === AI_TRUST && candidate.__ai_boundary === true;
}

module.exports = { AI_TRUST, CANDIDATE_STATUS, AI_ACCESS_ISOLATED, stampUntrusted, isUntrusted };