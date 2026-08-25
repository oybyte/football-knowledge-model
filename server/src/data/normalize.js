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

// 联赛别名收敛：竞彩官方用全称（如「韩国职业联赛」），本地人工盘赔用简称（如「韩K联」）。
// 归一化到同一规范名，使双源语义对齐；已为规范名/缩写名的返回自身。
// 该表与原型层 lottery.js 的 LEAGUE_ALIAS 保持一致（前后端各自维护同一收敛语义）。
const LEAGUE_ALIAS = Object.freeze({
  '韩国职业联赛': '韩K联',
  '沙特职业联赛': '沙特联', '沙特阿拉伯职业联赛': '沙特联',
  '欧洲冠军联赛': '欧冠杯', '欧冠联赛': '欧冠杯',
  '欧罗巴联赛': '欧联杯', '欧洲联赛': '欧联杯',
  '西班牙甲级联赛': '西甲',
  '英格兰超级联赛': '英超',
  '英格兰冠军联赛': '英冠',
  '意大利甲级联赛': '意甲',
  '德国甲级联赛': '德甲', '德国乙级联赛': '德乙',
  '法国甲级联赛': '法甲', '法国乙级联赛': '法乙',
  '荷兰甲级联赛': '荷甲',
  '葡萄牙超级联赛': '葡超',
  '巴西甲组联赛': '巴甲', '巴西甲级联赛': '巴甲',
  '日本职业联赛': '日职联', '日本乙级联赛': '日职乙', 'J2联': '日职乙',
  '挪威超级联赛': '挪超',
  '瑞典超级联赛': '瑞典超',
  '芬兰超级联赛': '芬超',
  '英格兰社区盾': '社区盾', '社区盾杯': '社区盾',
  '英格兰联赛杯': '英联杯',
  '韩国足总杯': '韩国杯',
  '南美解放者杯': '解放者杯',
  '美国职业大联盟': '美职联',
});

/**
 * 联赛名归一化：折叠空白后再做别名收敛，统一到规范名。
 * @param {string} name 联赛名（官方全称或人工简称）
 * @returns {string} 规范名；未知联赛返回折叠空白后的原串
 */
function normalizeLeague(name) {
  const n = normalizeTeamName(name);
  return LEAGUE_ALIAS[n] || n;
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
  normalizeLeague,
  parseMatchTime,
};