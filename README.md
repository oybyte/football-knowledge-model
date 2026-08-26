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

### 网关鉴权 / 限流（可选）

设置任一 API Key 后，所有受保护 API（`/api/*` 业务端点）需携带 `X-Api-Key` 头或 `?api_key=` 参数；`/api/health` 与 `/api/metrics` 跳过鉴权（供探活与监控）。留空 = 开发模式跳过鉴权。

```powershell
$env:OE_API_KEY="my-secret-key"              # 单 Key（兼容）
$env:OE_API_KEYS="key-a,key-b"               # 多 Key（逗号分隔，任一有效即可）
$env:OE_API_KEY_REVOKED="key-b"              # 撤销 Key（命中返回 403 forbidden）
```

语义：401 = 未认证（缺少或无效 Key）；403 = 已认证但无权限（Key 有效但被撤销）。有效 Key 集合 = 全部配置 Key − 撤销 Key。

密钥轮换（新增 → 宽限期 → 撤销回收）的完整运维流程见 [docs/ops/key-rotation.md](docs/ops/key-rotation.md)，配套脚本 `.\scripts\key-rotate.ps1` 生成新 Key / 转 sha256 / 探测旧 Key 调用余量。

生产级密钥校验：常量时间比较（`crypto.timingSafeEqual`）防时序侧信道；密钥可用明文，也可用 sha256 哈希（前缀 `sha256:<hex>`，配置/日志不落明文）：

```powershell
$env:OE_API_KEY="sha256:<echo -n my-secret-key | sha256sum 输出的 hex>"
```

限流（固定窗口，按客户端 IP）：超限返回 429 + Retry-After；`max<=0` 禁用。单实例默认 `memory` 后端即可；多实例共享限流计数设 `OE_RATE_LIMIT_STORE=redis`（需 `OE_REDIS_URL` 已接线），计数存 Redis（键 `rl:<ip>`）跨实例合并。

```powershell
$env:OE_RATE_LIMIT_MAX=300            # 每窗口最大请求数（默认 300）
$env:OE_RATE_LIMIT_WINDOW_MS=60000    # 窗口毫秒（默认 60000）
$env:OE_RATE_LIMIT_STORE=memory       # 限流存储：memory（默认）| redis（多实例共享）
```

TLS 终止（可选）：`OE_TLS_CERT` / `OE_TLS_KEY` 两个文件路径同设即以后端直连 HTTPS 启动（`getStatus().scheme=https`），生产多由 nginx/负载均衡反向代理终止 TLS。

```powershell
$env:OE_TLS_CERT="C:\certs\server.crt"   # 证书文件路径（与 OE_TLS_KEY 同设即 HTTPS）
$env:OE_TLS_KEY="C:\certs\server.key"    # 私钥文件路径
```

鉴权事件（成功/失败）自动写入 SQLite 审计日志（`audit_logs`，append-only）。

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

## Docker Compose 一键编排（真实 Redis + 后端 + 前端）

要跑通「真实数据链路」——后端连真实 Redis（缓存/队列/锁），前端静态托管，一次性拉起三服务：

```powershell
# 1) 复制环境变量模板（可选；不设也能起，只是不接人工盘赔目录）
Copy-Item .env.example .env

# 2) 如需接入本地人工盘赔，在 .env 中填入宿主机源目录后：
#    OE_MANUAL_ODDS_ROOT=D:\ocr_python_data\FootballScreenshotOcr\output

# 3) 拉起全栈
docker compose up -d --build
```

启动后访问：

- 前端：`http://localhost:8080`
- 后端 API：`http://localhost:3000`（可 `curl http://localhost:3000/api/health` 探活）
- 服务与健康检查状态：`docker compose ps`（Redis `service_healthy` 门控后端启动）

编排要点：

- **Redis** `redis:7-alpine`：数据落持久化卷 `redis-data`，提供 `service_healthy` 健康检查；后端依赖它就绪后才启动，因此缓存/队列/锁走真实 Redis，而非内存回退。
- **后端**：多阶段 Node:22 构建，数据落持久化卷 `oe-data`；`OE_REDIS_URL=redis://redis:6379/0`、`TZ`、网关鉴权（`OE_API_KEY` / `OE_API_KEYS` / `OE_API_KEY_REVOKED`）与限流（`OE_RATE_LIMIT_MAX` / `OE_RATE_LIMIT_WINDOW_MS`，共享计数 `OE_RATE_LIMIT_STORE=redis`）透传；人工盘赔目录 bind-mount 到容器 `/tmp/manual-odds`（只读），后端经 `OE_MANUAL_ODDS_ROOT=/tmp/manual-odds` 读取，宿主源目录由 `.env` 的 `OE_MANUAL_ODDS_ROOT` 指定——换目录只改 `.env`，不改代码。
- **前端**：`nginx` 静态托管 `prototype-1.0.0`，`http://localhost:8080`。
- 后端连接失败（如仅停掉 Redis）会**快速失败并降级内存**（有限重试后回退，不挂起），`getStatus().infra.backend` 可观测当前是 `redis` 还是 `memory`。

