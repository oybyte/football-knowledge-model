// ============================================================================
// AI 引擎 · 规则挖掘 + 信任边界（交互原型 · Mock/占位）
// 复刻后端 2.4 AI 引擎 + 1.6 融合决策的 Containment 隔离语义：
//   · 信任边界（三层）：AI 产出(untrusted) → 人工/规则审核(draft) → 规则库(可入链)
//   · 硬约束：AI 输出永不直接进入融合决策层；须经数据访问层注入、人工审核降标记后方可
//     with 规则身份入检索/融合链
//   · 数据接入：AI 引擎不持有数据源明文凭证（差异见数据接入视图）
//   · G19 时序：回测在 observed 序列建立了置信度（写先于读）；AI 单场解读须在 match_time 前完成
// 候选样本/指标为确定性 Mock，edge/acc 不代表生产值。
// ============================================================================
'use strict';

if (typeof window !== "undefined" && !window.__aiLoaded) {
  window.__aiLoaded = true;

  const AI_C = [
    { id: "C001", source: "时序族·主胜凯利", pattern: "主胜凯利连续 3 家下调且盘口冻结 → 上盘", samples: 142, acc: 0.61, edge: 0.084, status: "pending", g19: "赛前解读·回测置信度已建" },
    { id: "C002", source: "必发资金面", pattern: "必发主胜资金占比>50% 且冷热为正 → 风险", samples: 88, acc: 0.55, edge: -0.021, status: "pending", g19: "赛前解读·回测置信度已建" },
    { id: "C003", source: "横截面·澳门深开", pattern: "澳门初盘较其余均值深 0.5 且临场不降水 → 下盘", samples: 203, acc: 0.63, edge: 0.110, status: "draft", g19: "赛前解读·回测置信度已建" },
    { id: "C004", source: "欧指离散", pattern: "欧指主胜离散>0.4 且主水分歧 → 风险", samples: 167, acc: 0.58, edge: 0.031, status: "pending", g19: "赛前解读·回测置信度已建" },
    { id: "C005", source: "时序·共振", pattern: "升盘降水 + 同步调盘≥4 → 上盘(强信号)", samples: 120, acc: 0.67, edge: 0.150, status: "adopted", g19: "赛前解读·回测置信度已建" },
    { id: "C006", source: "时序·共振", pattern: "降盘升水 + 成交量放量 → 下盘", samples: 95, acc: 0.60, edge: 0.070, status: "rejected", g19: "赛前解读·回测置信度已建" }
  ];
  const AUDIT = [
    { t: "现时", lvl: "info", ev: "Containment 校验通过 · AI 输出未直接进入融合决策层（0 越权）" },
    { t: "现时", lvl: "ok", ev: "G19 序列已就绪 · 回测在 observed_at 建立置信度（写先于读）" },
    { t: "现时", lvl: "info", ev: "AI 单场解读于 match_time 前完成 · 无时间泄漏" },
    { t: "现时", lvl: "info", ev: "AI 引擎经数据访问层注入数据 · 不持有数据源明文凭证" }
  ];

  function count(st) { return AI_C.filter(c => c.status === st).length; }
  function dirOf(pat) { return pat.includes("上盘") ? 1 : (pat.includes("下盘") ? -1 : 0); }

  function adopt(id) {
    const c = AI_C.find(x => x.id === id); if (!c || c.status !== "pending") return;
    c.status = "adopted";
    if (RULES && !RULES.find(r => r.id === id)) {
      RULES.push({ id, name: `[AI候选]${c.pattern.slice(0, 18)}…`, family: "unknown", direction: dirOf(c.pattern), weight: 1, hasThreshold: false, placeholder: true, desc: c.pattern, test: () => null, evidence: () => "" });
    }
    AUDIT.unshift({ t: "现时", lvl: "ok", ev: `人在环审核通过 · 候选 ${id} 降标记转正入规则库（draft 待定稿）` });
    AUDIT.length = AUDIT.length > 30 ? 30 : AUDIT.length;
    if (window.render) window.render();
  }
  function reject(id) {
    const c = AI_C.find(x => x.id === id); if (!c || c.status !== "pending") return;
    c.status = "rejected";
    AUDIT.unshift({ t: "现时", lvl: "down", ev: `人工审核驳回候选 ${id}（未入规则库）` });
    AUDIT.length = AUDIT.length > 30 ? 30 : AUDIT.length;
    if (window.render) window.render();
  }
  function newTask() {
    const id = "C" + String(AI_C.length + 1).padStart(3, "0");
    const descs = ["主水集体下调后临场升盘", "必发客胜资金骤增", "欧指平赔异常走低", "多机构同步降盘"];
    AI_C.push({ id, source: "自定义挖掘", pattern: `${descs[AI_C.length % descs.length]} → 待审核`, samples: 60 + (AI_C.length % 120), acc: 0.52 + (AI_C.length % 7) / 100, edge: 0.01, status: "pending", g19: "赛前解读·回测置信度已建" });
    AUDIT.unshift({ t: "现时", lvl: "info", ev: `挖掘任务产出候选 ${id} · 标记 untrusted，待人工审核` });
    AUDIT.length = AUDIT.length > 30 ? 30 : AUDIT.length;
    if (window.render) window.render();
  }

  const badge = c => c.status === "adopted" ? '<span class="badge up">已转正</span>' : (c.status === "rejected" ? '<span class="badge down">已驳回</span>' : '<span class="badge risk">待审</span>');

  function renderAIView() {
    const pending = count("pending"), adopted = count("adopted"), draft = count("draft");
    const untrustedN = AI_C.length - adopted - (RULES ? 0 : 0); // 仍以 untrusted 身份存在的候选
    const steps = ["数据接入", "特征工程", "候选生成", "人工审核", "转正入库"];
    const stepper = `<div class="ai-stepper">${steps.map((s, i) => `<div class="ai-step ${i < 3 ? "done" : ""} ${i === 3 ? "current" : ""}"><div class="ai-step-dot">${i < 3 ? "✓" : i + 1}</div><div class="ai-step-label">${s}</div></div>${i < steps.length - 1 ? '<div class="ai-step-line"></div>' : ""}`).join("")}</div>`;
    const rows = AI_C.map(c => {
      const edgeCls = c.edge >= 0 ? "up" : "down";
      const actions = c.status === "pending"
        ? `<button class="btn sm primary" onclick="window.__aiAdopt('${c.id}')">${ICON.check}采纳</button><button class="btn sm" onclick="window.__aiReject('${c.id}')">${ICON.x}驳回</button>`
        : '<span class="muted">—</span>';
      return `<tr>
        <td class="l"><span class="rule-id">${c.id}</span></td>
        <td class="l"><div style="font-weight:500">${c.pattern}</div><div class="muted" style="font-size:11px;margin-top:2px">来源 ${c.source}</div></td>
        <td class="num">${c.samples}</td>
        <td class="num">${(c.acc * 100).toFixed(0)}%</td>
        <td class="num ${edgeCls}">${c.edge >= 0 ? "+" : ""}${c.edge.toFixed(3)}</td>
        <td><span class="badge risk">untrusted</span></td>
        <td>${badge(c)}</td>
        <td>${actions}</td></tr>`;
    }).join("");
    const audits = AUDIT.map(a => `<div class="tl-row"><div class="tl-time">${a.t}</div><div class="al-lvl ${a.lvl}">${a.lvl}</div><div class="al-ev">${a.ev}</div></div>`).join("");

    return `<div class="page">
      <div class="page-head">
        <div class="ph-title">AI 引擎<span class="badge mock" style="margin-left:8px">Mock 示意</span></div>
        <div class="ph-sub">规则挖掘 · 信任边界 Containment · G19 时序纪律</div>
        <div class="ph-actions"><button class="btn sm primary" onclick="window.__aiNew()">${ICON.spark}新建挖掘任务</button></div>
      </div>
      <div class="pipeline-banner"><strong>信任边界（Containment）。</strong>AI 输出标记 untrusted，<strong>永不直接进入融合决策层</strong>；须经数据访问层注入、人工审核降标记后以规则身份入检索/融合链。数据源明文凭证对 AI 引擎不可见。</div>

      <div class="cb-band">
        <div class="cb-cell">
          <div class="cb-lvl risk">AI 产出 · untrusted</div>
          <div class="cb-t">挖掘候选 · 仅沙箱/依据用途</div>
        </div>
        <div class="cb-arrow">→</div>
        <div class="cb-cell">
          <div class="cb-lvl info">人工 + 规则审核 · draft</div>
          <div class="cb-t">人在环 · 回测监督 · 不可入正式预测链</div>
        </div>
        <div class="cb-arrow">→</div>
        <div class="cb-cell">
          <div class="cb-lvl up">规则库 · validated/approved</div>
          <div class="cb-t">可进入检索/融合链 + G19 置信度</div>
        </div>
      </div>

      <div class="ing-sum" style="margin-top:14px">
        <div class="bt-chip"><b>待审候选</b><span class="brand">${pending}</span></div>
        <div class="bt-chip"><b>已转正</b><span class="up">${adopted}</span></div>
        <div class="bt-chip"><b>转正中(draft)</b><span>${draft}</span></div>
        <div class="bt-chip"><b>untrusted 存量</b><span class="risk">${untrustedN}</span></div>
      </div>

      <div class="card" style="margin-top:14px"><div class="card-hd"><div class="title">${ICON.cpu}挖掘流水线</div><div class="extra muted">候选生成后必须停在「人工审核」闸门</div></div><div class="card-bd">${stepper}</div></div>

      <div class="card" style="margin-top:14px"><div class="card-hd"><div class="title">候选规则 (${AI_C.length})</div><div class="extra muted">untrusted → 采纳后降标记转正则入规则库</div></div>
        <div class="card-bd" style="padding:0;overflow-x:auto"><table class="tbl"><thead><tr><th class="l">ID</th><th class="l">规则描述</th><th>样本</th><th>命中率</th><th>edge</th><th>信任</th><th>状态</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>

      <div class="card" style="margin-top:14px"><div class="card-hd"><div class="title">G19 时序纪律</div><div class="extra muted">审计</div></div>
        <div class="card-bd"><div class="callout up" style="margin-bottom:8px"><strong>G19。</strong>回测在 observed_at 序列建立置信度（先写后读）；AI 单场解读在 match_time（赛前）完成；数据先过 statistics_eligible 准入。以上保证无时间泄漏。</div>
        <div class="timeline">${audits}</div></div></div>
    </div>`;
  }

  window.renderAIView = renderAIView;
  window.__aiAdopt = adopt;
  window.__aiReject = reject;
  window.__aiNew = newTask;
  window.__AI = { AI_C, AUDIT, count, dirOf, adopt, reject, newTask };

  if (typeof module !== "undefined") {
    module.exports = { AI_C, AUDIT, count, dirOf, adopt, reject, newTask, renderAIView };
  }
}