// ============================================================================
// 特征引擎 · 特征计算监督视图（交互原型 · Mock/占位）
// 复刻后端 1.2 特征工程：四族（横截面/时序/共振/异常）+ 欧指 + 必发 纯函数计算。
// 契约：
//   · point-in-time：特征是 raw 快照的纯函数，给定同一历史算出完全一致 → 回测可复现、无泄漏
//   · 缓存策略：TTL 30 分钟，命中缓存直接返回（渲染侧模拟命中/未命中）
//   · 快照完整性：字段齐全；缺失数据源（如 mock 场无欧指/必发）字段留空而非污染
// 界面仅展示计算值与来源说明，不做生产精度/ROI 表述。
// ============================================================================
'use strict';

if (typeof window !== "undefined" && !window.__featureLoaded) {
  window.__featureLoaded = true;

  // 特征族元数据（字段键 → 展示标签/公式说明），与 features.computeFeatures 对齐
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

  const FSel = { matchId: "M007" }; // 默认真实全量场（特征最全）
  const Cache = {};

  function select(id) { if (MATCHES && MATCHES.some(m => m.id === id)) FSel.matchId = id; if (window.render) window.render(); }
  function clearCache() { for (const k in Cache) delete Cache[k]; if (window.render) window.render(); }

  function fmt(v) {
    if (v === null || v === undefined || v === "") return `<span class="muted">—</span>`;
    if (typeof v === "boolean") return v ? `<span class="badge up">是</span>` : `<span class="badge muted">否</span>`;
    if (typeof v === "number") return +v.toFixed(3);
    return v;
  }

  function familyPanel(name) {
    const meta = META[name];
    const f = FSel.f;
    const obj = f[name];
    if (!obj || (typeof obj === "object" && !Object.keys(obj).length)) {
      return `<div class="card"><div class="card-hd"><div class="title">${meta.title}</div><div class="extra muted">${meta.sub}</div></div>
        <div class="card-bd"><div class="empty">当前比赛无此数据源，字段留空（不污染快照）</div></div></div>`;
    }
    const tiles = meta.fields.map(fd => {
      const raw = obj[fd.k];
      const v = fmt(raw);
      return `<div class="bt-metric"><div class="bmt-k">${fd.label}</div><div class="bmt-v">${v}</div><div class="bmt-t">${fd.note}</div></div>`;
    }).join("");
    return `<div class="card"><div class="card-hd"><div class="title">${meta.title}</div><div class="extra muted">${meta.sub}</div></div>
      <div class="card-bd bt-metrics-grid">${tiles}</div></div>`;
  }

  function renderFeature() {
    const id = FSel.matchId;
    const m = MATCHES.find(x => x.id === id) || MATCHES[0];
    FSel.f = window.computeFeatures ? window.computeFeatures(m) : (typeof computeFeatures === "function" ? computeFeatures(m) : {});
    const f = FSel.f;
    const fromCache = !!Cache[id]; Cache[id] = true;

    const nonEmptyCount = Object.values(f).filter(o => o && typeof o === "object" && Object.keys(o).length).length;

    return `<div class="page">
      <div class="page-head">
        <div class="ph-title">特征引擎<span class="badge mock" style="margin-left:8px">Mock 计算示意</span></div>
        <div class="ph-sub">四族 + 欧指 + 必发 · point-in-time 纯函数 · 缓存 TTL 30 分钟</div>
        <div class="ph-actions">
          <label class="sel-label">比赛
            <select class="sel" onchange="window.__featSelect(this.value)">
              ${MATCHES.map(x => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${x.id} · ${x.league} ${x.home} vs ${x.away}${x.real ? "" : " (Mock)"}</option>`).join("")}
            </select>
          </label>
          <button class="btn sm" onclick="window.__featClear()">清除缓存</button>
        </div>
      </div>
      <div class="pipeline-banner">特征是 raw 快照的<strong>纯函数</strong>：同一历史必算出完全一致的结果 → 回测严格可复现、杜绝时间泄漏。缺失数据源字段留空而非注入占位污染。</div>

      <div class="ing-sum" style="margin-top:12px">
        <div class="bt-chip"><b>比赛</b><span class="mono">${id} · ${m.home} vs ${m.away}</span></div>
        <div class="bt-chip"><b>特征族</b><span>${nonEmptyCount}/${Object.keys(META).length}</span></div>
        <div class="bt-chip"><b>缓存</b><span class="${fromCache ? "up" : "brand"}">${fromCache ? "命中 · TTL内" : "未命中 → 已写入"}</span></div>
        <div class="bt-chip"><b>快照</b><span class="mono">raw→features</span></div>
      </div>

      <div class="feat-grid">
        ${familyPanel("cross")}
        ${familyPanel("temp")}
        ${familyPanel("reso")}
        ${familyPanel("anom")}
        ${familyPanel("onex")}
        ${familyPanel("betfair")}
      </div>
    </div>`;
  }

  window.renderFeature = renderFeature;
  window.__featSelect = select;
  window.__featClear = clearCache;

  if (typeof module !== "undefined") {
    module.exports = { META, FSel, Cache, select, clearCache, renderFeature };
  }
}