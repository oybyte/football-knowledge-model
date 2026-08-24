// ============================================================================
// 检索 Worker · conflict —— CONFLICT_DIRECTIONS 冲突检测
// 对齐 architecture §7：同时命中且 direction 相反即冲突。
// ============================================================================
'use strict';

const CONFLICT_DIRECTIONS = Object.freeze({
  favor_upper: ['favor_lower', 'reversal'],
  favor_lower: ['favor_upper', 'reversal'],
  follow: ['reversal', 'caution'],
  reversal: ['favor_upper', 'favor_lower', 'follow'],
  favor_home: ['favor_lower'],
});

/**
 * 检测方向冲突分组（两两比较）。
 * @param {Object[]} hits Hit[]
 * @returns {Object[]} ConflictGroup[]
 */
function detectConflicts(hits) {
  const groups = [];
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const a = hits[i].rule;
      const b = hits[j].rule;
      const conflicts = CONFLICT_DIRECTIONS[a.direction] || [];
      const dirTo = hits[j].direction;
      if (conflicts.includes(dirTo)) {
        groups.push({
          rule_version_ids: [a.version_id, b.version_id],
          directions: [a.direction, b.direction],
          severity: 'high',
          requires_review: true,
        });
      }
    }
  }
  return groups;
}

/**
 * 判定两个方向是否互为冲突。
 * @param {string} d1
 * @param {string} d2
 * @returns {boolean}
 */
function isConflicting(d1, d2) {
  const conflicts = CONFLICT_DIRECTIONS[d1] || [];
  return conflicts.includes(d2);
}

module.exports = { CONFLICT_DIRECTIONS, detectConflicts, isConflicting };