// ============================================================================
// Odds Edge · UI 层 —— 产品级原型 1.0.0（后续开发照此实现）
// 路由：首页(竞彩) / 历史记录(复盘) / 规则库 / AI引擎 / 设置
// 数据层 data.js · 特征层 features.js · 规则层 rules.js 已解耦，UI 不掺算法
// ============================================================================

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>',
  replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7 3.3"/><path d="M3 3v6h6"/></svg>',
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
  ball: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m12 7 4 3-1.5 5h-5L8 10z"/><path d="M12 2v5M2 12h5M12 22v-5M22 12h-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>',
  trending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6.3 6.3 2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
};

const NAV = [
  { id: "home",     label: "首页",     icon: "home" },
  { id: "pipeline", label: "预测链",   icon: "spark" },
  { id: "governance",label: "规则治理", icon: "book" },
  { id: "backtest", label: "回测",     icon: "trending" },
  { id: "ingest",   label: "数据接入", icon: "layers" },
  { id: "feature",  label: "特征引擎", icon: "chart" },
  { id: "dsl",      label: "DSL 引擎", icon: "filter" },
  { id: "api",      label: "后端接入", icon: "plus" },
  { id: "history",  label: "历史记录", icon: "replay" },
  { id: "rules",    label: "规则库",   icon: "book" },
  { id: "ai",       label: "AI引擎",   icon: "cpu" },
  { id: "settings", label: "设置",     icon: "gear" }
];
const PAGE_TITLES = {
  home:    ["首页",   "中国体育彩票 · 竞彩足球"],
  pipeline:["预测链", "完整预测流程可视化"],
  governance:["规则治理", "规则生命周期 · 回测监督"],
  backtest:["回测",   "回测报告 · 指标监督"],
  ingest:["数据接入", "数据源 · 信任分级 · 三时间戳"],
  feature:["特征引擎", "四族 + 欧指 + 必发 · point-in-time"],
  dsl:["DSL 引擎", "条件求值 · 算子 · 推理链"],
  api:["后端接入", "原型 ↔ 后端契约 · mock/真实切换"],
  history: ["历史记录", "已分析比赛复盘"],
  rules:   ["规则库", "规则引擎与特征目录"],
  ai:      ["AI 引擎", "挖掘 · 信任边界 Containment · G19"],
  settings:["设置",   "数据源与引擎参数"]
};
function topbarTitleHtml() {
  if (state.page === "home" && state.analyzeId) {
    // 合并/官方场次不在 MATCHES 数组，须经 lottery 快照取标题；兜底固有场次。
    // 单一取数出口 + 字段级兜底：场次缺失显示「载入中」，字段缺失不渲染 undefined。
    const ml = typeof currentLotteryMatch === "function" ? currentLotteryMatch(state.analyzeId) : null;
    const m = ml ? null : getMatch();
    const src = ml || m || {};
    const home = src.home != null ? String(src.home) : "";
    const away = src.away != null ? String(src.away) : "";
    const league = src.league != null ? String(src.league) : "";
    const sub = home && away ? `${home} vs ${away}${league ? " · " + league : ""}` : "载入中";
    return `<span class="tt-title">比赛分析</span><span class="tt-sep">/</span><span class="tt-sub">${sub}</span>`;
  }
  const t = PAGE_TITLES[state.page] || ["", ""];
  return `<span class="tt-title">${t[0]}</span><span class="tt-sep">/</span><span class="tt-sub">${t[1]}</span>`;
}

// ------------------------------ 全局状态 ------------------------------
const SET_KEY = "oddsedge.settings.v1";
const HIST_KEY = "oddsedge.history.v1";

function defaultSettings() {
  return {
    apiUrl: LOTTERY_API, apiKey: "", sync: "30m",
    confMetric: "hit", riskPref: "balanced",
    families: { temporal: true, cross: true, resonance: true, anomaly: true, onex: true, betfair: true, unknown: false }
  };
}
function loadSettings() {
  try { return Object.assign(defaultSettings(), JSON.parse(localStorage.getItem(SET_KEY)) || {}); }
  catch (e) { return defaultSettings(); }
}
function persistSettings() { localStorage.setItem(SET_KEY, JSON.stringify(state.settings)); }

function loadHistory() { try { return JSON.parse(localStorage.getItem(HIST_KEY)) || {}; } catch (e) { return {}; } }
function saveHistoryMap(map) { localStorage.setItem(HIST_KEY, JSON.stringify(map)); }

const state = {
  page: "home",
  analyzeId: null,
  matchId: MATCHES[0].id,
  view: "handicap",
  matchFilter: "all",
  enabled: {},
  thresholds: {},
  ruleFamFilter: "all",
  ruleSearch: "",
  ruleTab: "rules",
  lotteryGroup: "today",
  followed: {},
  analysisOn: {},
  settings: loadSettings()
};
RULES.forEach(r => {
  state.enabled[r.id] = true;
  if (r.hasThreshold) state.thresholds[r.id] = r.threshold;
});

const BM_COLORS = { "澳*": "#f59e0b", "澳门": "#f59e0b", "36*": "#38bdf8", "威*": "#8b5cf6", "立*": "#10b981", "皇冠": "#f43f5e", "Bet365": "#22c55e", "Betfai*": "#ec4899", "Interwet*": "#64748b" };
const THR_CFG = { dropN: { min: 1, max: 5, step: 1 }, riseN: { min: 1, max: 5, step: 1 }, ratio: { min: 0.30, max: 0.70, step: 0.05 }, kelly: { min: 0.90, max: 1.10, step: 0.01 } };

// 规则库兜底：检索命中预览（对接 DSL 引擎）+ DSL 条件摘要
let RULE_HITS = {}; let HIT_MATCH_ID = "";
function buildRuleHits() {
  RULE_HITS = {};
  if (!window.__DSL) return;
  const m = MATCHES[0]; HIT_MATCH_ID = m.id;
  const A = window.__DSL.analyze(m);
  A.list.forEach(x => { RULE_HITS[x.id] = { hit: x.hit, dir: x.dir }; });
}
function dslOpsHint(id) {
  if (!window.__DSL) return "";
  const e = window.__DSL.DSL.find(x => x.id === id);
  if (!e) return "—";
  if (e.placeholder) return "占位·未入检索";
  const hasExt = e.steps.some(s => s.ref.startsWith("$raw."));
  const ops = e.steps.map(s => s.op).join("+");
  return `${hasExt ? "外部引用·" : ""}${ops}${e.guard && e.guard.length ? "·前置guard" : ""}`;
}
function hitChip(id) {
  const h = RULE_HITS[id];
  if (!h) return '<span class="badge muted">未命中</span>';
  if (!h.hit) return '<span class="badge muted">未命中</span>';
  if (h.dir > 0) return '<span class="badge up">命中·上盘</span>';
  if (h.dir < 0) return '<span class="badge down">命中·下盘</span>';
  return '<span class="badge risk">命中·风险</span>';
}
const FAM_COLOR = { cross: "#8b5cf6", temporal: "#38bdf8", resonance: "#10b981", anomaly: "#f59e0b", betfair: "#ec4899", onex: "#22c55e", unknown: "#64748b" };

function fmt(v, n) { if (v == null || (typeof v === "number" && isNaN(v))) return "—"; return (typeof v === "number") ? v.toFixed(n == null ? 2 : n) : v; }
function getMatch() { return MATCHES.find(m => m.id === state.matchId); }
function compute() { const m = getMatch(); const f = computeFeatures(m); const res = evaluate(RULES, f, m, state); return { m, f, res }; }
function computeFor(id) {
  // 真实比赛在竞彩列表里，有详细赔率但没有盘口快照
  const mLottery = (typeof getCachedLotteryMatches === "function" ? getCachedLotteryMatches() : []).find(x => x.id === id);
  if (mLottery) {
    // 找到同名的详细盘口快照
    const m = MATCHES.find(x => x.id === id || (x.home === mLottery.home && x.away === mLottery.away));
    if (m) {
      const f = computeFeatures(m); const res = evaluate(RULES, f, m, state); return { m, f, res };
    }
    toast(`比赛 ${mLottery.home} vs ${mLottery.away} 暂无详细盘口快照，需手动提供`);
    return null;
  }
  // 本地 Mock 比赛
  const m = MATCHES.find(x => x.id === id);
  if (m) {
    const f = computeFeatures(m); const res = evaluate(RULES, f, m, state); return { m, f, res };
  }
  return null;
}
function bmColor(name) { for (const k in BM_COLORS) if (name.includes(k)) return BM_COLORS[k]; return "#64748b"; }
function fmtTime(ts) { const d = new Date(ts); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 1600);
}
function ringSmall(pct, cls) {
  const C = 2 * Math.PI * 18, off = C * (1 - pct);
  return `<div class="ring sm ${cls}"><svg width="44" height="44"><circle class="bg-c" cx="22" cy="22" r="18" fill="none" stroke-width="4"/><circle class="fg-c" cx="22" cy="22" r="18" fill="none" stroke-width="4" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" stroke-linecap="round"/></svg><div class="pct">${(pct * 100).toFixed(0)}%</div></div>`;
}

