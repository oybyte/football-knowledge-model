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

// ============================================================================
// 市场结论派生（首页简单分析） —— 纯函数，输入 odds/特征/规则结果 → 输出可展示结论
// 数据缺失时（mock 场仅有让球盘）用让球盘合理反推，保证每场都能给出 4 项结论
// ============================================================================
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function poisson(k, l) { let f = 1; for (let i = 2; i <= k; i++) f *= i; return Math.exp(-l) * Math.pow(l, k) / f; }

function parseLine(s) {
  if (s == null) return null;
  if (typeof s === "number") return s;
  const m = s.split("-").map(Number);
  if (m.length === 1) return m[0];
  return (m[0] + m[1]) / 2;
}

// 1X2 胜平负：优先用欧指隐含概率；mock 场用让球盘反推
function deriveOnex(match) {
  if (match.onex && match.onex.length) {
    const rows = match.onex.filter(o => o.current && o.current.h != null && o.current.d != null && o.current.a != null);
    if (rows.length) {
      const ah = avg(rows.map(o => o.current.h)), ad = avg(rows.map(o => o.current.d)), aa = avg(rows.map(o => o.current.a));
      const r = [1 / ah, 1 / ad, 1 / aa], s = r[0] + r[1] + r[2];
      return { h: r[0] / s, d: r[1] / s, a: r[2] / s, src: "onex" };
    }
  }
  const bms = match.handicap || [];
  const avgH = avg(bms.map(b => b.current.h));
  const mu = -avgH;                         // 主队进球优势
  const k = 1.15;
  let pw = 1 / (1 + Math.exp(-k * mu));
  let pd = Math.max(0.18, 0.30 - Math.abs(mu) * 0.10);
  let pl = Math.max(0.05, 1 - pw - pd);
  const sum = pw + pd + pl;
  return { h: pw / sum, d: pd / sum, a: pl / sum, src: "handicap" };
}

// 统一进球模型：从让球盘推导主队进球优势 mu，从大小球推导期望总进球 T，
// 反解两队期望进球 lh/la。让球胜平负 / 比分 / 总进球 全部共享此模型，保证内部一致。
function goalModel(match) {
  const bms = match.handicap || [];
  const avgH = bms.length ? avg(bms.map(b => b.current.h)) : 0;
  const mu = -avgH;                                   // 主队进球优势（亚盘线取反）
  const tot = deriveTotals(match);
  const T = tot.avgLine;
  const lh = Math.max(0.15, (T + mu) / 2);             // 主队期望进球
  const la = Math.max(0.15, (T - mu) / 2);             // 客队期望进球
  return { avgH, mu, tot, T, lh, la };
}

// 让球胜平负（3 路，竞彩式整数盘）：用整数让球数 + 泊松进球模型，平局腿恒非零
function deriveHandicap(gm) {
  const L = -Math.round(gm.avgH);                     // avgH<0(主强)→L>0 主让；avgH>0(客强)→L<0 客让
  const { lh, la } = gm;
  let ph = 0, pd = 0, pa = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const p = poisson(i, lh) * poisson(j, la);
    if (i - j > L) ph += p; else if (i - j === L) pd += p; else pa += p;
  }
  const sum = ph + pd + pa || 1;
  const lineLabel = L > 0 ? `主让${L}球` : (L < 0 ? `客让${-L}球` : `平手盘`);
  return { line: L, lineLabel, h: ph / sum, d: pd / sum, a: pa / sum, src: "model" };
}

// 总进球：优先用大小球盘，否则按让球盘幅度反推期望进球
function deriveTotals(match) {
  if (match.totals && match.totals.length) {
    const rows = match.totals.filter(t => t.current && t.current.over && t.current.under);
    if (rows.length) {
      const avgLine = avg(rows.map(t => parseLine(t.current.line)));
      const povers = rows.map(t => { const o = 1 / t.current.over, u = 1 / t.current.under; return o / (o + u); });
      return { avgLine, pOver: avg(povers), src: "totals" };
    }
  }
  const bms = match.handicap || [];
  const avgH = avg(bms.map(b => b.current.h));
  return { avgLine: clamp(2.0 + (-avgH) * 0.5, 1.5, 4.2), pOver: 0.5, src: "handicap" };
}

function goalsRange(avgLine, pOver) {
  let lo = Math.round(avgLine - 0.75), hi = Math.round(avgLine + 0.75);
  if (lo < 0) lo = 0;
  if (pOver > 0.58) hi += 1;
  if (pOver < 0.42) lo = Math.max(0, lo - 1);
  return `${lo}-${hi} 球`;
}

// 比分区间（最多 3 个）：独立泊松取 Top3，共享统一进球模型
function deriveScores(gm) {
  const { lh, la } = gm;
  const grid = [];
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) grid.push({ h: i, a: j, p: poisson(i, lh) * poisson(j, la) });
  grid.sort((x, y) => y.p - x.p);
  return grid.slice(0, 3).map(g => `${g.h}-${g.a}`);
}

// 推理过程：模型汇总行 + 方向规则前 2 条 + 风险 1 条，拼接为可读短句
function buildReasoning(res, onex, hwdl, tot) {
  const lines = [];
  const o = `${Math.round(onex.h * 100)}/${Math.round(onex.d * 100)}/${Math.round(onex.a * 100)}`;
  const srcTxt = onex.src === "onex" ? "欧指隐含" : "盘口反推";
  lines.push(`胜平负模型 ${o}（${srcTxt}）· 让球${hwdl.lineLabel} 主胜${Math.round(hwdl.h * 100)}% · 总进球${tot.avgLine.toFixed(1)}（大${Math.round(tot.pOver * 100)}%）`);
  res.hits.slice(0, 2).forEach(h => {
    const dir = h.direction > 0 ? "上盘" : (h.direction < 0 ? "下盘" : "中");
    lines.push(`${h.id} ${h.name}：${h.evidence}${h.direction ? " → 倾向" + dir : ""}`);
  });
  res.risks.slice(0, 1).forEach(r => { lines.push(`⚠ ${r.id} ${r.name}：${r.evidence}`); });
  if (res.hits.length === 0 && res.risks.length === 0) lines.push("暂无明确规则信号，建议观望。");
  return lines;
}

// 主入口：组装首页所需的 4 项结论 + 推理
function marketSummary(match, f, res) {
  const onex = deriveOnex(match);
  const gm = goalModel(match);
  const hwdl = deriveHandicap(gm);
  const tot = gm.tot;
  return {
    onex, hwdl,
    goals: goalsRange(tot.avgLine, tot.pOver),
    goalsPct: Math.round(tot.pOver * 100),
    scores: deriveScores(gm),
    reasoning: buildReasoning(res, onex, hwdl, tot),
    verdict: res.verdict,
    confidence: res.confidence
  };
}

if (typeof module !== "undefined") module.exports = { computeFeatures, round, marketSummary };
