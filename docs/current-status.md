# 当前状态 1.0.0

## 产品背景与验收定位

本项目面向足球比赛研究和分析场景，解决多源赛程、赔率、盘口、历史规则和赛果之间难以统一、难以追溯、难以防止时间泄漏的问题。系统的核心价值是把“当时可获得的数据”转换为可复核的特征、规则命中、预测结论和证据快照，支持后续规则治理与模型迭代。

当前验收产品由两部分组成：`prototype-1.0.0/` 前端验证客户端和 `server/` 后端服务。架构文档是实现基线，不等同于所有能力已经达到生产级别。官方数据、人工盘赔、模拟数据和 AI 输出必须按各自信任等级使用；置信度只用于当前分析链的相对表达，不代表生产准确率或 ROI。

当前正式规则源为外部 V9.7 registry，共 88 条 R/E/S 规则。服务启动会校验 registry 和 gate index 的版本；规则源不在本仓库内，通过 `OE_V97_REGISTRY_DIR` 覆盖默认位置。旧的手写文字规则 catalog 已清空，仅保留兼容接口，不应再作为现役规则来源。

## 最终验收范围

### 1. 启动与基础运行

- 可通过根目录 `npm run` 同时启动前端和后端，也可分别使用 `npm run web`、`npm run server`。
- `/api/health` 能返回服务版本、数据库连接状态和基础设施状态。
- 前端能够访问本地 API，并在 API 不可用、数据为空或数据降级时显示明确状态。

### 2. 比赛数据与证据链

- 能获取官方竞彩在售赛事；未配置真实端点时返回 `not_configured`，不能用假数据冒充官方数据。
- 能读取本地人工盘赔，并明确标记 `provisional`、数据来源和时间估算状态。
- 官方赛程与人工盘口可以按归一化联赛、主客队和开赛时间合并；无法对齐的人工赛事保留为 `manual_only`。
- 盘口快照、特征和预测必须通过时间完整性校验，赛后回灌或时序冲突的数据不得进入正式分析链。

### 3. 比赛分析闭环

- 用户可以从赛事列表进入单场分析。
- 分析结果包含规则命中、特征快照、方向结论、相对置信度、数据来源和推理链。
- 冲突规则、低可信数据和降级结果必须可识别，不能静默混入可信结论。
- 分析完成后能够保存预测和证据，赛后可以幂等回填结果并复盘。

### 4. 规则与回测治理

- 历史文字规则转换接口保留为兼容壳并已清空 Mock catalog；当前 88 条 V9.7 规则由 registry loader 载入，完整原生对象以 `provisional` 进入规则存储，后续引擎阶段再消费其 atoms/effects。
- 规则按状态机流转，正式生效前需要回测证据和审核，不允许直接覆盖历史版本。
- 回测包含时间完整性、结果可用性、快照完整性、规则生效时间等准入检查，并输出可追溯报告。
- SQLite 和 G12 `qd_*` 表支持幂等迁移、不可变约束、事务回滚和跨重启读取。

### 5. 服务安全与运行形态

- 配置 API Key 后，业务 API 能正确区分未认证 `401` 和已撤销 `403`。
- 限流超限返回 `429`、`Retry-After` 和限流头；Redis 模式支持多实例共享计数，异常时有明确降级状态。
- 同时配置 TLS 证书和私钥时服务以 HTTPS 启动，配置错误应快速失败而不是静默降级为明文。
- 审计日志记录鉴权、规则、预测和回填等关键操作，且不可被更新或删除。

## 验收边界

当前版本不承诺真实生产环境长期运行、自动化告警、容量上限、规则收益稳定性或商业化客户端完成度。真实线上部署、长期样本 ROI/edge 校准、前端生产化和正式运维闭环属于后续版本工作。

## 已实现

