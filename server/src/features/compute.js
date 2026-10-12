// ============================================================================
// 特征工程服务 · compute —— 四族 + 欧指 + 必发特征计算（1.2 设计文档 §3）
// 算法复用原型 features.js；输出字段名对齐 dsl-syntax 字段注册表（点分命名）。
// 输入为 adaptMatch 产出的 markets 结构（已过 point-in-time 过滤）。
// ============================================================================
'use strict';

const { parseDepth } = require('../engine/v97/handicap');
const { normalizeLine } = require('../data/normalize');

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function max(arr) { return arr.length ? Math.max(...arr) : null; }
function min(arr) { return arr.length ? Math.min(...arr) : null; }
function sign(x) { return x < -0.005 ? -1 : (x > 0.005 ? 1 : 0); }
function round(x, n) { const p = Math.pow(10, n); return Math.round(x * p) / p; }

/**
 * 盘口原始串 → 有符号深度（数值）。无法解析返回 null（诚实缺值，绝不猜）。
 *
 * 为什么必须有这一步：`data.line` 是 **OCR 原文串**（'1' / '0.5/1' / '0/0.5' / '-0.5'），
 * 直接对它做算术会退化——`avg(['1','1','1','1','1','1'])` 因字符串拼接得 `'0111111'/6 = 18518.5`，
 * `'1' - '0.5/1'` 得 NaN（JSON 序列化成 null），使「盘口线」整族特征全废。
 *
 * 复用 v97 引擎的 parseDepth：它已正确处理 '/' 双盘口（含负号作用域）、以及中文盘口名；
 * 以 normalizeLine 兜底历史 '-' 分隔格式。
 * 符号语义（与 v97 一致，经 673 条真实快照 × 欧赔交叉验证）：负 = 主队受让，正 = 主队让球。
 */
function toDepth(line) {
  const d = parseDepth(line);
  if (d && d.depth != null) return d.depth * d.sign; // sign: -1 受让 / 0 平手 / 1 让球
  const n = normalizeLine(line);
  return Number.isFinite(n) ? n : null;
}

/**
 * 从 markets.handicap 提取机构盘口数组（供四族计算）。
 * @param {Object} handicapMarket { institution: { initial, current } }
 * @returns {Array<{name:string, initial:{h,hw,aw}, current:{h,hw,aw}}>}
 */
function toBookmakerRows(handicapMarket) {
  return Object.entries(handicapMarket || {}).map(([name, rec]) => {
    const ini = rec.initial || {};
    const cur = rec.current || {};
    return {
      name,
      // line 统一归一化为「有符号深度」数值——下游四族全按数值做算术
      initial: { ...ini, line: toDepth(ini.line) },
      current: { ...cur, line: toDepth(cur.line) },
    };
  });
}

/**
 * ① 横截面差异（单时点 × 多机构）
 * 让球盘快照数据字段对齐 1.1 契约：line（盘口）/ home_water / away_water。
 */
function computeCross(rows) {
  const hCur = rows.map((b) => b.current.line).filter((x) => x != null);
  const hwCur = rows.map((b) => b.current.home_water).filter((x) => x != null);
  const awCur = rows.map((b) => b.current.away_water).filter((x) => x != null);
  return {
    'institution.diff_max': hCur.length ? round(max(hCur) - min(hCur), 3) : null,
    'water.upper.dispersion': hwCur.length ? round(max(hwCur) - min(hwCur), 3) : null,
    'water.lower.dispersion': awCur.length ? round(max(awCur) - min(awCur), 3) : null,
  };
}

/**
 * ② 时序差异（单机构 × 时序）
 */
