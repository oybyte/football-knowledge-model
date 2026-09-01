// ============================================================================
// V9.7 引擎 · handicap —— 亚盘域逻辑（垂直切片的地基）
//
// 三大职责：
//  1) 盘口序数：中文盘口名 ↔ 数值。注册表里 handicap_depth 用中文名做 lte/gte
//     比较（lte "平半" / gte "主让半一"），必须有序数表才能比大小。
//  2) 让球方判定：**line 是「主队视角的让球数」**——
//        line < 0 → 主队受让 → 上盘(让球方) = 客队
//        line > 0 → 主队让球 → 上盘(让球方) = 主队
//        |line|   → 盘口深度
//     该约定经 673 条真实快照与欧赔交叉验证，一致率 99.6%。
//     切勿按符号直觉推断：搞反会让「上盘超高水」算成下盘水位，结论全错。
//  3) 凯利派生：源 md 只提供 1X2 凯利，让球盘无凯利字段。此处按 V9.7 口径
//     （凯利 = 水位 × 全市场平均概率）由多家机构水位机械推导。
// ============================================================================
'use strict';

/** 中文盘口名 → 盘口数值（含主客前缀变体）。 */
const HANDICAP_ORDINAL = Object.freeze({
  平手: 0,
  平半: 0.25,
  半球: 0.5,
  半一: 0.75,
  一球: 1,
  '一球半': 1.25,
  球半: 1.5,
  '球半/两球': 1.75,
  两球: 2,
  '两球/两球半': 2.25,
  '两球半': 2.5,
});

/** 数值 → 中文盘口名（最接近的）。 */
const ORDINAL_TO_NAME = Object.freeze(
  Object.entries(HANDICAP_ORDINAL).reduce((acc, [name, v]) => {
    if (!(v in acc)) acc[v] = name;
    return acc;
  }, {}),
);

/** 水位合理区间：超出视为 OCR/走地异常（实测存在 hw=57 这类脏数据）。 */
const WATER_MIN = 0.3;
const WATER_MAX = 3.0;

/** 档位字面量别名 → 规范档位（注册表内字面量不统一，见 R13 用"深盘"、R01 用"深盘(≥半一)"）。 */
const BAND_ALIASES = Object.freeze({
  浅盘: '浅盘',
  '浅盘(≤平半)': '浅盘',
  '浅盘(平半及以下)': '浅盘',
  中盘: '中盘',
  '中盘(半球)': '中盘',
  深盘: '深盘',
  '深盘(≥半一)': '深盘',
  '深盘(半一及以上)': '深盘',
});

/**
 * 盘口名/数值 → 数值。
 * @param {string|number} x
 * @returns {number|null} 无法识别返回 null
 */
function toOrdinal(x) {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? Math.abs(x) : null;
  let s = String(x).trim();
  // 去掉「主让/客让」等让球方前缀（让球方由 line 符号单独判定，不在此处理）
  s = s.replace(/^(主让|客让)/, '');
  if (s in HANDICAP_ORDINAL) return HANDICAP_ORDINAL[s];
  const v = Number(s);
  return Number.isFinite(v) ? Math.abs(v) : null;
}

/**
 * 解析 line 字符串 → 盘口深度与符号。
 *
 * 支持：
 *   单盘口 "-0.5" → {depth:0.5, sign:-1}；"1" → {depth:1, sign:1}；"0" → {depth:0, sign:0}
 *   双盘口 "-1.5/2" → {depth:1.75, sign:-1}；"0/0.5" → {depth:0.25, sign:1}
 *
 * **注意**：双盘口的负号作用于整体（"-1.5/2" 意为 -1.5 到 -2），
 * 直接按 '/' 拆分会得到 [-1.5, 2] 并算出错误的 0.25。必须先剥离符号再取中位。
 * 该 bug 会让 Number("-1.5/2") 为 NaN，进而使让球方判定静默走默认分支——双盘口场次上盘全算反。
 *
 * @param {string|number} line
 * @returns {{depth:number|null, isDual:boolean, raw:string, sign:number}} sign: -1 主队受让 / 1 主队让球 / 0 平手
 */
function parseDepth(line) {
  if (line == null) return { depth: null, isDual: false, raw: String(line), sign: 0 };
  const raw = String(line).trim();
  if (raw === '') return { depth: null, isDual: false, raw, sign: 0 };

  const neg = raw.startsWith('-');
  const body = neg ? raw.slice(1) : raw;

  if (body.includes('/')) {
    const parts = body.split('/').map((p) => Number(p.trim())).filter((n) => Number.isFinite(n));
    if (parts.length >= 2) {
      const mid = (Math.max(...parts) + Math.min(...parts)) / 2;
      return { depth: Math.abs(mid), isDual: true, raw, sign: neg ? -1 : 1 };
    }
  }
  const v = Number(body);
  if (Number.isFinite(v)) return { depth: Math.abs(v), isDual: false, raw, sign: v === 0 ? 0 : (neg ? -1 : 1) };
  const ord = toOrdinal(raw);
  return { depth: ord, isDual: false, raw, sign: neg ? -1 : (ord === 0 ? 0 : 1) };
}

/** 水位是否为合理数值。 */
function isSaneWater(w) {
  return typeof w === 'number' && Number.isFinite(w) && w >= WATER_MIN && w <= WATER_MAX;
}