### 阶段 1 · 后端核心模块（server/src）
- 数据接入层：MatchSchema 三时间戳校验（observed_at / received_at / match_time）、数据源信任分级、CredentialVault 凭证隔离、mock 数据源迁移。
- 赛事元信息归一化：队名统一（全角/不换行空格折叠）、竞彩开赛时间（YYYYMMDD + HHmm/HH）→ 北京时间 ISO 8601，主客倒置（default_home）按竞彩口径翻正。
- 真实源适配器骨架：data/adapters/ 注册 + 竞彩官方赛程适配器。真实端点经 CredentialVault（data_source 域，ingest 角色）注入并审计；端点未配置 → 诚实返回 not_configured（零假数据），拉取失败 → degraded；basic 赛程源（无盘口快照）元信息入列。
- 竞彩官方赔率适配器（adapters/sporttery_odds.js）：直连官方在售赔率接口，拉取当日竞彩场次（胜平负/让球胜平负/比分/总进球/半全场共 5 个奖池），请求头与移动端站点一致；已实测拉取 16 场在售赛事。
- 联赛别名收敛（data/normalize.js）：LEAGUE_ALIAS 将竞彩官方联赛全称（如「韩国职业联赛」）与人工盘赔简称（如「韩K联」）统一映射到规范名，normalizeLeague 先折叠空白再收敛；语义键对齐依赖此表（前端 lottery.js 维护同一份语义映射，前后端各自实现、语义一致）。
- 公益网站减负缓存（HTTP 层）：官方赔率/赛程端点按「北京时间当天」缓存（日期后缀缓存键，当日 24:00 自动过期）；自动获取每日最多直连一次，后续请求命中缓存零直连；更新仅经手动刷新（?refresh=1 参数强制直连并回写缓存）。合并池端点同样命中当天缓存，直连次数不随请求增长（official-day-cache.test.js 3 用例覆盖）。
- 本地人工盘赔源（data/manual/）：解析用户整理的「盘口数据.md」为 MatchSchema 多份盘口快照（让球 / 欧赔 / 大小球 handicap, european, over_under + bf + 澳门分时时序 + 凯利 + 赛果）。根目录经 env:OE_MANUAL_ODDS_ROOT 动态配置（迁移目录不改代码）；全部快照标记 src_manual_odds / provisional（人工数据，不冒充官方）；初/即盘无显示时间的时点按开赛前相对偏移估算并打 timing_estimate 标记，澳门分时时序用真实显示时间；所有时点严格早于开赛（防泄漏）。
- 双源合并适配层（data/merge.js）：竞彩官方赛程（trusted 元信息，basic 无盘口快照）∪ 本地人工盘赔（provisional 盘口快照）→ 统一「真实比赛池」。语义键（联赛+主队+客队归一化）对齐，命中即用官方 match_id / 队名 / 联赛 / 开赛时间覆盖人工同名顶层、快照 match_id 同步跟随；未命中赛程的人工场次照常入池（manual_only，诚实保留 provisional）；时间防线：官方 match_time 早于任何盘口快照 received_at 的场次标记 conflicts，绝不入池（防赛后数据回灌）。
- 特征工程服务：横截面 / 时序 / 共振 / 异常四族 + 欧指 + 必发特征，point-in-time 防泄漏，特征缓存（TTL 30min），23 字段注册表映射。
- 规则存储服务：RuleVersion 类型、8 态状态机、规则级排他锁、append-only 存储（禁 UPDATE/DELETE）、G3 审计日志 + 脱敏。
- DSL 引擎：11 算子、编译期校验、推理链、加权 Jaccard 模糊匹配、外部引用解析。
- 回测框架：5 项准入校验、6 项指标、不可变证据快照、G19 时序、调度 + 报告。
- 融合决策层：三路输入（规则 / 统计模型 / 异常）、动态权重、信任隔离（AI 不污染正式预测链）、G19 置信度接入、方向仲裁 + 置信度合成。
- 检索 Worker：point-in-time 检索、冲突检测（CONFLICT_DIRECTIONS）、三层仲裁、融合输出、审计可追溯。
- 预测发布 / 结果回填层：不可变预测记录、幂等防重、赛果回填判定、证据锁定、审计追踪。

