// ============================================================================
// 规则引擎 (Rule Engine) —— 确定性 IF-THEN，可解释、可审计
// direction: 1=上盘, -1=下盘, 0=风险/异常提示(不参与方向投票)
// direction 可为函数 f => 1/-1/0（如 R004 依共振方向动态定方向）
// threshold 可选：UI 可现场调节，evaluate 时用 state.thresholds[id] 覆盖
// ============================================================================

function avgLocal(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

const RULES = [
  { id: "R001", name: "升盘降水", family: "temporal", direction: 1, weight: 1,
    test: (f) => f.temp.move_pattern === "升盘降水",
    evidence: (f) => `盘口${f.temp.handicap_movement}、主水${f.temp.home_water_movement}` },

  { id: "R002", name: "降盘升水", family: "temporal", direction: -1, weight: 1,
    test: (f) => f.temp.move_pattern === "降盘升水",
    evidence: (f) => `盘口${f.temp.handicap_movement}、主水${f.temp.home_water_movement}` },

  { id: "R003", name: "澳门初盘深开", family: "cross", direction: -1, weight: 1,
    test: (f, m) => {
      const bms = m.handicap; const macau = bms.find(b => b.name.includes("澳"));
      if (!macau) return false;
      const others = bms.filter(b => b !== macau);
      if (!others.length) return false;
      return (macau.initial.h - avgLocal(others.map(b => b.initial.h))) <= -0.25;
    },
    evidence: (f, m) => {
      const bms = m.handicap; const macau = bms.find(b => b.name.includes("澳"));
      const others = bms.filter(b => b !== macau);
      const diff = (macau.initial.h - avgLocal(others.map(b => b.initial.h))).toFixed(2);
      return `澳门初盘比其余均值深 ${diff}`;
    } },

  { id: "R004", name: "多机构同步调赔", family: "resonance", direction: (f) => f.reso.consensus_direction === "升盘" ? 1 : (f.reso.consensus_direction === "降盘" ? -1 : 0), weight: 1,
    test: (f) => f.reso.sync_handicap_count >= 3,
    evidence: (f) => `同向调盘机构 ${f.reso.sync_handicap_count} 家，方向「${f.reso.consensus_direction}」` },

  { id: "R005", name: "成交量异常波动", family: "anomaly", direction: 0, weight: 1,
    test: (f) => f.anom.volume_anomaly != null && f.anom.volume_anomaly >= 2.5,
    evidence: (f) => `量比均值 ${f.anom.volume_anomaly}x` },

  { id: "R006", name: "规则R006(待定义)", family: "unknown", direction: 0, weight: 0, placeholder: true,
    test: () => false,
    evidence: () => "用户尚未定义 R006" },

  { id: "R007", name: "稳定盘(无变动)", family: "temporal", direction: 1, weight: 1,
    test: (f, m) => {
      if (!f.temp.stability_flag || f.temp.move_pattern !== "稳定") return false;
      return m.handicap.every(b => Math.abs(b.current.hw - b.initial.hw) < 0.02);
    },
    evidence: (f) => `盘口水位全程稳定（主水变动${f.temp.home_water_movement}）` },

  { id: "R008", name: "机构主水分歧", family: "cross", direction: 0, weight: 1,
    test: (f) => f.cross.home_water_dispersion >= 0.15,
    evidence: (f) => `主水离散 ${f.cross.home_water_dispersion}` },

  { id: "R009", name: "凯利指数背离", family: "anomaly", direction: 0, weight: 1,
    test: (f) => f.anom.maxKelly != null && (f.anom.maxKelly >= 1.05 || f.anom.minKelly <= 0.90),
    evidence: (f) => `maxKelly=${f.anom.maxKelly} / minKelly=${f.anom.minKelly}` },

  { id: "R010", name: "规则R010(待定义)", family: "unknown", direction: 0, weight: 0, placeholder: true,
    test: () => false,
    evidence: () => "用户尚未定义 R010" },

  { id: "R011", name: "升盘不降水", family: "temporal", direction: -1, weight: 1,
    test: (f) => f.temp.move_pattern === "升盘不降水",
    evidence: (f) => `升盘${f.temp.handicap_movement}但主水${f.temp.home_water_movement}` },

  { id: "R012", name: "成交量异常放量", family: "anomaly", direction: 0, weight: 1,
    test: (f) => f.anom.volume_anomaly != null && f.anom.volume_anomaly >= 2.5,
    evidence: (f) => `量比均值 ${f.anom.volume_anomaly}x` },

  { id: "R013", name: "主水下调(盘口冻结)", family: "temporal", direction: 1, weight: 1, hasThreshold: true, threshold: 2, thrKey: "dropN",
    test: (f, m, st) => f.temp.stability_flag && f.temp.home_water_drop_count >= (st || 2),
    evidence: (f) => `盘口冻结，主水下调机构 ${f.temp.home_water_drop_count} 家` },

  { id: "R014", name: "主水上调(盘口冻结)", family: "temporal", direction: -1, weight: 1, hasThreshold: true, threshold: 2, thrKey: "riseN",
    test: (f, m, st) => f.temp.stability_flag && f.temp.home_water_rise_count >= (st || 2),
    evidence: (f) => `盘口冻结，主水上调机构 ${f.temp.home_water_rise_count} 家` },

  { id: "R015", name: "必发资金过度集中", family: "betfair", direction: 0, weight: 1, hasThreshold: true, threshold: 0.45, thrKey: "ratio",
    test: (f, m, st) => {
      if (!f.betfair) return false;
      const dom = f.betfair.rows.find(r => r.result === f.betfair.dominant_result);
      return f.betfair.dominant_ratio > (st || 0.45) && Math.abs(dom.heat) > 50;
    },
    evidence: (f) => `资金集中「${f.betfair.dominant_result}」占比 ${(f.betfair.dominant_ratio * 100).toFixed(0)}%` },

  { id: "R016", name: "欧指主胜凯利偏高", family: "onex", direction: 0, weight: 1, hasThreshold: true, threshold: 0.98, thrKey: "kelly",
    test: (f, m, st) => f.onex && f.onex.kelly_home_max != null && f.onex.kelly_home_max >= (st || 0.98),
    evidence: (f) => `主胜凯利最大值 ${f.onex ? f.onex.kelly_home_max : "-"}` }
];

// 评估：根据启用状态 + 阈值覆盖，输出命中规则、风险、倾向与置信度
function evaluate(rules, f, match, state) {
  const enabled = (state && state.enabled) || {};
  const thresholds = (state && state.thresholds) || {};
  let pos = 0, neg = 0;
  const hits = [], risks = [];
  for (const r of rules) {
    if (enabled[r.id] === false) continue;
    const thr = (thresholds[r.id] != null) ? thresholds[r.id] : r.threshold;
    let ok = false;
    try { ok = r.test(f, match, thr); } catch (e) { ok = false; }
    if (!ok) continue;
    const d = (typeof r.direction === "function") ? r.direction(f) : r.direction;
    const ev = r.evidence ? r.evidence(f, match, thr) : "";
    const hit = { id: r.id, name: r.name, family: r.family, direction: d, weight: r.weight, evidence: ev, placeholder: !!r.placeholder };
    if (d === 0) risks.push(hit);
    else { hits.push(hit); if (d > 0) pos += r.weight; else neg += r.weight; }
  }
  const score = pos - neg;
  let verdict = "无明显倾向", conf = 0;
  if (score > 0) { verdict = "看好上盘"; conf = (pos + neg) ? (pos - neg) / (pos + neg) : 0; }
  else if (score < 0) { verdict = "看好下盘"; conf = (pos + neg) ? (neg - pos) / (pos + neg) : 0; }
  return { verdict, confidence: Math.round(conf * 100) / 100, score, hits, risks, pos, neg };
}

if (typeof module !== "undefined") module.exports = { RULES, evaluate };