/**
 * 判定让球方（上盘）与两侧水位。
 *
 * **约定（经 673 条真实快照 × 欧赔交叉验证，一致率 99.6%）：**
 *   line < 0 → 主队受让，上盘 = 客队；line > 0 → 主队让球，上盘 = 主队。
 *
 * @param {{line?:string|number, home_water?:number, away_water?:number}} snap
 * @returns {{depth:number|null, upper:'home'|'away'|null, upperWater:number|null,
 *            lowerWater:number|null, homeWater:number|null, awayWater:number|null,
 *            isDual:boolean, reason?:string}}
 */
function resolveHandicap(snap) {
  const { depth, isDual, raw, sign } = parseDepth(snap && snap.line);
  const hw = snap && snap.home_water;
  const aw = snap && snap.away_water;
  const homeOk = isSaneWater(hw);
  const awayOk = isSaneWater(aw);

  if (depth == null) {
    return { depth: null, upper: null, upperWater: null, lowerWater: null, homeWater: hw, awayWater: aw, isDual, sign, reason: `line 无法解析: ${raw}` };
  }
  if (!homeOk || !awayOk) {
    return { depth, upper: null, upperWater: null, lowerWater: null, homeWater: hw, awayWater: aw, isDual, sign, reason: `水位缺失或越界(合理区间 ${WATER_MIN}~${WATER_MAX}): hw=${hw}, aw=${aw}` };
  }

  // 让球方判定优先级：显式前缀（主让/客让） > line 符号 > 平手盘默认。
  // 统一走 parseDepth 的 sign，避免对 "-1.5/2" 这类双盘口做 Number() 得 NaN 而漏判。
  const s = String(raw).trim();
  let upper;
  if (s.startsWith('主让')) upper = 'home';
  else if (s.startsWith('客让')) upper = 'away';
  else if (sign > 0) upper = 'home';
  else if (sign < 0) upper = 'away';
  else upper = 'home'; // 平手盘：无让球方，约定取主队为上盘

  const upperWater = upper === 'home' ? hw : aw;
  const lowerWater = upper === 'home' ? aw : hw;
  return { depth, upper, upperWater, lowerWater, homeWater: hw, awayWater: aw, isDual, sign };
}

/**
 * 盘口深度 → 档位（规范字面量）。
 * 边界与 R01 的「浅盘(≤平半) / 深盘(≥半一)」一致：≤0.25 浅盘，≤0.5 中盘，>0.5 深盘。
 * @param {number|null} depth
 * @returns {'浅盘'|'中盘'|'深盘'|null}
 */
function depthBand(depth) {
  if (depth == null || !Number.isFinite(depth)) return null;
  if (depth <= 0.25) return '浅盘';
  if (depth <= 0.5) return '中盘';
  return '深盘';
}

/** 档位字面量 → 规范档位（未知原样返回）。 */
function canonicalBand(x) {
  if (x == null) return null;
  const s = String(x).trim();
  return BAND_ALIASES[s] || s;
}

/**
 * 由多家机构水位推导让球盘凯利（V9.7 口径：凯利 = 水位 × 全市场平均概率）。
 *
 * 单机构内先对隐含概率去抽水归一：p_home = aw/(hw+aw)（等价于 (1/hw)/((1/hw)+(1/aw))）。
 * 再取全市场平均概率，各机构凯利 = 自身水位 × 平均概率。
 * 亚盘两方向的凯利在单机构内恒等于返还率，只有跨机构用同一平均概率才有差异——
 * 这正是「凯利极差」能反映机构分歧的原因。
 *
 * @param {Array<{institution:string, home_water:number, away_water:number, upper:'home'|'away'}>} rows
 * @returns {{kellyByInst:Object, range:number|null, avgProbHome:number|null, n:number}}
 */
function deriveKelly(rows) {
  const valid = (rows || []).filter((r) => isSaneWater(r.home_water) && isSaneWater(r.away_water));
  if (valid.length < 2) {
    return { kellyByInst: {}, range: null, avgProbHome: null, n: valid.length };
  }
  // 各机构去抽水后的主队概率
  const pHomes = valid.map((r) => r.away_water / (r.home_water + r.away_water));
  const avgProbHome = pHomes.reduce((a, b) => a + b, 0) / pHomes.length;

  const kellyByInst = {};
  const upperKellys = [];
  for (const r of valid) {
    const kHome = r.home_water * avgProbHome;
    const kAway = r.away_water * (1 - avgProbHome);
    kellyByInst[r.institution] = { kelly_home: kHome, kelly_away: kAway };
    const kUpper = r.upper === 'home' ? kHome : kAway;
    if (r.upper) upperKellys.push(kUpper);
  }
  const range = upperKellys.length >= 2 ? Math.max(...upperKellys) - Math.min(...upperKellys) : null;
  return { kellyByInst, range, avgProbHome, n: valid.length };
}

module.exports = {
  HANDICAP_ORDINAL,
  ORDINAL_TO_NAME,
  BAND_ALIASES,
  WATER_MIN,
  WATER_MAX,
  toOrdinal,
  parseDepth,
  isSaneWater,
  resolveHandicap,
  depthBand,
  canonicalBand,
  deriveKelly,
};
