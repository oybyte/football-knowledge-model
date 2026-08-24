// ============================================================================
// 后端接入 · 视图 —— 阶段 2.5 原型-后端集成演示
// 通过 window.__ApiClient 的「活动适配器」（mock / http）消费六类后端能力，
// 证明：规则库(版本+状态) / 分析(推理链) / AI 候选审核 均可经同一契约接入，
// 且 mock 与真实模式无需改动视图代码。
// ============================================================================
if (typeof window !== "undefined" && !window.__apiViewLoaded) {
  window.__apiViewLoaded = true;

  const api = () => (window.__ApiClient ? window.__ApiClient.getApi() : null);
  const statusOf = () => (window.__ApiClient ? window.__ApiClient.getStatus() : { mode: "mock", adapter: "?" });

  // ── 视图外壳 ──
  window.renderApiView = function renderApiView() {
    return `<div class="page api-page">
      <div class="api-hero">
        <div class="api-hero-title">原型 ↔ 后端 · API 集成</div>
        <div class="api-hero-sub">活动数据源：<span class="api-mode ${statusOf().mode === 'real' ? 'real' : 'mock'}">${statusOf().mode === 'real' ? '后端 API' : 'Mock 数据'}</span> · 适配器 ${statusOf().adapter} · 默认端点 ${window.__ApiClient ? window.__ApiClient.DEFAULT_BASE : ''}</div>
      </div>

      <div class="api-ctl">
        <button class="btn sm ${statusOf().mode === 'real' ? '' : 'primary'}" onclick="window.__apiSetMode('mock')">Mock 模式（离线）</button>
        <button class="btn sm ${statusOf().mode === 'real' ? 'primary' : ''}" onclick="window.__apiSetMode('real')">真实 API 模式</button>
        <span class="api-hint">切换持久化至 localStorage · oe_api_mode · 不改视图代码</span>
      </div>

      <div class="api-grid">
        <div class="api-card">
          <div class="api-card-h">规则库 · 版本 + 状态</div>
          <div class="api-card-body" id="api-rules">载入中…</div>
        </div>
        <div class="api-card">
          <div class="api-card-h">分析 · 推理链</div>
          <select class="api-sel" id="api-match" onchange="window.__apiBootAnalysis()"></select>
          <div class="api-card-body" id="api-analysis">载入中…</div>
        </div>
        <div class="api-card">
          <div class="api-card-h">AI 候选审核（Containment）</div>
          <div class="api-card-body" id="api-ai">载入中…</div>
        </div>
      </div>
    </div>`;
  };

  // ── 填充规则库 ──
  window.__apiBootRules = async function __apiBootRules() {
    const box = document.getElementById("api-rules");
    if (!box) return;
    const a = api(); if (!a) { box.innerHTML = emptyBox("API 客户端未加载"); return; }
    try {
      const res = await a.listRules();
      if (!res.ok) { box.innerHTML = emptyBox(res.error); return; }
      const rows = (res.data || []).slice(0, 8).map(r =>
        `<tr>
          <td class="l"><span class="rule-id">${r.id}</span></td>
          <td class="l">${r.conclusion || r.id}</td>
          <td><span class="badge ${r.status === 'active' ? 'up' : 'muted'}">${r.status}</span></td>
          <td class="num">v${r.version}</td>
          <td><span class="badge ${r.trust_level === 'untrusted' ? 'risk' : (r.trust_level === 'provisional' ? 'warn' : 'up')}">${r.trust_level}</span></td>
        </tr>`).join("");
      box.innerHTML = `<table class="tbl"><thead><tr><th>规则</th><th>结论</th><th>状态</th><th>版本</th><th>信任</th></tr></thead><tbody>${rows}</tbody></table>`;
    } catch (e) { box.innerHTML = emptyBox(e.message); }
  };

  // ── 填充比赛下拉 ──
  window.__apiBootMatches = async function __apiBootMatches() {
    const sel = document.getElementById("api-match");
    if (!sel) return;
    const a = api(); if (!a) return;
    try {
      const res = await a.listMatches();
      sel.innerHTML = (res.data || []).map(m =>
        `<option value="${m.match_id}">${m.home_team || m.home} vs ${m.away_team || m.away} · ${m.league}</option>`).join("");
    } catch (e) { /* 忽略 */ }
  };

  // ── 填充分析推理链 ──
  window.__apiBootAnalysis = async function __apiBootAnalysis() {
    const box = document.getElementById("api-analysis");
    const sel = document.getElementById("api-match");
    if (!box) return;
    const id = sel && sel.value ? sel.value : "M007";
    const a = api(); if (!a) { box.innerHTML = emptyBox("API 客户端未加载"); return; }
    box.innerHTML = "分析中…";
    try {
      const res = await a.getAnalysis(id);
      if (!res.ok) { box.innerHTML = emptyBox(res.error); return; }
      const list = res.data.reasoning || [];
      if (!list.length) { box.innerHTML = emptyBox("无命中规则（推理链为空）"); return; }
      box.innerHTML = list.map(h =>
        `<div class="tl-row">
          <div class="tl-time">${h.rule_id}</div>
          <div class="al-lvl ${h.hit ? 'ok' : 'muted'}">${h.hit ? '命中' : '未命中'}</div>
          <div class="al-ev">${h.note || ''}${h.dir != null ? ' · dir=' + h.dir : ''}</div>
        </div>`).join("");
    } catch (e) { box.innerHTML = emptyBox(e.message); }
  };

  // ── 填充 AI 候选 ──
  window.__apiBootAi = async function __apiBootAi() {
    const box = document.getElementById("api-ai");
    if (!box) return;
    const a = api(); if (!a) { box.innerHTML = emptyBox("API 客户端未加载"); return; }
    try {
      const res = await a.listAiCandidates();
      const list = (res.data || []).slice(0, 6);
      if (!list.length) { box.innerHTML = emptyBox("无 AI 候选"); return; }
      box.innerHTML = list.map(c =>
        `<div class="api-ai-row">
          <div class="api-ai-head"><span class="rule-id">${c.id}</span><span class="badge ${c.status === 'pending' ? 'risk' : 'muted'}">${c.status}</span><span class="badge risk">untrusted</span></div>
          <div class="api-ai-pat">${c.pattern || ''}</div>
          <div class="api-ai-actions">
            <button class="btn sm primary" onclick="window.__apiReview('${c.id}','approve')">采纳</button>
            <button class="btn sm" onclick="window.__apiReview('${c.id}','reject')">驳回</button>
          </div>
        </div>`).join("");
    } catch (e) { box.innerHTML = emptyBox(e.message); }
  };

  // ── 审核操作 ──
  window.__apiReview = async function __apiReview(id, verdict) {
    const a = api(); if (!a) return;
    const res = await a.reviewAiCandidate(id, verdict);
    if (typeof window.toast === "function") window.toast(res.ok ? `候选 ${id} 已${verdict === 'approve' ? '采纳' : '驳回'}` : res.error);
    window.__apiBootAi();
  };

  window.__apiSetMode = function __apiSetMode(mode) {
    if (window.__ApiClient) window.__ApiClient.setMode(mode);
    location.reload();
  };

  // ── 统一启动 ──
  window.__apiBoot = function __apiBoot() {
    window.__apiBootMatches();
    window.__apiBootRules();
    window.__apiBootAnalysis();
    window.__apiBootAi();
  };

  function emptyBox(msg) { return `<div class="muted" style="padding:8px 4px;font-size:12px">${msg}</div>`; }
}