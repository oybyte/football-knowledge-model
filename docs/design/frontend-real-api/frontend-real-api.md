# 前端三页接真实端点 · 实施方案

> 目标：把前端 `backtest` / `feature` / `rules` 三页从本地 mock 切到后端真实端点，消除双轨。
> 状态：**`implemented`（2026-10-09 已实施）**。D1–D4 全部按推荐项落地，实施细节与偏差见文末 §9。
> 事实来源：2026-10-09 逐文件代码探查（`prototype-1.0.0/*.js`、`server/src/http/*`、`server/src/features/*`、`server/src/backtest/metrics.js`、V9.7 registry 实测）。

---

## 0. 结论摘要

| 页面 | 难度 | 核心问题 | 建议顺序 |
|---|---|---|---|
| `feature` | 中 | **字段命名体系完全不同**（后端点分扁平 vs 前端族嵌套）；且**没有独立端点** | 第 1 |
| `backtest` | 中 | 端点已存在，但**缺季度序列 / 准入明细**两个字段；真实数字藏在 `v97_real` 里未消费 | 第 2 |
| `rules` | **高** | **语义冲突**：ID 体系、direction 含义、分类维度、可编辑性四项全对不上 | 第 3 |

三个页面有一个**共同的结构性障碍**：当前都是**同步渲染**（`main.innerHTML = renderXxx()`），接真实端点后必须改为**异步渲染**（骨架 → 数据填充）。这是本次改造的公共骨架，先做掉再逐页推进。

---

## 1. 现状核查（事实）

### 1.1 三个页面的渲染入口

| 页面 | 渲染函数 | 所在文件 | 数据来源 |
|---|---|---|---|
| `backtest` | `window.renderBacktest` | `prototype-1.0.0/backtest.js`（211 行） | 本地 `RULES` + `makeMetrics()` 伪随机 |
| `feature` | `window.renderFeature` | `prototype-1.0.0/feature.js`（137 行） | 本地 `MATCHES` + `computeFeatures()`（features.js） |
| `rules` | `renderRulesPage` / `renderRulesLibrary` / `renderFeatureCatalog` | **`prototype-1.0.0/app.js`**（908–1098 行） | 本地 `RULES`（`rules.js`，16 条 R001–R016） |

> 注意：`rules.js` 只是**数据层**（`RULES` 数组 + `evaluate`），**页面渲染在 `app.js`**。改造 rules 页要动 `app.js`，不是 `rules.js`。

### 1.2 api-client 的现状（已有基础设施，但三页都没用）

`prototype-1.0.0/src/api-client/api-client.js` 已实现：

- `getApi()` 按 `localStorage.oe_api_mode_v2` 返回 `http(baseUrl)` 或 `mock` 适配器；默认 `real`。
- **已有 `listRules` / `getBacktest` 的 http 适配器 + 契约归一化**（`ruleView` 做 `rule_id→id`；`getBacktest` 做 `sample_size→admitted`，`admission` 收缩为 `{adjudication, job_id}`）。
- **没有** feature 相关方法。

结论：rules / backtest 的适配器**已存在但不完整**，feature 需要从零加。

### 1.3 后端可用端点（`server/src/http/index.js` 路由表）

| 端点 | 返回 | 可否直接支撑页面 |
|---|---|---|
| `GET /api/rules` | 88 条 active 规则的版本对象 | 需要字段映射（见 §4.3） |
| `GET /api/rules/:id/versions` | 单规则版本历史 | 可直接用 |
| `GET /api/backtest/:id` | `{job_id, adjudication, sample_size, metrics, thresholds, synthetic, v97_real}` | 需要补字段（见 §4.2） |
| `GET /api/merged/analysis/:id` | `{features, hits, reasoning, arbitration, fusion, v97}` | **特征页唯一可用来源** |
| `GET /api/sources/merged` | 合并池 `pool[]` | 特征页场次选择的来源 |

**关键缺位：没有独立的特征端点**（`/api/features/:id` 不存在）。特征只在 `merged/analysis` 响应的 `features` 字段里。

### 1.4 后端真实产出 vs 前端期望（逐页差异）

#### A. 特征字段（19 产出 vs 23+ 期望）

后端 `server/src/features/compute.js` 产出**点分扁平命名**，前端 `feature.js` 的 `META` 期望**六族嵌套命名**：

