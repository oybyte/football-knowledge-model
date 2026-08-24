// ============================================================================
// 数据接入层 · 归一化适配 —— 1.1 设计文档 §7.1
// 机构名 / 盘口格式 / 水位格式 / 赛果格式 统一到内部口径
// ============================================================================
'use strict';

/**
 * 机构名归一化：去除通配后缀，映射到统一键。
 * @param {string} name 原型中的机构名，如 "澳*" / "澳门" / "36*"
 * @returns {string} 归一化键，如 "macau" / "ct366"；未知返回原串小写
 */
function normalizeInstitution(name) {
  if (typeof name !== 'string') return '';
  const s = name.replace(/[*＊]/g, '').trim();
  const lower = s.toLowerCase();
  if (s.includes('澳')) return 'macau';
  if (lower.includes('bet365')) return 'bet365'; // 必须先于 36 判断，避免 bet365 误命中
  if (s.includes('36')) return 'ct366';
  if (s.includes('威')) return 'william';
  if (s.includes('立')) return 'ladbrokes';
  if (s.includes('皇')) return 'crown';
  if (lower.includes('betfai')) return 'betfair';
  if (lower.includes('interwet')) return 'interwetten';
  return lower;
}

/**
 * 盘口格式归一化：字符串（"2-2.5" / "0.5"）解析为数值承受半档。
 * @param {number|string} line
 * @returns {number}
 */
function normalizeLine(line) {
  if (typeof line === 'number') return line;
  if (typeof line !== 'string') return NaN;
  const m = line.split('-').map(Number);
  if (m.some((x) => Number.isNaN(x))) return NaN;
  return m.length === 1 ? m[0] : (m[0] + m[1]) / 2;
}

/**
 * 水位格式归一化：统一到「点」基准（0–2 区间），越界标记异常。
 * @param {number} water
 * @returns {number}
 */
function normalizeWater(water) {
  if (typeof water !== 'number' || Number.isNaN(water)) return NaN;
  return Math.round(water * 1000) / 1000;
}

/**
 * 赛果归一化：比分 → actual_result 三值枚举。
 * @param {?number} homeScore
 * @param {?number} awayScore
 * @returns {?("home_win"|"draw"|"away_win")}
 */
function normalizeResult(homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return null;
  if (homeScore > awayScore) return 'home_win';
  if (homeScore < awayScore) return 'away_win';
  return 'draw';
}

module.exports = {
  normalizeInstitution,
  normalizeLine,
  normalizeWater,
  normalizeResult,
};