function computeTemp(rows) {
  const hMoves = rows.map((b) => (b.current.line != null && b.initial.line != null ? b.current.line - b.initial.line : null)).filter((x) => x != null);
  const hwMoves = rows.map((b) => (b.current.home_water != null && b.initial.home_water != null ? b.current.home_water - b.initial.home_water : null)).filter((x) => x != null);
  const awMoves = rows.map((b) => (b.current.away_water != null && b.initial.away_water != null ? b.current.away_water - b.initial.away_water : null)).filter((x) => x != null);
  const hChanged = rows.filter((b) => b.current.line != null && b.initial.line != null && b.current.line !== b.initial.line).length;
  const frozen = hChanged <= 1;

  const hm = avg(hMoves);
  const hwm = avg(hwMoves);
  let pattern = '稳定';
  if (sign(hm) < 0 && sign(hwm) < 0) pattern = '升盘降水';
  else if (sign(hm) > 0 && sign(hwm) > 0) pattern = '降盘升水';
  else if (sign(hm) < 0 && sign(hwm) >= 0) pattern = '升盘不降水';
  else if (sign(hm) > 0 && sign(hwm) < 0) pattern = '降盘不降水';

  const dropCount = rows.filter((b) => b.current.home_water != null && b.initial.home_water != null && (b.current.home_water - b.initial.home_water) <= -0.08).length;
  const riseCount = rows.filter((b) => b.current.home_water != null && b.initial.home_water != null && (b.current.home_water - b.initial.home_water) >= 0.08).length;
  const hCur = rows.map((b) => b.current.line).filter((x) => x != null);

  return {
    'handicap.change': hMoves.length ? round(hm, 3) : null,
    'handicap.current': hCur.length ? round(avg(hCur), 3) : null,
    'water.upper.change': hwMoves.length ? round(hwm, 3) : null,
    'water.lower.change': awMoves.length ? round(avg(awMoves), 3) : null,
    'water.upper.drop_count': dropCount,
    'water.upper.rise_count': riseCount,
    move_pattern: pattern,
    stability_flag: frozen,
  };
}

/**
 * ③ 共振差异（多机构 × 时序）
 */
function computeReso(rows) {
  const changed = rows.filter((b) => b.current.line != null && b.initial.line != null && b.current.line !== b.initial.line);
  const posH = changed.filter((b) => sign(b.current.line - b.initial.line) > 0).length;
  const negH = changed.filter((b) => sign(b.current.line - b.initial.line) < 0).length;
  const syncH = Math.max(posH, negH);
  let dir = '无';
  if (syncH >= 3) dir = negH > posH ? '升盘' : '降盘';
  return {
    'institution.sync_count': syncH,
    consensus_direction: dir,
  };
}

/**
 * ④ 衍生异常（计算指标）
 *
 * 口径依据 dsl-syntax：「最大/最小凯利指数」「凯利背离（最大−最小）」，均属 anomaly 族。
 * **凯利取自欧指市场**——它是 1X2 盘口的交叉验证指标，只存在于欧洲盘（澳门胜平负详细变化）。
 *
 * 历史缺陷（2026-10-12 修复）：本函数原以 `toBookmakerRows(markets.handicap)` 为输入，
 * 读 `current.kelly` / `current.volume` / `current.volumeBaseline`——而让球盘快照只产出
 * line/home_water/away_water，这三个字段**从不存在**，导致 kelly_index.max/min/divergence
 * 与 volume.ratio 无论数据多全都恒为 null（结构性死字段，非数据缺失）。
 * @param {Object} europeanMarket adaptMatch 产出的 markets.european
 */
function computeAnom(europeanMarket) {
  const kellys = [];
  for (const rec of Object.values(europeanMarket || {})) {
    const o = rec.latest_kelly || rec.current || {}; // 凯利通常只在该机构最近一条带凯利的观测上
    for (const v of [o.kelly_home, o.kelly_draw, o.kelly_away]) {
      if (typeof v === 'number' && Number.isFinite(v)) kellys.push(v);
    }
  }
  const maxK = max(kellys);
  const minK = min(kellys);
  return {
    'kelly_index.max': maxK == null ? null : round(maxK, 3),
    'kelly_index.min': minK == null ? null : round(minK, 3),
    'kelly_index.divergence': maxK != null && minK != null ? round(maxK - minK, 3) : null,
    // 量比 = 当前成交量 / 基线成交量，数据源为必发。本项目现用人工盘赔源（盘口截图 v2.3.4）
    // 的 md **整体不含必发章节**，故诚实为 null——是数据源不提供，不是实现缺失。
    'volume.ratio': null,
    'odds.volatility': null, // 预留：真实数据接入后计算
  };
}

