# 项目文档索引 1.0.0

## 当前入口

- `../prototype-1.0.0/index.html`：现役交互原型。
- `../server/src/index.js`：后端服务装配入口。
- `../package.json`：根级启动和测试命令。
- `architecture/architecture-1.0.0.html`：总体架构设计。
- `architecture/retrieval-engine-1.0.0.html`：检索引擎、DSL、数据模型、API、回测和生产设计。
- `architecture/architecture-review-1.0.0.html`：架构缺口和实施优先级评审。
- `architecture/data-source-layering.md`：数据来源分层原则（体彩仅作基础锚定 + 本地人工盘赔作明细，先锚后明细）。

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
- `design/retrieval-worker-1.7.0/`：检索 Worker 和任务处理设计。
- `design/prediction-backfill-1.8.0/`：预测发布与赛果回填设计。
- `design/implementation-plan-1.0.0/`：从架构基线到工程实现的阶段计划。

## 运维与验证

- `ops/deploy-e2e.md`：Docker Compose 生产形态端到端验收。
- `ops/key-rotation.md`：API Key 新增、切换、撤销和回滚。

## 文档状态

总体架构以 `1.0.0` 为基线；子系统文档使用独立的语义版本表示演进阶段，不构成并列应用版本。文档中的设计合同与真实实现状态以 `current-status.md` 为准，已经确认的取舍见 `decisions.md`。