| 前端族.字段 | 后端扁平键 | 状态 |
|---|---|---|
| `cross.handicap_dispersion` | `institution.diff_max` | 可映射 |
| `cross.home_water_dispersion` | `water.upper.dispersion` | 可映射 |
| `cross.away_water_dispersion` | `water.lower.dispersion` | 可映射 |
| `temp.handicap_movement` | `handicap.change` | 可映射 |
| `temp.home_water_movement` | `water.upper.change` | 可映射 |
| `temp.away_water_movement` | `water.lower.change` | 可映射 |
| `temp.move_pattern` | `move_pattern` | 可映射 |
| `temp.stability_flag` | `stability_flag` | 可映射 |
| `temp.home_water_drop_count` | `water.upper.drop_count` | 可映射 |
| `temp.home_water_rise_count` | `water.upper.rise_count` | 可映射 |
| `reso.sync_handicap_count` | `institution.sync_count` | 可映射 |
| `reso.consensus_direction` | `consensus_direction` | 可映射 |
| `anom.maxKelly` | `kelly_index.max` | 可映射 |
| `anom.minKelly` | `kelly_index.min` | 可映射 |
| `anom.kelly_divergence` | `kelly_index.divergence` | 可映射 |
| `anom.volume_anomaly` | `volume.ratio` | 可映射 |
| `onex.kelly_home_max` | `kelly_index.home_max` | 可映射 |
| `betfair.turnover` | `betfair.turnover` | 可映射 |
| `betfair.heat_max` | `betfair.heat` | 可映射 |
| `betfair.dominant_ratio` | `betfair.dominant_ratio` | 可映射 |
| `onex.home_odds_movement` | — | **后端未产出** |
| `onex.kelly_home_min` | — | **后端未产出** |
| `onex.kelly_home_divergence` | — | **后端未产出** |
| `onex.kelly_away_max` | — | **后端未产出** |
| `betfair.heat_min` | — | **后端未产出** |
| `betfair.dominant_result` | — | **后端未产出** |

> **6 个字段后端没有**。改造时必须渲染为"后端未产出"，**不得用 0 或猜测值填充**（宁缺毋滥）。

#### B. 回测指标（后端有 9 项，前端要 15 项）

后端 `computeMetrics` 产出：
`sample_size` / `direction_count` / `hit_count` / `hit_rate` / `roi` / `max_drawdown` / `time_stability` / `league_coverage` / `leagues[]`

前端 `makeMetrics` 需要但后端缺失：

| 前端字段 | 用途 | 后端状态 |
|---|---|---|
| `trend[]` / `trendLabels[]` | 季度命中率柱状图 | **缺**（只给了 `time_stability` 方差，没给序列） |
| `failDist{}` | 5 项准入失败分布 | **缺**（`runBacktest` 只回 `adjudication`，无逐项明细） |
| `untrusted` | 被隔离样本数 | **缺**（`sample_size` 已只含 eligible，隔离数未暴露） |
| `metrics` 整体 | — | 有，但 `getBacktest` 标了 `synthetic: true`（旧 DSL 合成门禁） |

**真实的 V9.7 数字在 `v97_real` 里**（`covered` / `tally` / `ledger_count` / `ledger_sample` / `probe`），当前前端完全没有消费。

#### C. 规则字段（语义冲突，四项）

后端 `/api/rules` 实测返回 88 条，字段：`rule_id` / `version_id` / `version` / `category` / `rule_type` / `direction` / `conclusion` / `base_confidence` / `priority` / `trust_level` / `status` / `valid_from` / `valid_to` / `evidence_refs` / `evidence_count` / `v97`

| 维度 | 前端 mock | 后端真实 | 冲突性质 |
|---|---|---|---|
| **ID 体系** | `R001`–`R016`（三位） | `R01`–`R88` + `E*` / `S*`（两位） | 完全不同，**无交集** |
| **名称** | `name`（如"升盘降水"） | 无 `name`，只有 `conclusion`（中文本，如"凯利0.05平权判定标准｜判定为极致平权盘，强制执行E06分型"） | 字段缺失 |
| **分类** | `family`：temporal/cross/resonance/anomaly/onex/betfair | `category`：盘性6 / 让球盘19 / 总进球18 / 联赛专属5 / 平局冷门8 / 执行复盘14 / 执行规范16 / 杯赛专项2 | **分类维度不同**，非改名可解 |
| **方向** | `direction`: `1`/`-1`/`0`（上盘/下盘/风险） | `direction`: `"rule"` 等**规则类型字符串**，不是方向 | **语义完全不同** |
| **阈值** | `threshold` + `hasThreshold` | 无顶层阈值（阈值在 `v97.atoms` 里） | 字段缺失 |
| **可编辑** | `newRule()` / `editRule()` 本地 CRUD | **无写端点**（治理变更走 state machine + promote） | **能力冲突** |

