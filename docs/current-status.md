# 当前状态 1.0.0

## 已实现

### 阶段 1 · 后端核心模块（server/src）
- 数据接入层：MatchSchema 三时间戳校验（observed_at / received_at / match_time）、数据源信任分级、CredentialVault 凭证隔离、mock 数据源迁移。
- 赛事元信息归一化：队名统一（全角/不换行空格折叠）、竞彩开赛时间（YYYYMMDD + HHmm/HH）→ 北京时间 ISO 8601，主客倒置（default_home）按竞彩口径翻正。
- 真实源适配器骨架：data/adapters/ 注册 + 竞彩官方赛程适配器。真实端点经 CredentialVault（data_source 域，ingest 角色）注入并审计；端点未配置 → 诚实返回 not_configured（零假数据），拉取失败 → degraded；basic 赛程源（无盘口快照）元信息入列。
- 竞彩官方赔率适配器（adapters/sportteryOdds.js）：直连官方在售赔率接口，拉取当日竞彩场次（胜平负/让球胜平负/比分/总进球/半全场共 5 个奖池），请求头与移动端站点一致；已实测拉取 16 场在售赛事。
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
- 2.1 文字规则 → DSL 转换：catalog（15 条）+ DSL 映射 + 入库脚本（draft + untrusted，编译门控）。
- 2.2 回测转正：promote 模块沿状态机推进达标规则至 active，不达标产出失败报告。
- 2.3 预测链接入：engine 模块（检索引擎 + 冲突仲裁 + 预测输出 + 证据快照）。
- 2.4 AI 引擎：多模型 provider 适配 + 规则挖掘 + 单场解读 + 审核转正 + 信任边界。
- 2.5 原型-后端集成：API 客户端层（mock / http 双适配 + localStorage 切换）+ 后端接入视图。http 适配已对齐本地服务联调：默认端点 http://localhost:3000（对齐 OE_PORT），后端字段归一化为视图契约（rule_id→id、candidates 数组、sample_size→admitted、推理链 {rule_id,hit,dir,note}），mock 与真实模式不改视图代码。

### 阶段 4 · 持久化存储层
- server/src/db/：SQLite 落库（node:sqlite 内置，无外部依赖），规则 / 预测 / 回填结果 / 证据 / 审计跨重启持久化。
- 不可变性在 DB 层强制（触发器拒绝 UPDATE/DELETE）+ 应用层护栏双保险；幂等（INSERT OR IGNORE）、回填 once-only、事务回滚。
- rules/index.js 新增 createRuleService({store}) 工厂，可注入 SqliteRuleStore 驱动状态机全生命周期。
- server/src/index.js 服务启动入口：createService 工厂（SQLite 落库 + createRuleService 注入 + seed 幂等 + 优雅关闭），bin/start.js CLI（npm start，OE_DB_PATH 指定路径）。
- Redis 生产接线（server/src/index.js connectRedis + createService 装配）：设置 OE_REDIS_URL（或注入 redis 实例）即自动接线三类基础设施——缓存层（RedisCacheAdapter）、分析任务队列（RedisAnalysisQueue）、规则级排他锁（RedisLockManager 注入 createRuleService）。共享单个 ioredis 客户端（lazyConnect + retryStrategy），关闭时 clear 锁心跳并 quit；连接失败或未配置时优雅降级内存实现并记日志，不抛致命错误。getStatus().infra 上报各 backend 类型（cache/queue/lock/backend），启动与运维可观测。测试：server/test/redis-service-bootstrap.test.js（5 用例，用假 redis 实例验证 Redis backend 装配 + 无 Redis 内存回退 + 失效 url 降级）。

### 阶段 4 · HTTP 层
- server/src/http/：samples（mock 合成样本/证据）+ handlers（REST 端点）+ index（createHttpServer：CORS + 路由 + 统一响应壳）。
- 端点全部由真实后端模块驱动：/api/matches、/api/analysis/:id、/api/rules、/api/rules/:id/versions、/api/backtest/:id、/api/ai/candidates、/api/ai/candidates/:id/review、/api/sources/manual-odds、/api/sources/schedule、/api/sources/merged（双源合并池）、/api/merged/analysis/:id（合并池上跑推理链）。
- 端口解析纯函数化（resolveHttpPort：显式端口 > OE_PORT > 默认 3000），服务装配测试不再绑定真实 3000，避免与常驻后端 EADDRINUSE 冲突。
- createService 支持 http 选项（true / 端口号 / {port}，port 0 = 随机端口），bin/start.js 默认启动 HTTP（OE_PORT，默认 3000），close() 一并关闭服务器。
- 前端可经 api-client 的 http 适配切到真实后端（CORS 已放开）；联调验证：prototype-1.0.0/test/api-client.http-integration.js 启动真实后端端到端验证，浏览器实测「后端接入」视图规则/推理链/AI 候选均从本地服务加载。