/**
 * ⑤ 欧指特征（1X2 + 凯利）
 */
function computeOnex(europeanMarket) {
  const rows = Object.values(europeanMarket || {}).map((rec) => rec.latest_kelly || rec.current || {});
  const kh = rows.map((o) => (o.kelly_home != null ? o.kelly_home : null)).filter((x) => x != null);
  return {
    'kelly_index.home_max': kh.length ? round(max(kh), 3) : null,
  };
}

/**
 * ⑥ 必发资金面特征
 */
function computeBetfair(bfMarket) {
  const rec = bfMarket && bfMarket.betfair ? bfMarket.betfair.current : null;
  if (!rec || !Array.isArray(rec.rows) || rec.rows.length === 0) {
    return { 'betfair.dominant_ratio': null, 'betfair.heat': null, 'betfair.turnover': null };
  }
  const rows = rec.rows;
  const total = rec.turnover || rows.reduce((s, r) => s + r.volume, 0);
  const dom = rows.reduce((a, b) => (b.volume > a.volume ? b : a));
  return {
    'betfair.dominant_ratio': total ? round(dom.volume / total, 3) : null,
    'betfair.heat': dom.heat != null ? dom.heat : null,
    'betfair.turnover': total,
  };
}

/**
 * 距开赛分钟数 = 开赛时间 − 分析时刻。
 *
 * **防泄漏契约（必须遵守）**：分析时刻由调用方显式给出。回测 / 复盘复用本模块时
 * **必须传入其回测时点**，禁止依赖默认「现在」，否则构成时间泄漏
 * （项目硬约束：特征与 AI 不得看到未来数据）。
 * 已开赛场次返回负值——语义诚实，不做 clamp。
 * @param {string} matchTime 开赛时间（ISO 8601）
 * @param {string} analyzedAt 分析时刻（ISO 8601）
 * @returns {?number} 分钟（四舍五入）；任一时间非法则 null
 */
function minutesUntil(matchTime, analyzedAt) {
  const nowMs = Date.parse(analyzedAt);
  const mtMs = Date.parse(matchTime);
  if (Number.isNaN(nowMs) || Number.isNaN(mtMs)) return null;
  return Math.round((mtMs - nowMs) / 60000);
}

/**
 * 特征计算主入口。
 * @param {Object} markets adaptMatch 产出的 markets 结构
 * @param {string} matchTime 开赛时间（ISO 8601）
 * @param {{analyzedAt?:string}} [opts] analyzedAt = 分析时刻（ISO 8601），默认当前时刻。
 *        仅用于 `time_to_match`；数据截取上界由 adapt 的 T 参数负责，二者语义不同、不可混用。
 * @returns {Record<string, number|string|boolean|null>} 注册表字段特征
 */
function computeFeatures(markets, matchTime, opts = {}) {
  const rows = toBookmakerRows(markets.handicap);
  const f = {
    ...computeCross(rows),
    ...computeTemp(rows),
    ...computeReso(rows),
    // 凯利属 1X2 盘口指标 → 必须取自欧指（曾经错读让球盘，见 computeAnom 注释）
    ...computeAnom(markets.european),
    ...computeOnex(markets.european),
    ...computeBetfair(markets.bf),
  };
  // 距开赛时间：以「分析时刻」计算。历史缺陷是直接用分析锚点 T（恒等于 match_time），
  // 减法恒得 0，使该字段毫无信息量。
  f.time_to_match = minutesUntil(matchTime, opts.analyzedAt || new Date().toISOString());
  return f;
}

module.exports = { computeFeatures, minutesUntil, toBookmakerRows, computeCross, computeTemp, computeReso, computeAnom, computeOnex, computeBetfair };