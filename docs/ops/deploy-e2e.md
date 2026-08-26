# 部署端到端验证手册（Docker Compose 实测）

生产网关/部署形态的**实现与自动化测试**均已在无 Docker 环境下落地（`server/test` 全量 378 用例绿，含生产配置合并冒烟 `deploy-smoke.test.js`）。本手册是**唯一依赖 Docker 的收尾验收**：在有 Docker 的机器上把三服务真实拉起，逐项核验生产形态。

前置：已安装 Docker Engine + Docker Compose v2（`docker compose version` 可运行）。

## 0. 准备 ↔ 一键拉起

```powershell
Copy-Item .env.example .env          # 可选；默认不设也能起
docker compose up -d --build
docker compose ps                     # 期望三服务均 running；redis 进入 healthy 后再等 backend 健康
```

若需接入本地人工盘赔目录，在 `.env` 中设 `OE_MANUAL_ODDS_ROOT=<宿主机源目录>`（compose 会 bind-mount 到容器 `/tmp/manual-odds` 只读）。

## 1. 探活与编排健康

| 验收项 | 命令 | 期望证据 |
|---|---|---|
| 前端静态托管 | `curl http://localhost:8080/` | HTTP 200，返回原型 HTML |
| 后端健康（免鉴权） | `curl http://localhost:3000/api/health` | `{"status":"ok"}` |
| redis 健康门控生效 | `docker compose ps` | redis `healthy`，backend 在其就绪后启动 |
| 服务编排整体 | `docker compose ps` | redis / backend / frontend 三服务 `running` |

## 2. 网关鉴权（多 Key / 撤销 / 哈希 / 401 / 403）

先在 `.env` 注入两个 Key 并 `docker compose up -d` 重启 backend 使配置生效：

```
OE_API_KEYS="key-a,key-b"
OE_API_KEY_REVOKED="key-b"
```

| 验收项 | 命令 | 期望 |
|---|---|---|
| 缺 Key | `curl -i http://localhost:3000/api/matches` | `401`（未认证） |
| 无效 Key | `curl -i -H "X-Api-Key: nope" http://localhost:3000/api/matches` | `401` |
| 有效且未撤销 | `curl -i -H "X-Api-Key: key-a" http://localhost:3000/api/matches` | `200` |
| 有效但被撤销 | `curl -i -H "X-Api-Key: key-b" http://localhost:3000/api/matches` | `403`（撤销优先） |
| health 免鉴权 | `curl http://localhost:3000/api/health` | `200` |

哈希 Key（推荐）：`.\scripts\key-rotate.ps1 sha256 -Key "<明文>"` 得 `sha256:<hex>`，把 `OE_API_KEYS` / `OE_API_KEY_REVOKED` 配成哈希形式，重复上表应行为一致（日志/配置不落明文）。

## 3. Redis 接线（缓存 / 队列 / 锁走真实 Redis）

| 验收项 | 命令 | 期望证据 |
|---|---|---|
| Redis 数据落盘 | `docker compose exec redis redis-cli DBSIZE` | `> 0`（有前端/后端写入的键） |
| 命中官方当天缓存 | 多次 `curl -H "X-Api-Key: key-a" -H "X-Api-Key: key-a" http://localhost:3000/api/sources/merged` | 第二次与第一次耗时显著下降（命中缓存，公益站零重复直连） |
| Redis 持久化 | `docker compose restart backend` 后再查读 | 缓存 Key 仍在（跨重启不丢，验证 `redis-data` 卷） |

后端真实走 Redis 可通过其启动日志的 infra 上报与本机联调等价验证（见第 5 节）。

## 4. 限流（多实例共享，Redis 后端）

在 `.env` 设 `OE_RATE_LIMIT_STORE=redis`、`OE_RATE_LIMIT_MAX=5`，重启 backend：

| 验收项 | 命令 | 期望 |
|---|---|---|
| 共享计数 | 连续 `curl -i -H "X-Api-Key: key-a" http://localhost:3000/api/matches` 共 6 次 | 第 6 次 `429` + `Retry-After`；响应带 `X-RateLimit-Limit/Remaining` |
| 计数跨实例合并 | 见下方「多实例共享限流演示」 | 计数在 Redis 中跨实例合并，超限一致 `429` |

> 跨实例共享计数的**自动化权威证据**：`server/test/rate-limit-redis.test.js` 的「跨实例合并」用例（两个逻辑实例打同一 Redis，计数合并、超限 429），无需 Docker 即可回归。下述是可选的真实多容器演示。

**多实例共享限流演示（可选，需先准备）**
本仓库 `docker-compose.yml` 为开发便利固定了 `container_name: oe-backend` 与宿主端口 `3000:3000`，这两者都与 `--scale` 不兼容（固定 container_name 的 service 无法 scale，且多个副集会抢同一宿主端口）。要真实演示多副本，需临时去掉固定标识与端口发布冲突：

1. 临时编辑 `docker-compose.yml`：删除 backend 的 `container_name: oe-backend`，并去掉/改注释 `ports` 的 `3000:3000` 一行。
2. 拉起两个副本共享同一 Redis 计数：`docker compose up -d --build --scale backend=2`。
3. 对同一 IP 打到 6 次（经负载或任一副本的内部端口），验证两个副本都观测到合并后的 `X-RateLimit-Remaining`，第 6 次为 `429`——证明计数在 Redis（键 `rl:<ip>`）中跨实例一致。
4. 演示完恢复 `docker-compose.yml`（还原 container_name / 端口）后再 `docker compose up -d`。

## 5. 非 Docker 的运行时联结证据（可先行自证）

本机无 Docker 时，可先用真实 Redis + 后端 + 前端**本地拉起**验证同一套运行时语义（`docker compose up` 是它的容器化演绎）：

```powershell
.\scripts\redis-dev.ps1 start          # 真实 Redis :16379
$env:OE_REDIS_URL="redis://127.0.0.1:16379"
$env:OE_API_KEYS="key-a"; npm run server   # 后端 :3000
npm run web                              # 前端 :8080
```

验证：`curl http://localhost:3000/api/health` → ok；前端打开 `http://localhost:8080` 正常渲染；后端日志/`getStatus()` 显示 `infra.backend=redis`、`infra.rateLimit=memory`。

## 6. 清理

```powershell
docker compose down        # 停服务（保留数据卷）
docker compose down -v     # 连数据卷一并删除
```

## 关联自动化测试（无需 Docker 即可回归）

- `server/test/deploy-smoke.test.js`：HTTPS(自签)+鉴权+Redis 共享限流同进程 over 真实 RESP，`getStatus()` scheme/infra 断言。
- `server/test/gateway.test.js` / `rate-limit.test.js` / `rate-limit-redis.test.js` / `gateway-tls.test.js` / `rotate-key.test.js` / `migrations.test.js`。
- 运行：`cd server && npm test`。