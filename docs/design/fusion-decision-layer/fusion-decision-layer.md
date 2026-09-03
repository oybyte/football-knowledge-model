# 融合决策层 · 落点与定义（v1.6.0 提案）

> 状态：`proposal`（供评审）。架构评审 G10 曾指出融合决策层输入/策略/可配置性空白；
> 早期导航将其并入后未定义落点。本文给出可执行的落点与策略基线，
> 待用户拍板后作为实现契约。

## 1. 背景

预测链现状（V9.7 接入后）：
- **旧 DSL 链**：`predict()`（engine/prediction.js）产出 `arbitration.direction/confidence`，
  但 V9.7 真规则的 atoms 不再喂 DSL → 真实场次上 DSL 推理链为空（prediction=null），
  方向仲裁常为 undecidable。**这条链已不承载真规则结论，仅承载 mock/历史契约。**
- **V9.7 引擎链**：`/api/merged/analysis` 新增 `v97` 块——88 规则三态求值 + 字段信封，
  命中规则带 `dimensions`（gate/weight/signal/classification/total_goals_signal/…），
  全部为 provisional 规则（未回测转正）。

## 2. 落点决定

融合决策层落点为 **merged/analysis 响应内的 `v97` 块 + 前端「V9.7 真规则求值」区块**
（已在 prototype-1.0.0/app.js 实现渲染），不再单设独立页面。
理由：
- 单场分析页是结论消费点，融合结果必须与场次同屏；
- 拆独立页会再次割裂「分析 → 结论」最短路径；
- 旧 DSL 仲裁保留为兼容字段，不并入融合（其输入已失效）。

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

## 4. 可配置项（设计目标，Phase 后续）

- 维度中文映射表 V97_DIM_ZH（app.js，已实现，可扩充）
- 每维度「是否参与方向仲裁」开关（默认否，转正后由 promote 侧开启）
- edge/ROI 加权（Phase 2；当前命中率加权仅为兼容占位）

## 5. 开放问题（待拍板）

- 总进球维度信号（S25 类）是否在回测转正后映射为「大小球方向」进入统一输出？
  现有 v97_real 探针已给出 S25 倾向命中 61.8%（76 场），可作为转正证据输入。
- AI 候选（untrusted）经 review→proposed 后，是否强制要求 v97_real 回测达标才可实验
  （当前 promote 已要求 metrics 全项达标，建议维持）。

## 6. 关联代码

- server/src/http/handlers.js：`/api/merged/analysis`（v97 块下发）+ `/api/backtest/:id`（v97_real）
- server/src/engine/v97/：fields/evaluate/run（信封三态）
- server/src/backtest/v97_real.js：真实回测（覆盖/台账/S25 探针）
- prototype-1.0.0/app.js：V9.7 区块渲染 + V97_DIM_ZH
- server/src/promote/promote.js + server/src/backtest/metrics.js：转正门禁
