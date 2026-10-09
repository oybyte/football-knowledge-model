// ============================================================================
// 回测结果页 · 回测报告视图（真实端点 /api/backtest/:id）
// 数据来源：后端回测作业（旧 DSL 合成门禁，synthetic=true）+ V9.7 真实回测台账（v97_real）。
// 诚实边界：
//   · 旧 DSL 合成门禁的指标为占位，须显式标注；真实数字以「V9.7 真实回测」卡为准；
//   · 后端未提供的字段（准入逐项明细、季度命中率序列、隔离样本数、G19 置信度）
//     一律渲染「未提供」，**绝不以伪随机或命中率现算填充**（宁缺毋滥）。
// 双轨：mock 模式（离线降级）由 window.__BACKTEST 的确定性伪随机生成器供给，本文件同时是
//        该生成器的单一事实源（governance.js 的规则治理门禁复用 makeMetrics/evalBt）。
// ============================================================================
'use strict';

if (typeof window !== "undefined" && !window.__backtestLoaded) {
  window.__backtestLoaded = true;

  // ---- 规范（对齐后端 design/backtest-1.5.0 §4/§6） ----
  const ADMISSION_CHECKS = [
    { key: "temporal_integrity", label: "时间完整性", desc: "observed_at ≤ backtestEnd（防时间泄漏）" },
    { key: "receipt_consistency", label: "接收一致性", desc: "received_at ≥ observed_at（时序不倒挂）" },
    { key: "result_available",   label: "结果可用",   desc: "match_time < backtestEnd（未来比赛剔除）" },
    { key: "snapshot_complete",  label: "快照完整",   desc: "trigger_data 存在（触发快照不缺）" },
    { key: "rule_active_at_trigger", label: "规则有效", desc: "触发时在 valid_from–valid_to 窗口内" }
  ];
  // 阈值（mock 沙盒富形状；真实/ mock 经 api 通道拿到的阈值为扁平数值表 {hit_rate:0.55,…}）
  const THRESHOLDS = {
    sample_size:   { op: ">=", value: 30,   label: "样本量",   note: "统计显著性" },
    hit_rate:      { op: ">=", value: 0.55, label: "命中率",   note: "基本有效性" },
    roi:           { op: ">=", value: 0.03, label: "ROI",      note: "盈利能力" },
    max_drawdown:  { op: "<=", value: 0.15, label: "最大回撤", note: "风险控制" },
    time_stability:{ op: "<=", value: 0.05, label: "时间稳定性", note: "时效性" },
    league_coverage:{ op: ">=", value: 2,   label: "联赛覆盖度", note: "泛化能力" }
  };
  const LEAGUES = ["日职联", "韩K联", "挪超", "瑞典超", "西乙", "巴西甲", "墨超", "美职联"];

  // 指标展示规范：键 → 后端 metrics 字段 / 比较方向（方向是设计契约常量，阈值取自后端）
  const METRIC_SPEC = [
    { key: "sample_size",     src: "sample_size",     label: "样本量",     dir: ">=", note: "统计显著性", fmt: "int" },
    { key: "hit_rate",        src: "hit_rate",        label: "命中率",     dir: ">=", note: "基本有效性", fmt: "pct" },
    { key: "roi",             src: "roi",             label: "ROI",        dir: ">=", note: "盈利能力",   fmt: "pct" },
    { key: "max_drawdown",    src: "max_drawdown",    label: "最大回撤",   dir: "<=", note: "风险控制",   fmt: "pct" },
    { key: "time_stability",  src: "time_stability",  label: "时间稳定性", dir: "<=", note: "时效性",     fmt: "num4" },
    { key: "league_coverage", src: "league_coverage", label: "联赛覆盖度", dir: ">=", note: "泛化能力",   fmt: "int" }
  ];

  // ---- 确定性伪随机（同一规则每次渲染一致）· mock 沙盒生成器，保持既有语义不变 ----
  function seeded(n) { let x = 5000 + n * 7919; return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; }
  function pick(r, n, pool) { const p = pool.slice(); const out = []; while (out.length < n && p.length) out.push(p.splice(Math.floor(r() * p.length), 1)[0]); return out; }

  function makeMetrics(id) {
    const n = (parseInt(id.replace(/R/, ""), 10) || 1);
    const r = seeded(n);
    // 准入失败分布（部分规则存在时间泄漏/快照缺失等被隔离的证据）
    const dist = {};
    let untrusted = 0;
    ADMISSION_CHECKS.forEach(c => {
      const v = Math.floor(r() * (c.key === "temporal_integrity" ? 4 : 2)); // 时间泄漏更易告警
      dist[c.key] = v; untrusted += v;
    });
    const eligible = 24 + Math.floor(r() * 200);        // 准入通过的样本 = 样本量
    const total = eligible + untrusted;
    const direction = Math.round(eligible * (0.76 + r() * 0.2)); // 有方向预测数
    const hitRate = +(0.45 + r() * 0.21).toFixed(3);
    const hitCount = Math.round(direction * hitRate);
    const roi = +(r() * 0.16 - 0.04).toFixed(4);
    const maxDD = +(r() * 0.2 + 0.03).toFixed(3);
    const league = 1 + Math.floor(r() * 5);             // 1–6
    const leagueNames = pick(r, league, LEAGUES);
    // 按季度命中率 → 取其方差作为时间稳定性（内部一致）
    const spread = 0.01 + r() * 0.04;
    const base = 0.5 + r() * 0.12;
    const trend = [0, 1, 2, 3].map(i => +(Math.max(0.2, Math.min(0.95, base + (r() * 2 - 1) * spread))).toFixed(3));
    const mean = trend.reduce((a, b) => a + b, 0) / trend.length;
    const varr = trend.reduce((a, b) => a + (b - mean) * (b - mean), 0) / trend.length;
    const timeStab = +varr.toFixed(4);
    return {
      id, total, eligible, untrusted, direction, hitCount,
      sample: eligible, hitRate, roi, maxDD, league, leagueNames, timeStab,
      trend, trendLabels: quarters(n),
      failDist: dist, checks: ADMISSION_CHECKS
    };
  }
  function quarters() {
    return ["25Q3", "25Q4", "26Q1", "26Q2"]; // mock 区间
  }

  function evalBt(m) {
    const items = [
      { key: "sample_size",  k: m.sample,  v: m.sample,            pass: m.sample >= 30,      txt: `${m.sample} ≥ 30` },
      { key: "hit_rate",     k: "命中率",  v: m.hitRate,           pass: m.hitRate >= 0.55,   txt: `${m.hitRate.toFixed(2)} ≥ 0.55` },
      { key: "roi",          k: "ROI",     v: m.roi,               pass: m.roi >= 0.03,       txt: `${m.roi.toFixed(3)} ≥ 0.03` },
      { key: "max_drawdown", k: "最大回撤", v: m.maxDD,            pass: m.maxDD <= 0.15,     txt: `${m.maxDD.toFixed(2)} ≤ 0.15` },
      { key: "time_stability",k: "时间稳定性", v: m.timeStab,       pass: m.timeStab <= 0.05,  txt: `${m.timeStab.toFixed(3)} ≤ 0.05` },
      { key: "league_coverage",k:"联赛覆盖度", v: m.league,         pass: m.league >= 2,       txt: `${m.league} ≥ 2` }
    ];
    const pass = items.every(i => i.pass);
    const adjudication = pass ? "validated" : "proposed"; // 全达标 → 建议晋升 validated
    const tone = pass ? "up" : "risk";
    return { items, pass, adjudication, tone };
  }

  // ───────────────────────── 页面状态（异步渲染单一事实源） ─────────────────────────
  const BT_STATE = {
    mode: "real",
    ruleId: null,
    rules: [],     // [{ id, label }]
    data: null,    // 归一化后的后端回测契约
    loading: false,
    error: null,
    reqSeq: 0,
  };
  const Sel = { ruleId: null }; // 兼容旧契约（当前展示选中）

  function getApi() { return window.__ApiClient ? window.__ApiClient.getApi() : null; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function rerender() {
    const main = document.getElementById("main");
    if (!main) return;
    let onPage = false;
    try { onPage = (typeof state !== "undefined") && state.page === "backtest"; } catch (e) { onPage = false; }
    if (onPage) main.innerHTML = window.renderBacktest();
  }
  function num(v, d) { return (typeof v === "number" && !isNaN(v)) ? v.toFixed(d == null ? 3 : d) : "—"; }
  function int(v) { return (typeof v === "number" && !isNaN(v)) ? String(Math.round(v)) : "—"; }
  function fmtMetric(value, kind) {
    if (typeof value !== "number" || isNaN(value)) return "—";
    if (kind === "int") return String(Math.round(value));
    if (kind === "num4") return value.toFixed(4);
    return value.toFixed(3);
  }

  const ADJ_ZH = {
    validated: "达标 · 建议晋升 validated",
    proposed: "不达标（proposed）",
  };

  // ───────────────────────── 渲染 ─────────────────────────
  function headHtml() {
    const opts = BT_STATE.rules.map(r =>
      `<option value="${esc(r.id)}" ${r.id === BT_STATE.ruleId ? "selected" : ""}>${esc(r.label)}</option>`).join("");
    const mockBadge = BT_STATE.mode === "mock" ? `<span class="badge mock" style="margin-left:8px">Mock 回测示意</span>` : "";
    return `<div class="page-head">
      <div class="ph-title">回测结果${BT_STATE.ruleId ? " · " + esc(BT_STATE.ruleId) : ""}${mockBadge}</div>
      <div class="ph-sub">可追溯回测报告 · 5 项准入 / 6 项指标 / V9.7 真实台账</div>
      <div class="ph-actions">
        <label class="sel-label">规则
          <select class="sel" onchange="window.__btSelect(this.value)" ${BT_STATE.rules.length ? "" : "disabled"}>
            ${opts || `<option>规则库未加载</option>`}
          </select>
        </label>
      </div>
    </div>`;
  }

  function renderReport() {
    const head = headHtml();

    if (BT_STATE.loading) {
      return `<div class="page">${head}<div class="empty" style="margin-top:16px">正在加载真实数据…</div></div>`;
    }
    if (BT_STATE.error) {
      return `<div class="page">${head}
        <div class="empty" style="margin-top:16px">后端不可用（error: ${esc(BT_STATE.error)}）· 可在左下角切换 Mock 模式</div></div>`;
    }
    const d = BT_STATE.data;
    if (!d) {
      return `<div class="page">${head}<div class="empty" style="margin-top:16px">请选择规则</div></div>`;
    }

    const id = d.rule_id;
    const m = d.metrics || {};
    const thr = d.thresholds || {};
    const ruleName = d.rule_name || (BT_STATE.rules.find(r => r.id === id) || {}).label || "";
    const adjTone = String(d.adjudication || "").toLowerCase() === "validated" ? "up" : "risk";

    // —— 6 项指标（阈值取自后端扁平表，比较方向为设计契约常量）——
    const items = METRIC_SPEC.map(s => {
      const v = m[s.src];
      const t = thr[s.key];
      const ok = (typeof v === "number" && typeof t === "number")
        ? (s.dir === ">=" ? v >= t : v <= t)
        : null;
      return { spec: s, v, t, ok };
    });
    const known = items.filter(i => i.ok !== null);
    const allPass = known.length > 0 && known.every(i => i.ok === true);
    const metTone = allPass ? "up" : "risk";
    const metHtml = items.map(i => {
      const txt = (typeof i.t === "number")
        ? `阈值 ${fmtMetric(i.v, i.spec.fmt)} ${i.spec.dir} ${fmtMetric(i.t, i.spec.fmt)}`
        : "阈值未提供";
      const badge = i.ok === null ? `<div class="bmt-b muted">阈值未提供</div>`
        : `<div class="bmt-b ${i.ok ? "ok" : "risk"}">${i.ok ? "达标" : "未达标"}</div>`;
      return `<div class="bt-metric ${i.ok === null ? "" : (i.ok ? "o" : "x")}">
        <div class="bmt-k">${i.spec.label} · ${i.spec.note}</div>
        <div class="bmt-v">${fmtMetric(i.v, i.spec.fmt)}</div>
        <div class="bmt-t">${txt}</div>
        ${badge}
      </div>`;
    }).join("");

    // —— 5 项准入：后端未提供逐项明细则诚实标注 ——
    const detail = d.admission_detail;
    const hasDetail = detail && typeof detail === "object" && Object.keys(detail).length > 0;
    const checksHtml = ADMISSION_CHECKS.map(c => {
      if (!hasDetail) {
        return `<div class="bt-check"><span class="btc-s">·</span>
          <span class="btc-n">${c.label}</span><span class="btc-d">${c.desc}</span>
          <span class="btc-c muted">明细未提供</span></div>`;
      }
      const fail = Number(detail[c.key] || 0);
      const ok = fail === 0;
      return `<div class="bt-check ${ok ? "o" : "x"}">
        <span class="btc-s">${ok ? "✓" : "×"}</span>
        <span class="btc-n">${c.label}</span>
        <span class="btc-d">${c.desc}</span>
        <span class="btc-c ${ok ? "ok" : "risk"}">${ok ? "通过" : `失败 ×${fail}`}</span>
      </div>`;
    }).join("");

    // —— 作业元数据 ——
    const range = d.date_range ? `${d.date_range.from || "—"} ~ ${d.date_range.to || "—"}` : "未提供";
    const untrustedTxt = d.untrusted_count != null ? `${d.untrusted_count} 隔离` : "隔离数未提供";
    const leaguesTxt = Array.isArray(m.leagues) && m.leagues.length ? m.leagues.join("、") : "—";
    const vr = d.v97_real;

    // —— V9.7 真实回测卡 ——
    let v97Html;
    if (!vr) {
      v97Html = `<div class="empty">该规则无 V9.7 真实台账（规则未声明可求值 atoms，或 DB 无历史场次）</div>`;
    } else if (vr.error) {
      v97Html = `<div class="empty">V9.7 台账计算失败：${esc(vr.error)}</div>`;
    } else {
      const tally = vr.tally || {};
      const ledger = Array.isArray(vr.ledger_sample) ? vr.ledger_sample : [];
      const rows = ledger.map(e => `<tr>
          <td class="l">${esc(e.match_id)}</td>
          <td class="l">${esc(e.league || "—")}</td>
          <td class="l">${esc(e.home_team || "")} vs ${esc(e.away_team || "")}</td>
          <td class="num mono">${esc(e.actual_result || "—")}</td>
          <td class="num mono">${e.total_goals != null ? esc(e.total_goals) : "—"}</td>
        </tr>`).join("");
      const probe = vr.probe
        ? `<div class="bt-sumfoo" style="margin-top:10px">
             <div class="bt-chip"><b>探针样本</b><span>${probe_num(vr.probe.total)}</span></div>
             <div class="bt-chip"><b>探针命中</b><span>${probe_num(vr.probe.hits)}</span></div>
             <div class="bt-chip"><b>探针命中率</b><span>${pctNum(vr.probe.hit_rate)}</span></div>
           </div>
           <div class="setting-note" style="margin-top:6px">${esc(vr.probe.note || "")}</div>`
        : `<div class="setting-note" style="margin-top:10px">该规则 effects 无自动可判方向语义 → 仅提供命中事件台账，正确性需人工核验。</div>`;
      v97Html = `
        <div class="bt-sumfoo">
          <div class="bt-chip"><b>可求值场次</b><span>${probe_num(vr.covered)}</span></div>
          <div class="bt-chip"><b>命中</b><span class="up">${probe_num(tally.hit)}</span></div>
          <div class="bt-chip"><b>未命中</b><span class="down">${probe_num(tally.miss)}</span></div>
          <div class="bt-chip"><b>数据不足</b><span>${probe_num(tally.insuff)}</span></div>
          <div class="bt-chip"><b>台账条数</b><span>${probe_num(vr.ledger_count)}</span></div>
        </div>
        ${probe}
        ${rows ? `<div style="margin-top:10px;overflow:auto"><table class="tbl"><thead><tr>
            <th class="l">场次</th><th class="l">联赛</th><th class="l">对阵</th><th class="num">赛果</th><th class="num">总进球</th>
          </tr></thead><tbody>${rows}</tbody></table></div>
          <div class="setting-note" style="margin-top:6px">台账仅展示前 ${ledger.length} 条命中事件（后端截断），用于人工核验。</div>`
          : `<div class="setting-note" style="margin-top:10px">该规则在历史场次上无命中事件。</div>`}`;
    }

    const banner = BT_STATE.mode === "mock"
      ? `Mock 沙盒：指标由确定性伪随机生成，<strong>不代表生产精度或 ROI</strong>，仅用于离线演示页面结构。`
      : `本页消费后端 <code>/api/backtest/:id</code>。${d.synthetic ? "「6 项指标」来自<strong>旧 DSL 合成门禁（占位）</strong>，" : ""}真实数字以「V9.7 真实回测」卡为准；后端未提供的字段一律标注「未提供」，不以伪随机填充。`;

    return `<div class="page">
      ${head}
      <div class="pipeline-banner">${banner}</div>

      <div class="card"><div class="card-hd"><div class="title">回测作业元数据</div>
        <div class="extra badge ${adjTone}">判定：${esc(ADJ_ZH[d.adjudication] || d.adjudication || "未知")}</div></div>
        <div class="card-bd bt-meta">
          <div class="bmt-m"><span class="muted">作业</span><span class="mono">${esc(d.job_id || "—")}</span></div>
          <div class="bmt-m"><span class="muted">规则版本</span><span class="mono">${esc(id)} v${d.rule_version != null ? esc(d.rule_version) : "—"}</span></div>
          <div class="bmt-m"><span class="muted">区间</span><span class="mono">${esc(range)}</span></div>
          <div class="bmt-m"><span class="muted">生成于</span><span class="mono">未提供</span></div>
          <div class="bmt-m"><span class="muted">样本</span><span class="mono">${int(d.sample_size)} 通过 / ${esc(untrustedTxt)}</span></div>
          <div class="bmt-m"><span class="muted">门禁口径</span><span class="mono">${d.synthetic ? "旧 DSL 合成（占位）" : "后端真实作业"}</span></div>
        </div>
        <div class="bt-sumfoo">
          <div class="bt-chip"><b>命中率</b><span>${pctNum(m.hit_rate)}</span></div>
          <div class="bt-chip"><b>命中</b><span>${int(m.hit_count)}/${int(m.direction_count)}</span></div>
          <div class="bt-chip"><b>联赛</b><span>${esc(leaguesTxt)}</span></div>
          <div class="bt-chip"><b>V9.7 覆盖</b><span>${vr && !vr.error ? probe_num(vr.covered) : "—"}</span></div>
        </div>
      </div>

      <div class="split-2">
        <div class="card"><div class="card-hd"><div class="title">5 项准入校验 · statistics_eligible</div>
          <div class="extra muted">${hasDetail ? "逐项失败分布" : "后端未提供逐项明细"}</div></div>
          <div class="card-bd bt-checks">${checksHtml}</div>
        </div>
        <div class="card"><div class="card-hd"><div class="title">6 项指标 · 阈值判定</div>
          <div class="extra badge ${metTone}">${known.length ? (allPass ? "全部达标" : "存在未达标") : "阈值未提供"}</div></div>
          <div class="card-bd bt-metrics-grid">${metHtml}</div>
        </div>
      </div>

      <div class="split-2">
        <div class="card"><div class="card-hd"><div class="title">时间稳定性</div>
          <div class="extra muted">方差 ${num(m.time_stability, 4)}${typeof m.time_stability === "number" ? (m.time_stability <= 0.05 ? " ≤ 0.05（稳定）" : " > 0.05（波动）") : ""}</div></div>
          <div class="card-bd"><div class="empty">季度命中率序列后端未提供（仅返回方差标量）</div></div>
        </div>
        <div class="card"><div class="card-hd"><div class="title">G19 置信度门 · 写-后-读时序</div>
          <div class="extra badge muted">未提供</div></div>
          <div class="card-bd">
            <div class="empty">后端回测响应未返回置信度。该值不得以命中率现算，待引擎补充后展示。</div>
          </div>
        </div>
      </div>

      <div class="card"><div class="card-hd"><div class="title">V9.7 真实回测 · DB 历史真实场次</div>
        <div class="extra badge ${vr && !vr.error ? "up" : "muted"}">${vr && !vr.error ? esc(probe_num(vr.covered)) + " 场可求值" : "无台账"}</div></div>
        <div class="card-bd">${v97Html}</div>
      </div>

      <div class="callout ${allPass ? "ok" : "warn"}">
        <strong>判定。</strong>${allPass
          ? `6 项指标全达标 → 后端判定 ${esc(d.adjudication || "validated")}；转正仍须走 <code>/api/rules/:id/promote</code> 门禁与人工审批。`
          : `存在未达标或阈值缺失项 → 后端判定 ${esc(d.adjudication || "proposed")}，保持当前状态；请复核准入/指标标红项及 V9.7 台账。`}
      </div>
    </div>`;
  }

  function probe_num(v) { return (typeof v === "number" && !isNaN(v)) ? String(v) : "—"; }
  function pctNum(v) { return (typeof v === "number" && !isNaN(v)) ? (v * 100).toFixed(1) + "%" : "—"; }

  // ───────────────────────── 取数 ─────────────────────────
  function defaultRuleId(rules) {
    for (const p of ["S25", "R01", "R13"]) { // 优先真实可回测且有 V9.7 台账的规则
      if (rules.some(r => r.id === p)) return p;
    }
    return rules[0].id;
  }

  async function loadRules() {
    const a = getApi();
    if (!a) { BT_STATE.error = "api_client_unavailable"; rerender(); return; }
    BT_STATE.loading = true; BT_STATE.error = null;
    rerender();
    let r;
    try { r = await a.listRules(); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    BT_STATE.loading = false;
    if (!r.ok) { BT_STATE.error = r.error || "unknown"; rerender(); return; }
    BT_STATE.rules = (r.data || []).map(x => ({
      id: x.id,
      label: `${x.id} · ${x.name || String(x.conclusion || "").slice(0, 24)}`,
    }));
    if (!BT_STATE.rules.length) { BT_STATE.error = "no_rules"; rerender(); return; }
    BT_STATE.ruleId = defaultRuleId(BT_STATE.rules);
    Sel.ruleId = BT_STATE.ruleId;
    BT_STATE.data = null;
    await loadBacktest(BT_STATE.ruleId);
  }

  async function loadBacktest(id) {
    const a = getApi();
    if (!a) { BT_STATE.error = "api_client_unavailable"; rerender(); return; }
    const seq = ++BT_STATE.reqSeq;
    BT_STATE.loading = true; BT_STATE.error = null;
    rerender();
    let r;
    try { r = await a.getBacktest(id); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (seq !== BT_STATE.reqSeq) return; // 过期响应丢弃
    BT_STATE.loading = false;
    if (!r.ok) { BT_STATE.data = null; BT_STATE.error = r.error || "unknown"; rerender(); return; }
    BT_STATE.data = r.data;
    rerender();
  }

  function btBoot() {
    const a = getApi();
    BT_STATE.mode = a ? a.name : "mock";
    if (!BT_STATE.rules.length) { loadRules(); return; }
    if (!BT_STATE.ruleId) BT_STATE.ruleId = defaultRuleId(BT_STATE.rules);
    if (BT_STATE.data && BT_STATE.data.rule_id === BT_STATE.ruleId) { rerender(); return; }
    loadBacktest(BT_STATE.ruleId);
  }

  function select(id) {
    if (!id || id === BT_STATE.ruleId) return;
    BT_STATE.ruleId = id;
    Sel.ruleId = id;
    BT_STATE.data = null;
    BT_STATE.error = null;
    BT_STATE.loading = true;
    if (window.render) window.render();
  }

  window.renderBacktest = renderReport;
  window.__btBoot = btBoot;
  window.__btSelect = select;
  window.__BACKTEST = { makeMetrics, evalBt, THRESHOLDS, ADMISSION_CHECKS, METRIC_SPEC, renderReport, Sel, BT_STATE };

  if (typeof module !== "undefined") {
    module.exports = { makeMetrics, evalBt, THRESHOLDS, ADMISSION_CHECKS, METRIC_SPEC, select, btBoot, renderReport };
  }
}