---

## 2. 必须先拍板的四个决策点（阻断项）

以下四项不定，`rules` 页无法开工；前两项也影响 `backtest`。

### D1. rules 页的编辑能力如何处置？

后端**没有**规则写端点。规则变更走 `state_machine`（8 态）+ `promote` 门禁 + 版本不可变。三条路：

- **D1-a（推荐）**：接真实后，规则库页**降级为只读浏览 + 版本历史**，编辑入口改为"发起变更提案"跳转到治理页；`newRule` / `editRule` 从规则库页移除。
  - 理由：与后端不可变版本化语义一致，不制造"前端能改、后端改不了"的假象。
- **D1-b**：保留本地编辑，但**明确标注"仅本地沙盒，不影响后端规则"**（双轨显式化）。
- **D1-c**：新增后端写端点（超出本次范围，等于开新工程）。

### D2. 规则"方向"从哪来？

后端 `direction` 字段是规则类型（`"rule"`），不是方向。候选来源：

- **D2-a**：从 `v97.effects` 取（引擎已求值出的方向型效果）——最贴合"求值结果"语义。
- **D2-b**：前端不展示方向列，改展示 `category` + `trust_level`。
- **D2-c**：定义"category → 方向"的静态映射表（不推荐，属于臆造语义）。

### D3. 特征页的数据通道？

- **D3-a（推荐）**：**新增** `GET /api/features/:id` 薄端点，内部复用 `computeMatchFeatures`，直接返回扁平特征 + 快照 meta。
  - 优点：特征页职责单一，不必为了看特征去跑整条推理链；`meta`（`snapshot_count` / `filtered_out` / `sources`）可完整展示。
- **D3-b**：复用 `/api/merged/analysis/:id` 的 `features` 字段。
  - 优点：零后端改动；缺点：必须触发整条 `predict()` + 融合链，且拿不到 `filtered_out` 等 meta。

### D4. mock 双轨是否保留？

建议**保留**（`api-client` 的 mock 适配器同步补齐新方法），理由：离线降级与"后端接入"页的 mock/http 切换是既有契约；删掉会破坏 `api` 页演示能力。

---

## 3. 公共骨架：同步 → 异步渲染

### 3.1 问题

当前 `app.js` 是同步的：

```js
else if (state.page === "backtest") main.innerHTML = window.renderBacktest();
```

接真实端点后，渲染函数必须先出骨架、再异步填充，否则页面会白屏或渲染出空数据。

### 3.2 统一模式（三页共用）

**步骤 3.2.1**：为每页引入一个模块级状态对象：

```js
const BT_STATE = { ruleId: null, rules: [], data: null, loading: false, error: null };
```

**步骤 3.2.2**：渲染函数拆成两层——`renderXxx()` 只读状态出 HTML（含 loading / error / empty 三态），`loadXxx()` 负责取数并回填状态后重渲：

```js
function rerender() {
  const main = document.getElementById("main");
  if (main) main.innerHTML = `<div class="page">${renderFeature()}</div>`;
}

async function loadFeatureData(id) {
  FEAT_STATE.loading = true; FEAT_STATE.error = null; rerender();
  const api = window.__ApiClient.getApi();
  const r = await api.getFeature(id);          // D3 决定方法名
  FEAT_STATE.loading = false;
  if (!r.ok) { FEAT_STATE.error = r.error || "unknown"; rerender(); return; }
  FEAT_STATE.data = r.data; rerender();
}
```

**步骤 3.2.3**：`app.js` 的路由分支改为"先渲骨架 → 再触发加载"：

```js
else if (state.page === "backtest") {
  main.innerHTML = `<div class="page">${window.renderBacktest()}</div>`;
  window.__btBoot && window.__btBoot();     // 新增引导函数
}
```

**步骤 3.2.4**：三态 UI 统一文案（复用既有 class）：

- loading：`<div class="empty">正在加载真实数据…</div>`
- error：`<div class="empty">后端不可用（error: ${error}）· 可切换 Mock 模式</div>`
- empty：`<div class="empty">合并池暂无场次</div>`

**步骤 3.2.5**：移除 mock 徽章的条件化——真实数据渲染时不再显示 `Mock 回测示意` / `Mock 计算示意`；mock 模式下保留。

---

## 4. 分页面实施步骤

### 4.1 `feature` 页（顺序 1，最独立）

**改动文件**：`prototype-1.0.0/feature.js`、`prototype-1.0.0/src/api-client/api-client.js`、`prototype-1.0.0/app.js`、`server/src/http/index.js` + `handlers.js`（若选 D3-a）