// ============================ 路由 ============================
function render() {
  document.getElementById("nav").innerHTML = NAV.map(n =>
    `<div class="nav-item ${state.page === n.id ? "active" : ""}" onclick="setPage('${n.id}')">${ICON[n.icon]}${n.label}</div>`).join("");
  const tt = document.getElementById("topbar-title");
  if (tt) tt.innerHTML = topbarTitleHtml();
  const main = document.getElementById("main");
  if (state.page === "home") main.innerHTML = state.analyzeId ? renderAnalysisShell() : renderLotteryList();
  else if (state.page === "pipeline") main.innerHTML = (window.renderPipelinePage ? window.renderPipelinePage() : `<div class="page">预测链模块未加载。</div>`);
  else if (state.page === "governance") main.innerHTML = (window.renderGovernance ? window.renderGovernance() : `<div class="page">规则治理模块未加载。</div>`);
  else if (state.page === "backtest") main.innerHTML = (window.renderBacktest ? window.renderBacktest() : `<div class="page">回测模块未加载。</div>`);
  else if (state.page === "ingest") main.innerHTML = (window.renderIngest ? window.renderIngest() : `<div class="page">数据接入模块未加载。</div>`);
  else if (state.page === "feature") main.innerHTML = (window.renderFeature ? window.renderFeature() : `<div class="page">特征引擎模块未加载。</div>`);
  else if (state.page === "dsl") main.innerHTML = (window.renderDsl ? window.renderDsl() : `<div class="page">DSL 引擎模块未加载。</div>`);
  else if (state.page === "api") { main.innerHTML = (window.renderApiView ? window.renderApiView() : `<div class="page">后端接入模块未加载。</div>`); window.__apiBoot ? window.__apiBoot() : 0; window.__ApiClient ? window.__ApiClient.init() : 0; }
  else if (state.page === "history") main.innerHTML = `<div class="page">${renderHistory()}</div>`;
  else if (state.page === "rules") { main.innerHTML = `<div class="page">${renderRulesPage()}</div>`; bindRuleSearch(); }
  else if (state.page === "ai") main.innerHTML = (window.renderAIView ? window.renderAIView() : `<div class="page">AI 引擎模块未加载。</div>`);
  else if (state.page === "settings") main.innerHTML = `<div class="page">${renderSettings()}</div>`;
}
function setPage(p) { state.page = p; render(); }

// ============================ 首页 · 竞彩赛事列表（竖向 + 右侧分析结论） ============================
function renderLotteryList() {
  const active = state.lotteryGroup;
  const allMatches = (typeof getCachedLotteryMatches === "function") ? getCachedLotteryMatches() : [];
  let matches = allMatches;
  if (active !== "all") matches = matches.filter(m => m.dateGroup === active);
  const onCount = matches.filter(m => state.analysisOn[m.id]).length;
  const datebar = `<div class="lottery-datebar"><span class="chip ${active === "all" ? "active" : ""}" onclick="setLotteryGroup('all')">全部</span>${LOTTERY_GROUPS.map(g => `<span class="chip ${active === g.id ? "active" : ""}" onclick="setLotteryGroup('${g.id}')">${g.label}</span>`).join("")}</div>`;
  const rows = matches.map(m => renderMatchRow(m)).join("");
  const total = allMatches.length;
  const manualOnly = (typeof isManualOnlyMode === "function") && isManualOnlyMode();
  const manualNote = manualOnly ? " · 数据源：本地人工盘赔池（非官方在售）" : "";
  const emptyTitle = manualOnly
    ? "本地人工盘赔池 · 该分类暂无赛事"
    : (active === "today" ? "今日可买暂无赛事" : "该分类暂无赛事");
  const emptySub = manualOnly
    ? `当前为「本地人工盘赔池」模式（未接入官方在售端点），共 ${total} 场历史盘赔已入池，点「全部」或「往期」即可查看全部；按真实开赛时间归类，不伪造在售状态。`
    : "可点右上角「手动刷新」拉取最新数据；若已连接后端数据源且当天无在售赛事，则为正常空态。";
  const emptyBlock = matches.length ? "" : (
    `<div class="home-empty">${ICON.chart}<div class="he-t">${emptyTitle}</div>` +
    `<div class="he-s">${emptySub}</div>` +
    `</div>`
  );
  return `<div class="home-list">
    <div class="home-banner">
      <div class="hb-left"><div class="hb-title">中国体育彩票 · 竞彩足球</div><div class="hb-sub">共 ${total || 0} 场 · 已开启分析 ${onCount} 场 · 当天数据已缓存（公益网站减负，仅手动刷新会直连官方）${manualNote}</div></div>
      <div class="hb-right"><button class="btn sm" onclick="refreshLottery()">${ICON.replay}手动刷新</button></div>
    </div>
    ${datebar}
    <div class="match-rows">${rows}</div>
    ${emptyBlock}
  </div>`;
}

function handicapTxt(n) {
  const v = Math.round(n * 100) / 100;
  return v > 0 ? "+" + v : String(v);
}
function renderMatchRow(m) {
  const hist = loadHistory()[m.id];
  const bt = m.betTypes.map(b => {
    const lab = (b.key === "hhad" && b.handicap != null) ? `让球(${handicapTxt(b.handicap)})` : b.label;
    return `<span class="play-chip ${b.data ? "on" : ""}" title="${b.label}">${lab}</span>`;
  }).join("");
  const od = m.oddsDetail;
  const on = state.analysisOn[m.id];
  const right = on ? renderSummary(m) : renderAnalysisOff(m);
  return `<div class="match-row ${on ? "on" : ""}">
    <div class="mr-card">
      <div class="mc-top"><span class="mc-league">${m.league}</span>${m.serial ? `<span class="mc-serial">${m.serial}</span>` : ""}<span class="badge real">${m.manualPool ? "人工盘赔" : "真实"}</span>${od ? `<span class="badge provisional" title="本地人工盘赔已关联 · ${od.snapshots} 条盘口快照 · provisional 信任级">盘赔明细 · ${od.snapshots}条</span>` : ""}</div>
      <div class="mc-teams">
        <div class="mc-team"><span class="mc-tn">${m.home}</span><span class="mc-pos">主</span></div>
        <div class="mc-vs">VS</div>
        <div class="mc-team right"><span class="mc-pos">${m.neutral ? "中" : "客"}</span><span class="mc-tn">${m.away}</span></div>
      </div>
      <div class="mc-meta"><span>${m.kickoff}</span><span class="mc-deadline">截止 ${m.deadline}</span>${m.salesOpen ? '<span class="dot up"></span>在售' : '<span class="dot idle"></span>停售'}</div>
      <div class="mc-plays">${bt}</div>
      ${hist ? `<div class="mc-analyzed">已复盘 · ${hist.verdict}</div>` : ""}
    </div>
    ${right}
  </div>`;
}

function renderAnalysisOff(m) {
  const hasOdds = m.oddsDetail || MATCHES.some(function(x) { return x.id === m.id; });
  if (!hasOdds) {
    return '<div class="mr-summary off"><div class="off-msg">' + ICON.chart + '<span>暂无详细盘口数据，无法分析</span></div></div>';
  }
  return '<div class="mr-summary off">' +
    '<div class="off-msg">' + ICON.chart + '<span>' + (m.oddsDetail ? '已关联「合并池 · 人工盘赔」推理链' : '未开启分析预测') + '</span></div>' +
    '<button class="btn sm primary" onclick="toggleAnalysis(\'' + m.id + '\',true)">' + ICON.spark + '开启分析预测</button>' +
  '</div>';
}

function toggleAnalysis(id, on) {
  if (on) {
    const ml = currentLotteryMatch(id);
    const hasOdds = (ml && ml.oddsDetail) || MATCHES.some(function(x) { return x.id === id; });
    if (!hasOdds) { toast('暂无详细盘口数据，无法分析'); return; }
  }
  state.analysisOn[id] = on; render();
}

function currentLotteryMatch(id) {
  if (typeof getCachedLotteryMatches !== "function") return null;
  const all = getCachedLotteryMatches();
  for (let i = 0; i < all.length; i++) if (String(all[i].id) === String(id)) return all[i];
  return null;
}

// ───────────────── 合并池 · 人工盘赔推理链（后端规则融合） ─────────────────
// 今日场次已关联「本地人工盘赔」时，推理链在后端 merged pool 上执行（真实盘赔特征）。
// 结果异步落缓存再重渲染；方向仲裁遵循 favor_upper⇒upper / favor_lower⇒lower / draw⇒平 / undecidable⇒弃判。
var _mergedAnalysis = {}; // official 数字 id → { loading, data }

function ensureMergedAnalysis(m) {
  if (_mergedAnalysis[m.id] && _mergedAnalysis[m.id].loading) return; // 已在加载
  if (!_mergedAnalysis[m.id]) {
    _mergedAnalysis[m.id] = { loading: true, data: null };
    var api = (typeof window !== "undefined" && window.__ApiClient) ? window.__ApiClient.getApi() : null;
    if (api && m.oddsDetail && typeof api.getMergedAnalysis === "function") {
      api.getMergedAnalysis(m.oddsDetail.mergedMatchId).then(function (r) {
        _mergedAnalysis[m.id] = { loading: false, data: r && r.ok ? r.data : null };
        render();
      })["catch"](function () { _mergedAnalysis[m.id] = { loading: false, data: null }; render(); });
    } else {
      _mergedAnalysis[m.id] = { loading: false, data: null };
    }
  }
}