### 阶段 2 · 后端线
- 2.1 文字规则 → DSL 的历史兼容链：原 catalog Mock 已清空，转换入口保留为 no-op；当前现役规则由 V9.7 registry 直接载入并经过启动门禁。
- 2.2 回测转正：promote 模块沿状态机推进达标规则至 active，不达标产出失败报告。
- 2.3 预测链接入：engine 模块（检索引擎 + 冲突仲裁 + 预测输出 + 证据快照）。
- 2.4 AI 引擎：多模型 provider 适配 + 规则挖掘 + 单场解读 + 审核转正 + 信任边界。
- 2.5 原型-后端集成：API 客户端层（mock / http 双适配 + localStorage 切换）+ 后端接入视图。http 适配已对齐本地服务联调：默认端点 http://localhost:3000（对齐 OE_PORT），后端字段归一化为视图契约（rule_id→id、candidates 数组、sample_size→admitted、推理链 {rule_id,hit,dir,note}），mock 与真实模式不改视图代码。

### V9.7 引擎垂直切片
- `server/src/engine/v97/` 已打通「盘口快照 → 字段信封 → atom 三态求值 → effects → 维度」链路；当前覆盖 5 个字段和 8 个基础算子。
- R13 已可完整求值；R01 的 `kelly_range` 已实现让球盘派生估算路径，但仍需更多真实字段和规则覆盖。
- 未覆盖的 203 个字段统一返回 `insufficient_data`，规则在信息不足时不出结论，禁止静默跳过或误判。
- `server/scripts/v97-slice-run.js` 使用 DB 派生的人工盘赔历史数据做字段覆盖率和规则切片验证；该脚本是架构验证工具，不代表 88 条规则已经全部具备业务求值能力。

### 阶段 4 · 持久化存储层
- server/src/db/：SQLite 落库（node:sqlite 内置，无外部依赖），规则 / 预测 / 回填结果 / 证据 / 审计跨重启持久化。
- 不可变性在 DB 层强制（触发器拒绝 UPDATE/DELETE）+ 应用层护栏双保险；幂等（INSERT OR IGNORE）、回填 once-only、事务回滚。
- rules/index.js 新增 createRuleService({store}) 工厂，可注入 SqliteRuleStore 驱动状态机全生命周期。
- server/src/index.js 服务启动入口：createService 工厂（SQLite 落库 + createRuleService 注入 + V9.7 seed 幂等 + 优雅关闭），bin/start.js CLI（`npm run server`，OE_DB_PATH 指定路径）。
- Redis 生产接线（server/src/index.js connectRedis + createService 装配）：设置 OE_REDIS_URL（或注入 redis 实例）即自动接线三类基础设施——缓存层（RedisCacheAdapter）、分析任务队列（RedisAnalysisQueue）、规则级排他锁（RedisLockManager 注入 createRuleService）。共享单个 ioredis 客户端（lazyConnect），关闭时 clear 锁心跳并强制 disconnect；连接失败或未配置时优雅降级内存实现并记日志，不抛致命错误。getStatus().infra 上报各 backend 类型（cache/queue/lock/backend），启动与运维可观测。测试：server/test/redis-service-bootstrap.test.js（5 用例，用假 redis 实例验证 Redis backend 装配 + 无 Redis 内存回退 + 失效 url 降级）。
- 真实 Redis 协议端到端验收（server/test/redis-resp-integration.test.js，5 用例）：用最小 RESP 协议替身（server/test/helpers/resp-server.js，纯 Node / 真实 TCP+RESP 编解码）连真实协议链路，验证 OE_REDIS_URL 下 backend=redis、缓存写/读/删、Redis 排他锁 acquire→isLocked→release（含并发被拒）、分析队列入/出、以及同一 RESP 服务器上两次独立 createService「重启后缓存 KEY 仍在 / 锁仍持 / 队列任务仍在」（缓存不丢验收）。
- 真实 Redis 服务端端到端验收（server/test/real-redis-e2e.test.js，5 用例）：连「真实 Redis 服务端」（本机 redis-server.exe 或 docker compose 的 redis 服务）验证同一套接线在真实服务端上生效；先探测 OE_REDIS_URL 可达性，不可达自动跳过（不失败），可安全纳入全量回归。本机已用 Redis-for-Windows（tporadowski/redis v5.0.14.1，免安装单文件）实测 5/5 绿。
- 本地真实 Redis 一键脚本（scripts/redis-dev.ps1）：start/stop/status 三动作，首次运行自动下载 Redis-for-Windows 到 .tools/redis/，默认端口 16379（避开 6379 常驻冲突）、数据不落盘；供无 Docker 环境拉起真实 Redis 做联调与验收。
- Redis 依赖声明与运维健壮性修复：server/package.json 显式声明 `ioredis@^6`（此前缺依赖时 require 抛 MODULE_NOT_FOUND 被静默吞掉、实际未接线）；ioredis 连接采用有限重试快速失败（retryStrategy 数轮后返回 null）——避免 Redis 宕机时 await connect() 永不 resolve 导致服务/回归进程挂起；失败路径主动挂 error 监听并 disconnect() 释放句柄；createService.close() 对 redis 强制 disconnect（而非异步 quit），防止残留连接句柄使测试/部署进程不退出。
- 队列前缀可注入（createService({queuePrefix}) → createAnalysisQueue({prefix})）：共享同一真实 Redis 的多实例可用唯一前缀隔离队列键，避免测试/多租户间互相污染。
- 服务编排（docker-compose.yml）：三服务一次性编排——redis:7-alpine（持久化卷 + 健康检查 service_healthy 门控后端启动）+ 后端（多阶段 Node:22 构建 + 持久化卷 + OE_REDIS_URL 指向 redis 服务 + 健康检查）+ 前端（nginx 静态托管 prototype-1.0.0，:8080）。后端经环境变量注入 Redis、人工盘赔目录（bind-mount 到容器 /tmp/manual-odds 只读，宿主机源目录经 .env 的 OE_MANUAL_ODDS_ROOT 配置）、API Key（OE_API_KEY）与 TZ。.env.example 提供全部可配置项模板，.gitignore 屏蔽 .env 防敏感配置入库。
- 编排资产加固：server/package.json 移除未使用的 `odds-edge: file:..` 依赖（server 代码从不 require 它，仅 health 字符串标签；该 file:.. 依赖会让 Docker 构建依赖指向根目录的符号链接，是脆弱点），重新生成 package-lock.json；模拟 Docker 构建（仅 COPY package.json + npm install --omit=dev）验证干净通过（仅 ioredis 及其传递依赖）。
- 编排运行时联结本地实测（无 Docker 环境）：真实 Redis（16379）+ 后端（:3000，getStatus().infra.backend=redis）+ 前端（:8080，HTTP 200）三服务本地拉起，/api/health 返回 ok（与 compose healthcheck 判定一致），/api/rules、/api/sources/merged 等前端消费端点正常——证明 compose 编码的运行时语义成立。