**步骤**

1. **接数据通道**（按 D3 决策）
   - 若 D3-a：`http/index.js` 加路由 `GET /api/features/:id` → `handlers.js` 新增 `getFeatures(service, params)`，内部 `loadManualOddsFromDb(service.qd)` 定位场次 → `computeMatchFeatures(match, match.match_time)`，返回 `{ match_id, features, meta: snapshot.meta, computed_at, feature_version }`。
   - 若 D3-b：直接用 `getMergedAnalysis`，取 `r.data.features`。

2. **api-client 加方法**

```js
// http 适配器
getFeature: function (id) { return req('GET', '/api/features/' + encodeURIComponent(id)); },
// mock 适配器（D4 若保留双轨）：用本地 MATCHES + computeFeatures 走族结构
getFeature: function (id) { /* 复用现有 features.js computeFeatures，返回族嵌套 */ },
```

3. **写族映射适配层**（在 `feature.js` 内新增，mock 模式下为恒等）

```js
const FLAT_TO_FAMILY = {   // 后端扁平键 → [族, 前端字段]
  'institution.diff_max':        ['cross', 'handicap_dispersion'],
  'water.upper.dispersion':      ['cross', 'home_water_dispersion'],
  'water.lower.dispersion':      ['cross', 'away_water_dispersion'],
  'handicap.change':             ['temp',  'handicap_movement'],
  'water.upper.change':          ['temp',  'home_water_movement'],
  'water.lower.change':          ['temp',  'away_water_movement'],
  'move_pattern':                ['temp',  'move_pattern'],
  'stability_flag':              ['temp',  'stability_flag'],
  'water.upper.drop_count':      ['temp',  'home_water_drop_count'],
  'water.upper.rise_count':      ['temp',  'home_water_rise_count'],
  'institution.sync_count':      ['reso',  'sync_handicap_count'],
  'consensus_direction':         ['reso',  'consensus_direction'],
  'kelly_index.max':             ['anom',  'maxKelly'],
  'kelly_index.min':             ['anom',  'minKelly'],
  'kelly_index.divergence':      ['anom',  'kelly_divergence'],
  'volume.ratio':                ['anom',  'volume_anomaly'],
  'kelly_index.home_max':        ['onex',  'kelly_home_max'],
  'betfair.turnover':            ['betfair', 'turnover'],
  'betfair.heat':                ['betfair', 'heat_max'],
  'betfair.dominant_ratio':      ['betfair', 'dominant_ratio'],
};

function toFamilyShape(flat) {
  const out = { cross: {}, temp: {}, reso: {}, anom: {}, onex: {}, betfair: {} };
  for (const [k, v] of Object.entries(flat || {})) {
    const m = FLAT_TO_FAMILY[k];
    if (m) out[m[0]][m[1]] = v;
  }
  return out;
}
```

4. **场次选择器换源**：`MATCHES.map(...)` → `FEAT_STATE.pool`（来自 `/api/sources/merged`），option 文案用 `league + home_team + away_team`，`merged` 场加标记；`(Mock)` 后缀移除。

5. **诚实标注缺失字段**：§1.4-A 表中"后端未产出"的 6 个字段，由 `fmt()` 渲染为 `—`，并在卡片 extra 处标注"后端未产出（N 项）"。

6. **快照 meta 展示**（D3-a 才有）：卡头加 `filtered_out` / `snapshot_count` / `sources`，替代当前 mock 的"缓存命中/未命中"。

7. **缓存语义对齐**：当前 `Cache` 是渲染侧模拟。改为展示后端 `computed_at` + `feature_version`，或直接去掉（后端 `FeatureCache` TTL 30min 是真的）。**不要保留"模拟缓存命中"的假信号**。

**验收**：切到 real 模式 → 选中一场真实合并池场次 → 六族卡片显示真实数值（可求值字段非 `—`）→ 缺失字段显示 `—` 且标注 → 切回 mock 模式仍可正常渲染。

---

### 4.2 `backtest` 页（顺序 2）

**改动文件**：`prototype-1.0.0/backtest.js`、`src/api-client/api-client.js`、`app.js`、`server/src/http/handlers.js`（补字段）

**步骤**

1. **api-client 的 `getBacktest` 适配器补齐**——当前把 `v97_real` 丢了，必须透传：