停止与清理：

```powershell
docker compose down          # 停止（保留数据卷）
docker compose down -v       # 停止并删除数据卷（Redis/DB 数据一并清空）
```

本地（非 Docker）联调同样指定 `OE_REDIS_URL` 即可启用真实 Redis 缓存/队列/锁，见上文「本地运行」。

> 生产网关/部署形态的端到端验收（探活 / 鉴权 401·403 / Redis 持久化跨重启 / 多实例共享限流 429）已固化为 [docs/ops/deploy-e2e.md](docs/ops/deploy-e2e.md)——在有 Docker 的机器上按 §0–§6 逐项核验，或直接触发内置 `.github/workflows/deploy-e2e.yml`（GitHub Actions Run workflow）在 Docker runner 上一键自动验收（无需本机 Docker）；密钥轮换流程见 [docs/ops/key-rotation.md](docs/ops/key-rotation.md)。

## 本地真实 Redis 联调（无 Docker 环境）

若本机没有 Docker，可用仓库自带的一键脚本拉起一个**真实 Redis 服务端**（Redis-for-Windows 官方社区移植，免安装单文件，首次运行自动下载到 `.tools\redis\`）：

```powershell
.\scripts\redis-dev.ps1 start     # 启动真实 Redis（默认端口 16379，后台）
.\scripts\redis-dev.ps1 status    # 查看状态
.\scripts\redis-dev.ps1 stop      # 停止
```

启动后让后端连它：

```powershell
$env:OE_REDIS_URL="redis://127.0.0.1:16379"
npm run server
```

验证真实 Redis 接线（缓存/队列/锁 + 重启缓存不丢）的自动化测试：

```powershell
cd server
node --test test/real-redis-e2e.test.js   # 连真实 Redis 跑 5 用例
```

> 说明：`real-redis-e2e.test.js` 会先探测 `OE_REDIS_URL`（默认 `redis://127.0.0.1:16379`）是否可达；不可达时自动跳过（不失败），因此可安全纳入全量回归。另有 `test/redis-resp-integration.test.js` 用纯 Node 的 RESP 协议替身验证同一套接线，不依赖任何 Redis 服务端。

## 数据模型（G12）

架构评审 P0 缺口的 12 张 `qd_*` 表已按设计文档（`docs/design/data-model-1.0.0/data-model-1.0.0.html`）落地为 SQLite 迁移（`server/migrations/001_init.sql`）：规则版本 / 证据快照 / 比赛 / 盘口快照 / 比赛特征 / 预测 / 分析命令 / 审计 / 数据源 / 回测作业 / AI 候选 / 字段注册表。不可变性在 DB 层强制（6 个触发器禁 UPDATE/DELETE）+ 12 个查询索引 + 外键约束。服务启动时自动应用迁移（幂等，可重复执行）。

配套提供 G12 数据访问层与迁移回填：
- `server/src/db/g12/repository.js` —— `createG12Repository(db)` 为 12 张 `qd_*` 表提供类型化写读（insert/get/count/all/listBy），列名收缩 + 必填校验（诚实失败，绝不捏造缺值）+ JSON 字段序列化 + 不可变护栏（不可变表应用层 update/delete/patch 抛错，DB 触发器兜底）。
- `server/src/db/g12/backfill.js` —— `backfillG12` 把运行时持久化层存量按 FK 依赖序、事务内幂等回填到 G12 表（data_sources → matches → audit_log → rule_versions → predictions），缺 match 的预测跳过并计数、缺值不捏造。
- `createDb`（`server/src/db`）已装配 `qd` 仓库与 `backfillG12`。测试：`test/g12-repository.test.js`（8 用例）＋ `test/g12-backfill.test.js`（3 用例）。

## 当前状态

原型使用本地模拟赛事和盘口数据，数据层、特征层、规则层已经解耦。真实竞彩接口、后端服务、SQLite 数据库、正式 DSL、时间泄漏校验、回测和 ROI 置信度已实现，详见 `docs/current-status.md`。

## 版本约定

当前基线为 `1.0.0`。后续变更使用语义化版本号，不再创建并列的旧版本目录。
