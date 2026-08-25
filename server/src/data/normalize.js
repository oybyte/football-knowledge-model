// ============================================================================
// 数据接入层 · 归一化适配 —— 1.1 设计文档 §7.1
// 机构名 / 盘口格式 / 水位格式 / 赛果格式 统一到内部口径
// 新增：赛事元信息归一化（队名 / 竞彩开赛时间 → +08:00 ISO），供真实赛程源适配器使用。
// ============================================================================
'use strict';

// 中国竞彩开赛时间默认以北京时间（UTC+8）给定时分。
const CN_TZ_OFFSET_MIN = 480;

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

// ───────────────────────── 赛事元信息归一化（真实赛程源）─────────────────────────

/**
 * 队名归一化：折叠全角空格 / 不换行空格 / 多余空白，去首尾。
 * @param {string} name
 * @returns {string}
 */
function normalizeTeamName(name) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[\u3000\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析竞彩开赛时间 → ISO 8601（北京时间）。
 * 兼容 datePart："20260814" | "2026-08-14" | "2026/08/14"；
 * timePart："18:30" | "1830" | "18"（缺分默认为 :00）。
 * 解析失败返回 null（不做猜测）。
 * @param {?string} datePart
 * @param {?string} timePart
 * @returns {?string}
 */
function parseMatchTime(datePart, timePart) {
  const d = String(datePart == null ? '' : datePart).replace(/[-/]/g, '');
  if (!/^\d{8}$/.test(d)) return null;
  const t = String(timePart == null ? '' : timePart).replace(':', '');
  let hh = '';
  let mm = '00';
  if (/^\d{4}$/.test(t)) { hh = t.slice(0, 2); mm = t.slice(2, 4); }
  else if (/^\d{2}$/.test(t)) { hh = t; }
  else return null;
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  const sign = CN_TZ_OFFSET_MIN < 0 ? '-' : '+';
  const abs = Math.abs(CN_TZ_OFFSET_MIN);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${hh}:${mm}:00${off}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

module.exports = {
  normalizeInstitution,
  normalizeLine,
  normalizeWater,
  normalizeResult,
  normalizeTeamName,
  parseMatchTime,
};