```js
getBacktest: function (id) {
  return req('GET', '/api/backtest/' + encodeURIComponent(id)).then(function (r) {
    if (!r.ok) return r;
    r.data = {
      rule_id: r.data.rule_id,
      job_id: r.data.job_id,
      adjudication: r.data.adjudication,
      sample_size: r.data.sample_size,
      metrics: r.data.metrics,
      thresholds: r.data.thresholds,
      synthetic: r.data.synthetic,
      v97_real: r.data.v97_real,     // ← 新增透传（真实数字在这里）
    };
    return r;
  });
}
```

2. **规则下拉换源**：`RULES.map(...)` → `/api/rules` 的真实 88 条（`rule_id` + `conclusion` 截断显示）；默认选中改为真实可回测的规则（`R01` / `R13` / `S25`），而非 `R009`。

3. **后端补两个字段**（`handlers.js` 的 `getBacktest`）：
   - **季度命中率序列**：`v97_real` 已在 `backtestRule` 里按场判定，可聚合出 `quarterly: [{ q: '2026-Q1', rate, n }]`；或由 `ledger` 前端聚合（若 `ledger_sample` 只给 10 条则必须后端聚合）。
   - **准入失败分布**：`runBacktest` 的 `job` 对象里若已有 `checks` / `failed_checks` 则直接透传；没有则返回 `null` 并让前端显式显示"准入明细未提供"。
   - **隔离样本数**：`computeMetrics` 只统计 eligible；若需要 `untrusted` 计数，在 `eligibility` 层统计后随 job 返回。

4. **渲染改造**：
   - 「回测作业元数据」卡：`reportId` / `job_${id}` / `近 8 周` / `${ago} 前` 四个 mock 字段改为真实值（`job_id` / `BACKTEST_RANGE` / `created_at`），或明确标注"后端未提供"。
   - 「6 项指标」卡：`metHtml` 数据源改为 `metrics` + `thresholds`，键名对齐（§1.4-B 表）。
   - 「5 项准入」卡：数据源改为后端 `admission`（若 D 步骤 3 未补，则**整卡降级为"未提供"**，不要保留伪随机分布）。
   - 「时间稳定性」卡：用步骤 3 的 `quarterly` 序列；无序列则降级为只显示 `time_stability` 数值。
   - **新增「V9.7 真实回测」卡**：展示 `v97_real.covered` / `tally`（hit/miss/insufficient）/ `ledger_count`，以及 `probe`（S25 探针 `total` / `hits` / `hit_rate` / `note`）。这是本页最有价值的新增内容。
   - **`synthetic` 诚实标注**：当 `synthetic === true` 时，指标卡必须显示"旧 DSL 合成门禁（占位）"，避免把合成数字当真实结论。

5. **G19 置信度卡**：当前 `confidence` 由 mock 算出。改为展示后端真实值；若端点未返回，则整卡标注"未提供"，**不要用命中率现算**。

**验收**：切 real → 选 `S25` → 展示真实 `v97_real`（含探针命中率）→ `synthetic` 标注可见 → 指标达标判定与后端 `adjudication` 一致。

---

### 4.3 `rules` 页（顺序 3，需 D1/D2 拍板）

**改动文件**：`prototype-1.0.0/app.js`（渲染 + 编辑函数）、`rules.js`（`RULES` 保留为 mock 源）、`src/api-client/api-client.js`

**步骤**

1. **api-client 的 `ruleView` 补字段**——当前只映射 6 个字段，丢失关键信息：

```js
function ruleView(r) {
  return {
    id: r.rule_id,
    version_id: r.version_id,
    conclusion: r.conclusion,       // 名称来源
    category: r.category,           // 中文分类（非 family）
    status: r.status,
    version: r.version,
    trust_level: r.trust_level,
    priority: r.priority,
    base_confidence: r.base_confidence,
    direction: r.direction,         // 注意：这是规则类型，不是方向（见 D2）
    evidence_count: r.evidence_count,
    valid_from: r.valid_from,
    valid_to: r.valid_to,
  };
}
```

2. **筛选 chips 换维度**：`temporal/cross/resonance/anomaly/onex/betfair/unknown` → 后端实际 `category`：`盘性 / 让球盘 / 总进球 / 联赛专属 / 平局冷门 / 执行复盘 / 执行规范 / 杯赛专项`（动态从数据聚合，不硬编码）。

