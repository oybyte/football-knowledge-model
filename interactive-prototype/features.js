// ============================================================================
// 特征差异计算层 (Feature Layer) —— point-in-time 纯函数
// 输入 raw 快照 → 输出统一的 MatchFeatureSnapshot（四族 + 欧指 + 必发）
// 回测不泄漏的根本保证：特征是 raw 的纯函数，给定同一历史算出完全一致
// ============================================================================

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function max(arr) { return arr.length ? Math.max(...arr) : null; }
function min(arr) { return arr.length ? Math.min(...arr) : null; }
function sign(x) { return x < -0.005 ? -1 : (x > 0.005 ? 1 : 0); }
function round(x, n) { const p = Math.pow(10, n); return Math.round(x * p) / p; }

// 主入口
function computeFeatures(match) {
  return {
    cross: computeCross(match.handicap || []),
    temp: computeTemp(match.handicap || []),
    reso: computeReso(match.handicap || []),
    anom: computeAnom(match.handicap || []),
    onex: computeOnex(match.onex || []),
    betfair: computeBetfair(match.betfair || null)
  };
}

// ① 横截面差异（单时点 × 多机构）
function computeCross(bms) {
  const hCur = bms.map(b => b.current.h);
  const hwCur = bms.map(b => b.current.hw);
  const awCur = bms.map(b => b.current.aw);
  return {
    handicap_dispersion: round(max(hCur) - min(hCur), 3),       // 盘口离散
    home_water_dispersion: round(max(hwCur) - min(hwCur), 3),   // 主水离散
    away_water_dispersion: round(max(awCur) - min(awCur), 3)    // 客水离散
  };
}

// ② 时序差异（单机构 × 时序）
function computeTemp(bms) {
  const hMoves = bms.map(b => b.current.h - b.initial.h);
  const hwMoves = bms.map(b => b.current.hw - b.initial.hw);
  const awMoves = bms.map(b => b.current.aw - b.initial.aw);
  const hChanged = bms.filter(b => b.current.h !== b.initial.h).length;
  const frozen = hChanged <= 1; // 盘口基本冻结（允许≤1家例外，如横截面独树一帜）

  const hm = avg(hMoves);   // <0 升盘, >0 降盘
  const hwm = avg(hwMoves); // <0 降水, >0 升水
  let pattern = "稳定";
  if (sign(hm) < 0 && sign(hwm) < 0) pattern = "升盘降水";
  else if (sign(hm) > 0 && sign(hwm) > 0) pattern = "降盘升水";
  else if (sign(hm) < 0 && sign(hwm) >= 0) pattern = "升盘不降水";
  else if (sign(hm) > 0 && sign(hwm) < 0) pattern = "降盘不降水";

  // 主水下调/上调家数（阈值 0.08）
  const dropCount = bms.filter(b => (b.current.hw - b.initial.hw) <= -0.08).length;
  const riseCount = bms.filter(b => (b.current.hw - b.initial.hw) >= 0.08).length;

  return {
    handicap_movement: round(hm, 3),
    home_water_movement: round(hwm, 3),
    away_water_movement: round(avg(awMoves), 3),
    move_pattern: pattern,
    stability_flag: frozen,
    home_water_drop_count: dropCount,
    home_water_rise_count: riseCount
  };
}

// ③ 共振差异（多机构 × 时序）
function computeReso(bms) {
  const hMoves = bms.map(b => sign(b.current.h - b.initial.h));
  const hwMoves = bms.map(b => sign(b.current.hw - b.initial.hw));
  const changed = bms.filter(b => b.current.h !== b.initial.h);
  const posH = changed.filter(b => sign(b.current.h - b.initial.h) > 0).length;
  const negH = changed.filter(b => sign(b.current.h - b.initial.h) < 0).length;
  const syncH = Math.max(posH, negH); // 同向变动最多家数

  let dir = "无";
  if (syncH >= 3) dir = (negH > posH) ? "升盘" : "降盘";

  const posW = hwMoves.filter(s => s > 0).length;
  const negW = hwMoves.filter(s => s < 0).length;

  return {
    sync_handicap_count: syncH,
    sync_home_water_count: Math.max(posW, negW),
    consensus_direction: dir
  };
}

// ④ 衍生异常（计算指标）
function computeAnom(bms) {
  const kellys = bms.map(b => b.kelly).filter(k => typeof k === "number");
  const maxK = max(kellys), minK = min(kellys);
  const ratios = bms.map(b => (b.volume != null && b.volumeBaseline) ? b.volume / b.volumeBaseline : null)
                    .filter(r => r != null);
  return {
    maxKelly: maxK == null ? null : round(maxK, 3),
    minKelly: minK == null ? null : round(minK, 3),
    kelly_divergence: (maxK != null && minK != null) ? round(maxK - minK, 3) : null,
    volume_anomaly: ratios.length ? round(avg(ratios), 2) : null
  };
}

// ⑤ 欧指特征（1X2 + 凯利）
function computeOnex(onex) {
  if (!onex.length) return null;
  const hMoves = onex.map(o => (o.current.h != null && o.initial.h != null) ? o.current.h - o.initial.h : null)
                     .filter(x => x != null);
  const kh = onex.map(o => o.kelly && o.kelly.h != null ? o.kelly.h : null).filter(x => x != null);
  const ka = onex.map(o => o.kelly && o.kelly.a != null ? o.kelly.a : null).filter(x => x != null);
  return {
    home_odds_movement: hMoves.length ? round(avg(hMoves), 3) : null,
    kelly_home_max: kh.length ? round(max(kh), 3) : null,
    kelly_home_min: kh.length ? round(min(kh), 3) : null,
    kelly_home_divergence: (kh.length ? round(max(kh) - min(kh), 3) : null),
    kelly_away_max: ka.length ? round(max(ka), 3) : null
  };
}

// ⑥ 必发资金面特征
function computeBetfair(bf) {
  if (!bf || !bf.rows || !bf.rows.length) return null;
  const rows = bf.rows;
  const total = bf.turnover || rows.reduce((s, r) => s + r.volume, 0);
  const dom = rows.reduce((a, b) => b.volume > a.volume ? b : a);
  const heats = rows.map(r => r.heat);
  return {
    turnover: total,
    heat_max: max(heats),
    heat_min: min(heats),
    dominant_result: dom.result,
    dominant_ratio: round(dom.volume / total, 3),
    rows: rows
  };
}

if (typeof module !== "undefined") module.exports = { computeFeatures, round };
