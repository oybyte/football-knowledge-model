# football-knowledge-model 1.0.0

足球竞猜知识库检索与预测系统。当前版本以交互原型验证盘口特征、确定性规则和分析流程，架构设计同步作为后续工程实现基线。

## 入口

- 当前原型：`prototype-1.0.0/index.html`
- 总体架构：`docs/architecture/architecture-1.0.0.html`
- 检索引擎：`docs/architecture/retrieval-engine-1.0.0.html`
- 架构评审：`docs/architecture/architecture-review-1.0.0.html`
- 项目索引：`docs/index.md`

## 本地运行

### 一键启动（推荐）

在项目根目录执行：

```powershell
npm run        # 等价于 node run.js
```

`run.js` 会同时拉起后端 API（`server/bin/start.js`，端口 `OE_PORT`/3000）与前端静态服务器（`prototype-1.0.0/serve.js`，端口 `OE_WEB_PORT`/8080），待前端就绪后自动打开浏览器访问 `http://localhost:8080`。按 `Ctrl+C` 会一并关闭两个子进程。

常用环境变量：

```powershell
$env:OE_WEB_PORT=8080        # 前端端口，默认 8080
$env:OE_PORT=3000            # 后端端口，默认 3000
$env:OE_REDIS_URL="redis://localhost:6379"   # 启用真实 Redis 缓存/队列/锁（可选）
```

单独启动某层：

```powershell
npm run server   # 仅后端 API
npm run web      # 仅前端静态服务器
```

### 仅托管原型

在项目根目录执行：

```powershell
python -m http.server 8137
```

然后打开 `http://localhost:8137/prototype-1.0.0/`。

## 当前状态

原型使用本地模拟赛事和盘口数据，数据层、特征层、规则层已经解耦。真实竞彩接口、后端服务、数据库、正式 DSL、时间泄漏校验、回测和 ROI 置信度仍未实现，详见 `docs/current-status.md`。

## 版本约定

当前基线为 `1.0.0`。后续变更使用语义化版本号，不再创建并列的旧版本目录。
