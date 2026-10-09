// ============================================================================
// 特征引擎 · 特征快照监督视图（真实端点 /api/features/:id）
// 数据来源：后端合并池（体彩锚定 ∪ 本地人工盘赔）→ computeMatchFeatures 纯函数。
// 契约：
//   · point-in-time：特征是 raw 快照的纯函数，给定同一历史算出完全一致 → 回测可复现、无泄漏
//   · 快照完整性：后端未产出的字段渲染为「—」并计入「未产出」，**绝不补零/猜测**（宁缺毋滥）
//   · 缓存语义：后端 FeatureCache TTL 30 分钟；本页只如实展示 computed_at + feature_version，
//     不再模拟「缓存命中/未命中」的假信号
// 双轨：mock 模式（离线降级）复用原型 features.js 的 computeFeatures，族结构与真实模式同形。
// ============================================================================
'use strict';

if (typeof window !== "undefined" && !window.__featureLoaded) {
  window.__featureLoaded = true;

  // 特征族元数据（字段键 → 展示标签/公式说明），与 features.computeFeatures 族结构对齐
  const META = {
    cross: { title: "横截面差异", sub: "单时点 × 多机构", fields: [
      { k: "handicap_dispersion", label: "盘口离散", note: "max(h) − min(h)" },
      { k: "home_water_dispersion", label: "主水离散", note: "max(hw) − min(hw)" },
      { k: "away_water_dispersion", label: "客水离散", note: "max(aw) − min(aw)" }
    ] },
    temp: { title: "时序差异", sub: "单机构 × 时序", fields: [
      { k: "handicap_movement", label: "盘口移动", note: "avg(Δh)：<0 升盘 · >0 降盘" },
      { k: "home_water_movement", label: "主水移动", note: "avg(Δhw)：<0 降水 · >0 升水" },
      { k: "away_water_movement", label: "客水移动", note: "avg(Δaw)" },
      { k: "move_pattern", label: "移动形态", note: "盘口+水位组合" },
      { k: "stability_flag", label: "盘口冻结", note: "变动≤1 家" },
      { k: "home_water_drop_count", label: "主水下调家数", note: "Δhw ≤ −0.08" },
      { k: "home_water_rise_count", label: "主水上调家数", note: "Δhw ≥ +0.08" }
    ] },
    reso: { title: "共振差异", sub: "多机构 × 时序", fields: [
      { k: "sync_handicap_count", label: "盘口同向家数", note: "max(升家数, 降家数)" },
      { k: "sync_home_water_count", label: "主水同向家数", note: "max(升水, 降水)" },
      { k: "consensus_direction", label: "一致方向", note: "同向≥3 判升盘/降盘" }
    ] },
    anom: { title: "异常指标", sub: "衍生计算", fields: [
      { k: "maxKelly", label: "凯利最高", note: "让球盘凯利" },
      { k: "minKelly", label: "凯利最低", note: "让球盘凯利" },
      { k: "kelly_divergence", label: "凯利背离", note: "max − min" },
      { k: "volume_anomaly", label: "成交异常", note: "volume / 基线 均值" }
    ] },
    onex: { title: "欧指特征", sub: "1X2 + 凯利", fields: [
      { k: "home_odds_movement", label: "主胜均值位移", note: "avg(Δh)" },
      { k: "kelly_home_max", label: "主凯利最高", note: "源凯利 h" },
      { k: "kelly_home_min", label: "主凯利最低", note: "源凯利 h" },
      { k: "kelly_home_divergence", label: "主凯利背离", note: "max − min" },
      { k: "kelly_away_max", label: "客凯利最高", note: "源凯利 a" }
    ] },
    betfair: { title: "必发资金面", sub: "盈亏/热度", fields: [
      { k: "turnover", label: "成交额", note: "turnover" },
      { k: "heat_max", label: "热度最高", note: "max(heat)" },
      { k: "heat_min", label: "热度最低", note: "min(heat)" },
      { k: "dominant_result", label: "主导结果", note: "volume 最大" },
      { k: "dominant_ratio", label: "主导占比", note: "vol / total" }
    ] }
  };

  // ───────────────────────── 页面状态（异步渲染单一事实源） ─────────────────────────
  const FEAT_STATE = {
    mode: "real",     // 'http' | 'mock'
    matchId: null,
    pool: [],         // [{ match_id, label }]
    data: null,       // { match_id, features:{族嵌套}, meta, computed_at, feature_version }
    loading: false,
    error: null,
    reqSeq: 0,        // 竞态防护：响应回来时序号不符则丢弃
  };

  function getApi() { return window.__ApiClient ? window.__ApiClient.getApi() : null; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  /** 仅在当前确实停留在特征页时局部重渲（避免污染其它页面）。 */
  function rerender() {
    const main = document.getElementById("main");
    if (!main) return;
    let onPage = false;
    try { onPage = (typeof state !== "undefined") && state.page === "feature"; } catch (e) { onPage = false; }
    if (onPage) main.innerHTML = window.renderFeature();
  }

  function fmt(v) {
    if (v === null || v === undefined || v === "") return `<span class="muted">—</span>`;
    if (typeof v === "boolean") return v ? `<span class="badge up">是</span>` : `<span class="badge muted">否</span>`;
    if (typeof v === "number") return +v.toFixed(3);
    return esc(v);
  }

  /** 全族字段产出统计（未产出 = 该字段键在族对象中不存在）。 */
  function missStats(f) {
    let total = 0, produced = 0;
    Object.keys(META).forEach(fam => {
      const obj = (f && f[fam]) || {};
      META[fam].fields.forEach(fd => {
        total++;
        if (Object.prototype.hasOwnProperty.call(obj, fd.k)) produced++;
      });
    });
    return { total, produced, missing: total - produced };
  }

  function familyPanel(name, f) {
    const meta = META[name];
    const obj = (f && f[name]) || {};
    const rows = meta.fields.map(fd => ({
      fd,
      produced: Object.prototype.hasOwnProperty.call(obj, fd.k),
      raw: obj[fd.k],
    }));
    const producedCount = rows.filter(r => r.produced).length;
    if (!producedCount) {
      return `<div class="card"><div class="card-hd"><div class="title">${meta.title}</div><div class="extra muted">${meta.sub}</div></div>
        <div class="card-bd"><div class="empty">该族 ${meta.fields.length} 项字段后端均未产出</div></div></div>`;
    }
    const tiles = rows.map(r => {
      const v = r.produced ? fmt(r.raw) : `<span class="muted">—</span>`;
      const note = r.produced ? r.fd.note : `<span class="muted">后端未产出</span>`;
      return `<div class="bt-metric"><div class="bmt-k">${r.fd.label}</div><div class="bmt-v">${v}</div><div class="bmt-t">${note}</div></div>`;
    }).join("");
    const missN = rows.length - producedCount;
    return `<div class="card"><div class="card-hd"><div class="title">${meta.title}</div><div class="extra muted">${meta.sub}${missN ? ` · 未产出 ${missN} 项` : ""}</div></div>
      <div class="card-bd bt-metrics-grid">${tiles}</div></div>`;
  }

  function headHtml() {
    const opts = FEAT_STATE.pool.map(p =>
      `<option value="${esc(p.match_id)}" ${p.match_id === FEAT_STATE.matchId ? "selected" : ""}>${esc(p.label)}</option>`).join("");
    const mockBadge = FEAT_STATE.mode === "mock" ? `<span class="badge mock" style="margin-left:8px">Mock 计算示意</span>` : "";
    return `<div class="page-head">
      <div class="ph-title">特征引擎${mockBadge}</div>
      <div class="ph-sub">四族 + 欧指 + 必发 · point-in-time 纯函数 · ${FEAT_STATE.mode === "mock" ? "离线沙盒" : "后端 /api/features/:id"}</div>
      <div class="ph-actions">
        <label class="sel-label">比赛
          <select class="sel" onchange="window.__featSelect(this.value)" ${FEAT_STATE.pool.length ? "" : "disabled"}>
            ${opts || `<option>暂无场次</option>`}
          </select>
        </label>
        <button class="btn sm" onclick="window.__featRefresh()">刷新</button>
      </div>
    </div>`;
  }

  function renderFeature() {
    const head = headHtml();

    if (FEAT_STATE.loading) {
      return `<div class="page">${head}<div class="empty" style="margin-top:16px">正在加载真实数据…</div></div>`;
    }
    if (FEAT_STATE.error) {
      return `<div class="page">${head}
        <div class="empty" style="margin-top:16px">后端不可用（error: ${esc(FEAT_STATE.error)}）· 可在左下角切换 Mock 模式</div></div>`;
    }
    if (!FEAT_STATE.pool.length) {
      return `<div class="page">${head}
        <div class="empty" style="margin-top:16px">合并池暂无场次（未配置体彩锚定 / 本地人工盘赔源）</div></div>`;
    }
    const d = FEAT_STATE.data;
    if (!d) {
      return `<div class="page">${head}<div class="empty" style="margin-top:16px">请选择场次</div></div>`;
    }

    const f = d.features || {};
    const st = missStats(f);
    const nonEmpty = Object.keys(META).filter(k => f[k] && Object.keys(f[k]).length).length;
    const meta = d.meta || {};
    const cur = FEAT_STATE.pool.find(p => p.match_id === d.match_id);
    const curLabel = (cur && cur.label) || d.match_id;
    const snap = meta.snapshot_count != null ? `${meta.snapshot_count} 条` : "—";

    const banner = FEAT_STATE.mode === "mock"
      ? `Mock 沙盒：复用原型 <code>features.js</code> 计算，仅作离线降级演示，<strong>不代表后端产出</strong>。`
      : `特征来自后端 <code>/api/features/:id</code>（raw 快照的<strong>纯函数</strong>）：同一历史必算出完全一致的结果 → 回测严格可复现、杜绝时间泄漏。后端未产出的字段显示「—」并计入未产出，<strong>绝不补零</strong>。`;

    return `<div class="page">
      ${head}
      <div class="pipeline-banner">${banner}</div>

      <div class="ing-sum" style="margin-top:12px">
        <div class="bt-chip"><b>场次</b><span class="mono">${esc(curLabel)}</span></div>
        <div class="bt-chip"><b>特征族</b><span>${nonEmpty}/${Object.keys(META).length}</span></div>
        <div class="bt-chip"><b>字段产出</b><span>${st.produced} / ${st.total}</span></div>
        <div class="bt-chip"><b>未产出</b><span class="${st.missing ? "brand" : "muted"}">${st.missing} 项</span></div>
        <div class="bt-chip"><b>快照</b><span class="mono">${snap}${meta.filtered_out ? " · 过滤 " + meta.filtered_out : ""}</span></div>
        <div class="bt-chip"><b>计算</b><span class="mono">${esc(d.feature_version || "—")}${d.computed_at ? " · " + esc(String(d.computed_at).slice(0, 16)) : ""}</span></div>
      </div>

      <div class="feat-grid">
        ${familyPanel("cross", f)}
        ${familyPanel("temp", f)}
        ${familyPanel("reso", f)}
        ${familyPanel("anom", f)}
        ${familyPanel("onex", f)}
        ${familyPanel("betfair", f)}
      </div>
    </div>`;
  }

  // ───────────────────────── 取数 ─────────────────────────
  /** 拉取场次池（真实=合并池；mock=原型 MATCHES），随后加载首个场次特征。 */
  async function loadPool() {
    const a = getApi();
    FEAT_STATE.loading = true; FEAT_STATE.error = null;
    rerender();
    try {
      if (a && a.name === "http") {
        const r = await a.getMergedPool();
        if (!r.ok) { FEAT_STATE.loading = false; FEAT_STATE.error = r.error || "unknown"; rerender(); return; }
        FEAT_STATE.pool = (r.data.pool || []).map(m => ({
          match_id: m.match_id,
          label: `${m.league} ${m.home_team} vs ${m.away_team}${m.merged ? " · 已锚定" : " · 未锚定"}`,
        }));
      } else {
        const M = (typeof MATCHES !== "undefined" && MATCHES) || [];
        FEAT_STATE.pool = M.map(m => ({ match_id: m.id, label: `${m.id} · ${m.league} ${m.home} vs ${m.away}` }));
      }
    } catch (e) {
      FEAT_STATE.loading = false;
      FEAT_STATE.error = String((e && e.message) || e);
      rerender();
      return;
    }
    FEAT_STATE.loading = false;
    if (!FEAT_STATE.pool.length) { FEAT_STATE.data = null; rerender(); return; }
    FEAT_STATE.matchId = FEAT_STATE.pool[0].match_id;
    FEAT_STATE.data = null;
    await loadFeature(FEAT_STATE.matchId);
  }

  /** 加载单场特征快照（带请求序号防竞态）。 */
  async function loadFeature(id) {
    const a = getApi();
    if (!a) { FEAT_STATE.error = "api_client_unavailable"; rerender(); return; }
    const seq = ++FEAT_STATE.reqSeq;
    FEAT_STATE.loading = true; FEAT_STATE.error = null;
    rerender();
    let r;
    try { r = await a.getFeature(id); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (seq !== FEAT_STATE.reqSeq) return; // 过期响应（用户已切场次）→ 丢弃
    FEAT_STATE.loading = false;
    if (!r.ok) { FEAT_STATE.data = null; FEAT_STATE.error = r.error || "unknown"; rerender(); return; }
    FEAT_STATE.data = r.data;
    rerender();
  }

  /** 路由入口：仅做必要取数（已有同场数据则直接复用）。 */
  function featBoot() {
    const a = getApi();
    FEAT_STATE.mode = a ? a.name : "mock";
    if (!FEAT_STATE.pool.length) { loadPool(); return; }
    if (!FEAT_STATE.matchId) FEAT_STATE.matchId = FEAT_STATE.pool[0].match_id;
    if (FEAT_STATE.data && FEAT_STATE.data.match_id === FEAT_STATE.matchId) { rerender(); return; }
    loadFeature(FEAT_STATE.matchId);
  }

  function select(id) {
    if (!id || id === FEAT_STATE.matchId) return;
    FEAT_STATE.matchId = id;
    FEAT_STATE.data = null;
    FEAT_STATE.error = null;
    FEAT_STATE.loading = true;
    if (window.render) window.render(); // 走路由 → 渲染 loading 骨架 + featBoot 取数
  }

  /** 重新取数（后端 FeatureCache TTL 30min，命中则返回同一快照——诚实，不做假清除）。 */
  function refresh() {
    if (!FEAT_STATE.matchId) return;
    FEAT_STATE.data = null;
    loadFeature(FEAT_STATE.matchId);
  }

  window.renderFeature = renderFeature;
  window.__featBoot = featBoot;
  window.__featSelect = select;
  window.__featRefresh = refresh;
  window.__featClear = refresh; // 兼容旧调用名（不再模拟本地缓存清除）

  if (typeof module !== "undefined") {
    module.exports = { META, FEAT_STATE, select, refresh, featBoot, renderFeature, missStats };
  }
}
