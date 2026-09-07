# G12 预测发布层迁移 · A1 契约基线与写路径清单

> 状态:`design-baseline`(T1 产物,后续 T2–T8 以本文为契约边界)。
> 目标:把预测发布层的落库目标从运行时表(`predictions`/`backfill_results`/`evidences`)
> 切换为 G12 `qd_predictions`(关联 `qd_analysis_commands`/`qd_audit_log`/`qd_matches`),
> 采**方案 B**(qd_* 为唯一写路径,运行时表降只读兼容,存量经 `backfillG12` once-only 迁移)。

## 1. 现状:预测发布写路径清单(完整调用栈)

### 1.1 写入口(仅一处,生产端)
```
HTTP POST /api/analysis/:match_id/publish
  └─ handlers.js:655  →  publisher.publish({ decision, idempotency_key, created_by:'http:predict' })
        ├─ publisher.js:40  PredictionPublisher.publish()
        │    ├─ normalizePredictionInput()                 (schema.js,双轴校验 E2001–E2004)
        │    ├─ guard.register()                           (idempotency.js,幂等判重)
        │    └─ this.store.insert(record)                  (publisher.js:56)
        │         └─ service.predictionStore               (= SqlitePredictionStore, db/prediction_store.js)
        │              └─ _insertPred → INSERT INTO predictions (... payload_json)   ← 运行时表
        └─ audit: SqliteAuditAdapter(service.auditStore) → INSERT INTO audit_logs    ← 运行时表
```
- 装配链:`createService`(src/index.js:142 `svc = {...persistence,...}`)← `createDb`(db/index.js:37)
  `predictionStore: new SqlitePredictionStore(db)`,同时已暴露 `qd: createG12Repository(db)` 与 `backfillG12`。
- 发布入口逐次经 `handlers.js:507 getPublisher(service)` 惰性构造 `PredictionPublisher`。

### 1.2 读入口(须保持兼容的读路径)
| 读路径 | 调用 | 后端方法 |
|---|---|---|
| GET /api/predictions | handlers.js:669 | `listPredictions()` → `store.list()` + `predictionWithResult()` → `store.getResult()` |
| GET /api/status predictions 计数 | index.js:162 | `persistence.predictionStore.list().length` |
| 赛果回填/证据 | publisher.backfill → backfillResult | `store.setResult` / `store.setEvidence`(backfill_results / evidences 运行时表) |
| 领域视图 | handlers.js:549 toPredView | 需 `prediction` + `result` 合并字段 |

### 1.3 测试注入点(读兼容层必须原样可用的方法集)
- `predictions-publish.test.js` / `prediction-backfill.test.js` / `s25-pilot.test.js`:
  `new PredictionPublisher({ store: db.predictionStore, ... })`,依赖
  `insert / get / list / setResult / getResult / setEvidence / getEvidence / predictionWithResult`
  + `update/delete/patch` 抛 `ImmutableError`。
- `db-persistence.test.js`:直接 `predictionStore.insert/setResult/getResult/setEvidence/getEvidence` 跨重启断言。

## 2. 结论:唯一落库点
生产端预测写入口**仅** `handlers.js:655`,经 `SqlitePredictionStore` 写运行时三张表
(`predictions` / `backfill_results` / `evidences`)。G12 `qd_predictions` 当前**未被**发布路径使用,
仅由 `backfillG12`(预测存量回填)与 `manual_reconcile`(G12 写入)接触。

## 3. 方案 B 决策记录
- **动机**:运行时三表与 qd_* 双写会产生两套事实来源、双份审计;方案 B 保持单一写事实来源。
- **选定**:`qd_predictions` 为**唯一写路径**;运行时 `predictions` 降为**只读兼容层**
  (`list/get/predictionWithResult` 等改从 qd_* 读取),保证既有视图与 API 契约不回归。
- **存量**:历史 `predictions` 经已实现的 `backfillG12` once-only 回填到 qd_*(缺 match 跳过并计数)。
- **审计/证据单链**:`qd_predictions.audit_trail_id`→qd_audit_log;回填证据 → `qd_evidence_snapshots`。
- **不做**:不新增双写、不修改 12 张 qd_* 表结构、不动 XML 结构或 HTTP 对外契约。

## 4. 迁移影响面(约束)
- 发布必须满足 qd_predictions 三条 FK:`match_id`→qd_matches、`audit_trail_id`→qd_audit_log、
  `command_id`(可空)→qd_analysis_commands;缺失按诚实失败(不捏造)或复用 backfill 锚点补足。
- 事务原子:qd_predictions(+analysis_commands / audit_log 锚点)三者在同一事务内。
- 只读兼容层不得破坏 `toPredView` 的输出字段(`prediction`+`result` 合并)。
- 不可变:仅 insert;update/delete/patch 抛错(应用层 + DB 触发器兜底)。
- 规则约束(AGENTS.md):架构文档保留为基线;`node --check` 校验变更 JS。

## 5. 附带发现(不在 A1 范围,单独跟进)
- `server/src/db/g12/manual_reconcile.js` 引用 `qd.qd_hist_scan_runs` / `qd_hist_match_version` /
  `qd_hist_match_snapshot`,但 `server/migrations/001_init.sql` 的 12 张 qd_* 表**均无**这些表,
  运行时该 reconcile 会抛错并被 `index.js:132` catch 为 `manual_odds_reconcile_failed`(静默降级)。
  需另行确认这些 hist 表是否应收敛为目标表集合或删除该路径。

## 6. 后续任务衔接(T2–T8)
- T2 G12 预测写入适配器 `createG12PredictionWriter({ qd })`(FK 锚点 + 诚实失败)。
- T3 事务原子化(发布= predictions+analysis_commands+audit_log 同事务)。
- T4 幂等 + 不可变护栏(qd_predictions 仅 insert,重复 publish 返回既有)。
- T5 只读兼容层(query/query/get/predictionWithResult 改从 qd_* 读)。
- T6 存量迁移(backfillG12 once-only)。
- T7 测试 `g12-publish.test.js` + 全量回归保持净增。
- T8 文档(current-status/README)+ commit/push。