3. **表格列重排**（按 D2 决策）：
   - `ID` → `rule_id`（R01 形式，宽度可收窄）
   - `名称` → `conclusion`（长文本截断 + `title` 悬浮全文）
   - `家族` → `category` 徽章
   - `方向` → 按 D2 决策（v97.effects / 隐藏 / 映射表）
   - `阈值` → **移除**（后端无此字段）或改为 display "见 atoms"
   - `状态` → `status`（active 等真实状态）
   - `版本` → `version` 真实版本号（不再是硬编码 `v1`）
   - `检索命中` → `buildRuleHits()` 用 `MATCHES[0]`，**必须换源**为真实场次；或整列移除
   - `DSL条件` → `dslOpsHint(r.id)` 基于前端 DSL mock，**与 V9.7 无关**，建议列移除或改展示 `evidence_count`

4. **编辑能力处置**（按 D1 决策）：
   - D1-a：`newRule` / `editRule` 按钮替换为"查看版本历史"（调 `/api/rules/:id/versions`）+ "发起变更提案"（跳治理页）；`state.enabled` / `state.thresholds` 的本地覆盖逻辑**保留但仅作用于 mock 模式**。
   - D1-b：保留编辑但按钮旁加 `badge mock`（"本地沙盒"），并在页面 banner 说明不写回后端。

5. **同步「特征目录」Tab**（`renderFeatureCatalog`）：`FEATURE_CATALOG` 是硬编码 14 项的静态表。若 D3-a 新增了特征端点，可改为展示后端实际字段清单（`/api/features/:id` 的 keys + 注册表 23 字段），消除"目录说 23 项、实际产出 19 项"的口径差。

6. **`rules.js` 的角色降级**：`RULES` 数组保留为 mock 模式数据源；但页面默认数据源改为 API。文档注释需更新（当前注释仍描述"确定性 IF-THEN"，与实际双轨状态不符）。

**验收**：切 real → 展示 88 条真实规则 → 分类筛选可聚合 → 版本历史可查 → 无编辑能力（或编辑明确标注不影响后端）→ 切 mock 仍可用。

---

## 5. 后端待补清单（汇总）

| # | 事项 | 文件 | 阻塞页面 |
|---|---|---|---|
| B1 | 新增 `GET /api/features/:id`（若选 D3-a） | `server/src/http/index.js` + `handlers.js` | feature |
| B2 | `getBacktest` 补季度命中率序列 | `handlers.js`（`backtestRule` 聚合） | backtest |
| B3 | `getBacktest` 补准入明细 / 隔离样本数 | `handlers.js` / `backtest/eligibility.js` | backtest |
| B4 | 补 6 个缺失特征字段（`onex.*` / `betfair.heat_min` / `dominant_result`） | `server/src/features/compute.js` | feature（可选，属能力扩展） |
| B5 | 规则方向语义来源确认（D2 若选 `v97.effects`） | `server/src/engine/v97/` | rules |

**B4 说明**：`onex.home_odds_movement` 等需欧洲盘初/临盘数据；`computeOnex` 当前只算 `kelly_index.home_max`，属**真实能力缺口**，不是接线问题。建议**不阻塞本次改造**，如实标注"未产出"。

---

## 6. 实施顺序与依赖

```
D1/D2/D3/D4 拍板
      │
      ├─→ 阶段 0：公共骨架（§3 异步渲染模式）           ← 无依赖，先做
      │   └─ app.js 路由改造 + 三页状态对象脚手架
      │
      ├─→ 阶段 1：feature 页（D3）                       ← 依赖 D3
      │   └─ 可选 B1
      │
      ├─→ 阶段 2：backtest 页                            ← 依赖阶段 0
      │   └─ 可选 B2/B3
      │
      └─→ 阶段 3：rules 页（D1/D2）                      ← 依赖 D1/D2
          └─ 可选 B5
```

**每阶段完成后的校验**（对齐 AGENTS.md）：

1. `node --check` 全部改动的 JS 文件
2. 浏览器实测：real 模式下三态（loading / error / data）均正确
3. 切 mock 模式回归，确认离线降级未破坏
4. 后端 `npm test` 全量回归（461 用例）保持全绿 —— 若动了 `handlers.js` / `compute.js`，需补对应单测
5. 无 `window.error` / `unhandledrejection`（沿用既有双通道捕获验证法）

---

## 7. 风险与注意

| 风险 | 说明 | 缓解 |
|---|---|---|
| **异步渲染引入竞态** | 快速切页/切场次时旧响应覆盖新状态 | 状态对象内加请求序号 `reqSeq`，响应回来比对，过期丢弃 |
| **`synthetic: true` 被误读** | 合成门禁数字被当作真实回测结论 | 前端强制标注；AGENTS.md 已明文禁止描述为生产精度/ROI |
| **双轨残留** | 三页接真后，`rules.js` / `features.js` / `pipeline.js` 的 mock 仍在别处被引用 | 改造前 grep 全部引用点，逐一定位 |
| **ID 体系割裂** | 前端 R001 与后端 R01 并存会造成用户困惑 | 统一展示后端 ID；mock 模式单独标注"示例规则" |
| **`api` 页契约漂移** | `api-client` 是 `api` 页的演示对象，改契约要同步该页说明 | 改完后跑 `prototype-1.0.0/test/api-client.http-integration.js` |

