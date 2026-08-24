// ============================================================================
// 回测结果页 · 回测报告视图（交互原型 · Mock/占位）
// 复刻后端 1.5 回测框架报告语义，对齐设计文档 §4/§6/§8/§9：
//   · 5 项准入校验（statistics_eligible）
//   · 6 项指标 + 阈值判定（命中率/ROI/最大回撤/样本量/时间稳定性/联赛覆盖度）
//   · 可追溯报告（report_id/job/date_range/adjudication/summary/failed_checks）
//   · G19 跨域时序（回测完成→一次性写置信度→检索读新值）
// 本页指标为确定性伪随机示意；edge/ROI 不代表生产准确率或 ROI。
// 本文件同时是前端回测指标的"单一事实源"（window.__BACKTEST 供 governance 复用）。
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
  // 指标指标：key → { op, value, label, note }
  const THRESHOLDS = {
    sample_size:   { op: ">=", value: 30,   label: "样本量",   note: "统计显著性" },
    hit_rate:      { op: ">=", value: 0.55, label: "命中率",   note: "基本有效性" },
    roi:           { op: ">=", value: 0.03, label: "ROI",      note: "盈利能力" },
    max_drawdown:  { op: "<=", value: 0.15, label: "最大回撤", note: "风险控制" },
    time_stability:{ op: "<=", value: 0.05, label: "时间稳定性", note: "时效性" },
    league_coverage:{ op: ">=", value: 2,   label: "联赛覆盖度", note: "泛化能力" }
  };
  const LEAGUES = ["日职联", "韩K联", "挪超", "瑞典超", "西乙", "巴西甲", "墨超", "美职联"];

  // ---- 确定性伪随机（同一规则每次渲染一致） ----
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
  function quarters(n) {
    const base = ["25Q3", "25Q4", "26Q1", "26Q2"];
    return base; // Mock 区间
  }

  function evalBt(m) {
    const items = [
      { key: "sample_size",  k: m.sample,  v: m.sample,            pass: THRESHOLDS.sample_size.op === ">=" ? m.sample >= 30 : m.sample <= 30, txt: `${m.sample} ≥ 30` },
      { key: "hit_rate",     k: "命中率",  v: m.hitRate,           pass: m.hitRate >= 0.55,      txt: `${m.hitRate.toFixed(2)} ≥ 0.55` },
      { key: "roi",          k: "ROI",     v: m.roi,               pass: m.roi >= 0.03,          txt: `${m.roi.toFixed(3)} ≥ 0.03` },
      { key: "max_drawdown", k: "最大回撤", v: m.maxDD,            pass: m.maxDD <= 0.15,        txt: `${m.maxDD.toFixed(2)} ≤ 0.15` },
      { key: "time_stability",k: "时间稳定性", v: m.timeStab,       pass: m.timeStab <= 0.05,     txt: `${m.timeStab.toFixed(3)} ≤ 0.05` },
      { key: "league_coverage",k:"联赛覆盖度", v: m.league,         pass: m.league >= 2,          txt: `${m.league} ≥ 2` }
    ];
    const pass = items.every(i => i.pass);
    const adjudication = pass ? "validated" : "proposed"; // 全达标 → 建议晋升 validated
    const tone = pass ? "up" : "risk";
    return { items, pass, adjudication, tone };
  }

  // ---- 选择态 ----
  const Sel = { ruleId: "R009" }; // 默认展示处于 validated 态的规则
  function select(id) { if (RULES && RULES.some(r => r.id === id)) Sel.ruleId = id; if (window.render) window.render(); }

  // ---- 渲染 ----
  const mockTag = () => `<span class="badge mock">Mock 回测示意</span>`;

  function renderReport() {
    const id = Sel.ruleId;
    const rule = RULES.find(r => r.id === id) || { id, name: id, family: "—" };
    const m = makeMetrics(id);
    const bt = evalBt(m);
    const reportId = `rep_job_${id}`;
    const ago = `${(parseInt(id.replace(/R/, ""), 10) % 9) + 1}d`;

    // —— 5 项准入 ——
    const checksHtml = m.checks.map(c => {
      const fail = (m.failDist[c.key] || 0);
      const pass = fail === 0;
      return `<div class="bt-check ${pass ? "o" : "x"}">
        <span class="btc-s">${pass ? "✓" : "×"}</span>
        <span class="btc-n">${c.label}</span>
        <span class="btc-d">${c.desc}</span>
        <span class="btc-c ${pass ? "ok" : "risk"}">${pass ? "通过" : `失败 ×${fail}`}</span>
      </div>`;
    }).join("");

    // —— 6 项指标 ——
    const metHtml = bt.items.map(i =>
      `<div class="bt-metric ${i.pass ? "o" : "x"}">
        <div class="bmt-k">${i.label}${THRESHOLDS[i.key] ? ` · ${THRESHOLDS[i.key].note}` : ""}</div>
        <div class="bmt-v">${i.k}</div>
        <div class="bmt-t">阈值 ${i.txt}</div>
        <div class="bmt-b ${i.pass ? "ok" : "risk"}">${i.pass ? "达标" : "未达标"}</div>
      </div>`).join("");

    // —— 月度/季度命中率趋势（时间稳定性）——
    const maxV = Math.max(...m.trend, 0.55);
    const bars = m.trend.map((v, i) =>
      `<div class="bt-trend-col" title="${m.trendLabels[i]} 命中率 ${(v * 100).toFixed(0)}%">
        <div class="bt-trend-bar" style="height:${Math.round((v / maxV) * 100)}%"></div>
        <div class="bt-trend-l">${m.trendLabels[i].replace("Q", "Q")}</div>
        <div class="bt-trend-v">${(v * 100).toFixed(0)}%</div>
      </div>`).join("");

    // —— G19 置信度门（写-后-读时序）——
    const confidence = +(Math.min(0.92, 0.5 + m.hitRate * 0.25 + (bt.pass ? 0.1 : 0.02))).toFixed(3);

    return `<div class="page">
      <div class="page-head">
        <div class="ph-title">回测结果 · ${id} · ${rule.name}</div>
        <div class="ph-sub">可追溯回测报告 · ${reportId} · 5 项准入 / 6 项指标 / G19 时序</div>
        <div class="ph-actions">
          <label class="sel-label">规则
            <select class="sel" onchange="window.__btSelect(this.value)">
              ${RULES.map(r => `<option value="${r.id}" ${r.id === id ? "selected" : ""}>${r.id} · ${r.name}</option>`).join("")}
            </select>
          </label>
        </div>
      </div>
      <div class="pipeline-banner">本页复刻后端 1.5 回测框架报告：仅 <code>statistics_eligible</code> 证据计入指标；全指标达标建议晋升 <code>validated</code>。${mockTag()}</div>

      <div class="card"><div class="card-hd"><div class="title">回测作业元数据</div><div class="extra badge ${bt.tone}">判定：${bt.adjudication === "validated" ? "建议晋升 validated" : "不达标（proposed）"}</div></div>
        <div class="card-bd bt-meta">
          <div class="bmt-m"><span class="muted">报告</span><span class="mono">${reportId}</span></div>
          <div class="bmt-m"><span class="muted">作业</span><span class="mono">job_${id}</span></div>
          <div class="bmt-m"><span class="muted">规则版本</span><span class="mono">${id} v1</span></div>
          <div class="bmt-m"><span class="muted">区间</span><span class="mono">近 8 周</span></div>
          <div class="bmt-m"><span class="muted">生成于</span><span class="mono">${ago} 前</span></div>
          <div class="bmt-m"><span class="muted">样本</span><span class="mono">${m.eligible} 通过 / ${m.untrusted} 隔离</span></div>
        </div>
        <div class="bt-sumfoo">
          <div class="bt-chip"><b>命中率</b><span>${(m.hitRate * 100).toFixed(1)}%</span></div>
          <div class="bt-chip"><b>命中</b><span>${m.hitCount}/${m.direction}</span></div>
          <div class="bt-chip"><b>联赛</b><span>${m.leagueNames.join("、")}</span></div>
          <div class="bt-chip"><b>置信度 G19</b><span>${confidence}</span></div>
        </div>
      </div>

      <div class="split-2">
        <div class="card"><div class="card-hd"><div class="title">5 项准入校验 · statistics_eligible</div><div class="extra muted">${m.eligible} eligible / ${m.untrusted} untrusted</div></div>
          <div class="card-bd bt-checks">${checksHtml}</div>
        </div>
        <div class="card"><div class="card-hd"><div class="title">6 项指标 · 阈值判定</div><div class="extra badge ${bt.tone}">${bt.pass ? "全部达标" : "存在未达标"}</div></div>
          <div class="card-bd bt-metrics-grid">${metHtml}</div>
        </div>
      </div>

      <div class="split-2">
        <div class="card"><div class="card-hd"><div class="title">时间稳定性 · 季度命中率</div><div class="extra muted">方差 ${m.timeStab} ${m.timeStab <= 0.05 ? "≤ 0.05 (稳定)" : "> 0.05 (波动)"}</div></div>
          <div class="card-bd bt-trend">${bars}</div>
        </div>
        <div class="card"><div class="card-hd"><div class="title">G19 置信度门 · 写-后-读时序</div><div class="extra badge ${bt.tone}">committed</div></div>
          <div class="card-bd">
            <div class="bt-conf"><div class="bc-label">当前置信度</div><div class="bc-val mono">${confidence}</div><div class="bc-note muted">确认内置基础 + 命中率加成，回测完成一次性写入</div></div>
            <div class="bt-gate">
              <div class="btg-step"><b>回测运行</b><span>gate 未写</span></div>
              <div class="btg-arrow">→</div>
              <div class="btg-step on"><b>完成 + 写置信度</b><span>原子一次性 commit</span></div>
              <div class="btg-arrow">→</div>
              <div class="btg-step"><b>检索读取</b><span>读到新值，无竞态</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="callout ${bt.pass ? "ok" : "warn"}">
        <strong>判定。</strong>${bt.pass ? `全指标达标 → 建议将 ${id} 由 experiment 晋升 validated；随后检索可读到新置信度。` : `存在未达标指标 → 保持 proposed，回测失败报告留档；建议复盘失败证据（见准入/指标标红项）。`}
      </div>
    </div>`;
  }

  window.renderBacktest = renderReport;
  window.__btSelect = select;
  window.__BACKTEST = { makeMetrics, evalBt, THRESHOLDS, ADMISSION_CHECKS, renderReport, Sel };

  if (typeof module !== "undefined") {
    module.exports = { makeMetrics, evalBt, THRESHOLDS, ADMISSION_CHECKS, select, renderReport };
  }
}