// 方向词汇统一：后端引擎返回 favor_upper/favor_lower/draw/warning，需收敛到中文语义展示
function dirLabel(d) {
  if (d === "upper" || d === "favor_upper") return "上盘";
  if (d === "lower" || d === "favor_lower") return "下盘";
  if (d === "draw") return "平局";
  if (d === "warning") return "风险";
  return "弃判";
}
function dirCls(d) {
  if (d === "upper" || d === "favor_upper") return "up";
  if (d === "lower" || d === "favor_lower") return "down";
  if (d === "warning") return "risk";
  return "none";
}
function mergedDirText(arb) {
  return dirLabel(arb && arb.direction);
}
function mergedDirCls(arb) {
  return dirCls(arb && arb.direction);
}
function getMergedAnalysisSummary(m) {
  ensureMergedAnalysis(m);
  const mr = _mergedAnalysis[m.id];
  if (!mr || mr.loading) {
    return '<div class="mr-summary on"><div class="off-msg">' + ICON.chart + '<span>载入合并池盘赔推理链路 …</span></div></div>';
  }
  if (!mr.data || !mr.data.arbitration) {
    return '<div class="mr-summary on"><div class="off-msg">' + ICON.chart + '<span>无可用证据，方向未定</span></div></div>';
  }
  const d = mr.data;
  const hitsHtml = (d.hits || []).map(function (h) {
    return `<div class="reason-line"><span class="badge ${dirCls(h.direction)}">${h.rule_id}</span> <span class="muted">${dirLabel(h.direction)} · conf=${h.confidence}</span></div>`;
  }).join("") || '<div class="reason-line"><span class="muted">未命中规则</span></div>';
  const arb = d.arbitration;
  const conf = arb.confidence != null ? Math.round(arb.confidence * 100) : 0;
  return `<div class="mr-summary on">
    <div class="sum-grid">
      <div class="sum-block" style="grid-column:1/-1">
        <div class="sum-h">推理链（后端 · 合并人工盘赔）</div>
        ${hitsHtml}
      </div>
    </div>
    <div class="sum-foot">
      <span class="vc-pill ${mergedDirCls(arb)}">${mergedDirText(arb)} · ${conf}%</span>
      <div class="spacer"></div>
      <button class="btn sm" onclick="toggleAnalysis('${m.id}',false)">关闭</button>
      <button class="btn sm primary" onclick="enterAnalysis('${m.id}')">${ICON.chart}详细分析</button>
    </div>
  </div>`;
}

function renderSummary(m) {
  if (m.oddsDetail) return getMergedAnalysisSummary(m);
  const cr = computeFor(m.id);
  if (!cr) return '<div class="mr-summary on"><div class="off-msg">' + ICON.chart + '<span>暂无详细盘口数据</span></div></div>';
  const { f, res } = cr;
  const s = marketSummary(m, f, res);
  const vcls = res.verdict.includes("上盘") ? "up" : (res.verdict.includes("下盘") ? "down" : "none");
  const onexMax = Math.max(s.onex.h, s.onex.d, s.onex.a);
  const hwdlMax = Math.max(s.hwdl.h, s.hwdl.d, s.hwdl.a);
  const lineTxt = (s.hwdl.line >= 0 ? "主+" : "主") + (Math.round(s.hwdl.line * 100) / 100);
  return `<div class="mr-summary on">
    <div class="sum-grid">
      <div class="sum-block">
        <div class="sum-h">胜平负</div>
        ${onexBar("胜", s.onex.h, s.onex.h === onexMax)}
        ${onexBar("平", s.onex.d, s.onex.d === onexMax)}
        ${onexBar("负", s.onex.a, s.onex.a === onexMax)}
      </div>
      <div class="sum-block">
        <div class="sum-h">让球胜平负 <span class="sum-line">${lineTxt}</span></div>
        ${onexBar("胜", s.hwdl.h, s.hwdl.h === hwdlMax)}
        ${onexBar("平", s.hwdl.d, s.hwdl.d === hwdlMax)}
        ${onexBar("负", s.hwdl.a, s.hwdl.a === hwdlMax)}
      </div>
      <div class="sum-block">
        <div class="sum-h">总进球区间</div>
        <div class="sum-big">${s.goals}</div>
        <div class="sum-sub">大球概率 ${s.goalsPct}%</div>
      </div>
      <div class="sum-block">
        <div class="sum-h">比分区间</div>
        <div class="sum-scores">${s.scores.map((sc, i) => `<span class="score ${i === 0 ? "hot" : ""}">${sc}</span>`).join("")}</div>
        <div class="sum-sub">最可能的 ${s.scores.length} 个比分</div>
      </div>
      <div class="sum-reason">
        <div class="sum-h">推理过程</div>
        ${s.reasoning.map(r => `<div class="reason-line">${r}</div>`).join("")}
      </div>
    </div>
    <div class="sum-foot">
      <span class="vc-pill ${vcls}">${res.verdict} · ${Math.round(res.confidence * 100)}%</span>
      <div class="spacer"></div>
      <button class="btn sm" onclick="toggleAnalysis('${m.id}',false)">关闭</button>
      <button class="btn sm primary" onclick="enterAnalysis('${m.id}')">${ICON.chart}详细分析</button>
    </div>
  </div>`;
}

function onexBar(label, pct, hot) {
  const p = Math.round(pct * 100);
  return `<div class="onex-row ${hot ? "hot" : ""}"><span class="lab">${label}</span><span class="ob"><i style="width:${p}%"></i></span><span class="pct">${p}%</span></div>`;
}

function setLotteryGroup(g) { state.lotteryGroup = g; render(); }
function refreshLottery() {
  // 手动刷新：直连体彩官方（公益网站减负——自动获取每天最多一次，之后仅手动）
  if (typeof fetchLotteryMatches === "function") {
    fetchLotteryMatches(true).then(function() { render(); toast("赛事列表已刷新"); });
  } else {
    render(); toast("赛事列表已刷新");
  }
}

function enterAnalysis(id) {
  state.page = "home"; state.analyzeId = id; state.matchId = id;
  render();
}
function exitAnalysis() { state.analyzeId = null; render(); }
function saveCurrentAnalysis() {
  const m = getMatch(); const { res } = compute();
  const map = loadHistory();
  map[state.matchId] = {
    matchId: state.matchId, label: `${m.home} vs ${m.away}`, ts: Date.now(),
    verdict: res.verdict, confidence: res.confidence, score: res.score, pos: res.pos, neg: res.neg,
    hits: res.hits.map(h => ({ id: h.id, name: h.name, direction: h.direction })),
    risks: res.risks.map(r => ({ id: r.id, name: r.name }))
  };
  saveHistoryMap(map); toast("复盘已保存");
}

// ============================ 分析壳（三栏复用） ============================
function renderAnalysisShell() {
  const ml = currentLotteryMatch(state.matchId);
  if (ml && ml.oddsDetail) return renderMergedAnalysisShell(ml);
  const m = getMatch();
  if (!m) return `<div class="analysis-shell"><div class="analysis-bar"><button class="btn sm" onclick="exitAnalysis()">${ICON.back} 返回列表</button><div class="ab-spacer"></div></div><div class="analysis-body"><main class="page" style="padding:18px"><div class="off-msg">${ICON.chart}<span>比赛不存在或尚未加载</span></div></main></div></div>`;
  return `<div class="analysis-shell">
    <div class="analysis-bar">
      <button class="btn sm" onclick="exitAnalysis()">${ICON.back} 返回列表</button>
      <div class="ab-title">${m.home} <span class="muted">vs</span> ${m.away}</div>
      <div class="ab-spacer"></div>
      <button class="btn sm" onclick="saveCurrentAnalysis()">${ICON.check}保存复盘</button>
    </div>
    <div class="analysis-body">
      ${renderMatchCol()}
      <main class="page" style="flex:1 1 0;min-width:0;overflow:auto;padding:18px">${renderCenter()}</main>
      <aside class="page" style="flex:0 0 300px;min-width:0;overflow-y:auto;border-left:1px solid var(--bd-1);background:var(--bg-1);padding:16px">${renderRulesPanel()}</aside>
    </div>
  </div>`;
}