---

## 8. 待确认问题清单（请拍板）

1. **D1**：rules 页编辑能力 → 只读（a）/ 本地沙盒（b）/ 新增写端点（c）？
2. **D2**：规则"方向"列 → 取 `v97.effects`（a）/ 隐藏该列（b）/ 静态映射（c）？
3. **D3**：特征数据通道 → 新增 `/api/features/:id`（a）/ 复用 `merged/analysis`（b）？
4. **D4**：mock 双轨 → 保留（建议）/ 移除？
5. **B2/B3**：季度序列与准入明细是否本轮就补后端？还是先让前端诚实显示"未提供"？
6. 本方案是否按 feature → backtest → rules 顺序执行，还是三页并行？

---

## 9. 实施记录（2026-10-09）

**决策落地**：D1-a（rules 只读 + 版本历史）、D2-a（方向取 `v97.effects`）、D3-a（新增特征薄端点）、D4（保留 mock 双轨）、B2/B3 本轮不补后端（前端诚实显示"未提供"）。执行顺序 feature → backtest → rules。

### 9.1 后端

| 改动 | 位置 |
|---|---|
| 新增路由 `GET /api/features/:id` | `server/src/http/index.js` |
| 新增 `getFeatures` 薄端点（合并池定位 → `computeMatchFeatures`，不触发规则检索/融合链） | `server/src/http/handlers.js` |
| `listRules` / `getRuleVersions` 改为**瘦视图**：补 `name`（取 `v97.name`）、`rule_type`、`category`、`declared_direction`、`evidence_count`、`valid_from/to`、`previous_version_id`、`created_at` 等；剔除 `v97` 大对象 | 同上（`ruleVersionView` / `declaredDirection`） |
| `getBacktest` 补 `date_range` / `rule_name` / `rule_version`，并显式回 `admission_detail: null`、`untrusted_count: null`（未产出即 null，前端据此标注） | 同上 |

**D2 的语义校正（重要）**：探查发现 `v97.effects` 中的方向类维度（`direction` / `signal_direction` / `total_goals_signal`）是**规则正文声明的语义文本**（如「诱小→防大」「阻大=真实看大球」「按E01释义」），**不是本场求值结论，更不是 `1/-1/0`**。因此 D2-a 落地为：原样展示声明文本 + 表头命名为「方向语义」+ 悬浮说明「非本场求值结论」。**未做任何"上盘/下盘"映射**（那属臆造语义）。

### 9.2 契约层（api-client）

- 新增 `getFeature`（http + mock），并新增 **`FLAT_TO_FAMILY` + `toFamilyShape`**：后端 20 个点分扁平键 → 前端六族嵌套键。
  - **偏差说明**：方案原拟把族映射写在 `feature.js`；实施时改到 api-client —— 因为该文件的既有职责就是"契约归一化（mock 与真实模式不改视图代码）"，放这里才与既有架构一致，且 mock 适配器直接复用 `features.js` 的族结构，两个适配器输出同形。
  - 后端未产出的键**不进入族结构**（不补零、不补 null），前端据此判定「未产出」。
- **`getBacktest` 双适配器统一为归一化契约**：`{rule_id, rule_name, rule_version, job_id, adjudication, sample_size, metrics, thresholds, date_range, synthetic, v97_real, admission_detail, untrusted_count}`。原 mock 契约里的 `admitted` / `admission` 已移除（改为 `sample_size` / `admission_detail`），并修复了 mock 既有的 `metrics: rep.metrics`（实为 `undefined`）缺陷。
- mock 的 `thresholds` 归一化为与后端同形的**扁平数值表**（原型沙盒是 `{op,value}` 富形状 → 取 `value`）。
- `ruleView` 补齐新字段；mock `listRules` / `getRuleVersions` 同步为同形。

### 9.3 前端三页

