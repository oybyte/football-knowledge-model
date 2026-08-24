// ============================================================================
// 预测链 · Pipeline 演示引擎 + 页面渲染器（交互原型 · Mock/占位）
// 复刻 server 阶段 1 语义，把单场完整预测链在 UI 上可视化：
//   输入/特征快照 → 规则检索(点-in-time active) → 冲突检测 → 三层仲裁
//   → 融合决策 → 预测发布 → 结果回填(判定/证据/审计)
// 严格标注：所有规则生命周期/DSL/优先级/置信度/权重/赛果均为 Mock/示意，
//   置信度不代表生产准确率或 ROI（对齐工程规范）。
// ============================================================================
'use strict';

if (typeof window !== "undefined" && !window.__pipelineLoaded) {
  window.__pipelineLoaded = true;

  // ------------------------------ 常量与工具 ------------------------------
  const REVIEW_DIFF = 0.1;
  const NOMINAL_WEIGHTS = { rule: 0.5, model: 0.3, anomaly: 0.2 }; // 名义权重（示意）

  // 冲突方向映射（复刻 server worker/conflict.js）
  const CONFLICT_DIRECTIONS = {
    favor_upper: ["favor_lower", "reversal"],
    favor_lower: ["favor_upper", "reversal"],
    follow: ["reversal", "caution"],
    reversal: ["favor_upper", "favor_lower", "follow"],
    favor_home: ["favor_lower"],
  };
  // 可判定方向 → 期望让球结果（复刻 backtest §6 方向判定 / server publish/schema）
  const VERIFIABLE = { favor_upper: "upper", favor_lower: "lower" };

  const DIR_LABEL = { favor_upper: "上盘", favor_lower: "下盘", caution: "风险提示", reversal: "反向", follow: "观望" };
  const MATCH_RESULT_LABEL = { upper: "上盘", lower: "下盘", draw: "走水/平局" };

  function round(x, n) { const p = Math.pow(10, n); return Math.round(x * p) / p; }
  function isConflicting(d1, d2) { return (CONFLICT_DIRECTIONS[d1] || []).includes(d2); }
  function computeVerdict(dir, mr) {
    const expected = VERIFIABLE[dir];
    if (!expected) return { verifiable: false, expected: null, correct: null };
    if (mr === "draw") return { verifiable: true, expected, correct: false };
    return { verifiable: true, expected, correct: mr === expected };
  }

  // 前端规则方向(+1/-1/0) → 后端方向词表
  function toDir(d) { return d > 0 ? "favor_upper" : (d < 0 ? "favor_lower" : "caution"); }

  // ------------------------------ 会话状态 ------------------------------
  const P = {
    matchId: MATCHES[0].id,   // 默认真实全量场 M007：特征最丰富，但方向规则不触发→演示"风险提示/不可判定"路径
                              // 下拉可切换 M001（Mock 让球盘）→ 产出明确"上盘"方向，演示仲裁/融合/回填判定
    result: null,             // 回填后为 'upper' | 'lower' | 'draw'
    backfilled: false,
    runSeq: 0,
  };
  function pickMatch(id) { P.matchId = id; P.result = null; P.backfilled = false; if (window.render) window.render(); }
  function backfill() {
    const sel = document.getElementById("pipe-result");
    P.result = sel ? sel.value : "upper";
    P.backfilled = true;
    if (window.render) window.render();
  }
  function rerun() { P.result = null; P.backfilled = false; if (window.render) window.render(); }

  // ------------------------------ 规则生命周期元数据（Mock/示意） ------------------------------
  // 状态分配为示意：占位规则=draft，部分规则处于提案/实验/验证/审批中（不进正式链），其余=active
  const RULE_LIFECYCLE_STATES = {
    R001: "active", R002: "active", R003: "active", R004: "active", R005: "active", R006: "draft",
    R007: "active", R008: "active", R009: "validated", R010: "draft", R011: "proposed",
    R012: "active", R013: "experiment", R014: "proposed", R015: "approved", R016: "active",
  };
  function priorityOf(id) {
    // 确定性派生（示意）：70–89 区间，稳定复现
    const n = parseInt(id && id.replace("R", ""), 10) || 1;
    return 70 + (n % 20);
  }
  function dslHintOf(rule) {
    // DSL(示意) —— 仅文本描述，非真实 DSL 求值；驱动命中仍走 features/rules 层的 test()
    const fam = rule.family;
    const map = {
      temporal: 'AND( move_pattern EQ "' + (rule.id === "R001" ? "升盘降水" : rule.id === "R002" ? "降盘升水" : rule.id === "R007" ? "稳定" : "升盘不降水") + '" )',
      cross: 'GTE( cross.home_water_dispersion , ' + (rule.id === "R003" ? "deep_open(initial.h)" : "0.15") + " )",
      resonance: "GTE( reso.sync_handicap_count , 3 )",
      anomaly: rule.id === "R009" ? "OR( GTE(anom.maxKelly,1.05), LTE(anom.minKelly,0.90) )" : "GTE( anom.volume_anomaly , 2.5 )",
      onex: "GTE( onex.kelly_home_max , 0.98 )",
      betfair: "GTE( betfair.dominant_ratio , 0.45 )",
      unknown: "// 待定义",
    };
    return (map[fam] || "// —") + "   ·示意·";
  }

  // ------------------------------ 检索（point-in-time · active） ------------------------------
  function retrieve() {
    const m = MATCHES.find((x) => x.id === P.matchId);
    const f = computeFeatures(m);
    const rows = [];
    for (const r of RULES) {
      const state = RULE_LIFECYCLE_STATES[r.id] || "active";
      const priority = priorityOf(r.id);
      const base_confidence = 0.5;
      if (state !== "active") {
        rows.push({ id: r.id, name: r.name, family: r.family, state, active: false, hit: false, direction: null, evidence: null, priority, base_confidence, dsl: dslHintOf(r) });
        continue;
      }
      let ok = false, ev = "";
      try { ok = r.test(f, m, r.threshold); ev = r.evidence ? r.evidence(f, m, r.threshold) : ""; } catch (e) { ok = false; }
      const d = (typeof r.direction === "function") ? r.direction(f) : r.direction;
      rows.push({ id: r.id, name: r.name, family: r.family, state, active: true, hit: ok, direction: ok ? toDir(d) : null, evidence: ev, priority, base_confidence, dsl: dslHintOf(r) });
    }
    return { match: m, features: f, rows, hits: rows.filter((r) => r.active && r.hit) };
  }

  // ------------------------------ 冲突检测 ------------------------------
  function detectConflicts(hits) {
    const groups = [];
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i], b = hits[j];
        if ((CONFLICT_DIRECTIONS[a.direction] || []).includes(b.direction)) {
          groups.push({ from: a, to: b, severity: "high", requires_review: true });
        }
      }
    }
    return groups;
  }

  // ------------------------------ 三层仲裁 ------------------------------
  function arbitrate(hits) {
    if (!hits.length) return { none: true, conflicts: [], groups: [] };
    const map = new Map();
    for (const h of hits) {
      const d = h.direction;
      if (!d) continue;
      if (!map.has(d)) map.set(d, { direction: d, score: 0, confNum: 0, confDen: 0, rules: [] });
      const g = map.get(d);
      const s = (h.priority / 100) * h.base_confidence;
      g.score += s;
      g.confNum += (h.priority || 1) * h.base_confidence;
      g.confDen += h.priority || 1;
      g.rules.push({ id: h.id, score: round(s, 4) });
    }
    const groups = [...map.values()].map((g) => ({
      direction: g.direction,
      score: round(g.score, 4),
      confidence: g.confDen ? round(g.confNum / g.confDen, 3) : 0,
      rules: g.rules.sort((a, b) => b.score - a.score),
    })).sort((a, b) => b.score - a.score);

    const conflicts = detectConflicts(hits);
    const top1 = groups[0], top2 = groups[1] || null;
    let manual = false, direction = top1.direction, confidence = top1.confidence, note = null;
    const dominant = top1.rules[0].id;
    if (conflicts.length && top2 && isConflicting(top1.direction, top2.direction)) {
      const diff = Math.abs(top1.score - top2.score);
      if (diff < REVIEW_DIFF) { manual = true; direction = null; confidence = 0; note = `冲突分差 ${diff.toFixed(4)} < ${REVIEW_DIFF} → 需人工复核`; }
    }
    return { none: false, groups, conflicts, direction, confidence, dominant, manual, note };
  }

  // ------------------------------ 融合决策（骨架：规则路真实，模型/异常占位） ------------------------------
  function fuse(arb, hits) {
    if (arb.none || arb.direction === null) {
      return { ready: false, blocked: arb.manual ? true : false, blockedReason: arb.note || null };
    }
    const chain = hits.filter((h) => h.direction === arb.direction).map((h, i) => ({
      step: i + 1, source: "rule:" + h.id + "#1", direction: h.direction,
      confidence: h.base_confidence, weight: round((h.priority / 100), 3), included: true,
    }));
    return {
      ready: true,
      final_direction: arb.direction,
      final_confidence: arb.confidence,
      weights: NOMINAL_WEIGHTS,          // 名义权重（示意）
      activeStreams: ["rule"],           // 骨架版仅规则路真实
      chain,
      model_placeholder: true, anomaly_placeholder: true,
    };
  }

  // ------------------------------ 发布 + 回填（判定/证据/审计） ------------------------------
  function publish(fused) {
    if (!fused.ready) return null;
    P.runSeq += 1;
    return {
      prediction_id: `pred_${P.matchId}_${String(P.runSeq).padStart(4, "0")}`,
      match_id: P.matchId,
      audit_trail_id: `fus_demo_${P.runSeq}`,
      final_direction: fused.final_direction,
      final_confidence: fused.final_confidence,
      weights: fused.weights,
      reasoning_chain: fused.chain,
      created_by: "pipeline:demo",
      created_at: new Date().toISOString(),
      immutable: true,
    };
  }
  function backfillStep(pred) {
    if (!pred || !P.backfilled || !P.result) return null;
    const v = computeVerdict(pred.final_direction, P.result);
    return {
      match_result: P.result, match_result_label: MATCH_RESULT_LABEL[P.result],
      predicted_direction: pred.final_direction,
      expected: v.expected, verifiable: v.verifiable, correct: v.correct,
      evidence_id: "ev_demo_" + P.runSeq,
      backfilled_at: new Date().toISOString(),
    };
  }

  // ------------------------------ 页面渲染 ------------------------------
  function stageShell(num, title, status, statusCls, body) {
    return `<div class="pipe-stage"><div class="stage-k"><span class="stage-no">${num}</span><span class="stage-tt">${title}</span>${status ? `<span class="badge ${statusCls}">${status}</span>` : ""}</div><div class="stage-body">${body}</div></div>`;
  }
  const mockTag = (t) => `<span class="badge mock">${t || "Mock"}</span>`;

  function featChip(label, value, unit) {
    return `<div class="feat"><span class="ft">${label}</span><div class="fv${value !== null && Math.abs(value) >= 100 ? " small" : ""}">${value == null ? "—" : Number(value).toFixed(3)}</div><span class="ff">${unit || ""}</span></div>`;
  }

  function renderPipelinePage() {
    const m = MATCHES.find((x) => x.id === P.matchId);
    const ret = retrieve();
    const arb = arbitrate(ret.hits);
    const fused = fuse(arb, ret.hits);
    const pred = publish(fused);
    const back = backfillStep(pred);

    // 特征快照（仅挑示意字段，标注占位）
    const f = ret.features;
    const featHtml = [
      featChip("temp.move_pattern", f.temp.move_pattern === "稳定" ? "稳定" : f.temp.move_pattern),
      featChip("cross.home_water_dispersion", f.cross.home_water_dispersion, "点"),
      featChip("temp.handicap_movement", f.temp.handicap_movement, "球"),
      featChip("temp.home_water_drop_count", f.temp.home_water_drop_count, "家"),
      featChip("reso.sync_handicap_count", f.reso.sync_handicap_count, "家"),
      featChip("reso.consensus_direction", f.reso.consensus_direction === "无" ? "—" : f.reso.consensus_direction),
      featChip("anom.maxKelly", f.anom.maxKelly, "凯利"),
      featChip("anom.volume_anomaly", f.anom.volume_anomaly, "x"),
      featChip("onex.kelly_home_max", f.onex ? f.onex.kelly_home_max : null, "凯利"),
      featChip("betfair.dominant_ratio", f.betfair ? f.betfair.dominant_ratio : null, "占比"),
    ].join("");

    // 检索表
    const rowHtml = ret.rows.map((r) => {
      const stateBadge = r.active
        ? '<span class="badge brand">active</span>'
        : '<span class="badge mock">' + r.state + "</span>";
      const hitCell = !r.active
        ? '<span class="tbl muted">未参与(非active)</span>'
        : r.hit
          ? '<span class="badge up">命中</span>'
          : '<span class="muted">未命中</span>';
      const dirCell = r.hit && r.direction ? `<span class="badge ${r.direction === "favor_upper" ? "up" : "down"}">${DIR_LABEL[r.direction]}</span>` : '<span class="muted">—</span>';
      return `<tr><td class="l"><b>${r.id}</b> <span class="muted">${r.name}</span></td><td>${stateBadge}</td><td>${hitCell}</td><td>${dirCell}</td><td class="l"><span class="muted">${r.dsl}</span></td><td class="l"><span class="muted">${r.hit && r.evidence ? r.evidence : "—"}</span></td><td>${r.priority}</td><td>${r.base_confidence.toFixed(2)}</td></tr>`;
    }).join("");
    const dslRows = ret.rows.filter((r) => r.active).length;
    const retrievedBody = `<table class="tbl"><thead><tr><th>规则</th><th>生命周期</th><th>命中</th><th>方向</th><th>DSL(示意)</th><th>证据</th><th>优先级</th><th>基础置信度</th></tr></thead><tbody>${rowHtml}</tbody></table><div class="stage-note">${ret.hits.length}/${dslRows} 条 active 规则命中 · 生命周期/DSL 为 ${mockTag("示意")}</div>`;

    // 冲突
    const conflictBody = arb.conflicts.length
      ? arb.conflicts.map((c) => `<div class="conflict-row"><span class="badge risk">冲突</span><span>${c.from.id}(${DIR_LABEL[c.from.direction]}) ⇄ ${c.to.id}(${DIR_LABEL[c.to.direction]})</span><span class="muted">severity·high · 触发人工复核</span></div>`).join("") + '<div class="stage-note">命中方向对撞，需人工复核</div>'
      : (arb.none ? '<div class="empty">无命中，跳过冲突检测</div>' : '<div class="conflict-clear">未检测到方向冲突 ' + mockTag("真实计算，数据为Mock") + "</div>");

    // 仲裁
    let arbBody;
    if (arb.none) arbBody = '<div class="empty">仲裁跳过（无命中）</div>';
    else if (arb.manual) arbBody = `<div class="v-hero risk"><div class="vh-dir">需人工复核</div><div class="vh-sub">${arb.note}</div><div>${arb.groups.map((g) => `<span class="chip">${DIR_LABEL[g.direction]} · 综合分 ${g.score.toFixed(3)}</span>`).join("")}</div></div>`;
    else arbBody = `<div class="v-hero ${arb.direction === "favor_upper" ? "up" : "down"}"><div class="vh-dir">${DIR_LABEL[arb.direction]}</div><div class="vh-sub">综合分 ${arb.groups[0].score.toFixed(3)} · 主导规则 ${arb.dominant} · 置信度 ${(arb.confidence * 100).toFixed(0)}%</div><div>${arb.groups.map((g) => `<span class="chip">${DIR_LABEL[g.direction]} · ${g.score.toFixed(3)}</span>`).join("")}</div></div>`;

    // 融合
    const fuseBody = !fused.ready
      ? `<div class="empty">融合被阻断：${fused.blockedRatio || fused.blocked || "无方向"}</div>`
      : `<div class="grid-3">
          <div><div class="muted">最终方向</div><div class="fuse-dir ${fused.final_direction === "favor_upper" ? "up" : "down"}">${DIR_LABEL[fused.final_direction]}</div></div>
          <div><div class="muted">最终置信度</div>${ringHtml(fused.final_confidence)}</div>
          <div><div class="muted">权重（名义·示意）</div><div class="wt">规则 <b>${(fused.weights.rule * 100).toFixed(0)}%</b> · 模型 ${(fused.weights.model * 100).toFixed(0)}%（占位·untrusted） · 异常 ${(fused.weights.anomaly * 100).toFixed(0)}%（占位·untrusted）</div></div>
        </div>
        <div class="stage-note">推理链（受控方向命中规则）</div>
        <div class="blueprint"><div class="line"></div>${fused.chain.map((c) => `<div class="bp-node"><span class="bp-idx">R${c.step}</span><span class="muted">${c.source}</span><span>${DIR_LABEL[c.direction]}</span><span>权重 ${c.weight}</span></div>`).join("")}</div>`;

    // 发布
    const pubBody = !pred
      ? '<div class="empty">预测未产出，无法发布</div>'
      : `<div class="pub-card"><div class="pub-row"><span class="muted">prediction_id</span><b>${pred.prediction_id}</b></div>
         <div class="pub-row"><span class="muted">audit_trail_id</span><b>${pred.audit_trail_id}</b></div>
         <div class="pub-row"><span class="muted">final_direction</span><b>${DIR_LABEL[pred.final_direction]}</b></div>
         <div class="pub-row"><span class="muted">final_confidence</span><b>${(pred.final_confidence * 100).toFixed(0)}%</b></div>
         <div class="pub-row"><span class="muted">不可变</span><span class="badge brand">append-only · 只读</span></div></div>`;

    // 回填
    const backControls = `<div class="backfill-ctl"><span class="muted">赛果（归一化让球方向）</span>
        <select id="pipe-result" onchange="window.__backfillChanged()">
          <option value="upper">upper · 上盘</option>
          <option value="lower">lower · 下盘</option>
          <option value="draw">draw · 走水</option>
        </select>
        ${pred ? `<button class="btn primary sm" onclick="window.__backfill()">回填判定</button>` : ""}
        <button class="btn sm" onclick="window.__rerun()">重跑</button></div>`;
    const backBody = !pred
      ? '<div class="empty">先产出预测，才能回填赛果</div>'
      : !back
        ? backControls + '<div class="stage-empty">尚未回填 · 选择赛果后点击「回填判定」</div>'
        : backControls +
          `<div class="v-hero ${back.correct ? "up" : "risk"}"><div class="vh-dir">判定：${back.correct ? "命中" : "判错/走水"}</div><div class="vh-sub">${back.predicted_direction === "favor_upper" ? "预测上盘" : "预测下盘"} vs 赛果 ${back.match_result_label}(${back.match_result}) · ${back.verifiable ? (back.correct ? "与预期一致" : "不一致") : "不可判定方向"}</div></div>
         <div class="pub-card"><div class="pub-row"><span class="muted">expected_outcome</span><b>${back.expected || "null"}</b></div><div class="pub-row"><span class="muted">prediction_correct</span><b>${back.correct === null ? "null" : back.correct}</b></div><div class="pub-row"><span class="muted">evidence_id</span><b>${back.evidence_id}</b><span class="badge mock">Mock</span></div></div>`;

    // 审计时间线
    const events = [];
    events.push(ev("prediction_generated", pred ? pred.audit_trail_id : "—", "融合收敛，生成预测记录"));
    if (arb.manual && !pred) events.push(ev("manual_review_required", P.matchId, arb.note || "冲突需人工复核"));
    if (back) events.push(ev("prediction_backfilled", pred.prediction_id, `赛果 ${back.match_result_label}(${back.match_result}) · correct=${back.correct}`));
    if (back) events.push(ev("evidence_locked", back.evidence_id, "证据快照已冻结(append-only)"));
    if (!events.length) events.push(ev("none", "—", "等待赛果回填以充实审计"));
    const tlHtml = events.map((e, i) => `<div class="ti"><span class="ti-time">${e.time}</span><span class="ti-dot ${e.type}"></span><div><div class="ti-type">${e.type}</div><div class="ti-target">target: ${e.target}</div><div class="ti-desc">${e.desc}</div></div></div>`).join("");

    const head = `
      <div class="page-head">
        <div class="ph-title">预测链 Pipeline <span class="badge mock">交互原型 · 全链 Mock</span></div>
        <div class="ph-sub">检索 → 冲突 → 仲裁 → 融合 → 发布/回填 → 审计 · 置信度不代表生产准确率/ROI</div>
        <div class="ph-actions">
          <span class="muted">选择比赛</span>
          <select id="pipe-match" onchange="window.__pickMatch()">${MATCHES.map((x) => `<option value="${x.id}" ${x.id === P.matchId ? "selected" : ""}>${x.id} · ${x.home} vs ${x.away} ${x.real ? "(真实)" : "(Mock)"}</option>`).join("")}</select>
        </div>
      </div>`;

    const s1 = stageShell("01", "输入 / 特征快照（point-in-time）", m.real ? "真实数据" : "Mock", m.real ? "real" : "mock",
      `<div class="m-sub">${m.home} vs ${m.away} · ${m.league} · 开赛 ${m.kickoff}</div><div class="feat-grid">${featHtml}</div><div class="stage-note">字段为特征注册表 ${mockTag("示意子集")} · 由 features.js 纯函数计算</div>`);

    const s2 = stageShell("02", "规则检索", `${ret.hits.length} 命中`, ret.hits.length ? "up" : "mock", retrievedBody);
    const s3 = stageShell("03", "冲突检测", arb.conflicts.length ? `${arb.conflicts.length} 组` : "无", arb.conflicts.length ? "risk" : "ok", conflictBody);
    const s4 = stageShell("04", "三层仲裁（优先级 / 置信度加权 / 冲突裁决）", arb.manual ? "人工复核" : (arb.none ? "跳过" : "已裁决"), arb.manual ? "risk" : (arb.none ? "mock" : "ok"), arbBody);
    const s5 = stageShell("05", "融合决策", fused.ready ? "方向收敛" : "阻断", fused.ready ? "ok" : "mock", fuseBody);
    const s6 = stageShell("06", "预测发布", pred ? "已发布" : "未发布", pred ? "ok" : "mock", pubBody);
    const s7 = stageShell("07", "结果回填 + 判定", back ? "已回填" : (pred ? "待回填" : "跳过"), back ? "ok" : (pred ? "mock" : "mock"), backBody);
    const s8 = stageShell("08", "审计 / 可追溯", `${events.length} 事件`, "mock", `<div class="timeline">${tlHtml}</div>`);

    return `<div class="page">${head}<div class="pipeline-banner">${ICON ? ICON.spark : ""} 本页为 Odds Edge 预测链的可复现演示：算法复刻 server 阶段1语义，数据与生命周期为 Mock/占位。</div><div class="rail">${s1}${s2}${s3}${s4}${s5}${s6}${s7}${s8}</div></div>`;
  }

  function ev(type, target, desc) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return { time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, type, target, desc };
  }
  function ringHtml(pct) {
    const C = 2 * Math.PI * 18, off = C * (1 - Math.max(0, Math.min(1, pct)));
    return `<div class="ring sm up"><svg width="44" height="44"><circle class="bg-c" cx="22" cy="22" r="18" fill="none" stroke-width="4"/><circle class="fg-c" cx="22" cy="22" r="18" fill="none" stroke-width="4" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" stroke-linecap="round"/></svg><div class="pct">${(pct * 100).toFixed(0)}%</div></div>`;
  }

  // window 暴露（供 app.js / index.html 调用）
  window.renderPipelinePage = renderPipelinePage;
  window.__pickMatch = function () { const s = document.getElementById("pipe-match"); if (s) pickMatch(s.value); };
  window.__backfill = function () { backfill(); };
  window.__rerun = function () { rerun(); };
  window.__backfillChanged = function () { /* 仅刷新选中态 */ };

  if (typeof module !== "undefined") {
    module.exports = {
      REVIEW_DIFF, CONFLICT_DIRECTIONS, VERIFIABLE, computeVerdict, isConflicting,
      retrieve, detectConflicts, arbitrate, fuse, publish, backfillStep,
      renderPipelinePage, RULE_LIFECYCLE_STATES, pickMatch,
    };
  }
}