// ============================================================================
// 融合决策层 · Containment 隔离 —— AI/模型/异常输出信任门
// 原则（architecture + project_memory）：untrusted 输出不得进入正式预测链。
// 骨架版：model/anomaly 强制 untrusted（未转正 placeholder）；仅当显式 trusted 且
// 带 evidence（已转正模型）才可信，保留阶段 3 扩展性。rule 为真实 DSL 输出。
// ============================================================================
'use strict';

const DIRECTIONS = ['favor_upper', 'favor_lower', 'warning', 'follow', null];

/**
 * 解析某一路最终信任级别。
 * @param {"rule"|"model"|"anomaly"} stream
 * @param {Object|null} input 该路输入（null/undefined 视为未触发）
 * @returns {"trusted"|"untrusted"}
 */
function resolveTrust(stream, input) {
  if (!input) return 'untrusted';
  if (stream === 'rule') {
    // 规则为真实 DSL 输出，除非调用方显式降级
    return input.trust === 'untrusted' ? 'untrusted' : 'trusted';
  }
  // model / anomaly：显式 trusted 且带证据（已转正）才可信，否则 untrusted
  return input.trust === 'trusted' && input.evidence ? 'trusted' : 'untrusted';
}

/**
 * 校验方向是否合法（含 null=无方向）。
 * @param {*} d
 * @returns {boolean}
 */
function isValidDirection(d) {
  return DIRECTIONS.includes(d);
}

/**
 * 校验置信度为有限数字且在 [0,1]。
 * @param {*} c
 * @returns {boolean}
 */
function isValidConfidence(c) {
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1;
}

/**
 * 输入门控：该路能否进入融合合成。
 * @param {Object} input 已解析输入的依赖字段
 * @param {Object} input.direction
 * @param {Object} input.confidence
 * @returns {{ allowed: boolean, reason?: string }}
 */
function gateCheck({ direction, confidence }) {
  if (!isValidDirection(direction)) return { allowed: false, reason: 'invalid_direction' };
  if (!isValidConfidence(confidence)) return { allowed: false, reason: 'invalid_confidence' };
  return { allowed: true };
}

module.exports = { resolveTrust, gateCheck, isValidDirection, isValidConfidence, DIRECTIONS };