// ============================================================================
// DSL 引擎 · 规则条件求值视图（交互原型 · Mock/占位）
// 复刻后端 1.4 DSL 引擎语义，把 JS 规则 test() 翻译为可审计的条件步：
//   · 11 算子：EQ / NEQ / GT / GTE / LT / LTE / BETWEEN / IN / PATTERN / ABS_GT / ABS_LT
//   · 引用：$feat.<路径> 读特征快照；$raw.<外部引用> 读原始快照（本质同后端外部引用解析）
//   · 分组组合：all（全部通过）/ any（任一通过）+ 前置 guard（如 NOT_NULL 防空指针）
//   · 求值：逐条件展示 算子→期望→实际→通过/未通过，输出命中/未命中 + 推理链
// 命中判定与现有 evaluate()（预测链同源）保持一致性，避免 UI 与预测链矛盾。
// 界面仅展示计算过程，不做生产精度/ROI 表述。
// ============================================================================
'use strict';

if (typeof window !== "undefined" && !window.__dslLoaded) {
  window.__dslLoaded = true;

  // ---- 算子求值 ----
  function applyOp(op, a, v) {
    if (op === "NOT_NULL") return a !== null && a !== undefined && a !== "";
    if (a === null || a === undefined) return false;
    if (op === "EQ") return a === v;
    if (op === "NEQ") return a !== v;
    if (Array.isArray(v) && op === "IN") return (Array.isArray(a) ? a : [a]).some(x => v.includes(x));
    if (op === "PATTERN") return String(a).includes(v);
    const n = Number(a);
    if (Number.isNaN(n)) return false;
    switch (op) {
      case "GT": return n > v;
      case "GTE": return n >= v;
      case "LT": return n < v;
      case "LTE": return n <= v;
      case "BETWEEN": return n >= v[0] && n <= v[1];
      case "ABS_GT": return Math.abs(n) > v;
      case "ABS_LT": return Math.abs(n) < v;
    }
    return false;
  }

  function avgO(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

  // ---- 外部引用（读原始快照 match）
  const EXTRAS = {
    macau_open_diff: (f, m) => {
      const bms = m.handicap || [];
      const ma = bms.find(b => b.name.includes("澳"));
      const others = bms.filter(b => b !== ma);
      if (!ma || !others.length) return null;
      return +(ma.initial.h - avgO(others.map(b => b.initial.h))).toFixed(2);
    },
    water_all_stable: (f, m) => (m.handicap || []).every(b => Math.abs(b.current.hw - b.initial.hw) < 0.02),
    bf_heat_abs: (f, m) => {
      if (!f || !f.betfair || !f.betfair.dominant_result) return null;
      const r = f.betfair.rows.find(x => x.result === f.betfair.dominant_result);
      return r ? Math.abs(r.heat) : null;
    }
  };

  // ---- DSL 映射（与 rules.js test() 语义一一对应） ----
  const DSL = [
    { id: "R001", cond: "all", steps: [{ op: "EQ", ref: "$feat.temp.move_pattern", val: "升盘降水" }] },
    { id: "R002", cond: "all", steps: [{ op: "EQ", ref: "$feat.temp.move_pattern", val: "降盘升水" }] },
    { id: "R003", cond: "all", steps: [{ op: "LTE", ref: "$raw.macau_open_diff", val: -0.25, note: "外部引用：澳门初盘 − 其余均值" }] },
    { id: "R004", cond: "all", steps: [{ op: "GTE", ref: "$feat.reso.sync_handicap_count", val: 3, note: "方向随共识动态" }] },
    { id: "R005", cond: "all", guard: [{ op: "NOT_NULL", ref: "$feat.anom.volume_anomaly" }], steps: [{ op: "GTE", ref: "$feat.anom.volume_anomaly", val: 2.5 }] },
    { id: "R006", placeholder: true },
    { id: "R007", cond: "all", steps: [
      { op: "EQ", ref: "$feat.temp.move_pattern", val: "稳定" },
      { op: "EQ", ref: "$feat.temp.stability_flag", val: true },
      { op: "EQ", ref: "$raw.water_all_stable", val: true, note: "外部引用：全部机构水位变幅 <0.02" }
    ] },
    { id: "R008", cond: "all", steps: [{ op: "GTE", ref: "$feat.cross.home_water_dispersion", val: 0.15 }] },
    { id: "R009", cond: "any", guard: [{ op: "NOT_NULL", ref: "$feat.anom.maxKelly" }], steps: [
      { op: "GTE", ref: "$feat.anom.maxKelly", val: 1.05 },
      { op: "LTE", ref: "$feat.anom.minKelly", val: 0.90 }
    ] },
    { id: "R010", placeholder: true },
    { id: "R011", cond: "all", steps: [{ op: "EQ", ref: "$feat.temp.move_pattern", val: "升盘不降水" }] },
    { id: "R012", cond: "all", guard: [{ op: "NOT_NULL", ref: "$feat.anom.volume_anomaly" }], steps: [{ op: "GTE", ref: "$feat.anom.volume_anomaly", val: 2.5 }] },
    { id: "R013", cond: "all", steps: [
      { op: "EQ", ref: "$feat.temp.stability_flag", val: true },
      { op: "GTE", ref: "$feat.temp.home_water_drop_count", val: 2, note: "阈值可由 UI 调节" }
    ] },
    { id: "R014", cond: "all", steps: [
      { op: "EQ", ref: "$feat.temp.stability_flag", val: true },
      { op: "GTE", ref: "$feat.temp.home_water_rise_count", val: 2 }
    ] },
    { id: "R015", cond: "all", guard: [{ op: "NOT_NULL", ref: "$feat.betfair" }], steps: [
      { op: "GT", ref: "$feat.betfair.dominant_ratio", val: 0.45, note: "资金集中占比" },
      { op: "GT", ref: "$raw.bf_heat_abs", val: 50, note: "外部引用：主导结果热度绝对值" }
    ] },
    { id: "R016", cond: "all", guard: [{ op: "NOT_NULL", ref: "$feat.onex.kelly_home_max" }], steps: [{ op: "GTE", ref: "$feat.onex.kelly_home_max", val: 0.98, note: "阈值可由 UI 调节" }] }
  ];
  const OPERS = {
    EQ: "等于", NEQ: "不等于", GT: "大于", GTE: "大于等于", LT: "小于", LTE: "小于等于",
    BETWEEN: "区间", IN: "属于", PATTERN: "包含", ABS_GT: "绝对值>", ABS_LT: "绝对值<", NOT_NULL: "非空"
  };

  const Sel = { matchId: "M007", onlyHits: false };

  function select(id) { if (MATCHES && MATCHES.some(m => m.id === id)) Sel.matchId = id; if (window.render) window.render(); }
  function toggleOnlyHits() { Sel.onlyHits = !Sel.onlyHits; if (window.render) window.render(); }

  function getRef(ref, f, match) {
    if (ref.startsWith("$feat.")) {
      let o = f; for (const k of ref.slice(6).split(".")) { if (o == null) return null; o = o[k]; } return o;
    }
    if (ref.startsWith("$raw.")) return (EXTRAS[ref.slice(5)] || (() => null))(f, match);
    return null;
  }
  function dirOf(id, f) {
    const r = RULES.find(x => x.id === id);
    if (!r) return 0;
    return (typeof r.direction === "function") ? r.direction(f) : r.direction;
  }

  // 分析一场比赛的所有规则（供渲染与一致性测试复用）
  function analyze(match) {
    const f = window.computeFeatures ? window.computeFeatures(match) : computeFeatures(match);
    const list = []; const hits = [], risks = [];
    for (const e of DSL) {
      if (e.placeholder) { list.push({ id: e.id, placeholder: true, hit: false, dir: 0, steps: [], guard: [], f, m: match }); continue; }
      const steps = e.steps.map(s => { const actual = getRef(s.ref, f, match); return { ...s, actual, pass: applyOp(s.op, actual, s.val) }; });
      const guardPass = (e.guard || []).every(g => applyOp(g.op, getRef(g.ref, f, match), g.val));
      const mainPass = e.cond === "any" ? steps.some(x => x.pass) : steps.every(x => x.pass);
      const hit = guardPass && mainPass;
      const dir = hit ? dirOf(e.id, f) : 0;
      list.push({ id: e.id, hit, dir, cond: e.cond, steps, guard: e.guard || [], f, m: match });
      if (hit) (dir === 0 ? risks : hits).push(e.id);
    }
    return { f, list, hits, risks };
  }

  // ---- 渲染 ----
  const mockTag = () => `<span class="badge mock">Mock DSL 示意</span>`;
  function fmtVal(v) {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (Array.isArray(v)) return `[${v.join(", ")}]`;
    return String(v);
  }
  const dirBadge = d =>
    d > 0 ? `<span class="badge up">上盘</span>` : (d < 0 ? `<span class="badge down">下盘</span>` : `<span class="badge muted">风险/异常</span>`);

  function ruleCard(it) {
    if (it.placeholder) return `<div class="dsl-rule ph">
      <div class="dsl-hd"><span class="rule-id">${it.id}</span><span class="gov-name">规则待定义</span><span class="badge mock">placeholder</span></div>
      <div class="muted">用户尚未定义该规则条件，未进入 DSL 求值。</div></div>`;
    const rule = RULES.find(r => r.id === it.id) || {};
    const fam = rule.family || "—";
    const steps = it.steps.map(s => {
      const ext = s.ref.startsWith("$raw.");
      return `<div class="dsl-step ${s.pass ? "o" : "x"}">
        <span class="ds-op mono">${s.op}</span>
        <span class="ds-ref mono">${s.ref}${ext ? ' <em class="ext">外部引用</em>' : ""}</span>
        <span class="ds-exp">期望 ${fmtVal(s.val)}${s.note ? ` <span class="muted">· ${s.note}</span>` : ""}</span>
        <span class="ds-act mono">实际 ${fmtVal(s.actual)}</span>
        <span class="ds-b ${s.pass ? "ok" : "risk"}">${s.pass ? "✓" : "×"}</span>
      </div>`;
    }).join("");
    const hitBadge = it.hit ? dirBadge(it.dir) + `<span class="badge up">命中</span>` : `<span class="badge muted">未命中</span>`;
    const comboTxt = it.cond === "any" ? `<span class="badge info">分组:任一通过</span>` : `<span class="badge muted">分组:全部通过</span>`;
    const guardHtml = it.guard.length ? `<div class="dsl-guard"><span class="badge info">前置 guard</span><span class="mono">${it.guard.map(g => `${g.ref} ${OPERS[g.op]}`).join(" 且 ")}</span></div>` : "";
    const ev = it.hit ? (rule.evidence ? rule.evidence(it.f, it.m, rule.threshold) : "") : "";
    return `<div class="dsl-rule ${it.hit ? "hit" : ""}">
      <div class="dsl-hd"><span class="rule-id">${it.id}</span><span class="gov-name">${rule.name}</span>
        <span class="badge brand">${fam}</span>${hitBadge}${comboTxt}</div>
      ${guardHtml}
      <div class="dsl-steps">${steps}</div>
      ${it.hit && ev ? `<div class="dsl-ev">推理：${ev}</div>` : ""}
    </div>`;
  }

  function renderDsl() {
    const id = Sel.matchId;
    const m = MATCHES.find(x => x.id === id) || MATCHES[0];
    const A = analyze(m);
    const shown = Sel.onlyHits ? A.list.filter(x => x.hit) : A.list;
    const opLegend = Object.keys(OPERS).slice(0, 11).join(" · ");
    const cards = shown.map(ruleCard).join("");
    const statAll = A.hits.length + A.risks.length;

    return `<div class="page">
      <div class="page-head">
        <div class="ph-title">DSL 引擎<span class="badge mock" style="margin-left:8px">Mock 求值示意</span></div>
        <div class="ph-sub">规则条件 → DSL 算子求值 → 命中/未命中 + 推理链（与预测链同源 evaluate）</div>
        <div class="ph-actions">
          <label class="sel-label">比赛
            <select class="sel" onchange="window.__dslSelect(this.value)">
              ${MATCHES.map(x => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${x.id} · ${x.league} ${x.home} vs ${x.away}${x.real ? "" : " (Mock)"}</option>`).join("")}
            </select>
          </label>
          <button class="btn sm ${Sel.onlyHits ? "primary" : ""}" onclick="window.__dslToggle()">${Sel.onlyHits ? "显示全部" : "仅命中"}</button>
        </div>
      </div>
      <div class="pipeline-banner">算子：${opLegend}。引用 <code>$feat.×</code> 读特征快照，<code>$raw.×</code> 读原始快照（外部引用）。命中判定与预测链同源，保证 UI 与推理一致。</div>

      <div class="ing-sum" style="margin-top:12px">
        <div class="bt-chip"><b>规则总数</b><span>${A.list.length}</span></div>
        <div class="bt-chip"><b>方向命中</b><span class="up">${A.hits.length}</span></div>
        <div class="bt-chip"><b>风险命中</b><span class="brand">${A.risks.length}</span></div>
        <div class="bt-chip"><b>触发合计</b><span>${statAll}</span></div>
        <div class="bt-chip"><b>显示</b><span>${shown.length} 条</span></div>
      </div>

      <div class="dsl-list">${cards ? cards : '<div class="empty">无命中规则（可切换比赛或关闭"仅命中"）</div>'}</div>
    </div>`;
  }

  window.renderDsl = renderDsl;
  window.__dslSelect = select;
  window.__dslToggle = toggleOnlyHits;
  window.__DSL = { analyze, applyOp, DSL, EXTRAS, Sel, getRef };

  if (typeof module !== "undefined") {
    module.exports = { analyze, applyOp, DSL, EXTRAS, Sel, getRef, select, toggleOnlyHits, renderDsl };
  }
}