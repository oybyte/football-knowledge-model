// ============================================================================
// 历史赛事 · 历史比赛处理状态总览（Phase 1 · 纯前端）
// 单一入口看全部历史比赛的处理状态：场次 / 赛果 / 下钻推理链（历史场为纯本地明细，不做体彩锚定）。
// 数据全部来自合并池（/api/sources/merged，竞彩锚定 ∪ 本地人工盘赔）：
//   · 赛果 actual_result 来自盘口数据.md（provisional，已解析）
//   · 历史比赛为纯本地明细（provisional），不做体彩锚定；锚定仅限当天在售截止场（见数据来源分层原则）
//   · 推理链经 /api/merged/analysis/:id 下钻（规则命中 / 方向 / 置信度）
// 诚实原则：不展示未实现的「命中判定 / 回填 / 回测」列（Phase 2 需后端批量端点）。
// ============================================================================
'use strict';

if (typeof window !== "undefined" && !window.__historicalLoaded) {
  window.__historicalLoaded = true;

  let histState = null;     // 合并池数据（null=加载中）
  let histFilter = "all";   // 当前筛选 chip
  let histAnalysis = null;  // 选中场次的推理链
  let histSelected = -1;    // 选中场次在 pool 中的下标
  let histBooted = false;   // 懒加载守卫：api-client 就绪后仅自动拉取一次

  async function refreshHistorical() {
    histState = null; if (window.render) window.render();
    try {
      const Api = window.__ApiClient;
      if (!Api || typeof Api.getApi !== "function") { histState = { error: "api_client_unavailable" }; if (window.render) window.render(); return; }
      const r = await Api.getApi().getMergedPool();
      histState = (r && r.ok) ? r.data : { error: (r && r.error) || "http_error" };
    } catch (e) {
      histState = { error: String((e && e.message) || e) };
    }
    histAnalysis = null; histSelected = -1;
    if (window.render) window.render();
  }

  async function analyzeHistoricalMatch(i) {
    if (!histState || !histState.pool) return;
    const m = histState.pool[i]; if (!m) return;
    histSelected = i; histAnalysis = null; if (window.render) window.render();
    try {
      const Api = window.__ApiClient;
      if (!Api || typeof Api.getApi !== "function") { histAnalysis = { error: "api_client_unavailable" }; if (window.render) window.render(); return; }
      const r = await Api.getApi().getMergedAnalysis(m.match_id);
      histAnalysis = (r && r.ok) ? r.data : { error: (r && r.error) || "http_error" };
    } catch (e) {
      histAnalysis = { error: String((e && e.message) || e) };
    }
    if (window.render) window.render();
  }

  function dirBadge(dir, conf) {
    // 真实方向枚举为 favor_upper/favor_lower/favor_draw + undecidable（兼容旧 short 别名）
    const map = {
      favor_upper: ["看好上盘", "up"], upper: ["看好上盘", "up"],
      favor_lower: ["看好下盘", "down"], lower: ["看好下盘", "down"],
      favor_draw: ["平手盘", "warn"], draw: ["平手盘", "warn"],
      undecidable: ["不可判定", "info"]
    };
    const v = map[dir] || [dir || "未知", "info"];
    return `<span class="badge ${v[1]}">${v[0]}${conf != null ? " · " + Math.round(conf * 100) + "%" : ""}</span>`;
  }

  function renderHistoricalAnalysis() {
    if (histAnalysis === null) return "";
    if (histAnalysis.error) {
      return `<div class="ing-manual-a"><div class="callout risk"><strong>推理链读取失败。</strong>${histAnalysis.error}</div><span class="muted">请确认已配置 OE_MANUAL_ODDS_ROOT，且该场次源于本地人工盘赔源。</span></div>`;
    }
    const a = histAnalysis;
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
        ${dirBadge(dir, conf)}
        ${a.mode === "http" ? '<span class="badge up">后端API</span>' : ""}
      </div>
      <div class="ing-table-wrap manual-table-wrap"><table class="ing-table">
        <thead><tr><th>规则</th><th>版本</th><th>方向</th><th>命中</th></tr></thead>
        <tbody>${hits}</tbody>
      </table></div>
      <div class="muted tts" style="font-size:12px">盘口快照 → 特征 → 规则检索/融合 → 方向仲裁（合并池端到端）</div>
    </div>`;
  }

  // 懒加载：页面首次渲染时 api-client 必然已就绪（脚本加载顺序保证），仅触发一次。
  // 模块加载时 window.__ApiClient 尚未定义，故不在 IIFE 顶层拉取，改在首次渲染时拉取。
  function ensureBoot() {
    if (histBooted) return;
    const Api = window.__ApiClient;
    if (Api && typeof Api.getApi === "function") {
      histBooted = true;
      refreshHistorical();
    }
  }

  function renderHistorical() {
    ensureBoot(); // 首次渲染且 api-client 就绪时自动拉取合并池
    if (histState === null) {
      return `<div class="page"><div class="page-head"><div class="ph-title">历史赛事</div></div><div class="empty">正在加载合并池（历史比赛）…</div></div>`;
    }
    if (histState.error) {
      return `<div class="page"><div class="page-head"><div class="ph-title">历史赛事</div></div><div class="callout risk"><strong>合并池读取失败。</strong>${histState.error}</div><span class="muted">请确认已启动本地后端（localhost:3000）并切换为「后端API」。</span></div>`;
    }
    const s = histState;
    const pool = (s.pool || []);
    const meta = s.meta || { schedule_total: 0, manual_total: 0, aligned: 0, manual_only: 0, conflicts: 0, pool_size: 0 };

    const filtered = pool.filter(m => {
      if (histFilter === "all") return true;
      if (histFilter === "hasResult") return !!m.actual_result;
      if (histFilter === "noResult") return !m.actual_result;
      return true;
    });

    const rows = filtered.map((m) => {
      const origIdx = pool.indexOf(m);
      const result = m.actual_result ? `<span class="badge info">${m.actual_result}</span>` : '<span class="muted">待赛果</span>';
      const sel = (origIdx === histSelected) ? ' style="background:var(--bg2)"' : "";
      return `<tr${sel}>
        <td class="mono">${m.match_id}</td>
        <td><span class="ing-lg">${m.league || ""}</span></td>
        <td><span class="mono">${m.home_team || ""}</span><span class="ing-name">vs ${m.away_team || ""}</span></td>
        <td class="tts mono">${(m.match_time || "").replace("T", " ").replace("+08:00", "")}</td>
        <td>${result}</td>
        <td><button class="btn sm" onclick="window.__histAnalyze(${origIdx})">推理链</button></td>
      </tr>`;
    }).join("") || '<tr><td colspan="6" class="empty">当前筛选无历史赛事</td></tr>';

    const chips = [
      ["all", "全部"], ["hasResult", "有赛果"], ["noResult", "无赛果"]
    ].map(([k, lab]) => `<span class="chip ${histFilter === k ? "active" : ""}" onclick="window.__histSetFilter('${k}')">${lab}</span>`).join("");

    return `<div class="page">
      <div class="page-head">
        <div class="ph-title">历史赛事</div>
        <div class="ph-sub">历史比赛处理状态总览 · 合并池（历史场为纯本地盘赔明细，不做体彩锚定）</div>
        <div class="ph-actions"><button class="btn sm primary" onclick="window.__histRefresh()">实时刷新·合并池</button></div>
      </div>
      <div class="ing-sum">
        <div class="bt-chip"><b>入池</b><span>${meta.pool_size}</span></div>
        <div class="bt-chip"><b>有赛果</b><span class="up">${pool.filter(m => !!m.actual_result).length}</span></div>
        <div class="bt-chip"><b>无赛果</b><span>${pool.filter(m => !m.actual_result).length}</span></div>
        <div class="bt-chip"><b>时间防线剔除</b><span class="risk">${meta.conflicts}</span></div>
        <div class="bt-chip"><b>当前筛选</b><span>${filtered.length}</span></div>
      </div>
      <div class="lottery-datebar" style="margin:10px 0">${chips}</div>
      <div class="card" style="margin-top:8px"><div class="card-hd"><div class="title">历史比赛列表</div><div class="extra muted">赛果来自盘口数据.md · 锚定取自合并池 · 点击「推理链」下钻</div></div>
        <div class="card-bd ing-table-wrap manual-table-wrap"><table class="ing-table">
          <thead><tr><th>match_id</th><th>联赛</th><th>对阵</th><th>开赛</th><th>赛果</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        ${renderHistoricalAnalysis()}
      </div>
    </div>`;
  }

  window.renderHistorical = renderHistorical;
  window.__histRefresh = refreshHistorical;
  window.__histAnalyze = analyzeHistoricalMatch;
  window.__histSetFilter = (f) => { histFilter = f; if (window.render) window.render(); };

  // 注：不在此处调用 refreshHistorical()——模块加载时 api-client 尚未就绪，
  // 改为首次渲染时经 ensureBoot() 懒拉取，避免残留 api_client_unavailable。
}