### 阶段 4 · HTTP 层
- server/src/http/：samples（mock 合成样本/证据）+ handlers（REST 端点）+ index（createHttpServer：CORS + 路由 + 统一响应壳）。
- 端点全部由真实后端模块驱动：/api/matches、/api/analysis/:id、/api/rules、/api/rules/:id/versions、/api/backtest/:id、/api/ai/candidates、/api/ai/candidates/:id/review、/api/sources/manual-odds、/api/sources/schedule、/api/sources/merged（双源合并池）、/api/merged/analysis/:id（合并池上跑推理链）。
- 端口解析纯函数化（resolveHttpPort：显式端口 > OE_PORT > 默认 3000），服务装配测试不再绑定真实 3000，避免与常驻后端 EADDRINUSE 冲突。
- createService 支持 http 选项（true / 端口号 / {port}，port 0 = 随机端口），bin/start.js 默认启动 HTTP（OE_PORT，默认 3000），close() 一并关闭服务器。
- 前端可经 api-client 的 http 适配切到真实后端（CORS 已放开）；联调验证：prototype-1.0.0/test/api-client.http-integration.js 启动真实后端端到端验证，浏览器实测「后端接入」视图规则/推理链/AI 候选均从本地服务加载。

### 阶段 4 · 网关鉴权 / 限流
- server/src/gateway/auth.js 生产级鉴权：支持多 Key（OE_API_KEYS 逗号分隔，兼容单 Key OE_API_KEY）+ 撤销 Key（OE_API_KEY_REVOKED 逗号分隔）→ 401/403 语义。401 = 未认证（缺少或无效 Key）；403 = 已认证但无权限（Key 有效但被撤销）。有效 Key 集合 = 全部配置 Key − 撤销 Key；全部被撤销时视为未配置跳过鉴权（开发模式）。
- 生产级密钥校验：常量时间比较（crypto.timingSafeEqual）防时序侧信道；支持 sha256 哈希密钥配置（前缀 `sha256:<hex>`，明文与哈希可混用），配置/日志不落明文密钥；撤销列表同样支持明文或哈希形式。
- 鉴权审计落库：鉴权事件（auth_ok INFO / auth_rejected WARN）经审计回调写入 audit_logs（append-only），含 status / reason（missing_key / revoked_key / invalid_key）/ path / method，可追溯每一次认证成败。
- 限流中间件（server/src/gateway/rate_limit.js）：按客户端 IP 限流，超限返回 429 + Retry-After，并带 X-RateLimit-Limit / X-RateLimit-Remaining 头；max<=0 禁用。所有已匹配路由（含 health/metrics）先限流后鉴权，防单客户端打爆。可经环境变量 OE_RATE_LIMIT_MAX / OE_RATE_LIMIT_WINDOW_MS 配置（默认 300 次 / 60s）。两种存储后端：
  - memory（默认）：单实例内存固定窗口，满足单后端部署。
  - redis（OE_RATE_LIMIT_STORE=redis，需 OE_REDIS_URL 已接线）：多实例共享计数——键 `rl:<ip>`，INCR + EXPIRE 固定窗口（窗口锚定在首次请求的 EXPIRE），多个后端实例计数合并，实现多实例共享限流存储；Redis 不可用时回退内存限流（不熔断开放，记日志可观测）。getStatus().infra.rateLimit 上报实际后端（memory/redis）。docker-compose.yml 已透传 OE_RATE_LIMIT_STORE。