- **公共骨架**：`app.js` 路由改为「先渲骨架 → 再触发 `window.__featBoot` / `__btBoot` / `__rulesBoot`」；三页各引入模块级状态对象（`FEAT_STATE` / `BT_STATE` / `RULE_STATE`）含 `loading / error / data / reqSeq`，`reqSeq` 用于过期响应丢弃（防快速切页/切场次竞态）；三个 boot 钩子均按「已有同 key 数据则复用」幂等。
- **feature 页**：场次选择器换源 `/api/sources/merged`（标注已锚定/未锚定）；六族卡片消费归一化族结构；缺失字段渲染 `—` 且标注「后端未产出」，页头统计 `字段产出 20 / 27`、`未产出 7 项`；**移除"模拟缓存命中"假信号**，改展示 `computed_at` + `feature_version`；原「清除缓存」按钮改为「刷新」（后端 `FeatureCache` TTL 30min 命中即返回同一快照，不做假清除）。
- **backtest 页**：规则下拉换源 `/api/rules` 真实 88 条（默认优先 `S25` → `R01` → `R13`）；6 项指标取后端 `metrics` + 扁平 `thresholds`（比较方向为设计契约常量）；5 项准入在无逐项明细时整卡降级为「明细未提供」；时间稳定性仅给方差、季度序列标注「未提供」；G19 标注「后端未返回，不得以命中率现算」；**新增「V9.7 真实回测」卡**（`covered` / `tally` / `ledger_sample` 表 / `probe` 探针）；`synthetic=true` 强制标注「旧 DSL 合成（占位）」。**保留 `window.__BACKTEST`（makeMetrics/evalBt/THRESHOLDS/ADMISSION_CHECKS）契约不变**，`governance.js` 的治理门禁不受影响。
- **rules 页**：列重排为 `ID / 名称(v97.name) / 分类 / 类型 / 方向语义 / 状态 / 版本 / 可信 / 证据`；筛选 chips 由 `category` **动态聚合**（不再硬编码六族）；real 模式只读——header 的「新建规则」改为「发起变更提案」（跳治理页），行内「编辑」改为「版本历史」（弹窗调 `/api/rules/:id/versions`，展示版本链与 `previous_version_id` 指针）；**移除**与 V9.7 无关的旧列（「检索命中」基于旧 DSL 按 `MATCHES[0]` 现算、「DSL条件」）及其死代码（`buildRuleHits` / `dslOpsHint` / `hitChip` / `RULE_HITS` / `HIT_MATCH_ID`）；mock 模式保留本地沙盒新建/编辑（按钮标题显式标注 Mock 沙盒）。
- `index.html` 缓存版本号提升：`api-client?v=5`、`backtest?v=2`、`feature?v=2`、`app?v=20`。

### 9.4 B 类待办（本轮未做，仍开放）

- **B2/B3**：季度命中率序列、准入逐项明细、隔离样本数 —— 后端未提供，前端一律标注「未提供」。仍为开放项（§5）。
- **B4**：`onex.*` 4 项 + `betfair.heat_min` + `betfair.dominant_result` + `reso.sync_home_water_count`（合计 7 项前端契约字段）后端未产出，属**真实能力缺口**（需欧洲盘初/临盘等新数据源），非接线问题。宁缺毋滥，渲染为 `—`。
- **B5**：规则方向若日后要展示"本场求值方向"，需引入按场次求值的通道（当前仅声明语义）。

### 9.5 验证证据

1. `node --check` 全部改动 JS：通过；`index.html` 16 项资产引用全部存在。
2. 后端 `npm test`：**465 用例 / 463 通过 / 0 失败 / 2 跳过**（含新增 4 例：特征薄端点正/反例、规则瘦视图字段、版本瘦视图）。
3. 原型契约测试：`api-client.smoke.js`（mock + http 双适配器，含 `getFeature` 族归一化）通过；`api-client.http-integration.js`（真实后端联调）通过；`governance-gate.test.js` 2/2 通过。
4. **新增 `prototype-1.0.0/test/render-real-pages.js`**（4 例，自包含：`:memory:` DB + 临时盘赔目录）：在 VM + 最小 DOM 中加载四个脚本接真实后端，断言三页渲染真实数据、mock 双轨可用、未提供项诚实标注。**该用例首跑即抓到一处真实缺陷**：`app.js` 路由检查 `window.__rulesBoot` 却从未挂载，规则页会永停 loading —— 已修复。
5. 已知既有失败（非本次引入）：`frontend-v97.test.js` 失败于第 55 行。已用 `git show HEAD:` 原始 `api-client.js` 复跑复现同一失败，确认与本改造无关 —— 该用例硬编码"当天录入场次 `2041244`"，今日合并池 `aligned=0` 且该场次不在 343 场人工盘赔池内。**建议后续改为动态选取池内场次或加环境前置跳过**。
