# ============================================================================
# 网关 API Key 轮换辅助脚本 (Windows PowerShell)
# 用途: 配合后端多 Key + 撤销机制, 简化「新增 → 宽限期 → 撤销回收」三步轮换。
#   - 不直接改任何配置文件: 只生成密钥与 .env 片段, 由运维自行填入 .env。
#   - 生产建议配置 sha256 哈希形式, 避免明文密钥落盘(.env/日志仅存哈希)。
# 用法:
#   .\scripts\key-rotate.ps1 new                 # 生成新随机 Key(明文 + sha256)
#   .\scripts\key-rotate.ps1 sha256 -Key <明文>  # 将某个明文 Key 转为 sha256:<hex>
#   .\scripts\key-rotate.ps1 drain -Key <明文> \ # 检查旧 Key 是否仍被调用
#       [-Url http://localhost:3000]              # (可选) 探测后端鉴权语义
# 详细流程见 docs/ops/key-rotation.md
# ============================================================================
param(
  [Parameter(Position = 0)]
  [ValidateSet('new', 'sha256', 'drain')]
  [string]$Action = 'new',
  [string]$Key,
  [string]$Url = 'http://localhost:3000'
)

$ErrorActionPreference = 'Stop'

function Get-Sha256Hex {
  param([string]$s)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($s))
  ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

function New-ApiKey {
  # 32 字符 URL 安全随机串 (取 base64url 前 32 字符, 约 24 字节熵)
  $buf = New-Object byte[] 32
  ([System.Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($buf)
  ([Convert]::ToBase64String($buf) -replace '[/+=]', '').Substring(0, 32)
}

switch ($Action) {
  'new' {
    $plain = New-ApiKey
    $hex = Get-Sha256Hex $plain
    Write-Host "[key-rotate] 新 Key 明文(仅此可见, 落库用哈希): "
    Write-Host "  $plain"
    Write-Host "[key-rotate] 建议写入 .env 的哈希形式(日志/配置不落明文): "
    Write-Host "  sha256:$hex"
    Write-Host "`n轮换流程: 参照 docs/ops/key-rotation.md。推荐三步走:"
    Write-Host "  1) 新增: 把新 Key 追加到 OE_API_KEYS (旧 Key 继续有效 = 宽限期)"
    Write-Host "  2) 切换: 客户端改用新 Key, 验证旧调用量趋零"
    Write-Host "  3) 撤销: 把旧 Key 加入 OE_API_KEY_REVOKED (立即 403, 回收)"
  }
  'sha256' {
    if (-not $Key) { throw '[key-rotate] sha256 需指定 -Key <明文>' }
    $hex = Get-Sha256Hex $Key
    Write-Host "sha256:$hex"
  }
  'drain' {
    if (-not $Key) { throw '[key-rotate] drain 需指定 -Key <明文> 以探测旧 Key 是否仍被调用' }
    if (-not $Url) { throw '[key-rotate] 需指定 -Url http://host:port' }
    try {
      $r = Invoke-WebRequest -Uri "$Url/api/health" -Method GET -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
      if ($r.StatusCode -ne 200) {
        Write-Host "[key-rotate] 后端健康检查未通过 (HTTP $($r.StatusCode)): 请确保服务在 $Url 运行"
        exit 1
      }
    } catch {
      Write-Host "[key-rotate] 后端未就绪或不可达 ($Url): $($_.Exception.Message)"
      exit 1
    }
    try {
      $probe = Invoke-WebRequest -Uri "$Url/api/matches" -Method GET -Headers @{ 'X-Api-Key' = $Key } -UseBasicParsing -TimeoutSec 5
      Write-Host "[key-rotate] 旧 Key 仍被接受 (HTTP $($probe.StatusCode)): 尚未回收, 先别撤销。"
    } catch {
      $code = $_.Exception.Response.StatusCode.value__
      Write-Host "[key-rotate] 旧 Key 已不被接 (HTTP $code = 400/401/403 类): 可安全撤销回收。"
    }
  }
}