- 鉴权范围：所有受保护 API（/api/* 业务端点）需携带 X-Api-Key 头或 ?api_key= 参数；/api/health 与 /api/metrics 跳过鉴权（供探活与监控）。未配置任何有效 Key 时跳过鉴权（auth_disabled 开发模式）。
- TLS 终止（server/src/http/index.js）：OE_TLS_CERT / OE_TLS_KEY 同设即以 HTTPS 启动（node:https），getStatus().scheme 上报 http/https，bin/start 启动信息相应显示；仅配一项按未启用处理并 warn，证书/私钥读取失败在 createHttpServer 抛 tls_misconfigured 快速失败（绝不静默降级明文 HTTP）。生产多由 nginx/负载均衡终止 TLS，直连后端时也可在此加密。测试自签迭代基于纯 Node 零依赖 ASN.1/签名（test/helpers/selfsigned.js）。
- 密钥轮换流程固化（docs/ops/key-rotation.md + scripts/key-rotate.ps1）：运维手册完整覆盖「新增（宽限期）→ 切换（drain 探测旧 Key 调用趋零）→ 撤销回收（403 永拒）→ 回滚」全流程；脚本提供新 Key 生成（明文 + sha256 哈希，不落明文）、任意明文转 sha256、旧 Key 调用探测三动作，回滚路径单点恢复。配套 rotate-key.test.js 端到端验证生命周期各阶段。
- 测试：gateway.test.js（多 Key / 撤销 403 / 缺少 401 / sha256 哈希 / 常量时间 / 审计回调）+ rate-limit.test.js（未超限 + 头 / 429 + Retry-After / 不同 IP 独立计数 / 禁用 / 窗口重置 / clientIp + x-forwarded-for）+ rate-limit-redis.test.js（真实 RESP 协议走 Redis 共享计数 / 跨两个中间件对象计数合并 / 窗口 EXPIRE 过期重置 / Redis 不可用回退内存，4 用例）+ gateway-tls.test.js（自签证书生成器合法 X.509 v3 且自签校验通过 / createHttpServer 配证书即 HTTPS 往返 / createService 装配后 getStatus().scheme=https / 只配一项快速失败抛 tls_misconfigured，4 用例）+ http-server.test.js（http 层鉴权集成 Header/Query 通过、错误 401、撤销 403、health/metrics 跳过、鉴权审计落库、内存 OE_RATE_LIMIT_MAX 超限 429、OE_RATE_LIMIT_STORE=redis 走真实 RESP 共享计数 429 与 infra 上报）。

### 阶段 4 · G12 数据模型（SQLite 迁移落地）
- server/migrations/001_init.sql：架构评审 P0 缺口的 12 张核心 qd_* 表（qd_rule_versions / qd_evidence_snapshots / qd_matches / qd_odds_snapshots / qd_match_features / qd_predictions / qd_analysis_commands / qd_audit_log / qd_data_sources / qd_backtest_jobs / qd_ai_candidates / qd_field_registry）全部落地，字段与设计文档（docs/design/data-model-1.0.0/data-model-1.0.0.html）逐列对齐；002 另增加 3 张人工盘赔历史派生表。
- 不可变性在 DB 层强制：核心 qd_* 表 6 个不可变触发器（禁 UPDATE/DELETE）+ 核心 12 个查询索引，历史派生层另有 5 个索引 + 外键约束。复杂嵌套字段 payload_json 整存，标量列用于索引与查询。
- server/src/db/migrate.js 迁移执行器：按版本号顺序执行 migrations/*.sql（幂等，IF NOT EXISTS 可重复执行），schema.js migrate() 在建表 + 不可变触发器后自动应用迁移。
- server/src/db/g12/repository.js 数据访问层 createG12Repository(db)：12 张 qd_* 表的类型化写读（insert/get/count/all/listBy），列名收缩 + 必填校验（诚实失败，绝不捏造缺值）+ JSON 字段序列化 + 不可变护栏（不可变表应用层 update/delete/patch 抛 G12ImmutableError，DB 触发器兜底）。每个实体既有短别名（qd.data_sources…）也有全表名（qd.qd_data_sources…），entity 元信息可自省。
- server/src/db/g12/backfill.js 迁移回填 backfillG12：把运行时持久化层（rule_store / prediction_store / audit_store 及外部 match/data_source/field 源）存量批量幂等回填到 G12 qd_* 表。全程事务内执行（任一步失败整体回滚）、INSERT OR IGNORE 按 PK 幂等、严格 FK 依赖序（data_sources → matches → audit_log → rule_versions → predictions）；规则/比赛/数据源缺失值不捏造，缺 match 的预测跳过并计数（predictions_skipped_no_match），审计锚点缺失补占位、已存在则优先复用。
- 接线：ruleStore / auditStore 新增只读 listAll() 支持批量回填；createDb 装配 qd 仓库 + backfillG12。
- 测试：migrations.test.js（核心表与历史派生表 / 触发器 / 索引 / 幂等 / 外键 / 关键字段对齐）+ db-persistence.test.js（运行时表、G12 表和历史派生表持久化）+ g12-repository.test.js（类型化读写、幂等、校验、不可变和外键）+ g12-backfill.test.js（FK 序迁移、幂等和事务原子性）。

### 阶段 2 · 前端原型（prototype-1.0.0）
- 预测链流水线、规则治理、回测结果、数据接入监控、特征引擎、DSL 引擎、AI 引擎、规则库（增强 DSL 索引 + 检索命中预览）。
- 首页已切换真实数据（mock 数据源已删除）：「今日可买」卡片消费竞彩官方在售列表（序号/让球/业务日/在售状态为权威元信息）；已关联本地人工盘赔的场次显示「盘赔明细 · N条」徽章（provisional 标注），开启分析后右侧渲染后端合并池推理链（规则命中 / 方向 / 置信度），「详细分析」进入三栏分析壳（规则命中表 + 特征快照表 + 方向胶囊）。
- 方向词汇统一（app.js dirLabel/dirCls）：后端引擎枚举 favor_upper/favor_lower/draw/warning 收敛为前端展示语义 上盘/下盘/平局/风险，不改后端值。
- 公益网站减负（前端）：本地 localStorage 当天缓存 + 后端当天缓存双层，自动获取每日一次，右上角「手动刷新」按钮带 refresh=1 强制直连。

## 验证
- 后端全量回归 403 用例：401 通过、0 失败、2 个外部服务用例可跳过（`npm test` = `node --test "server/test/*.test.js"`，干净退出无残留句柄）。
- 真实 Redis 运行时验收（real-redis-e2e.test.js 2 用例，可跳过式）：对**真实 Redis daemon**（OE_TEST_REDIS_URL 或本地 127.0.0.1:16379，无则 t.skip）一验证 createService({redisUrl}) 接线 backend=redis（cache/queue/lock 均为 Redis 适配器）且「重启后缓存不丢」在真实 Redis 上成立；二验证生产形态 HTTP 运行时（http.apiKey + OE_RATE_LIMIT_STORE=redis）在真实守护进程上 infra.backend=redis、infra.rateLimit=redis，health 免鉴权 200 → 缺 Key 401 → 带 Key 200——补齐 RESP 内存替身之外的守护进程级运行时证据（补上 deploy-smoke 用 mock、real-redis 只看 infra 层之间的夹缝），CI 无外部依赖不因缺 Redis 失败。
- 测试覆盖：数据接入 / 特征 / 规则存储 / DSL / 回测 / 融合 / 检索 Worker / 发布回填 / 文字转 DSL / AI 引擎 / 回测转正 / 预测链 / V9.7 字段信封与 atom 三态求值 / 持久化存储 / 服务启动装配 / HTTP 层 / 真实赛程源适配器 / 本地人工盘赔源 / 双源合并（7 用例，含联赛别名收敛 2 例）+ 合并 HTTP 端点（4 用例）+ 公益网站当天缓存（3 用例）/ 缓存适配器 / 网关 / Redis 锁 / 分析队列 / Redis 服务接线（5 用例）+ 真实 RESP 协议端到端（5 用例）+ 真实 Redis 服务端端到端（外部服务不可用时跳过）+ G12 数据模型迁移 + 网关鉴权 + 内存/Redis 限流 + HTTP 鉴权集成 + 密钥轮换生命周期。
- 端口解析纯函数（resolveHttpPort）用例：不绑定真实 3000，验证显式端口 > OE_PORT > 默认 3000 优先级。
- 本地人工盘赔源实测：目录注入后扫描 75 场比赛；单场（韩K联 金泉尚武 vs 全北现代，001 场）解析 37 份盘口快照入合并池，信任分级 provisional、0 时间泄漏、0 冲突剔除。
- 双源合并实测（HTTP 集成）：配置本地盘赔目录 + 官方赛程端点后，联赛别名收敛使场次语义键对齐 → merged:true（官方数字 match_id / 队名 / 开赛时间覆盖，快照 match_id 跟随）；未命中赛程的人工场次 manual_only 保留；时间防线剔除生效；/api/merged/analysis 打通盘口→特征→推理链。V9.7 真规则已完成入库和启动门禁，atoms/effects 到正式引擎求值仍属于后续阶段。
- 原型 api-client 冒烟（mock/http 契约一致，含 merged 池与合并分析）+ 真实后端联调通过；浏览器实测「后端接入」视图从本地服务加载。
- 生产部署形态合并冒烟（deploy-smoke.test.js 1 用例）：单进程同时启用 HTTPS（自签）+ 鉴权（API Key）+ Redis 共享限流（真实 RESP），跨真实 TLS 套接字依次断言 /api/health 200（免鉴权）→ /api/matches 缺 Key 401 → 带 Key 200 → 超限 429（rate_limited），且 getStatus() scheme=https / infra.backend=redis / infra.rateLimit=redis 三者并存——证明网关鉴权、限流、TLS、Redis 接线在生产配置下同进程协同生效。
- 前端端到端实测（浏览器）：首页「今日可买」16 场在售赛事渲染；001 场「开启分析预测」→ 推理链加载 → 「关闭」收起 → 「详细分析」进入分析面板 → 「返回列表」退出，全按钮矩阵操作 window error / unhandledrejection 双通道捕获为零错误。

## 未实现 / 待后续
- 生产环境长期运行观测、告警、容量压测和真实线上部署闭环。
- 规则持续优化流水线，以及基于真实长期样本的 edge/ROI 校准。
- V9.7 引擎继续补齐剩余字段、算子和规则的真实数据求值，并将切片结果接入正式检索/融合链。
- 前端从当前后端接入视图继续演进为完整生产客户端。

## 事实状态
- 原型：`active`，功能验证用途。
- mock 数据与占位行为均显式标注，置信度分属原型验证而非生产精度或 ROI。
- 架构文档：`design-baseline`，作为后续实现基线保留。
- 生产部署：`pending`，Docker Compose 和 GitHub Actions 已具备生产形态验收，但没有可核验的线上部署目标。
