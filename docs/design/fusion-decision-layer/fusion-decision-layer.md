# 融合决策层 · 落点与定义（v1.6.0 提案）

> 状态：`proposal`（供评审）。**事实更正（2026-09-03，系统全量审视后）**：
> 融合决策层**并非空白**——`server/src/fusion/`（fuse.js / decision.js / weights.js /
> confidence.js / containment.js）**已实现且已接线**，由 `engine/prediction.js` 与
> `worker/worker.js` 调用，具备三路输入（规则/统计/异常）、动态权重、G19 置信度门、
> 信任隔离（AI 不污染正式链）。
> 真正的缺口是：**V9.7 真规则结果没有喂进融合层**——V9.7 atoms 不再进 DSL 检索，
> 导致融合层无输入而空转（prediction=null、arbitration undecidable）。
> 本文件因此聚焦「v97 结果如何接入既有融合层」，而非重新定义这一层。
> 全系统模块状态见 docs/system-review-2026-09-03.md。

## 1. 背景

预测链现状（V9.7 接入后）：
- **旧 DSL 链**：`predict()`（engine/prediction.js）产出 `arbitration.direction/confidence`，
  但 V9.7 真规则的 atoms 不再喂 DSL → 真实场次上 DSL 推理链为空（prediction=null），
  方向仲裁常为 undecidable。**这条链已不承载真规则结论，仅承载 mock/历史契约。**
- **V9.7 引擎链**：`/api/merged/analysis` 新增 `v97` 块——88 规则三态求值 + 字段信封，
  命中规则带 `dimensions`（gate/weight/signal/classification/total_goals_signal/…），
  全部为 provisional 规则（未回测转正）。

## 2. 落点决定

**融合计算仍在既有 `fusion/` 模块内完成（不另起炉灶）**；消费端落点为
`merged/analysis` 响应内的 `v97` 块 + 前端「V9.7 真规则求值」区块（已在 app.js 渲染）。
即：v97 维度结果 → 适配为 fusion 的一路输入 → 融合输出 → 同页展示。
理由：
- `fusion/` 已有三路融合/权重/置信度门/信任隔离，重写是浪费且会丢门禁；
- 单场分析页是结论消费点，融合结果必须与场次同屏，不再单设独立页；
- 旧 DSL 仲裁保留为兼容字段，待 v97 接入后由融合层统一产出。

## 3. 策略（可配置性）

| 输入 | 信任 | 用途 |
|---|---|---|
| v97 规则命中（dimensions/effects） | provisional | 维度信号（门禁/权重/信号），**不直接产出让球方向** |
| v97 字段信封（status 分布） | — | 结论可信度：usable 字段占比低 → 降级提示 |
| 回测证据（v97_real，含 S25 探针） | 转正后 | 规则由 provisional→trusted 后，其方向结论才可进正式仲裁 |

默认策略（v1）：
1. `gate` 类维度 = 前置门禁（不构成方向）；`weight/guard` = 调整权重（暂只展示）；
2. `total_goals_signal`/`direction`/`signal_direction` 类 = 维度倾向结论 → 以
   「总进球信号/方向倾向」形式输出，**与让球方向仲裁分离展示**（对应四维框架）；
3. 规则回测转正（promote 门禁：样本≥30/命中率≥55%/ROI≥0/回撤≤15%，
   见 backtest/metrics.js THRESHOLDS + promote/promote.js）后，该规则方向结论
   才允许进入统一方向仲裁。

## 4. 可配置项

| 项 | 状态 | 说明 |
|---|---|---|
| 维度中文映射表 V97_DIM_ZH | ✅ 已实现 | app.js，可扩充 |
| **融合三路权重（rule/model/anomaly）** | ✅ **已实现（2026-09-03）** | env `OE_FUSION_WEIGHTS=rule:0.5,model:0.3,anomaly:0.2`；仅覆盖给定键、缺失键回退默认、自动归一；解析失败回退默认。关闭 G10「可配置性空白」。 |
| 每维度「是否参与方向仲裁」开关 | ⏳ Phase 2 | 默认否，转正后由 promote 侧开启 |
| **置信度 edge/ROI 加权** | ⏳ **Phase 2（定义见 §4.1）** | 当前为回测命中率加权（兼容占位）；让球盘基础胜率天然≈50%，须改用 edge/ROI 度量真实优势 |

### 4.1 edge/ROI 置信度目标公式（Phase 2 接入点）

规则最终置信度 `C_rule` 当前由 G19 取回测 `confidence`（命中率加权）。Phase 2 改为以
**期望收益 edge** 为主、命中率为辅的可解释度量，接入点 = `server/src/fusion/confidence.js`
的 `ConfidenceProvider.resolve()`：

```
edge = mean( (odds_implied_prob_i - true_prob_i) / true_prob_i )   // 盘口隐含概率 vs 真实概率的偏离（去水）
roi  = mean( (payout_i - 1) * indicator(hit_i) - (1 - indicator(hit_i)) )  // 单位注净收益
C_rule = clamp( 0.5 + k * edge , 0, 1 )          // edge>0 抬高，edge<0 压低；k 为可调增益
            （命中率仍作为 gate 前置门槛：hit_rate ≥ 55% 才允许进入仲裁，见 promote 门禁）
```

要点：
- edge 直接反映「盘口定价偏差带来的可下注优势」，比命中率更贴合竞彩让球盘（基线≈50%）；
- ROI 用于回测台账与赛果回填的盈亏口径（predictions-publish 已支持赛果回填，可直接接 ROI 列）；
- 与现有门禁一致：hit_rate/roi/edge 同为转正硬门槛（用户拍板 edge≥0 / roi≥0 / 样本≥80）。

## 5. 开放问题（待拍板）

- 总进球维度信号（S25 类）是否在回测转正后映射为「大小球方向」进入统一输出？
  现有 v97_real 探针已给出 S25 倾向命中 61.8%（76 场），可作为转正证据输入。
- AI 候选（untrusted）经 review→proposed 后，是否强制要求 v97_real 回测达标才可实验
  （当前 promote 已要求 metrics 全项达标，建议维持）。
- edge/ROI 置信度公式中的增益系数 k 与基线 0.5 是否需写入设置页（当前为常量，待可配置化）。

## 6. 关联代码

- server/src/http/handlers.js：`/api/merged/analysis`（v97 块下发）+ `/api/backtest/:id`（v97_real）
- server/src/engine/v97/：fields/evaluate/run（信封三态）
- server/src/backtest/v97_real.js：真实回测（覆盖/台账/S25 探针）
- prototype-1.0.0/app.js：V9.7 区块渲染 + V97_DIM_ZH
- server/src/promote/promote.js + server/src/backtest/metrics.js：转正门禁
