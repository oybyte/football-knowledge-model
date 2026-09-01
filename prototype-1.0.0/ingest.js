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
    // 锚定状态：以合并池「已对齐官方赛程」标记（merged）按 match_id 交叉判定
    const anchoredIds = (mergedState && Array.isArray(mergedState.pool))
      ? new Set(mergedState.pool.filter(p => p.merged).map(p => p.match_id))
      : null;
    const anchorBadge = (id) => {
      if (anchoredIds === null) return '<span class="badge muted">—</span>';
      return anchoredIds.has(id)
        ? '<span class="badge up">已锚定</span>'
        : '<span class="badge info">未锚定</span>';
    };
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
        <td>${anchorBadge(m.match_id)}</td>
        <td><button class="btn sm" onclick="window.__ingAnalyzeManual(${i})">推理链</button></td>
      </tr>`;
    }).join("") || '<tr><td colspan="9" class="empty">当前无已接入场次</td></tr>';

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
        <thead><tr><th>match_id</th><th>联赛</th><th>对阵</th><th>开赛</th><th>快照</th><th>赛果</th><th>信任</th><th>锚定</th><th>操作</th></tr></thead>
        <tbody>${matches}</tbody>
      </table></div>
      <div class="muted tts" style="font-size:12px">「锚定」= 该场人工盘赔是否已对齐**当天**体彩在售截止锚点（trusted 基础数据；周一~周五 22:00 / 周六~周日 23:00 截止）；未锚定即 manual_only（截止日非当天或仅本地盘赔）。历史比赛不锚定。锚定状态取自双源合并池。</div>
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
        <div class="ph-actions"><button class="btn sm primary" onclick="window.__ingRefresh()">模拟采集刷新</button><button class="btn sm" onclick="window.__ingRefreshManual()">实时刷新·本地盘赔源</button><button class="btn sm" onclick="window.__ingRefreshSchedule()">手动刷新·竞彩赛程</button><button class="btn sm" onclick="window.__ingRefreshOdds()">手动刷新·竞彩赔率</button><button class="btn sm" onclick="window.__ingRefreshMerged()">实时刷新·合并池</button></div>
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

      <div class="card" style="margin-top:14px"><div class="card-hd"><div class="title">真实数据源 · 竞彩官方赛程</div><div class="extra muted">经后端 HTTP · 端点注入 env:ODDS_SPORTTERY_SCHEDULE_BASE · 当天缓存（公益网站减负）</div></div>
        ${renderScheduleSource()}
      </div>

      <div class="card" style="margin-top:14px"><div class="card-hd"><div class="title">真实数据源 · 竞彩官方赔率</div><div class="extra muted">直连 webapi.sporttery.cn · trusted 级别 · 当天缓存（公益网站减负，仅手动刷新直连）</div></div>
        ${renderSportteryOddsSource()}
      </div>

      <div class="card" style="margin-top:14px"><div class="card-hd"><div class="title">真实比赛池 · 双源合并（竞彩赛程 ∪ 本地盘赔）</div><div class="extra muted">经后端 HTTP · 语义键对齐 · 时间防线剔除</div></div>
        ${renderMergedPool()}
      </div>
    </div>`;
  }

  // ── 真实数据源可观测：竞彩官方赛程（当天缓存 · 公益网站减负） ──
  let scheduleState = null; // null=加载中
  async function refreshSchedule(force) {
    scheduleState = null; if (window.render) window.render();
    try {
      const Api = window.__ApiClient;
      if (!Api || typeof Api.getApi !== 'function') { scheduleState = { error: 'api_client_unavailable' }; if (window.render) window.render(); return; }
      const r = await Api.getApi().getScheduleStatus(force ? { refresh: true } : undefined);
      scheduleState = (r && r.ok) ? r.data : { error: (r && r.error) || 'http_error' };
    } catch (e) {
      scheduleState = { error: String((e && e.message) || e) };
    }
    if (window.render) window.render();
  }
  function renderScheduleSource() {
    if (scheduleState === null) return `<div class="card-mb"><div class="empty">正在实时加载竞彩官方赛程状态…</div></div>`;
    if (scheduleState.error) return `<div class="card-mb"><div class="callout risk"><strong>赛程源状态读取失败。</strong>${scheduleState.error}</div><span class="muted">请启动本地后端并切换「后端API」。</span></div>`;
    const s = scheduleState;
    const meta = s.meta || { total: 0, admitted: 0, rejected: 0 };
    const schedCacheBadge = (s.cached === 'local')
      ? '<span class="badge info">当日缓存·本地</span>'
      : (s.cached === true ? '<span class="badge info">当日缓存·后端</span>' : '');
    const rows = (s.matches || []).map((m) => `<tr>
      <td class="mono">${m.match_id}</td>
      <td><span class="ing-lg">${m.league || ''}</span></td>
      <td><span class="mono">${m.home_team || ''}</span><span class="ing-name">vs ${m.away_team || ''}</span></td>
      <td class="tts mono">${(m.match_time || '').replace('T', ' ').replace('+08:00', '')}</td>
      <td><span class="badge info">${m.status || '-'}</span></td>
    </tr>`).join("") || '<tr><td colspan="5" class="empty">当前无赛程场次</td></tr>';
    const tip = s.status === 'ok'
      ? '已接入真实竞彩赛程元信息（basic 源，无盘口快照；盘口快照由本地人工盘赔源补充）。'
      : '（诚实降级，未接入真实数据）';
    return `<div class="card-mb">
      <div class="manual-src-head">
        <span class="mono">${s.source_id || 'src_schedule_sporttery'}</span>
        <span class="ing-name">竞彩官方赛程</span>
        ${manualStatusBadge(s.status)}
        ${schedCacheBadge}
        ${s.status === 'ok' ? '' : `<span class="muted">· ${s.reason || ''}</span>`}
        ${s.mode === 'http' ? '<span class="badge up">后端API</span>' : ''}
      </div>
      <div class="ing-sum mt">
        <div class="bt-chip"><b>报文字段</b><span>${meta.total}</span></div>
        <div class="bt-chip"><b>已接入</b><span class="up">${meta.admitted}</span></div>
        <div class="bt-chip"><b>拒绝</b><span class="risk">${meta.rejected}</span></div>
      </div>
      <div class="ing-table-wrap manual-table-wrap"><table class="ing-table">
        <thead><tr><th>match_id</th><th>联赛</th><th>对阵</th><th>开赛</th><th>状态</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="muted tts" style="font-size:12px">${tip} 端点经 CredentialVault 注入 · 全部 received_at 早于 match_time（防泄漏）</div>
    </div>`;
  }

  // ── 真实数据源可观测：竞彩官方赔率（当天缓存 · 公益网站减负） ──
  // 自动获取每天最多一次（当天缓存命中则零请求）；仅手动按钮直连 webapi.sporttery.cn。
  let oddsState = null; // null=加载中
  async function refreshOdds(force) {
    oddsState = null; if (window.render) window.render();
    try {
      const Api = window.__ApiClient;
      if (!Api || typeof Api.getApi !== 'function') { oddsState = { error: 'api_client_unavailable' }; if (window.render) window.render(); return; }
      const r = await Api.getApi().getSportteryOddsStatus(force ? { refresh: true } : undefined);
      oddsState = (r && r.ok) ? r.data : { error: (r && r.error) || 'http_error' };
    } catch (e) {
      oddsState = { error: String((e && e.message) || e) };
    }
    if (window.render) window.render();
  }
  function renderSportteryOddsSource() {
    if (oddsState === null) return `<div class="card-mb"><div class="empty">正在读取竞彩官方赔率（当天缓存）…</div></div>`;
    if (oddsState.error) return `<div class="card-mb"><div class="callout risk"><strong>赔率源拉取失败。</strong>${oddsState.error}</div><span class="muted">请确认网络可访问 webapi.sporttery.cn</span></div>`;
    const s = oddsState;
    const meta = s.meta || { total: 0, admitted: 0, rejected: 0 };
    const cacheBadge = (s.cached === 'local')
      ? '<span class="badge info">当日缓存·本地</span>'
      : (s.cached === true ? '<span class="badge info">当日缓存·后端</span>' : '<span class="badge up">当日直连</span>');
    const rows = (s.matches || []).map((m) => `<tr>
      <td class="mono">${m.match_id}</td>
      <td><span class="ing-lg">${m.league || ''}</span></td>
      <td><span class="mono">${m.home_team || ''}</span><span class="ing-name">vs ${m.away_team || ''}</span></td>
      <td class="tts mono">${(m.match_time || '').replace('T', ' ').replace('+08:00', '')}</td>
      <td><span class="badge info">${m.status || '-'}</span></td>
      <td><span class="ing-chip">${m.pool_count || 0}池</span></td>
    </tr>`).join("") || '<tr><td colspan="6" class="empty">当前无在售赔率场次</td></tr>';
    const tip = s.status === 'ok'
      ? '官方赔率（胜平负/让球/比分/总进球/半全场），含 impliedProb/noVigProb/fairOdds/returnRate。'
      : '（降级，未拉到真实赔率数据）';
    return `<div class="card-mb">
      <div class="manual-src-head">
        <span class="mono">${s.source_id || 'src_odds_sporttery'}</span>
        <span class="ing-name">竞彩官方赔率</span>
        ${manualStatusBadge(s.status)}
        ${cacheBadge}
        ${s.status === 'ok' ? '' : `<span class="muted">· ${s.reason || ''}</span>`}
        ${s.mode === 'http' ? '<span class="badge up">后端API</span>' : ''}
        <span class="badge" style="background:#2a7d2a;color:#fff">trusted</span>
      </div>
      <div class="ing-sum mt">
        <div class="bt-chip"><b>报文字段</b><span>${meta.total}</span></div>
        <div class="bt-chip"><b>已接入</b><span class="up">${meta.admitted}</span></div>
        <div class="bt-chip"><b>拒绝</b><span class="risk">${meta.rejected}</span></div>
        <div class="bt-chip"><b>更新时间</b><span class="mono">${meta.updated_at || '-'}</span></div>
      </div>
      <div class="ing-table-wrap manual-table-wrap"><table class="ing-table">
        <thead><tr><th>match_id</th><th>联赛</th><th>对阵</th><th>开赛</th><th>状态</th><th>赔率池</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="muted tts" style="font-size:12px">${tip} 公益网站减负：自动获取每天最多直连官方一次，其余走当天缓存；点击「手动刷新」才直连 webapi.sporttery.cn · trusted 级别 · 全部 received_at 早于 match_time（防泄漏）</div>
    </div>`;
  }

  // ── 真实数据源可观测：双源合并「真实比赛池」（竞彩赛程 ∪ 本地人工盘赔） ──
  let mergedState = null; // null=加载中
  let mergedAnalysis = null; // 当前选中场次的推理链
  async function refreshMerged() {
    mergedState = null; if (window.render) window.render();
    try {
      const Api = window.__ApiClient;
      if (!Api || typeof Api.getApi !== 'function') { mergedState = { error: 'api_client_unavailable' }; if (window.render) window.render(); return; }
      const r = await Api.getApi().getMergedPool();
      mergedState = (r && r.ok) ? r.data : { error: (r && r.error) || 'http_error' };
    } catch (e) {
      mergedState = { error: String((e && e.message) || e) };
    }
    mergedAnalysis = null;
    if (window.render) window.render();
  }
  async function analyzeMergedMatch(i) {
    if (!mergedState || !mergedState.pool) return;
    const m = mergedState.pool[i]; if (!m) return;
    mergedAnalysis = null; if (window.render) window.render();
    try {
      const Api = window.__ApiClient;
      if (!Api || typeof Api.getApi !== 'function') { mergedAnalysis = { error: 'api_client_unavailable' }; if (window.render) window.render(); return; }
      const r = await Api.getApi().getMergedAnalysis(m.match_id);
      mergedAnalysis = (r && r.ok) ? r.data : { error: (r && r.error) || 'http_error' };
    } catch (e) {
      mergedAnalysis = { error: String((e && e.message) || e) };
    }
    if (window.render) window.render();
  }
  function renderMergedAnalysis() {
    if (mergedAnalysis === null) return "";
    if (mergedAnalysis.error) {
      return `<div class="ing-manual-a"><div class="callout risk"><strong>合并池推理链读取失败。</strong>${mergedAnalysis.error}</div><span class="muted">请确认后端已配置 OE_MANUAL_ODDS_ROOT 与 ODDS_SPORTTERY_SCHEDULE_BASE。</span></div>`;
    }
    const a = mergedAnalysis;
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
        <span class="mono">推理链 · ${a.match_id || ""}</span>
        <span class="ing-name">${a.merged ? "已对齐官方赛程" : "未对齐（manual_only）"}</span>
        ${dirBadge(dir, conf)}
      </div>
      <div class="ing-table-wrap manual-table-wrap"><table class="ing-table">
        <thead><tr><th>规则</th><th>版本</th><th>方向</th><th>命中</th></tr></thead>
        <tbody>${hits}</tbody>
      </table></div>
      <div class="muted tts" style="font-size:12px">盘口快照 → 特征 → 规则检索/融合 → 方向仲裁（合并池端到端）</div>
    </div>`;
  }
  function renderMergedPool() {
    if (mergedState === null) return `<div class="card-mb"><div class="empty">正在实时加载双源合并「真实比赛池」…</div></div>`;
    if (mergedState.error) return `<div class="card-mb"><div class="callout risk"><strong>合并池读取失败。</strong>${mergedState.error}</div><span class="muted">请启动本地后端并切换「后端API」。</span></div>`;
    const s = mergedState;
    const meta = s.meta || { schedule_total: 0, manual_total: 0, aligned: 0, manual_only: 0, conflicts: 0, pool_size: 0 };
    const rows = (s.pool || []).map((m, i) => `<tr>
      <td class="mono">${m.match_id}</td>
      <td><span class="ing-lg">${m.league || ''}</span></td>
      <td><span class="mono">${m.home_team || ''}</span><span class="ing-name">vs ${m.away_team || ''}</span></td>
      <td class="tts mono">${(m.match_time || '').replace('T', ' ').replace('+08:00', '')}</td>
      <td>${m.merged ? '<span class="badge up">已对齐</span>' : '<span class="badge info">manual_only</span>'}</td>
      <td class="mono">${m.snapshots}</td>
      <td>${m.actual_result ? `<span class="badge info">${m.actual_result}</span>` : '<span class="muted">-</span>'}</td>
      <td><button class="btn sm" onclick="window.__ingAnalyzeMerged(${i})">推理链</button></td>
    </tr>`).join("") || '<tr><td colspan="8" class="empty">当前无合并场次（请配置真实源）</td></tr>';
    const tip = s.status === 'ok'
      ? '已合并真实比赛池：竞彩官方赛程（trusted 元信息）∪ 本地人工盘赔（provisional 盘口快照），语义键对齐。'
      : '（诚实降级：未配置真实源或全部场次被时间防线剔除）';
    return `<div class="card-mb">
      <div class="manual-src-head">
        <span class="mono">src_merged_pool</span>
        <span class="ing-name">真实比赛池 · 双源合并</span>
        ${manualStatusBadge(s.status)}
        ${s.status === 'ok' ? '' : `<span class="muted">· ${s.reason || ''}</span>`}
        ${s.mode === 'http' ? '<span class="badge up">后端API</span>' : ''}
      </div>
      <div class="ing-sum mt">
        <div class="bt-chip"><b>赛程</b><span>${meta.schedule_total}</span></div>
        <div class="bt-chip"><b>盘赔</b><span>${meta.manual_total}</span></div>
        <div class="bt-chip"><b>已对齐</b><span class="up">${meta.aligned}</span></div>
        <div class="bt-chip"><b>仅盘赔</b><span>${meta.manual_only}</span></div>
        <div class="bt-chip"><b>时间防线剔除</b><span class="risk">${meta.conflicts}</span></div>
        <div class="bt-chip"><b>入池</b><span class="up">${meta.pool_size}</span></div>
      </div>
      <div class="ing-table-wrap manual-table-wrap"><table class="ing-table">
        <thead><tr><th>match_id</th><th>联赛</th><th>对阵</th><th>开赛</th><th>对齐</th><th>快照</th><th>赛果</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${renderMergedAnalysis()}
      <div class="muted tts" style="font-size:12px">${tip} 官方 match_time 早于盘口快照接收的场次被时间防线剔除（防泄漏）</div>
    </div>`;
  }

  window.renderIngest = renderIngest;
  window.__ingRefresh = refreshNow;
  window.__ingRefreshManual = refreshManual;
  window.__ingAnalyzeManual = analyzeManualMatch;
  // 竞彩赛程/赔率：手动刷新才直连体彩官方（公益网站减负）
  window.__ingRefreshSchedule = function () { refreshSchedule(true); };
  window.__ingRefreshOdds = function () { refreshOdds(true); };
  window.__ingRefreshMerged = refreshMerged;
  window.__ingAnalyzeMerged = analyzeMergedMatch;

  refreshManual(); // 初次进入即向后端实时拉取本地盘赔源状态
  refreshSchedule(false); // 自动获取当天竞彩赛程（当天缓存命中则零请求）
  refreshOdds(false); // 自动获取当天竞彩赔率（当天缓存命中则零请求）
  refreshMerged(); // 初次进入即向后端实时拉取双源合并「真实比赛池」

  if (typeof module !== "undefined") {
    module.exports = { SOURCES, TRUST, recent, statsOf, ocrToken, renderIngest };
  }
}