// 合并盘赔场次的后端推理分析页（真实盘赔经后端规则融合，避免无 MATCHES 快照崩溃）
function renderMergedAnalysisShell(ml) {
  ensureMergedAnalysis(ml);
  const od = ml.oddsDetail;
  const mr = _mergedAnalysis[ml.id];
  let body;
  if (!mr || mr.loading) {
    body = `<div class="page-head"><div class="ph-title">载入中</div></div><div class="off-msg">${ICON.chart}<span>载入合并池盘赔推理链路 …</span></div>`;
  } else if (!mr.data || !mr.data.arbitration) {
    body = `<div class="page-head"><div class="ph-title">无可用推理结果</div></div><div class="off-msg">${ICON.chart}<span>未检索到可执行规则，方向未定</span></div>`;
  } else {
    const d = mr.data;
    const arb = d.arbitration;
    const hitsRows = (d.hits || []).map(function (h) {
      return `<tr><td class="l"><span class="badge ${dirCls(h.direction)}">${h.rule_id}</span></td><td>${dirLabel(h.direction)}</td><td class="num">${h.confidence}</td><td>${h.exact ? "精确" : "条件"}</td></tr>`;
    }).join("");
    const featsHtml = Object.keys(d.features || {}).slice(0, 24).map(function (k) {
      const v = d.features[k];
      return `<tr><td class="l">${k}</td><td class="num">${typeof v === "number" ? v.toFixed(3) : String(v == null ? "" : v)}</td></tr>`;
    }).join("");
    body = `<div class="page-head">
        <div><div class="ph-title">${ml.home} <span class="muted">vs</span> ${ml.away}</div>
        <div class="ph-sub">${ml.league} · ${ml.kickoff} · 序号 ${ml.serial} · 后端合并池 · 人工盘赔 ${od.snapshots} 条 (provisional)</div></div>
        <div class="ph-actions"><span class="vc-pill ${mergedDirCls(arb)}">${mergedDirText(arb)} · ${arb.confidence != null ? Math.round(arb.confidence * 100) : 0}%</span></div>
      </div>
      <div class="page-section" style="margin-top:14px">
        <div class="section-title">规则命中</div>
        <table class="tbl"><tbody>${hitsRows || '<tr><td class="muted">未命中规则</td></tr>'}</tbody></table>
      </div>
      <div class="page-section" style="margin-top:14px">
        <div class="section-title">特征快照（真实盘赔）</div>
        <table class="tbl"><tbody>${featsHtml}</tbody></table>
      </div>`;
  }
  return `<div class="analysis-shell">
    <div class="analysis-bar">
      <button class="btn sm" onclick="exitAnalysis()">${ICON.back} 返回列表</button>
      <div class="ab-title">${ml.home} <span class="muted">vs</span> ${ml.away} <span class="badge provisional">人工盘赔 · ${od.snapshots}条</span></div>
      <div class="ab-spacer"></div>
    </div>
    <div class="analysis-body"><main class="page" style="flex:1 1 0;min-width:0;overflow:auto;padding:18px">${body}</main></div>
  </div>`;
}

function renderMatchCol() {
  const list = MATCHES.filter(m => m.real); // 归档仅真实历史
  const items = list.map(m => `
    <div class="match-item ${m.id === state.matchId ? "active" : ""}" onclick="selectMatch('${m.id}')">
      <div class="teams">${m.home} <span class="muted" style="font-weight:400">vs</span> ${m.away} <span class="badge real">真实</span></div>
      <div class="meta"><span>${m.league}</span><span>${m.kickoff}</span></div>
    </div>`).join("");
  return `<aside class="match-col">
    <div class="hd">
      <div class="section-title">比赛 (${list.length})</div>
    </div>${items}
  </aside>`;
}

function renderCenter() {
  const { m, f } = compute();
  const tabs = [["handicap", "让球盘", ICON.ball], ["onex", "欧指/凯利", ICON.trending], ["totals", "大小球", ICON.chart], ["betfair", "必发资金", ICON.filter]];
  const tabHtml = `<div class="tabs">${tabs.map(([k, l, ic]) => `<div class="tab ${state.view === k ? "active" : ""}" onclick="switchView('${k}')">${ic}${l}</div>`).join("")}</div>`;
  let body = "";
  if (state.view === "handicap") body = viewHandicap(m, f);
  else if (state.view === "onex") body = viewOnex(m, f);
  else if (state.view === "totals") body = viewTotals(m, f);
  else if (state.view === "betfair") body = viewBetfair(m, f);
  return `<div class="page-head">
      <div><div class="ph-title">${m.home} <span class="muted" style="font-weight:400">vs</span> ${m.away}</div>
      <div class="ph-sub">${m.league} · ${m.kickoff} · ${m.neutral ? "中立场" : "主客场"} · ${m.handicap.length} 家机构</div></div>
      <div class="ph-actions"><button class="btn sm" onclick="toast('分析报告导出中（占位）')">${ICON.download}导出</button><button class="btn sm primary" onclick="toggleFollow()">${ICON.plus}${state.followed && state.followed[state.matchId] ? "已关注" : "加入关注"}</button></div>
    </div>${tabHtml}<div>${body}</div>`;
}

function viewHandicap(m, f) {
  const rows = m.handicap.map(b => {
    const hm = b.current.h - b.initial.h, wm = b.current.hw - b.initial.hw;
    const hc = hm < -0.005 ? "up" : (hm > 0.005 ? "down" : "");
    const wc = wm < -0.005 ? "up" : (wm > 0.005 ? "down" : "");
    const hArr = hm < -0.005 ? "↑" : (hm > 0.005 ? "↓" : "");
    const wArr = wm < -0.005 ? "↓" : (wm > 0.005 ? "↑" : "");
    return `<tr>
      <td class="l"><span class="bm-tag"><span class="bm-dot" style="background:${bmColor(b.name)}"></span>${b.name}</span></td>
      <td class="num ${hc}">${fmt(b.initial.h)} ${hArr}</td><td class="num ${wc}">${fmt(b.initial.hw)} ${wArr}</td>
      <td class="num ${hc}">${fmt(b.current.h)}</td><td class="num ${wc}">${fmt(b.current.hw)}</td>
      <td class="num">${fmt(b.current.aw)}</td></tr>`;
  }).join("");
  const cd = f.cross, tp = f.temp, rs = f.reso, an = f.anom;
  const feats = [
    ["盘口离散", fmt(cd.handicap_dispersion), "cross", "max(临盘)−min(临盘)"],
    ["主水离散", fmt(cd.home_water_dispersion), "cross", "max(临主水)−min(临主水)"],
    ["盘口变动", fmt(tp.handicap_movement), "temporal", "avg(临盘−初盘)"],
    ["主水变动", fmt(tp.home_water_movement), "temporal", "avg(临主水−初主水)"],
    ["形态", tp.move_pattern, "temporal", "升/降盘 × 降/升水", true],
    ["盘口冻结", tp.stability_flag ? "是" : "否", "temporal", "变动机构≤1家", true],
    ["同步调盘", rs.sync_handicap_count + "家", "resonance", "同向变动最多家数", true],
    ["共识方向", rs.consensus_direction, "resonance", "多数机构动作方向", true],
    ["最大凯利", fmt(an.maxKelly), "anomaly", "max 让球盘凯利"],
    ["量比均值", an.volume_anomaly != null ? fmt(an.volume_anomaly) + "x" : "—", "anomaly", "avg(量/基线)"]
  ].map(([t, v, fam, fo, sm]) => `<div class="feat" title="${fo}"><span class="fam" style="background:${FAM_COLOR[fam]}"></span><div class="ft">${t}</div><div class="fv ${sm ? "small" : ""}">${v}</div><div class="ff">${fo}</div></div>`).join("");
  let tl = "";
  if (m.macauHandicapHistory) {
    tl = `<div class="card" style="margin-top:14px"><div class="card-hd"><div class="title">${ICON.replay}澳门让球变化时间轴</div><div class="extra">${m.macauHandicapHistory.length} 个时点</div></div>
      <div class="card-bd"><div class="timeline">${m.macauHandicapHistory.slice().reverse().map((h, i) => `<div class="tl-row ${i === 0 ? "first" : ""}"><div class="tl-time">${h.time}</div><div class="tl-val mono">主水 ${fmt(h.hw)} · 盘 ${fmt(h.h)} · 客水 ${fmt(h.aw)}</div></div>`).join("")}</div></div></div>`;
  }
  return `<div class="card"><div class="card-hd"><div class="title">${ICON.ball}让球盘 · 多机构双水（初盘 → 临场）</div><div class="extra">↑ 数值变小 · ↓ 数值变大</div></div>
    <div class="card-bd" style="padding:0"><table class="tbl"><thead><tr><th class="l">机构</th><th>初盘</th><th>初主水</th><th>临盘</th><th>临主水</th><th>临客水</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div style="margin-top:14px"><div class="section-title">特征差异 · 四族</div><div class="feat-grid">${feats}</div></div>${tl}`;
}

