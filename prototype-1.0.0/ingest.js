// ============================================================================
// 数据接入监控 · 数据源注册表 / 信任分级 / 三时间戳完整性 / 凭证隔离
// 复刻后端 1.1 数据接入层契约（Mock/占位）：
//   · MatchSchema 三时间戳校验（observed_at ≤ received_at ≤ match_time 纪律）
//   · 数据源注册表 + 数据信任分级（trusted / low / untrusted）
//   · CredentialVault 凭证隔离（打码显示，凭证不注入特征/AI 层）
//   · 数据 → 特征快照：仅 trusted 且完整性通过的数据可进入 statistics_eligible
// 通关严格时间纪律：时间泄漏 / 时序倒挂 / 重复上报 均写入告警（G3 风格，示意）。
// ============================================================================
'use strict';

if (typeof window !== "undefined" && !window.__ingestLoaded) {
  window.__ingestLoaded = true;

  // ---- 数据源注册表（Mock，源自 data.js 各机构） ----
  const SOURCES = [
    { id: "SRC_AO", name: "澳*",     type: "让球盘+欧指",   base: "trusted", feed: ["让球盘", "1X2", "大小球"] },
    { id: "SRC_36", name: "36*",     type: "让球盘+欧指",   base: "trusted", feed: ["让球盘", "1X2", "大小球"] },
    { id: "SRC_WY", name: "威*",     type: "让球盘+欧指",   base: "trusted", feed: ["让球盘", "1X2", "大小球"] },
    { id: "SRC_LB", name: "立*",     type: "欧指+大小球",   base: "trusted", feed: ["1X2", "大小球"] },
    { id: "SRC_IW", name: "Interwet*", type: "全盘口",      base: "trusted", feed: ["让球盘", "1X2", "大小球"] },
    { id: "SRC_BF", name: "Betfai*", type: "必发盈亏",       base: "low",     feed: ["必发"] },
    { id: "SRC_MK", name: "Mock合成数据", type: "占位合成",  base: "untrusted", feed: ["占位"] }
  ];
  const TRUST = {
    trusted:   { label: "可信",   tone: "up" },
    low:       { label: "低信",   tone: "info" },
    untrusted: { label: "沙盒/不可信", tone: "risk" }
  };
  const PROMO = ["M007", "M008", "M009", "M010"];

  function seeded(n) { let x = 7000 + n * 4931; return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; }
  const safe = n => Math.min(parseInt(n.replace(/[^\d]/g, "") || "0", 10) % 100, 99);

  // 某源「最近一笔」三时间戳明细
  function recent(s, idx) {
    const r = seeded(safe(s.id));
    const match = PROMO[idx % PROMO.length];
    const obs = 50 + Math.floor(r() * 200);      // 赛前观察（分钟）
    const recvLag = Math.floor(r() * 6);          // 接收相对观察的时延（分钟）
    const observed_at = `08-14 ${String(17 - Math.floor(obs / 60)).padStart(2, "0")}:${String((obs % 60)).padStart(2, "0")}`;
    const received_at = `08-14 ${String(17 - Math.floor((obs - recvLag) / 60)).padStart(2, "0")}:${String((obs - recvLag) % 60).padStart(2, "0")}`;
    const match_time = "08-14 18:00";
    // 完整性判定；Mock 源刻意演示一次「接收早于观察」的时序倒挂
    let integrity = { k: "ok", note: "通过" };
    if (s.base === "untrusted") integrity = { k: "reversal", note: "时序倒挂(received<observed)" };
    const eligible = s.base === "trusted" && integrity.k === "ok";
    return { match, observed_at, received_at, match_time, integrity, eligible };
  }

  // 指标：今日采集量 / 时延 / 健康
  function statsOf(s, idx) {
    const r = seeded(safe(s.id) + 31);
    return {
      today: 40 + Math.floor(r() * 220),
      latency: Math.floor(r() * 12) + 1,         // 秒
      up: s.base !== "untrusted"
    };
  }
  function ocrToken(s) { return `${s.id.slice(0, 3)}·${"•".repeat(4)}tok_${safe(s.id)}`; }

  // ---- 告警（G3 风格，示意） ----
  const Demo = { alerts: [] };
  function seedAlerts() {
    if (Demo.alerts.length) return;
    Demo.alerts = [
      { t: "17:58", lvl: "warn", src: "SRC_MK", ev: "时序倒挂 · received_at 早于 observed_at（已隔离，不入统计）" },
      { t: "17:52", lvl: "warn", src: "SRC_MK", ev: "重复上报 · 幂等键冲突（丢弃第二条）" },
      { t: "17:31", lvl: "info", src: "SRC_BF", ev: "低信任源接入 · 仅作沙盒参考 pool_eligible=false" },
      { t: "17:02", lvl: "info", src: "—", ev: "凭证隔离校验通过 · 无越权访问（0 告警）" }
    ];
  }
  function refreshNow() {
    const d = new Date(); const p = n => String(n).padStart(2, "0");
    const t = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const ok = SOURCES.filter(s => s.base !== "untrusted").length;
    Demo.alerts.unshift({ t, lvl: "ok", src: "ALL", ev: `定时采集完成 · ${ok}/${SOURCES.length} 源健康，样本已进入特征层` });
    Demo.alerts = Demo.alerts.slice(0, 40);
    if (window.render) window.render();
  }
  seedAlerts();

  // ---- 渲染 ----
  const mockTag = () => `<span class="badge mock">Mock 数据接入示意</span>`;
  const nowTxt = () => { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}`; };

  // ── 真实数据源可观测：本地人工盘赔源（经 api-client → 后端 HTTP） ──
  // root 由 env:OE_MANUAL_ODDS_ROOT 动态配置；每次点击「实时刷新」向后端扫描。
  let manualState = null; // null=加载中
  let manualAnalysis = null; // 当前选中场次的推理链
  async function refreshManual() {
    manualState = null; if (window.render) window.render();
    try {
      const Api = window.__ApiClient;
      if (!Api || typeof Api.getApi !== 'function') { manualState = { error: 'api_client_unavailable' }; if (window.render) window.render(); return; }
      const r = await Api.getApi().getManualOddsStatus();
      manualState = (r && r.ok) ? r.data : { error: (r && r.error) || 'http_error' };
    } catch (e) {
      manualState = { error: String((e && e.message) || e) };
    }
    manualAnalysis = null;
    if (window.render) window.render();
  }
  async function analyzeManualMatch(i) {
    if (!manualState || !manualState.matches) return;
    const m = manualState.matches[i]; if (!m) return;
    manualAnalysis = null; if (window.render) window.render();
    try {
      const Api = window.__ApiClient;
      if (!Api || typeof Api.getApi !== 'function') { manualAnalysis = { error: 'api_client_unavailable' }; if (window.render) window.render(); return; }
      const r = await Api.getApi().getManualAnalysis(m.match_id);
      manualAnalysis = (r && r.ok) ? r.data : { error: (r && r.error) || 'http_error' };
    } catch (e) {
      manualAnalysis = { error: String((e && e.message) || e) };
    }
    if (window.render) window.render();
  }
  function dirBadge(dir, conf) {
    const map = { upper: ["看好上盘", "up"], lower: ["看好下盘", "down"], draw: ["平手盘", "warn"], undecidable: ["不可判定", "info"] };
    const v = map[dir] || [dir || "未知", "info"];
    return `<span class="badge ${v[1]}">${v[0]}${conf != null ? " · " + Math.round(conf * 100) + "%" : ""}</span>`;
  }
  function renderManualAnalysis() {
    if (manualAnalysis === null) return "";
    if (manualAnalysis.error) {
      return `<div class="ing-manual-a"><div class="callout risk"><strong>推理链读取失败。</strong>${manualAnalysis.error}</div><span class="muted">请确认后端已配置 OE_MANUAL_ODDS_ROOT，且该场次源于本地人工盘赔源。</span></div>`;
    }
    const a = manualAnalysis;
    const dir = (a.arbitration || {}).direction;
    const conf = (a.arbitration || {}).confidence;
    const hits = (a.hits || []).map(h => `<tr>
      <td class="mono">${h.rule_id}</td>
      <td class="mono">${h.version_id || "-"}</td>
      <td>${dirBadge(h.direction, h.confidence)}</td>
      <td class="mono">${(h.exact ? "精确" : "近似")}</td>
    </tr>`).join("") || '<tr><td colspan="4" class="empty">无命中的规则</td></tr>';

    return `<div class="ing-manual-a">
      <div class="a-head">
        <span class="mono">推理链</span>
        <span class="ing-name">${(a.match_id || "")}</span>
        ${dirBadge(dir, conf)}
        <span class="badge muted">${a.source || "mock"} · ${a.trust_level || "provisional"}</span>
        ${a.mode === "http" ? '<span class="badge up">后端API</span>' : ""}
      </div>
      <div class="ing-sum mt">
        ${(a.snapshots != null) ? `<div class="bt-chip"><b>盘口快照</b><span class="brand">${a.snapshots}</span></div>` : ""}
        ${(a.neutral != null) ? `<div class="bt-chip"><b>中立场地</b><span>${a.neutral ? "是" : "否"}</span></div>` : ""}
        <div class="bt-chip"><b>仲裁</b><span class="mono">${(a.arbitration || {}).dominant_rule_version_id || "-"}</span></div>
        <div class="bt-chip"><b>需人工复核</b><span>${(a.arbitration || {}).manual_review_required ? "是" : "否"}</span></div>
      </div>
      ${(a.prediction && a.prediction.final_direction) ? `<div class="callout up" style="margin:10px 0"><strong>预测：</strong>${dirBadge(a.prediction.final_direction, a.prediction.final_confidence)}</div>` : ""}
      <div class="ing-table-wrap manual-table-wrap"><table class="ing-table">
        <thead><tr><th>规则</th><th>版本</th><th>方向</th><th>命中</th></tr></thead>
        <tbody>${hits}</tbody>
      </table></div>
      <div class="muted tts" style="font-size:12px">分析锚点 at=${(a.at || "").replace("T", " ")} · 全部盘赔快照均早于开赛（防泄漏）</div>
    </div>`;
  }
  function manualStatusBadge(status) {
    const map = {
      ok:            { label: "接入中", tone: "up" },
      degraded:      { label: "降级",   tone: "warn" },
      not_configured:{ label: "未配置", tone: "info" },
      mock_placeholder: { label: "Mock 占位", tone: "muted" },
    };
    const m = map[status] || { label: status || "未知", tone: "info" };
    return `<span class="badge ${m.tone}">${m.label}</span>`;
  }
  function renderManualSource() {
    if (manualState === null) {
      return `<div class="card-mb"><div class="empty">正在实时加载本地人工盘赔源状态…</div></div>`;
    }
    if (manualState.error) {
      return `<div class="card-mb"><div class="callout risk"><strong>源状态读取失败。</strong>${manualState.error}</div><span class="muted">请确认已启动本地后端（localhost:3000）并切换为「后端API」。</span></div>`;
    }
    const s = manualState;
    const meta = s.meta || { total: 0, admitted: 0, rejected: 0 };
    const matches = (s.matches || []).map((m, i) => {
      const trust = s.trust_level === 'provisional' ? '<span class="badge warn">provisional</span>' : `<span class="badge info">${s.trust_level || '-'}</span>`;
      return `<tr>
        <td class="mono">${m.match_id}</td>
        <td><span class="ing-lg">${m.league}</span></td>
        <td><span class="mono">${m.home_team}</span><span class="ing-name">vs ${m.away_team}</span></td>
        <td class="tts mono">${(m.match_time || '').replace('T', ' ').replace('+08:00', '')}</td>
        <td class="mono">${m.snapshots}</td>
        <td>${m.actual_result || '<span class="muted">待赛果</span>'}</td>
        ${trust}
        <td><button class="btn sm" onclick="window.__ingAnalyzeManual(${i})">推理链</button></td>
      </tr>`;
    }).join("") || '<tr><td colspan="8" class="empty">当前无已接入场次</td></tr>';

    return `<div class="card-mb">
      <div class="manual-src-head">
        <span class="mono">${s.source_id}</span>
        <span class="ing-name">${s.name}</span>
        ${manualStatusBadge(s.status)}
        ${s.status === 'ok' ? '' : `<span class="muted">· ${s.reason || ''}</span>`}
        <span class="badge muted">信任 ${s.trust_level || '-'}</span>
        ${s.mode === 'http' ? '<span class="badge up">后端API</span>' : ''}
      </div>
      <div class="ing-sum mt">
        <div class="bt-chip"><b>目录场次</b><span>${meta.total}</span></div>
        <div class="bt-chip"><b>已接入</b><span class="up">${meta.admitted}</span></div>
        <div class="bt-chip"><b>拒绝</b><span class="risk">${meta.rejected}</span></div>
        <div class="bt-chip"><b>连线</b><span class="brand">盘口 → 特征 → 推理链</span></div>
      </div>
      <div class="ing-table-wrap manual-table-wrap"><table class="ing-table">
        <thead><tr><th>match_id</th><th>联赛</th><th>对阵</th><th>开赛</th><th>快照</th><th>赛果</th><th>信任</th><th>操作</th></tr></thead>
        <tbody>${matches}</tbody>
      </table></div>
      ${renderManualAnalysis()}
    </div>`;
  }

  function renderIngest() {
    const trustedN = SOURCES.filter(s => s.base === "trusted").length;
    const lowN = SOURCES.filter(s => s.base === "low").length;
    const untrN = SOURCES.filter(s => s.base === "untrusted").length;
    const okN = SOURCES.filter(s => s.base !== "untrusted").length;

    const rows = SOURCES.map((s, i) => {
      const Rc = recent(s, i);
      const St = statsOf(s, i);
      const T = TRUST[s.base];
      const integ = Rc.integrity;
      const integBadge = integ.k === "ok"
        ? `<span class="badge up">完整性 ✓</span>`
        : `<span class="badge risk">${integ.note}</span>`;
      const elig = Rc.eligible
        ? `<span class="badge up">eligible</span>`
        : `<span class="badge risk">不入统计</span>`;
      return `<tr>
        <td class="ing-src"><span class="mono">${s.id}</span><span class="ing-name">${s.name}</span><span class="badge brand">${s.type}</span></td>
        <td><div class="ing-feed">${s.feed.map(f => `<span class="badge muted">${f}</span>`).join("")}</div></td>
        <td><span class="badge ${T.tone}">${T.label}</span></td>
        <td class="ing-ts">
          <span class="tts mono">观测 ${Rc.observed_at}</span>
          <span class="tts mono">接收 ${Rc.received_at}</span>
          <span class="tts mono">开赛 ${Rc.match_time}</span>
        </td>
        <td>${integBadge}</td>
        <td>${elig}</td>
        <td class="ing-hlth"><span class="lamp ${St.up ? "ok" : "risk"}"></span>${St.today}<span class="muted">笔</span></td>
      </tr>`;
    }).join("");

    // 凭证隔离
    const vault = SOURCES.map(s => `<div class="v-co"><span class="vc-n">${s.name}</span><span class="vc-tok mono">${s.base === "untrusted" ? "—（无凭证）" : ocrToken(s)}</span></div>`).join("");

    // 告警
    const alerts = Demo.alerts.map(a =>
      `<div class="tl-row"><div class="tl-time">${a.t}</div><div class="al-lvl ${a.lvl}">${a.lvl}</div><div class="al-src mono">${a.src}</div><div class="al-ev">${a.ev}</div></div>`
    ).join("");

    return `<div class="page">
      <div class="page-head">
        <div class="ph-title">数据接入监控<span class="badge mock" style="margin-left:8px">Mock 示意</span></div>
        <div class="ph-sub">数据源注册表 · 信任分级 · 三时间戳完整性 · 凭证隔离</div>
        <div class="ph-actions"><button class="btn sm primary" onclick="window.__ingRefresh()">模拟采集刷新</button><button class="btn sm" onclick="window.__ingRefreshManual()">实时刷新·本地盘赔源</button></div>
      </div>
      <div class="pipeline-banner">数据平面契约：特征/AI 引擎无权访问源凭证；仅 trusted 且三时间戳完整性通过的源数据可进入 <code>statistics_eligible</code>。时间泄漏/倒挂/重复上报写入告警。</div>

      <div class="ing-sum">
        <div class="bt-chip"><b>已注册源</b><span>${SOURCES.length}</span></div>
        <div class="bt-chip"><b>可信</b><span class="up">${trustedN}</span></div>
        <div class="bt-chip"><b>低信</b><span class="brand">${lowN}</span></div>
        <div class="bt-chip"><b>沙盒/不可信</b><span class="risk">${untrN}</span></div>
        <div class="bt-chip"><b>健康源</b><span>${okN}</span></div>
        <div class="bt-chip"><b>最近采集</b><span class="mono">${nowTxt()}</span></div>
      </div>

      <div class="card" style="margin-top:14px"><div class="card-hd"><div class="title">数据源注册表</div><div class="extra muted">三时间戳：observed_at ≤ received_at ≤ match_time</div></div>
        <div class="card-bd ing-table-wrap"><table class="ing-table">
          <thead><tr><th>数据源</th><th>接入字段</th><th>信任</th><th>最近一笔·三时间戳</th><th>完整性</th><th>统计合格</th><th>今日量</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>

      <div class="split-2">
        <div class="card"><div class="card-hd"><div class="title">CredentialVault · 凭证隔离</div><div class="extra muted">打码 · 仅接层可读</div></div>
          <div class="card-bd v-grid">${vault}</div>
          <div class="card-bd"><div class="callout info" style="margin-top:8px"><strong>隔离边界。</strong>特征/AI 引擎经数据访问层注入数据，不触碰 <code>CredentialVault</code> 明文凭证；仅 trusted 源有凭证，untrusted 源标注无凭证。</div></div>
        </div>
        <div class="card"><div class="card-hd"><div class="title">接入告警 · 时间纪律</div><div class="extra">${Demo.alerts.length} 条</div></div>
          <div class="card-bd ing-alerts">${alerts ? `<div class="timeline">${alerts}</div>` : '<div class="empty">无告警</div>'}</div>
        </div>
      </div>

      <div class="card" style="margin-top:14px"><div class="card-hd"><div class="title">真实数据源 · 本地人工盘赔</div><div class="extra muted">经后端 HTTP · 目录根 env:OE_MANUAL_ODDS_ROOT 动态配置</div></div>
        ${renderManualSource()}
      </div>
    </div>`;
  }

  window.renderIngest = renderIngest;
  window.__ingRefresh = refreshNow;
  window.__ingRefreshManual = refreshManual;
  window.__ingAnalyzeManual = analyzeManualMatch;

  refreshManual(); // 初次进入即向后端实时拉取本地盘赔源状态

  if (typeof module !== "undefined") {
    module.exports = { SOURCES, TRUST, recent, statsOf, ocrToken, renderIngest };
  }
}