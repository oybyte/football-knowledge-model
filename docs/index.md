# 项目文档索引 1.0.0

## 当前入口

- `current-status.md`：能力清单与验收范围（**状态权威**）。
- `decisions.md`：已确认的取舍与路线决策（**决策权威**）。
- `../prototype-1.0.0/index.html`：现役交互原型。
- `../server/src/index.js`：后端服务装配入口。
- `../package.json`：根级启动和测试命令。
- `../ledgers/`：赛后复盘台账（按日期分目录）。
- `../proposals/`：候选规则提案（人工审核前的隔离区）。
- `architecture/architecture-1.0.0.html`：总体架构设计。
- `architecture/retrieval-engine-1.0.0.html`：检索引擎、DSL、数据模型、API、回测和生产设计。
- `architecture/architecture-review-1.0.0.html`：架构缺口和实施优先级评审。
- `architecture/data-source-layering.md`：数据来源分层原则（体彩仅作基础锚定 + 本地人工盘赔作明细，先锚后明细）。
- `../server/scripts/v97-slice-run.js`：V9.7 引擎垂直切片的真实数据验证脚本。
- `progress-review-2026-10-10.md`：项目进度评估（分层进度、价值链断点定位、后续优先级实测快照）。
- `system-review-2026-09-03.md`：系统模块状态与开发优先级评审（含 2026-10-09 更新注）。

## 子系统设计

- `design/dsl-syntax-1.0.0/`：DSL 语法、字段注册表和规则编译约束。
- `design/data-model-1.0.0/`：数据模型和迁移字段设计。
- `design/api-contract-1.0.0/`：HTTP API 契约。
- `design/performance-model-1.0.0/`：性能模型和容量规划。
- `design/data-ingest-1.1.0/`：数据接入与双源合并设计。
- `design/feature-engine-1.2.0/`：特征计算和 point-in-time 设计。
- `design/rule-storage-1.3.0/`：规则存储、版本和不可变性设计。
- `design/dsl-engine-1.4.0/`：DSL 编译、求值和检索设计。
- `design/backtest-1.5.0/`：回测准入、指标和证据设计。
- `design/fusion-1.6.0/`：多路信号融合和冲突仲裁设计。
- `design/fusion-decision-layer/fusion-decision-layer.md`：V9.7 融合决策层落点、策略和开放问题提案（当前评审）。
- `design/frontend-real-api/frontend-real-api.md`：前端 backtest / feature / rules 三页从 mock 切到真实端点的实施方案与**实施记录**（已实施，D1–D4 全按推荐项落地）。
- `design/retrieval-worker-1.7.0/`：检索 Worker 和任务处理设计。
- `design/prediction-backfill-1.8.0/`：预测发布与赛果回填设计。
- `design/implementation-plan-1.0.0/`：从架构基线到工程实现的阶段计划。

## 运维与验证

- `ops/deploy-e2e.md`：Docker Compose 生产形态端到端验收。
- `ops/key-rotation.md`：API Key 新增、切换、撤销和回滚。

## 文档状态

总体架构以 `1.0.0` 为基线；子系统文档使用独立的语义版本表示演进阶段，不构成并列应用版本。文档中的设计合同与真实实现状态以 `current-status.md` 为准，已经确认的取舍见 `decisions.md`。