function viewOnex(m, f) {
  if (!m.onex || !m.onex.length) return emptyView("该场为让球盘演示场，暂无欧指/凯利数据。");
  const rows = m.onex.map(o => {
    const k = o.kelly || {};
    const kcell = (x) => x == null ? "—" : `<span class="${x >= 1 ? "down" : (x <= 0.85 ? "up" : "")}">${fmt(x)}</span>`;
    return `<tr><td class="l"><span class="bm-tag"><span class="bm-dot" style="background:${bmColor(o.name)}"></span>${o.name}</span></td>
      <td class="num">${fmt(o.initial.h)}</td><td class="num">${fmt(o.initial.d)}</td><td class="num">${fmt(o.initial.a)}</td>
      <td class="num">${fmt(o.current.h)}</td><td class="num">${fmt(o.current.d)}</td><td class="num">${fmt(o.current.a)}</td>
      <td class="num mono">${kcell(k.h)}/${kcell(k.d)}/${kcell(k.a)}</td></tr>`;
  }).join("");
  const ox = f.onex || {};
  const feats = [
    ["主胜赔变", fmt(ox.home_odds_movement), "onex", "avg(临主胜−初主胜)"],
    ["主胜凯利max", fmt(ox.kelly_home_max), "onex", "max 各机构主胜凯利"],
    ["主胜凯利离散", fmt(ox.kelly_home_divergence), "onex", "max−min 主胜凯利"]
  ].map(([t, v, fam, fo]) => `<div class="feat" title="${fo}"><span class="fam" style="background:${FAM_COLOR[fam]}"></span><div class="ft">${t}</div><div class="fv">${v}</div><div class="ff">${fo}</div></div>`).join("");
  let tl = "";
  if (m.macauOnexHistory) {
    tl = `<div class="card" style="margin-top:14px"><div class="card-hd"><div class="title">${ICON.replay}澳门欧指变化时间轴</div><div class="extra">${m.macauOnexHistory.length} 个时点</div></div>
      <div class="card-bd"><div class="timeline">${m.macauOnexHistory.slice().reverse().map((h, i) => `<div class="tl-row ${i === 0 ? "first" : ""}"><div class="tl-time">${h.time}</div><div class="tl-val mono">主 ${fmt(h.h)} · 平 ${fmt(h.d)} · 客 ${fmt(h.a)} · 凯利 ${fmt(h.kh)}/${fmt(h.kd)}/${fmt(h.ka)}</div></div>`).join("")}</div></div></div>`;
  }
  return `<div class="card"><div class="card-hd"><div class="title">${ICON.trending}1X2 欧指 + 凯利指数</div><div class="extra">凯利 ≥1.0 红色 · ≤0.85 绿色</div></div>
    <div class="card-bd" style="padding:0"><table class="tbl"><thead><tr><th class="l">机构</th><th>初主</th><th>初平</th><th>初客</th><th>临主</th><th>临平</th><th>临客</th><th>凯利(主/平/客)</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div style="margin-top:14px"><div class="section-title">欧指特征</div><div class="feat-grid">${feats}</div></div>${tl}`;
}

function viewTotals(m, f) {
  if (!m.totals || !m.totals.length) return emptyView("该场为让球盘演示场，暂无大小球数据。");
  const rows = m.totals.map(o => {
    const oc = o.current.over - o.initial.over, uc = o.current.under - o.initial.under;
    return `<tr><td class="l"><span class="bm-tag"><span class="bm-dot" style="background:${bmColor(o.name)}"></span>${o.name}</span></td>
      <td>${o.initial.line}</td><td class="num ${oc < -0.005 ? "up" : (oc > 0.005 ? "down" : "")}">${fmt(o.initial.over)}</td><td class="num ${uc < -0.005 ? "up" : (uc > 0.005 ? "down" : "")}">${fmt(o.initial.under)}</td>
      <td>${o.current.line}</td><td class="num ${oc < -0.005 ? "up" : (oc > 0.005 ? "down" : "")}">${fmt(o.current.over)}</td><td class="num ${uc < -0.005 ? "up" : (uc > 0.005 ? "down" : "")}">${fmt(o.current.under)}</td></tr>`;
  }).join("");
  return `<div class="card"><div class="card-hd"><div class="title">${ICON.chart}大小球（大球 / 盘口 / 小球）</div><div class="extra">初盘 → 临场</div></div>
    <div class="card-bd" style="padding:0"><table class="tbl"><thead><tr><th class="l">机构</th><th>初盘</th><th>初大</th><th>初小</th><th>临盘</th><th>临大</th><th>临小</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function viewBetfair(m, f) {
  if (!m.betfair || !f.betfair) return emptyView("该场为让球盘演示场，暂无必发资金数据。");
  const bf = f.betfair, total = bf.turnover;
  const barCls = { "胜": "b-up", "平": "b-draw", "负": "b-down" };
  const rows = bf.rows.map(r => {
    const w = (r.volume / total * 100).toFixed(0);
    return `<tr><td class="l"><span class="bm-tag"><span class="bm-dot" style="background:${r.result === "胜" ? "var(--up)" : (r.result === "负" ? "var(--down)" : "var(--brand)")}"></span>${r.result}</span></td>
      <td class="num">${fmt(r.odds)}</td><td class="num">${r.volume.toLocaleString()}</td>
      <td style="min-width:120px"><div class="bar"><i class="${barCls[r.result]}" style="width:${w}%"></i><span class="bar-pct">${w}%</span></div></td>
      <td class="num ${r.pnl >= 0 ? "down" : "up"}">${r.pnl >= 0 ? "+" : ""}${r.pnl.toLocaleString()}</td>
      <td><div class="heat-gauge"><div class="heat-bar">${r.heat >= 0 ? `<i class="pos" style="width:${Math.min(r.heat / 2, 50)}%"></i>` : `<i class="neg" style="width:${Math.min(-r.heat / 2, 50)}%"></i>`}</div><span class="num ${r.heat > 0 ? "risk" : (r.heat < 0 ? "up" : "muted")}">${r.heat > 0 ? "+" : ""}${r.heat}</span></div></td></tr>`;
  }).join("");
  const feats = [
    ["资金集中", bf.dominant_result, "betfair", `占比 ${(bf.dominant_ratio * 100).toFixed(0)}%`, true],
    ["冷热极值", `${fmt(bf.heat_max)} / ${fmt(bf.heat_min)}`, "betfair", "max / min 冷热指数"],
    ["总交易量", total.toLocaleString(), "betfair", "必发成交量"]
  ].map(([t, v, fam, fo, sm]) => `<div class="feat" title="${fo}"><span class="fam" style="background:${FAM_COLOR[fam]}"></span><div class="ft">${t}</div><div class="fv ${sm ? "small" : ""}">${v}</div><div class="ff">${fo}</div></div>`).join("");
  return `<div class="card"><div class="card-hd"><div class="title">${ICON.filter}必发交易盈亏 · 冷热指数</div><div class="extra">总交易量 ${total.toLocaleString()}</div></div>
    <div class="card-bd" style="padding:0"><table class="tbl"><thead><tr><th class="l">结果</th><th>欧指</th><th>交易量</th><th>资金占比</th><th>盈亏</th><th>冷热</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div style="margin-top:14px"><div class="section-title">资金面特征</div><div class="feat-grid">${feats}</div></div>`;
}

function emptyView(msg) { return `<div class="empty">${msg}</div>`; }

function renderRulesPanel() {
  const { f, res } = compute();
  const vcls = res.verdict.includes("上盘") ? "up" : (res.verdict.includes("下盘") ? "down" : "none");
  const C = 2 * Math.PI * 24;
  const off = C * (1 - res.confidence);
  const risks = res.risks.length ? res.risks.map(r => `<div class="ri">${ICON.warn}<span><b>${r.id}</b> ${r.name}：${r.evidence}</span></div>`).join("") : `<div class="risk-empty">无风险信号</div>`;
  const verdictCard = `<div class="verdict-card ${vcls}">
    <div class="vc-top"><div><div class="vc-label">综合倾向${state.settings.confMetric === "edge" ? " (edge)" : ""}</div><div class="vc-verdict ${vcls}">${res.verdict}</div></div>
      <div class="ring"><svg width="56" height="56"><circle class="bg-c" cx="28" cy="28" r="24" fill="none" stroke-width="5"/><circle class="fg-c" cx="28" cy="28" r="24" fill="none" stroke-width="5" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" stroke-linecap="round"/></svg><div class="pct">${(res.confidence * 100).toFixed(0)}%</div></div></div>
    <div class="vc-stats"><div class="vc-stat"><div class="k">方向规则命中</div><div class="v">${res.hits.length}</div></div><div class="vc-stat"><div class="k">风险信号</div><div class="v" style="color:var(--risk)">${res.risks.length}</div></div></div>
    <div class="risk-list">${risks}</div></div>`;

  const items = RULES.map(r => {
    const hit = res.hits.find(h => h.id === r.id) || res.risks.find(h => h.id === r.id);
    const dir = hit ? hit.direction : 0;
    const dirBadge = !hit ? '<span class="badge mock">未命中</span>' : (dir > 0 ? '<span class="badge up">上盘</span>' : (dir < 0 ? '<span class="badge down">下盘</span>' : '<span class="badge risk">风险</span>'));
    const edgeCls = hit ? (dir === 0 ? "risk-h" : (dir > 0 ? "up-h" : "down-h")) : "";
    let thr = "";
    if (r.hasThreshold) {
      const cfg = THR_CFG[r.thrKey] || { min: 0, max: 9, step: 1 };
      const v = state.thresholds[r.id];
      thr = `<div class="rule-thr"><span>阈值</span><input type="range" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${v}" oninput="updateThrDisplay(this,'${r.id}','${r.thrKey}')" onchange="changeThr('${r.id}','${r.thrKey}',this.value)"><span class="v">${v}</span></div>`;
    }
    const ev = hit ? `<div class="rule-ev">${ICON.warn.replace('var(--risk)', 'var(--t-3)')}<span>${hit.evidence}</span></div>` : "";
    const cls = ["rule", hit ? "hit" : "", edgeCls, r.placeholder ? "placeholder" : ""].filter(Boolean).join(" ");
    const ck = state.enabled[r.id] ? "checked" : "";
    return `<div class="${cls}">
      <div class="rule-top">
        <label class="switch"><input type="checkbox" ${ck} onchange="toggleRule('${r.id}',this.checked)"><span class="track"></span></label>
        <span class="rule-id">${r.id}</span><span class="rule-name">${r.name}</span>
        <span class="rule-fam">${r.family}</span>${dirBadge}
      </div>${thr}${ev}</div>`;
  }).join("");
  return `${verdictCard}<div style="margin-top:16px"><div class="section-title">${ICON.book}规则引擎 (${RULES.length})</div>${items}
    <button class="btn sm" style="width:100%;justify-content:center;margin-top:8px" onclick="resetRules()">${ICON.replay}重置全部</button></div>`;
}