### 阶段 2 · 前端原型（prototype-1.0.0）
- 预测链流水线、规则治理、回测结果、数据接入监控、特征引擎、DSL 引擎、AI 引擎、规则库（增强 DSL 索引 + 检索命中预览）。
- 首页已切换真实数据（mock 数据源已删除）：「今日可买」卡片消费竞彩官方在售列表（序号/让球/业务日/在售状态为权威元信息）；已关联本地人工盘赔的场次显示「盘赔明细 · N条」徽章（provisional 标注），开启分析后右侧渲染后端合并池推理链（规则命中 / 方向 / 置信度），「详细分析」进入三栏分析壳（规则命中表 + 特征快照表 + 方向胶囊）。
- 方向词汇统一（app.js dirLabel/dirCls）：后端引擎枚举 favor_upper/favor_lower/draw/warning 收敛为前端展示语义 上盘/下盘/平局/风险，不改后端值。
- 公益网站减负（前端）：本地 localStorage 当天缓存 + 后端当天缓存双层，自动获取每日一次，右上角「手动刷新」按钮带 refresh=1 强制直连。

## 验证
- 后端全量回归 324 用例绿（`node --test`，23 个测试文件），覆盖数据接入 / 特征 / 规则存储 / DSL / 回测 / 融合 / 检索 Worker / 发布回填 / 文字转 DSL / AI 引擎 / 回测转正 / 预测链 / 持久化存储 / 服务启动装配 / HTTP 层 / 真实赛程源适配器 / 本地人工盘赔源 / 双源合并（7 用例，含联赛别名收敛 2 例）+ 合并 HTTP 端点（4 用例）+ 公益网站当天缓存（3 用例）/ 缓存适配器 / 网关 / Redis 锁 / 分析队列 / Redis 服务接线（5 用例）。
- 端口解析纯函数（resolveHttpPort）用例：不绑定真实 3000，验证显式端口 > OE_PORT > 默认 3000 优先级。
- 本地人工盘赔源实测：目录注入后扫描 75 场比赛；单场（韩K联 金泉尚武 vs 全北现代，001 场）解析 37 份盘口快照入合并池，信任分级 provisional、0 时间泄漏、0 冲突剔除。
- 双源合并实测（HTTP 集成）：配置本地盘赔目录 + 官方赛程端点后，联赛别名收敛使 001 场语义键对齐 → merged:true（官方数字 match_id / 队名 / 开赛时间覆盖，快照 match_id 跟随）；未命中赛程的人工场次 manual_only 保留；时间防线剔除生效；/api/merged/analysis 打通 盘口→特征→推理链（命中 R007/R008/R013，方向 favor_upper，置信度 0.5）。
- 原型 api-client 冒烟（mock/http 契约一致，含 merged 池与合并分析）+ 真实后端联调通过；浏览器实测「后端接入」视图从本地服务加载。
- 前端端到端实测（浏览器）：首页「今日可买」16 场在售赛事渲染；001 场「开启分析预测」→ 推理链加载 → 「关闭」收起 → 「详细分析」进入分析面板 → 「返回列表」退出，全按钮矩阵操作 window error / unhandledrejection 双通道捕获为零错误。

## 未实现 / 待后续
- 服务部署与 API 网关（当前为 SQLite 落库 + 本地 HTTP 服务，网关路由骨架已有测试，尚无生产网关 / 鉴权 / 部署）。
- Redis 生产接线已完成（缓存/队列/锁经 OE_REDIS_URL 自动切换真实 Redis，见上文）。剩余生产化：真实 Redis 部署与服务编排、网关鉴权 / 部署。
- 线上长期运行观测与规则持续优化流水线。

## 事实状态
- 原型：`active`，功能验证用途。
- mock 数据与占位行为均显式标注，置信度分属原型验证而非生产精度或 ROI。
- 架构文档：`design-baseline`，作为后续实现基线保留。
- 生产部署：`not-applicable`，当前没有生产后端或部署服务。