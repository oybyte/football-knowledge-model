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
        <div class="ph-actions"><button class="btn sm primary" onclick="window.__ingRefresh()">模拟采集刷新</button></div>
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
    </div>`;
  }

  window.renderIngest = renderIngest;
  window.__ingRefresh = refreshNow;

  if (typeof module !== "undefined") {
    module.exports = { SOURCES, TRUST, recent, statsOf, ocrToken, renderIngest };
  }
}