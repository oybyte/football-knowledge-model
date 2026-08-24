// ============================================================================
// 检索 Worker · arbitrate —— 三层仲裁（优先级 / 置信度加权 / 冲突裁决 + 人工复核）
// 对齐 architecture §7。综合分 = (priority/100)·confidence 归一化 [0,1]，
// 使「分差 < 0.1 → 人工复核」阈值语义成立。
// ============================================================================
'use strict';

const { detectConflicts, isConflicting } = require('./conflict');

const REVIEW_DIFF = 0.1;

/** @param {number} priority @param {number} confidence @returns {number} */
function computeScore(priority, confidence) {
  const p = typeof priority === 'number' && Number.isFinite(priority) ? priority : 1;
  const c = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0;
  return (p / 100) * c;
}

/**
 * 无冲突结果容器。
 * @returns {Object}
 */
function emptyArbitration() {
  return {
    direction: null,
    confidence: 0,
    dominant_rule_version_id: null,
    manual_review_required: false,
    review_note: null,
    conflict_groups: [],
    groups: [],
  };
}

/**
 * 三层仲裁。
 * @param {Object[]} hits Hit[]
 * @returns {Object} Arbitration
 */
function arbitrate(hits) {
  if (!hits || hits.length === 0) return emptyArbitration();

  // 按方向分组（方向 = 规则 direction）
  const map = new Map();
  for (const h of hits) {
    const d = h.direction;
    if (d === null) continue;
    if (!map.has(d)) map.set(d, { direction: d, score: 0, confNum: 0, confDen: 0, rules: [] });
    const g = map.get(d);
    const s = computeScore(h.rule.priority, h.confidence);
    g.score += s;
    g.confNum += (h.rule.priority || 1) * h.confidence;
    g.confDen += h.rule.priority || 1;
    g.rules.push({ rule_id: h.rule.rule_id, version_id: h.rule.version_id, score: s });
  }
  const groups = [...map.values()].map((g) => ({
    direction: g.direction,
    score: Math.round(g.score * 1e6) / 1e6,
    confidence: g.confDen > 0 ? Math.round((g.confNum / g.confDen) * 1e3) / 1e3 : 0,
    rules: g.rules.sort((a, b) => b.score - a.score),
  })).sort((a, b) => b.score - a.score);

  if (groups.length === 0) return emptyArbitration();

  const conflicts = detectConflicts(hits);
  const top1 = groups[0];
  const top2 = groups[1] || null;

  let manual = false;
  let reviewNote = null;
  let direction = top1.direction;
  let confidence = top1.confidence;

  // 三层：冲突仲裁 —— 冲突双方分差 < 0.1 → 人工复核
  if (conflicts.length && top2 && isConflicting(top1.direction, top2.direction)) {
    const diff = Math.abs(top1.score - top2.score);
    if (diff < REVIEW_DIFF) {
      manual = true;
      reviewNote = `conflict_score_diff=${diff.toFixed(4)}<${REVIEW_DIFF} needs manual review`;
      direction = null;
      confidence = 0;
    }
    // 否则高分胜出（默认 direction = top1）
  }
  // 无冲突 / 冲突但分差足够：L1 优先级 + L2 置信度加权已体现在 top1.confidence

  return {
    direction,
    confidence,
    dominant_rule_version_id: top1.rules[0].version_id,
    manual_review_required: manual,
    review_note: reviewNote,
    conflict_groups: conflicts,
    groups,
  };
}

module.exports = { arbitrate, computeScore, emptyArbitration, REVIEW_DIFF };