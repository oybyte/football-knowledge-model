// ============================================================================
// 特征工程服务 · compute —— 四族 + 欧指 + 必发特征计算（1.2 设计文档 §3）
// 算法复用原型 features.js；输出字段名对齐 dsl-syntax 字段注册表（点分命名）。
// 输入为 adaptMatch 产出的 markets 结构（已过 point-in-time 过滤）。
// ============================================================================
'use strict';

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function max(arr) { return arr.length ? Math.max(...arr) : null; }
function min(arr) { return arr.length ? Math.min(...arr) : null; }
function sign(x) { return x < -0.005 ? -1 : (x > 0.005 ? 1 : 0); }
function round(x, n) { const p = Math.pow(10, n); return Math.round(x * p) / p; }

/**
 * 从 markets.handicap 提取机构盘口数组（供四族计算）。
 * @param {Object} handicapMarket { institution: { initial, current } }
 * @returns {Array<{name:string, initial:{h,hw,aw}, current:{h,hw,aw}}>}
 */
function toBookmakerRows(handicapMarket) {
  return Object.entries(handicapMarket || {}).map(([name, rec]) => ({
    name,
    initial: rec.initial || {},
    current: rec.current || {},
  }));
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
 */
function computeAnom(rows) {
  const kellys = rows.map((b) => b.current.kelly).filter((k) => typeof k === 'number');
  const maxK = max(kellys);
  const minK = min(kellys);
  const ratios = rows
    .map((b) => (b.current.volume != null && b.current.volumeBaseline ? b.current.volume / b.current.volumeBaseline : null))
    .filter((r) => r != null);
  return {
    'kelly_index.max': maxK == null ? null : round(maxK, 3),
    'kelly_index.min': minK == null ? null : round(minK, 3),
    'kelly_index.divergence': maxK != null && minK != null ? round(maxK - minK, 3) : null,
    'volume.ratio': ratios.length ? round(avg(ratios), 2) : null,
    'odds.volatility': null, // 预留：真实数据接入后计算
  };
}

/**
 * ⑤ 欧指特征（1X2 + 凯利）
 */
function computeOnex(europeanMarket) {
  const rows = Object.values(europeanMarket || {}).map((rec) => rec.current || {});
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
 * 特征计算主入口。
 * @param {Object} markets adaptMatch 产出的 markets 结构
 * @param {string} matchTime 开赛时间（ISO 8601）
 * @param {string} t 分析时点（ISO 8601）
 * @returns {Record<string, number|string|boolean|null>} 注册表字段特征
 */
function computeFeatures(markets, matchTime, t) {
  const rows = toBookmakerRows(markets.handicap);
  const f = {
    ...computeCross(rows),
    ...computeTemp(rows),
    ...computeReso(rows),
    ...computeAnom(rows),
    ...computeOnex(markets.european),
    ...computeBetfair(markets.bf),
  };
  // 距开赛时间（分钟）：match_time − T，天然无未来数据
  const tMs = Date.parse(t);
  const mtMs = Date.parse(matchTime);
  f.time_to_match = !Number.isNaN(tMs) && !Number.isNaN(mtMs) ? Math.round((mtMs - tMs) / 60000) : null;
  return f;
}

module.exports = { computeFeatures, toBookmakerRows, computeCross, computeTemp, computeReso, computeAnom, computeOnex, computeBetfair };