// ============================================================================
// 规则治理 · 生命周期 + 回测监督 视图（交互原型 · Mock/占位）
// 把后端 1.3 规则存储(8态状态机) 与 1.5 回测框架(6项指标) 对齐到前端 UI。
// 严格标注：生命周期推进/回测指标/状态转换审计均为 Mock/示意，
//   edge/ROI 不代表生产准确率或 ROI（对齐工程规范）。
// 只读对齐后端语义；状态推进按钮仅在本次会话内的内存中演示，不落库。
// ============================================================================
'use strict';

if (typeof window !== "undefined" && !window.__governanceLoaded) {
  window.__governanceLoaded = true;

  // ---- 8 态生命周期（复刻 server rules/state_machine —— 示意） ----
  const LIFE = {
    draft: { label: "待草案",  tone: "mock" },
    proposed: { label: "提案评审", tone: "brand" },
    experiment: { label: "实验激活", tone: "info" },
    validated: { label: "回测达标", tone: "ok" },
    approved: { label: "人工审批", tone: "ok" },
    active: { label: "在线激活", tone: "up" },
    superseded: { label: "已替代", tone: "muted" },
    deprecated: { label: "已废弃", tone: "risk" }
  };
  const LIFE_MAIN = ["draft", "proposed", "experiment", "validated", "approved", "active"];
  const NEXT = {
    draft: ["proposed"],
    proposed: ["experiment"],
    experiment: ["validated", "proposed"],
    validated: ["approved", "deprecated"],
    approved: ["active"],
    active: ["superseded"],
    superseded: [],
    deprecated: []
  };
  const VIEW_NOTE = {
    proposed: "提案报送评审",
    experiment: "激活实验回测",
    validated: "回测达标，提请审批",
    approved: "审批通过，发布上线",
    active: "已进入预测链",
    superseded: "被新版本规则取代",
    deprecated: "不达标/废弃（保留证据）"
  };
  // 规则 → 初始生命周期（与 pipeline 预测链视图保持一致）
  const BASE_STATE = {
    R001: "active", R002: "active", R003: "active", R004: "active", R005: "active", R006: "draft",
    R007: "active", R008: "active", R009: "validated", R010: "draft", R011: "proposed",
    R012: "active", R013: "experiment", R014: "proposed", R015: "approved", R016: "active"
  };

  // 会话内演示状态（重载 base；不落库，刷新即重置）
  const Demo = { override: {}, audit: [] };

  function stateOf(id) { return Demo.override[id] || BASE_STATE[id] || "draft"; }
  function nowHMS() { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }

  // ---- 回测指标：单一事实源取自 backtest.js（window.__BACKTEST，对齐设计文档阈值） ----
  // 独立加载/单测时为兜底，阈值与 backtest.js 保持一致（样本≥30/命中≥0.55/ROI≥0.03/回撤≤0.15/稳定≤0.05/联赛≥2）
  const _bt = () => (typeof window !== "undefined" && window.__BACKTEST) ? window.__BACKTEST : null;
  function seeded(n) { let x = 2000 + n * 7919; return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; }
  function btFallbackMetrics(id) {
    const r = seeded((parseInt(id.replace("R", ""), 10) || 1));
    return {
      sample: 24 + Math.floor(r() * 200),
      hitRate: +(0.45 + r() * 0.21).toFixed(3),
      roi: +(r() * 0.16 - 0.04).toFixed(4),
      maxDD: +(r() * 0.2 + 0.03).toFixed(3),
      timeStab: +(r() * 0.09).toFixed(4),
      league: 1 + Math.floor(r() * 5)
    };
  }
  function metrics(id) { return _bt() ? _bt().makeMetrics(id) : btFallbackMetrics(id); }
  function evalBt(m) {
    if (_bt()) {
      const r = _bt().evalBt(m);
      return {
        checks: r.items.map(i => [i.k, i.pass, i.txt]),
        pass: r.pass,
        verdict: r.pass ? "建议转正" : "观察",
        tone: r.tone
      };
    }
    const T = { sample: 30, hitRate: 0.55, roi: 0.03, maxDD: 0.15, timeStab: 0.05, league: 2 };
    const checks = [
      ["样本量", m.sample >= T.sample, `${m.sample} ≥ ${T.sample}`],
      ["命中率", m.hitRate >= T.hitRate, `${m.hitRate.toFixed(2)} ≥ ${T.hitRate.toFixed(2)}`],
      ["ROI", m.roi >= T.roi, `${m.roi.toFixed(3)} ≥ ${T.roi.toFixed(2)}`],
      ["最大回撤", m.maxDD <= T.maxDD, `${m.maxDD.toFixed(2)} ≤ ${T.maxDD.toFixed(2)}`],
      ["时间稳定性", m.timeStab <= T.timeStab, `${m.timeStab.toFixed(3)} ≤ ${T.timeStab.toFixed(2)}`],
      ["联赛覆盖度", m.league >= T.league, `${m.league} ≥ ${T.league}`]
    ];
    const pass = checks.every(c => c[1]);
    return { checks, pass, verdict: pass ? "建议转正" : "观察", tone: pass ? "up" : "risk" };
  }

  // ---- 交互：演示状态推进 + append-only 审计 ----
  // 治理门禁（与后端 promote 对齐，收紧 AI 采纳/上线路径）：
  //   · 进入「validated（回测达标）」与「active（在线激活）」必须当前回测全项达标；
  //   · 未达标 → 拦截 + 审计留痕（append-only），绝不静默放行。
  function _gatePass(id) {
    const m = metrics(id);
    return m ? evalBt(m).pass : false;
  }
  function _toast(msg) {
    if (typeof window !== "undefined" && window.toast) window.toast(msg);
  }
  function advance(id) {
    const cur = stateOf(id);
    const nexts = NEXT[cur] || [];
    if (!nexts.length) return;
    const to = nexts[0];
    if ((to === "validated" || to === "active") && !_gatePass(id)) {
      const checks = (metrics(id) ? evalBt(metrics(id)).checks : []).filter((c) => !c[1]).map((c) => c[0]).join("、");
      Demo.audit.push({ t: nowHMS(), id, from: cur, to, note: `拦截：回测未达标（${checks || "指标缺失"}），不得进入「${LIFE[to].label}」` });
      _toast(`回测未达标（${checks || "指标缺失"}），不能推进至「${LIFE[to].label}」`);
      if (window.render) window.render();
      return;
    }
    Demo.override[id] = to;
    Demo.audit.push({ t: nowHMS(), id, from: cur, to, note: VIEW_NOTE[to] || "状态转换" });
    if (window.render) window.render();
  }
  function resetRule(id) {
    delete Demo.override[id];
    Demo.audit.push({ t: nowHMS(), id, from: "", to: "（重置为基准态）", note: "撤销演示推进" });
    if (window.render) window.render();
  }
  function resetAll() { Demo.override = {}; Demo.audit = []; if (window.render) window.render(); }

  // ---- 渲染 ----
  const mockTag = t => `<span class="badge mock">${t || "Mock"}</span>`;

  function lifecycleRail(counts) {
    const cells = LIFE_MAIN.map((s, i) => {
      const active = i === LIFE_MAIN.length - 1 && counts[s] > 0;
      return `<div class="gov-rail-cell ${counts[s] > 0 ? "has" : ""}">
        <div class="gov-rail-dot ${lifeTone(s)}"></div>
        <div class="gov-rail-label">${LIFE[s].label}</div>
        <div class="gov-rail-n">${counts[s] || 0}</div>
      </div>`;
    }).join("");
    const term = ["superseded", "deprecated"].map(s => `${LIFE[s].label} ${counts[s] || 0}`).join(" · ");
    return `<div class="gov-rail"><div class="line"></div>${cells}<div class="gov-rail-term">分支：${term}</div></div>`;
  }

  function lifeTone(s) {
    const t = LIFE[s] && LIFE[s].tone;
    if (t === "up") return "up";
    if (t === "risk") return "risk";
    if (t === "brand" || t === "info") return "brand";
    if (t === "ok") return "up";
    if (t === "muted") return "muted";
    return "muted";
  }

  function renderRuleCard(id, m) {
    const rule = RULES.find(r => r.id === id);
    const name = rule ? rule.name : id;
    const family = rule ? rule.family : "—";
    const st = stateOf(id);
    const stMeta = LIFE[st];
    const bt = m ? evalBt(m) : null;
    const inReview = st === "proposed" || st === "experiment" || st === "validated";
    const curByte = (inReview && bt) ? bt.verdict : "";
    let action = "";
    const nexts = NEXT[st] || [];
    if (nexts.length) {
      action = `<button class="btn sm primary" onclick="window.__govAdvance('${id}')" title="${VIEW_NOTE[nexts[0]] || ""}">${ICON__check}推进至「${LIFE[nexts[0]].label}」</button>`;
    }
    if (Demo.override[id]) action += `<button class="btn sm" onclick="window.__govReset('${id}')">重置演示</button>`;
    let metricHtml = "";
    if (bt) {
      metricHtml = `<div class="gov-metrics">${bt.checks.map(([lab, pass, txt]) =>
        `<div class="gov-m" title="阈值 ${txt}"><span class="gm-k">${lab}</span><span class="gm-v ${pass ? "up" : "risk"}">${txt.split(" ")[0].split("≥")[0].split("≤")[0]}</span><span class="gm-b ${pass ? "o" : "x"}">${pass ? "✓" : "×"}</span></div>`).join("")}</div>`;
    }
    let audit = "";
    const evs = Demo.audit.filter(e => e.id === id).slice(-3).reverse();
    if (evs.length) audit = `<div class="gov-rule-audit">${evs.map(e => `<span class="muted">${e.t} ${e.from}→${e.to} ${e.note}</span>`).join("<br>")}</div>`;
    const badge = `<span class="badge ${stMeta.tone}">${stMeta.label}</span>`;
    // 回测结论仅对在评审中的规则展示（proposed/experiment/validated）
    const verBadge = (inReview && bt) ? `<span class="badge ${bt.tone}">${bt.verdict}</span>` : "";
    return `<div class="gov-rule ${Demo.override[id] ? "demo" : ""}">
      <div class="gov-rule-hd">
        <span class="rule-id">${id}</span><span class="gov-name">${name}</span>
        <span class="badge brand">${family}</span>${badge}${verBadge}
      </div>
      ${metricHtml}
      <div class="gov-rule-ft">
        <span class="muted">${curByte ? curByte : `当前：${stMeta.label}${nexts.length ? " · 可推进" : " · 终态"}`}</span>
        <span>${action}</span>
      </div>
      ${audit}
    </div>`;
  }

  function renderGovernance() {
    const counts = {};
    for (const r of RULES) { counts[stateOf(r.id)] = (counts[stateOf(r.id)] || 0) + 1; }
    LIFE_MAIN.forEach(s => counts[s] = counts[s] || 0);

    const cards = RULES.map(r => renderRuleCard(r.id, metrics(r.id))).join("");
    const auditHtml = Demo.audit.slice().reverse().map(e =>
      `<div class="tl-row"><div class="tl-time">${e.t}</div><div class="tl-val mono">${e.id} <b>${e.from}</b> → <b>${e.to}</b> · ${e.note}</div></div>`
    ).join("");

    return `<div class="page">
      <div class="page-head">
        <div class="ph-title">规则治理 <span class="badge mock">交互原型 · 状态/指标 Mock</span></div>
        <div class="ph-sub">8 态生命周期 · 6 项回测监督 · edge/ROI 不代表生产准确率或 ROI</div>
        <div class="ph-actions"><button class="btn sm" onclick="window.__govResetAll()">${ICON__replay}重置全部演示</button></div>
      </div>
      <div class="pipeline-banner">本页复刻后端 1.3 规则状态机与 1.5 回测框架的交互演示。推进/回测为示意，仅本地会话内生效（append-only 审计），刷新即还原。</div>

      <div class="card" style="margin-bottom:14px"><div class="card-hd"><div class="title">生命周期总览（8 态）</div><div class="extra">${mockTag("分配示意")}</div></div>
        <div class="card-bd">${lifecycleRail(counts)}</div></div>

      <div class="section-title">规则状态机 + 回测监督（${RULES.length}）</div>
      <div class="gov-grid">${cards}</div>

      <div class="card" style="margin-top:16px"><div class="card-hd"><div class="title">审计 / 状态转换记录 · append-only</div><div class="extra">${Demo.audit.length} 条（含本次演示）</div></div>
        <div class="card-bd">${auditHtml ? `<div class="timeline">${auditHtml}</div>` : '<div class="empty">暂无状态转换；点击规则卡片上的「推进」观察审计写入。</div>'}</div></div>
    </div>`;
  }

  const ICON__check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const ICON__replay = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7 3.3"/><path d="M3 3v6h6"/></svg>';

  window.renderGovernance = renderGovernance;
  window.__govAdvance = advance;
  window.__govReset = resetRule;
  window.__govResetAll = resetAll;

  if (typeof module !== "undefined") {
    module.exports = { advance, resetRule, resetAll, metrics, evalBt, stateOf, renderGovernance, BASE_STATE, NEXT, LIFE };
  }
}