// ============================ 历史记录 · 复盘 ============================
function renderHistory() {
  const map = loadHistory(); const ids = Object.keys(map);
  if (!ids.length) return `<div class="placeholder-page"><div class="icon">${ICON.replay}</div><div class="pt">暂无复盘记录</div><div class="ps">在首页选择一场比赛点击「分析」即可生成复盘记录，之后可在此重新运行引擎。</div></div>`;
  const items = ids.map(id => {
    const h = map[id];
    const vcls = h.verdict.includes("上盘") ? "up" : (h.verdict.includes("下盘") ? "down" : "none");
    return `<div class="history-item">
      <div class="hi-main"><div class="hi-title">${h.label}</div><div class="hi-time">${fmtTime(h.ts)} · ${h.hits.length} 命中 / ${h.risks.length} 风险</div></div>
      <div class="hi-verdict ${vcls}">${h.verdict}</div>
      ${ringSmall(h.confidence, vcls)}
      <div class="hi-actions">
        <button class="btn sm" onclick="enterAnalysis('${id}')">${ICON.replay}复盘</button>
        <button class="btn sm" onclick="deleteHistory('${id}')">${ICON.x}删除</button>
      </div>
    </div>`;
  }).join("");
  return `<div class="page-head"><div><div class="ph-title">历史记录</div><div class="ph-sub">${ids.length} 场已分析比赛 · 点击复盘可重新运行引擎</div></div>
    <div class="ph-actions"><button class="btn sm" onclick="clearHistory()">${ICON.warn}清空</button></div></div>
    <div class="history-list">${items}</div>`;
}
function deleteHistory(id) {
  showConfirm('删除复盘', '确定删除该复盘记录？', () => {
    const map = loadHistory(); delete map[id]; saveHistoryMap(map); toast("已删除"); render();
  });
}
function clearHistory() {
  showConfirm('清空全部', '确认清空全部复盘记录？此操作不可撤销。', () => {
    localStorage.removeItem(HIST_KEY); toast("已清空"); render();
  });
}

