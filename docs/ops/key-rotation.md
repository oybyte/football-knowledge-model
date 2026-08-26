# API Key 轮换流程（运维手册）

网关鉴权的多 Key + 撤销机制支持生产级的密钥生命周期管理：**新增 → 宽限期 → 撤销回收 → 永拒**。本手册描述用 `OE_API_KEYS` / `OE_API_KEY_REVOKED` 完成一次不中断服务的密钥轮换。

## 一、鉴权语义速览

- 鉴权来源：`OE_API_KEYS`（逗号分隔多 Key，兼容单 Key `OE_API_KEY`）。
- 撤销名单：`OE_API_KEY_REVOKED`（逗号分隔）。
- **有效 Key 集合 = 全部配置 Key − 撤销 Key**。
- 状态码：`401` 未认证（缺少/无效 Key）；`403` 已认证但无权限（Key 有效但被撤销）。
- **撤销优先**：即便某 Key 后续从 `OE_API_KEYS` 移除，只要仍在 `OE_API_KEY_REVOKED`，恒返回 `403`（撤销即永久拒绝）。
- 密钥可配明文或 `sha256:<hex>`（配置/日志不落明文）；比较用 `crypto.timingSafeEqual` 常量时间，防时序侧信道。
- 每次认证成败均落审计日志（`audit_logs` append-only）：`auth_ok`(INFO) / `auth_rejected`(WARN，含 `missing_key` / `invalid_key` / `revoked_key`）。
- 全部 Key 均被撤销时视为未配置，跳过鉴权（开发模式）。

配置示例：

```powershell
$env:OE_API_KEYS="key-a,key-b"               # 多 Key（任一有效即可）
$env:OE_API_KEY_REVOKED="key-b"              # 撤销 Key（命中返回 403 forbidden）
```

## 二、轮换三步流程

假设当前只有 `old-key` 在用，目标是平滑换成 `new-key`。

### 步骤 1 · 新增（宽限期）

把新 Key 追加到 `OE_API_KEYS`，**不**动旧 Key，并**不**加入撤销名单。

```powershell
$env:OE_API_KEYS="old-key,new-key"
# OE_API_KEY_REVOKED 为空或保持现有
```

此时宽限期开始：`old-key` 与 `new-key` 同时有效，存量调用（仍用旧 Key）不受影响。

```powershell
curl -H "X-Api-Key: old-key" http://localhost:3000/api/matches   # 200
curl -H "X-Api-Key: new-key" http://localhost:3000/api/matches   # 200
```

### 步骤 2 · 切换

将各调用方（程序/脚本/网关的客户端凭据）改切到 `new-key`，并在宽限期内观察旧 Key 的调用量趋零。可用本仓库脚本探测：

```powershell
.\scripts\key-rotate.ps1 drain -Key "old-key" -Url http://localhost:3000
```

- 输出「旧 Key 仍被接受」→ 尚有存量调用，**先别撤销**，继续等待切换。
- 输出「旧 Key 已不被接」→ 调用已全部切走，可进入撤销。

### 步骤 3 · 撤销回收（永拒）

把旧 Key 加入撤销名单，并可从有效集合移除：

```powershell
$env:OE_API_KEYS="new-key"                    # 若还有其它存量 Key 一并保留
$env:OE_API_KEY_REVOKED="old-key"             # 旧 Key 立即永久 403
```

撤销后验证：

```powershell
curl -H "X-Api-Key: new-key" http://localhost:3000/api/matches   # 200
curl -H "X-Api-Key: old-key" http://localhost:3000/api/matches   # 403（撤销优先，即便已移出有效集合）
```

> 若后续某 Key 被完全遗忘/确认不再需要，可在撤销名单观足够长时间后**仅移除 `OE_API_KEY_REVOKED` 中对应项**（不再列在任何处）。但安全直觉上：一旦确认泄露或被回收，建议长期保留在撤销名单以形成永久拒名单。

## 三、哈希形式（推荐：不落明文密钥）

明文密钥会出现在 `.env` / 进程环境 / 潜在日志中。生产建议把 `OE_API_KEYS` 与 `OE_API_KEY_REVOKED` 配置为 `sha256:<hex>`：

```powershell
.\scripts\key-rotate.ps1 new                     # 输出明文 + sha256 哈希
.\scripts\key-rotate.ps1 sha256 -Key "my-secret" # 仅转哈希: sha256:<hex>
```

生成后再写入 `.env`：

```
OE_API_KEYS_VIA_HASH?  # 直接写哈希形式:
OE_API_KEYS="sha256:<hex-of-new-key>"
OE_API_KEY_REVOKED="sha256:<hex-of-old-key>"
```

明文与哈希可混用。配置/日志均只存哈希，即使泄漏也不直接可得原始密钥。

## 四、回滚

若新增后在宽限期发现 `new-key` 有问题，**尚未撤销旧 Key 前**只需把 `new-key` 从 `OE_API_KEYS` 移除即可回到原状（旧 Key 全程有效，宽限期设计保证了这一点）：

```powershell
$env:OE_API_KEYS="old-key"     # 恢复
```

一旦进入撤销步骤，旧 Key 已被永久拒绝，回滚需重新发布旧 Key（或从加号侧重新引入并摘除撤销项），属一次新的轮换。

## 五、配套测试

- `server/test/rotate-key.test.js`（2 用例）：在真实 HTTP 进程内模拟「加入新 Key → 宽限期双 Key 并存 → 撤销回收」，断言各阶段鉴权行为与审计落库（`auth_ok` / `auth_rejected` 语义正确）。
- `server/test/gateway.test.js`：多 Key、撤销 403、缺少 401、sha256 哈希、常量时间比较、审计回调。
- `server/test/gateway-tls.test.js` + `server/test/deploy-smoke.test.js`：HTTPS + 鉴权 + Redis 共享限流在生产配置下同进程协同。