// Custom confirm modal (replaces native confirm())
function showConfirm(title, msg, onConfirm) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:999;backdrop-filter:blur(2px);animation:fadeIn .2s ease';
  overlay.innerHTML = `
    <div style="background:var(--bg-2);border:1px solid var(--bd-2);border-radius:var(--r-lg);width:360px;padding:0;box-shadow:0 8px 32px rgba(0,0,0,.4);animation:modalIn .2s ease">
      <div style="padding:16px 18px;border-bottom:1px solid var(--bd-1);font-weight:600;font-size:14px">${title}</div>
      <div style="padding:16px 18px;font-size:13px;color:var(--t-2);text-align:center">${msg}</div>
      <div style="padding:12px 18px;border-top:1px solid var(--bd-1);display:flex;gap:8px;justify-content:flex-end">
        <button class="btn sm" id="confirm-cancel">取消</button>
        <button class="btn sm primary" id="confirm-ok" style="background:var(--down);border-color:var(--down)">确认</button>
      </div>
    </div>`;
  const close = () => overlay.remove();
  overlay.querySelector('#confirm-cancel').addEventListener('click', close);
  overlay.querySelector('#confirm-ok').addEventListener('click', () => { close(); onConfirm(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
}

// 通用弹窗（表单型）：actions=[{label,cls,onClick}]，onClick 返回 false 可阻止关闭
function showModal(title, innerHtml, actions, onMount) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal">
    <div class="modal-hd">${title}</div>
    <div class="modal-bd">${innerHtml}</div>
    <div class="modal-ft"></div>
  </div>`;
  const ft = overlay.querySelector(".modal-ft");
  actions.forEach(a => {
    const b = document.createElement("button");
    b.className = "btn sm " + (a.cls || "");
    b.textContent = a.label;
    b.onclick = () => { if (!a.onClick || a.onClick(overlay)) overlay.remove(); };
    ft.appendChild(b);
  });
  document.body.appendChild(overlay);
  if (onMount) onMount(overlay);
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  toast("已导出 " + filename);
}

// ============================ 规则库（含特征目录 tab） ============================
function renderRulesPage() {
  const tab = state.ruleTab;
  const tabs = `<div class="tabs"><div class="tab ${tab === "rules" ? "active" : ""}" onclick="setRuleTab('rules')">${ICON.book}规则库</div><div class="tab ${tab === "features" ? "active" : ""}" onclick="setRuleTab('features')">${ICON.layers}特征目录</div></div>`;
  const body = tab === "rules" ? renderRulesLibrary() : renderFeatureCatalog();
  return `${tabs}${body}`;
}
function setRuleTab(t) { state.ruleTab = t; document.getElementById("main").innerHTML = `<div class="page">${renderRulesPage()}</div>`; bindRuleSearch(); }

function renderRulesLibrary() {
  buildRuleHits();
  const chips = [["all", "全部"], ["temporal", "时序"], ["cross", "横截面"], ["resonance", "共振"], ["anomaly", "异常"], ["onex", "欧指"], ["betfair", "必发"], ["unknown", "占位"]];
  return `<div class="page-head"><div><div class="ph-title">规则库</div><div class="ph-sub">${RULES.length} 条规则 · 覆盖让球盘 / 欧指 / 必发三数据源</div></div>
    <div class="ph-actions"><button class="btn sm" onclick="downloadRules()">${ICON.download}导出</button><button class="btn sm primary" onclick="newRule()">${ICON.plus}新建规则</button></div></div>
    <div class="card"><div class="card-hd">
      <div class="filter-chips">${chips.map(([k, l]) => `<span class="chip ${state.ruleFamFilter === k ? "active" : ""}" onclick="setRuleFam('${k}')">${l}</span>`).join("")}</div>
      <input class="inp" id="rule-search-input" style="width:200px" placeholder="搜索规则名称 / ID…" value="${state.ruleSearch}" autocomplete="off">
    </div>
    <div class="card-bd" style="padding:0"><table class="tbl"><thead><tr><th class="l">ID</th><th class="l">名称</th><th>家族</th><th>方向</th><th>阈值</th><th>状态</th><th>版本</th><th>检索命中 <span class="muted mono" style="font-size:10px">${HIT_MATCH_ID}</span></th><th>DSL条件</th><th></th></tr></thead><tbody id="rules-tbody">${buildRuleRows()}</tbody></table></div></div>`;
}

function buildRuleRows() {
  let list = RULES;
  if (state.ruleFamFilter !== "all") list = RULES.filter(r => r.family === state.ruleFamFilter);
  if (state.ruleSearch) {
    const q = state.ruleSearch.toLowerCase();
    list = list.filter(r => (r.name + r.id).toLowerCase().includes(q));
  }
  return list.map(r => {
    const d = (typeof r.direction === "function") ? "动态" : (r.direction > 0 ? "上盘" : (r.direction < 0 ? "下盘" : "风险"));
    const dBd = d === "上盘" ? "up" : (d === "下盘" ? "down" : (d === "风险" ? "risk" : "brand"));
    const status = r.placeholder ? '<span class="badge mock">占位</span>' : '<span class="badge up">活跃</span>';
    return `<tr>
      <td class="l"><span class="rule-id">${r.id}</span></td>
      <td class="l">${r.name}${r.placeholder ? ' <span class="badge mock">占位</span>' : ""}</td>
      <td><span class="badge brand">${r.family}</span></td>
      <td><span class="badge ${dBd}">${d}</span></td>
      <td>${r.hasThreshold ? `<span class="num mono">${state.thresholds[r.id]}</span>` : '<span class="muted">—</span>'}</td>
      <td>${status}</td>
      <td class="num muted mono">v1</td>
      <td>${hitChip(r.id)}</td>
      <td><span class="mono" style="font-size:11px;color:var(--t-2)">${dslOpsHint(r.id)}</span></td>
      <td><button class="btn sm" onclick="editRule('${r.id}')">编辑</button></td></tr>`;
  }).join("");
}

function setRuleSearch(v) {
  state.ruleSearch = v;
  const tb = document.getElementById("rules-tbody");
  if (tb) tb.innerHTML = buildRuleRows();
}

function bindRuleSearch() {
  const el = document.getElementById("rule-search-input");
  if (el && !el.dataset.bound) {
    el.dataset.bound = "1";
    el.addEventListener("input", (e) => setRuleSearch(e.target.value));
  }
}

const FEATURE_CATALOG = [
  ["inst.handicap_dispersion", "盘口离散", "cross", "scalar", "max(临盘) − min(临盘)", "各机构 current.handicap"],
  ["inst.home_water_dispersion", "主水离散", "cross", "scalar", "max(临主水) − min(临主水)", "各机构 current.homeWater"],
  ["temp.handicap_movement", "盘口变动", "temporal", "scalar", "avg(临盘 − 初盘)", "initial/current.handicap"],
  ["temp.home_water_movement", "主水变动", "temporal", "scalar", "avg(临主水 − 初主水)", "initial/current.homeWater"],
  ["temp.move_pattern", "盘水形态", "temporal", "enum", "升/降盘 × 降/升水 组合", "handicap_movement × water_movement"],
  ["temp.stability_flag", "盘口冻结", "temporal", "bool", "盘口变动机构 ≤ 1 家", "所有机构 handicap 时序"],
  ["temp.home_water_drop_count", "主水下调家数", "temporal", "int", "count(主水变动 ≤ −0.08)", "各机构 homeWater 时序"],
  ["reso.sync_handicap_count", "同步调盘机构数", "resonance", "int", "同向变动最多家数", "各机构 handicap 时序"],
  ["reso.consensus_direction", "共识方向", "resonance", "enum", "多数机构动作方向", "sync_handicap_count"],
  ["anom.kelly_divergence", "凯利背离", "anomaly", "scalar", "max − min 让球盘凯利", "各机构 kelly"],
  ["anom.volume_anomaly", "量比异常", "anomaly", "scalar", "avg(成交量 / 基线)", "volume / volumeBaseline"],
  ["onex.home_odds_movement", "主胜赔变", "onex", "scalar", "avg(临主胜 − 初主胜)", "1X2 initial/current.home"],
  ["onex.kelly_home_max", "主胜凯利最大值", "onex", "scalar", "max 各机构主胜凯利", "onex kelly.home"],
  ["betfair.dominant_ratio", "资金集中占比", "betfair", "scalar", "max(交易量) / 总量", "betfair rows.volume"]
];
function renderFeatureCatalog() {
  const groups = { cross: "横截面差异", temporal: "时序差异", resonance: "共振差异", anomaly: "衍生异常", onex: "欧指特征", betfair: "必发资金面" };
  const famList = Object.keys(groups);
  const cards = famList.map(fam => {
    const items = FEATURE_CATALOG.filter(f => f[2] === fam);
    if (!items.length) return "";
    return `<div class="card"><div class="card-hd"><div class="title"><span class="dot" style="background:${FAM_COLOR[fam]}"></span>${groups[fam]}</div><div class="extra">${items.length} 个特征</div></div>
      <div class="card-bd">${items.map(([id, name, fam, type, def, inputs]) => `
        <div class="kv"><div><div style="font-weight:500">${name} <span class="muted mono" style="font-size:11px">${id}</span></div><div class="ff" style="font-family:var(--mono);font-size:11px;color:var(--t-3);margin-top:2px">${def}</div></div>
        <div style="text-align:right"><span class="badge brand">${type}</span><div class="muted" style="font-size:11px;margin-top:4px">输入：${inputs}</div></div></div>`).join("")}</div></div>`;
  }).join("");
  return `<div class="page-head"><div><div class="ph-title">特征目录</div><div class="ph-sub">${FEATURE_CATALOG.length} 个特征定义 · 四族分类 · point-in-time 纯函数 · 版本化不可变</div></div>
    <div class="ph-actions"><button class="btn sm" onclick="downloadFeatures()">${ICON.download}导出契约</button><button class="btn sm primary" onclick="newFeature()">${ICON.plus}新建特征</button></div></div>
    <div class="grid-2">${cards}</div>`;
}

// ============================ 规则库 / 特征目录 · 壳层 CRUD ============================
function downloadRules() {
  const data = RULES.map(r => ({
    id: r.id, name: r.name, family: r.family,
    direction: (typeof r.direction === "function") ? "动态" : r.direction,
    enabled: state.enabled[r.id] !== false,
    threshold: state.thresholds[r.id] != null ? state.thresholds[r.id] : (r.threshold != null ? r.threshold : null)
  }));
  downloadJson("odds-edge-rules.json", { exportedAt: Date.now(), count: RULES.length, rules: data });
}

function newRule() {
  const fams = ["temporal", "cross", "resonance", "anomaly", "onex", "betfair", "unknown"];
  const inner = `
    <div class="setting-row col"><label>规则名称</label><input class="inp" id="nr-name" placeholder="例如：主水集体下调"></div>
    <div class="setting-row col"><label>家族</label><select class="inp" id="nr-fam">${fams.map(f => `<option>${f}</option>`).join("")}</select></div>
    <div class="setting-row col"><label>方向</label><select class="inp" id="nr-dir"><option value="1">上盘</option><option value="-1">下盘</option><option value="0">风险</option></select></div>
    <div class="setting-row col"><label>阈值（可选）</label><input class="inp" id="nr-thr" type="number" placeholder="留空表示无阈值"></div>
    <div class="setting-note">原型新建规则含占位判定（test 返回 null），不参与引擎打分；真实判定逻辑在 Phase 2 实现。</div>`;
  showModal("新建规则", inner, [
    { label: "取消", cls: "", onClick: () => true },
    { label: "创建", cls: "primary", onClick: (ov) => {
      const name = ov.querySelector("#nr-name").value.trim();
      if (!name) { toast("请填写规则名称"); return false; }
      const fam = ov.querySelector("#nr-fam").value;
      const dir = parseInt(ov.querySelector("#nr-dir").value, 10);
      const thrRaw = ov.querySelector("#nr-thr").value.trim();
      const id = "R" + (RULES.length + 1).toString().padStart(3, "0");
      const nr = { id, name, family: fam, direction: dir, weight: 1, hasThreshold: thrRaw !== "", threshold: thrRaw !== "" ? parseFloat(thrRaw) : undefined, placeholder: false, test: () => null, evidence: () => "" };
      if (nr.hasThreshold) { nr.thrKey = "ratio"; state.thresholds[id] = parseFloat(thrRaw); }
      RULES.push(nr); state.enabled[id] = true;
      toast("规则已创建：" + id);
      return true;
    } }
  ]);
}

function editRule(id) {
  const r = RULES.find(x => x.id === id); if (!r) return;
  const inner = `
    <div class="setting-row col"><label>规则名称</label><input class="inp" id="er-name" value="${r.name}"></div>
    <div class="setting-row col"><label>默认启用</label><select class="inp" id="er-en"><option value="1" ${state.enabled[id] !== false ? "selected" : ""}>启用</option><option value="0" ${state.enabled[id] === false ? "selected" : ""}>停用</option></select></div>
    <div class="setting-row col"><label>阈值（可选）</label><input class="inp" id="er-thr" type="number" value="${r.hasThreshold ? (state.thresholds[id] != null ? state.thresholds[id] : r.threshold) : ""}" placeholder="留空表示无阈值"></div>`;
  showModal("编辑规则 · " + id, inner, [
    { label: "取消", cls: "", onClick: () => true },
    { label: "保存", cls: "primary", onClick: (ov) => {
      const name = ov.querySelector("#er-name").value.trim();
      if (name) r.name = name;
      state.enabled[id] = ov.querySelector("#er-en").value === "1";
      const thrRaw = ov.querySelector("#er-thr").value.trim();
      if (r.hasThreshold) state.thresholds[id] = thrRaw !== "" ? parseFloat(thrRaw) : (r.threshold || 0);
      toast("规则已更新：" + id);
      return true;
    } }
  ]);
}

function downloadFeatures() {
  downloadJson("odds-edge-features.json", {
    count: FEATURE_CATALOG.length,
    features: FEATURE_CATALOG.map(f => ({ id: f[0], name: f[1], family: f[2], type: f[3], def: f[4], inputs: f[5] }))
  });
}

function newFeature() {
  const fams = ["cross", "temporal", "resonance", "anomaly", "onex", "betfair"];
  const inner = `
    <div class="setting-row col"><label>特征名称</label><input class="inp" id="nf-name" placeholder="例如：临场主水标准差"></div>
    <div class="setting-row col"><label>家族</label><select class="inp" id="nf-fam">${fams.map(f => `<option>${f}</option>`).join("")}</select></div>
    <div class="setting-row col"><label>类型</label><select class="inp" id="nf-type"><option value="scalar">scalar</option><option value="int">int</option><option value="bool">bool</option><option value="enum">enum</option></select></div>
    <div class="setting-row col"><label>计算定义</label><input class="inp" id="nf-def" placeholder="例如：std(临主水)"></div>`;
  showModal("新建特征", inner, [
    { label: "取消", cls: "", onClick: () => true },
    { label: "创建", cls: "primary", onClick: (ov) => {
      const name = ov.querySelector("#nf-name").value.trim();
      if (!name) { toast("请填写特征名称"); return false; }
      const fam = ov.querySelector("#nf-fam").value;
      const type = ov.querySelector("#nf-type").value;
      const def = ov.querySelector("#nf-def").value.trim() || "—";
      const id = "cust." + name.replace(/\s+/g, "_");
      FEATURE_CATALOG.push([id, name, fam, type, def, "用户自定义"]);
      toast("特征已创建：" + id);
      return true;
    } }
  ]);
}

// ============================ 设置 ============================
function renderSettings() {
  const s = state.settings;
  const famList = [["temporal", "时序"], ["cross", "横截面"], ["resonance", "共振"], ["anomaly", "异常"], ["onex", "欧指"], ["betfair", "必发"], ["unknown", "占位"]];
  const famChips = famList.map(([k, l]) => `<span class="chip ${s.families[k] ? "active" : ""}" onclick="toggleFam('${k}')">${l}</span>`).join("");
  return `<div class="page-head"><div><div class="ph-title">设置</div><div class="ph-sub">数据源 · 引擎参数 · 外观</div></div>
    <div class="ph-actions"><button class="btn sm primary" onclick="saveSettings()">${ICON.check}保存</button><button class="btn sm" onclick="resetSettings()">${ICON.replay}恢复默认</button></div></div>
    <div class="settings-grid">
      <div class="card"><div class="card-hd"><div class="title">${ICON.home}数据源（中国体育彩票）</div></div><div class="card-bd">
        <div class="setting-row"><label>竞彩接口地址</label><input class="inp" value="${s.apiUrl}" oninput="updateSetting('apiUrl',this.value)" placeholder="https://api.sporttery.cn/..."></div>
        <div class="setting-row"><label>接口密钥</label><input class="inp" type="password" value="${s.apiKey}" oninput="updateSetting('apiKey',this.value)" placeholder="在设置页配置"></div>
        <div class="setting-row"><label>同步频率</label><select class="inp" onchange="updateSetting('sync',this.value)">${["5m", "15m", "30m", "1h", "手动"].map(o => `<option ${s.sync === o ? "selected" : ""}>${o}</option>`).join("")}</select></div>
        <div class="setting-note">数据现已通过后端直连 webapi.sporttery.cn 获取真实竞彩赛程（含赔率池）。</div>
      </div></div>
      <div class="card"><div class="card-hd"><div class="title">规则引擎</div></div><div class="card-bd">
        <div class="setting-row"><label>置信度口径</label>
          <div class="seg">
            <button class="seg-btn ${s.confMetric === "hit" ? "active" : ""}" onclick="setConfMetric('hit')">命中率</button>
            <button class="seg-btn ${s.confMetric === "edge" ? "active" : ""}" onclick="setConfMetric('edge')">edge / ROI</button>
          </div>
        </div>
        <div class="setting-note ${s.confMetric === "edge" ? "warn" : ""}">${s.confMetric === "edge" ? "edge/ROI 度量已在路线图中，当前引擎仍以命中率加权（Phase 2 实现）。" : "让球盘基础胜率天然≈50%，建议后续切换为 edge/ROI 口径以度量真实优势。"}</div>
        <div class="setting-row"><label>风险偏好</label>
          <div class="seg">
            <button class="seg-btn ${s.riskPref === "conservative" ? "active" : ""}" onclick="setRiskPref('conservative')">保守</button>
            <button class="seg-btn ${s.riskPref === "balanced" ? "active" : ""}" onclick="setRiskPref('balanced')">平衡</button>
            <button class="seg-btn ${s.riskPref === "aggressive" ? "active" : ""}" onclick="setRiskPref('aggressive')">激进</button>
          </div>
        </div>
        <div class="setting-row col"><label>默认启用规则族</label><div class="filter-chips">${famChips}</div></div>
      </div></div>
      <div class="card"><div class="card-hd"><div class="title">关于</div></div><div class="card-bd">
        <div class="setting-row"><label>版本</label><span class="muted mono">1.0.0 (交互原型)</span></div>
        <div class="setting-row"><label>数据来源</label><span class="muted">竞彩官方接口（后端实时直连）</span></div>
        <div class="setting-note">本原型为产品级交互验证，后续开发将完全照此实现。规则引擎(RULES) / 特征层(features) / 数据层(data) 已解耦。</div>
      </div></div>
    </div>`;
}
function updateSetting(k, v) { state.settings[k] = v; persistSettings(); }
function setConfMetric(m) { state.settings.confMetric = m; persistSettings(); document.getElementById("main").innerHTML = `<div class="page">${renderSettings()}</div>`; }
function setRiskPref(p) { state.settings.riskPref = p; persistSettings(); document.getElementById("main").innerHTML = `<div class="page">${renderSettings()}</div>`; }
function toggleFam(k) { state.settings.families[k] = !state.settings.families[k]; persistSettings(); document.getElementById("main").innerHTML = `<div class="page">${renderSettings()}</div>`; }
function saveSettings() { persistSettings(); toast("设置已保存"); }
function resetSettings() { state.settings = defaultSettings(); persistSettings(); render(); toast("已恢复默认"); }

// ============================ 交互 ============================
function selectMatch(id) { state.matchId = id; render(); }
function switchView(v) { state.view = v; render(); }
function toggleFollow() { state.followed[state.matchId] = !state.followed[state.matchId]; render(); toast(state.followed[state.matchId] ? "已加入关注" : "已取消关注"); }
function setMatchFilter(f) { state.matchFilter = f; render(); }
function toggleRule(id, on) { state.enabled[id] = on; render(); }
function updateThrDisplay(el, id, key) {
  const v = (key === "ratio" || key === "kelly") ? parseFloat(el.value) : parseInt(el.value, 10);
  state.thresholds[id] = v;
  const vEl = el.parentElement.querySelector(".v");
  if (vEl) vEl.textContent = v;
}
function changeThr(id, key, val) { state.thresholds[id] = (key === "ratio" || key === "kelly") ? parseFloat(val) : parseInt(val, 10); render(); }
function setRuleFam(f) { state.ruleFamFilter = f; document.getElementById("main").innerHTML = `<div class="page">${renderRulesPage()}</div>`; bindRuleSearch(); }
function resetRules() { RULES.forEach(r => { state.enabled[r.id] = true; if (r.hasThreshold) state.thresholds[r.id] = r.threshold; }); render(); }

// ============================ 顶栏全局搜索 ============================
function bindGlobalSearch() {
  const input = document.getElementById("global-search-input");
  const pop = document.getElementById("search-popover");
  if (!input || !pop) return;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { pop.classList.remove("show"); return; }
    const mMatches = MATCHES.filter(m => (m.home + m.away + m.league).toLowerCase().includes(q)).slice(0, 4);
    const rMatches = RULES.filter(r => (r.name + r.id).toLowerCase().includes(q)).slice(0, 4);
    const fMatches = FEATURE_CATALOG.filter(f => (f[0] + f[1]).toLowerCase().includes(q)).slice(0, 4);
    let html = "";
    if (mMatches.length) html += `<div class="sp-group">比赛</div>` + mMatches.map(m => `<div class="sp-item" onclick="goSearchMatch('${m.id}')"><span>${m.home} vs ${m.away}</span><span class="sp-tag">${m.league}</span></div>`).join("");
    if (rMatches.length) html += `<div class="sp-group">规则</div>` + rMatches.map(r => `<div class="sp-item" onclick="goSearchRule('${r.id}')"><span>${r.id} ${r.name}</span><span class="sp-tag">${r.family}</span></div>`).join("");
    if (fMatches.length) html += `<div class="sp-group">特征</div>` + fMatches.map(f => `<div class="sp-item" onclick="goSearchFeature('${f[1]}')"><span>${f[1]}</span><span class="sp-tag mono">${f[0]}</span></div>`).join("");
    if (!html) html = `<div class="sp-empty">未找到匹配项</div>`;
    pop.innerHTML = html;
    pop.classList.add("show");
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = input.value.trim().toLowerCase();
      const m = MATCHES.find(m => (m.home + m.away).toLowerCase().includes(q));
      if (m) { goSearchMatch(m.id); return; }
      const r = RULES.find(r => (r.name + r.id).toLowerCase().includes(q));
      if (r) { goSearchRule(r.id); return; }
      toast("未找到匹配项");
    }
    if (e.key === "Escape") { pop.classList.remove("show"); input.blur(); }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#global-search")) pop.classList.remove("show");
  });
}

function closeGlobalSearch() {
  const pop = document.getElementById("search-popover");
  if (pop) pop.classList.remove("show");
  const input = document.getElementById("global-search-input");
  if (input) input.value = "";
}

function goSearchMatch(id) { closeGlobalSearch(); enterAnalysis(id); }
function goSearchRule(id) {
  closeGlobalSearch();
  state.page = "rules"; state.ruleTab = "rules"; state.ruleFamFilter = "all"; state.ruleSearch = id;
  render();
}
function goSearchFeature(name) {
  closeGlobalSearch();
  state.page = "rules"; state.ruleTab = "features";
  render();
  toast(`特征：${name}`);
}

// ============================ 启动 ============================
bindGlobalSearch();
render();
if (window.__ApiClient) window.__ApiClient.init();
// 自动获取当天竞彩数据（当天缓存命中则零请求；公益网站每天最多自动直连一次）
if (typeof fetchLotteryMatches === "function") {
  fetchLotteryMatches(false).then(function() {
    // 人工盘赔回退模式（官方在售为空）→ 默认展示「全部」，单一入口即可看到本地 149 场盘赔
    if (typeof isManualOnlyMode === "function" && isManualOnlyMode() && state.lotteryGroup === "today") {
      state.lotteryGroup = "all";
    }
    render();
  });
}
