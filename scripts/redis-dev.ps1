# ============================================================================
# 本地真实 Redis 一键脚本 (Windows PowerShell)
# 用途: 为「真实 Redis 端到端验收」与本地联调拉起一个真实 redis-server。
#   - 首次运行自动下载 Redis-for-Windows (tporadowski/redis, 官方社区移植,
#     免安装单文件) 到 .tools\redis\
#   - 默认端口 16379 (避开 6379 常驻冲突), 数据不落盘 (--save "")
# 用法:
#   .\scripts\redis-dev.ps1 start    # 启动 (后台)
#   .\scripts\redis-dev.ps1 stop     # 停止
#   .\scripts\redis-dev.ps1 status   # 查看状态
# 后端联调: $env:OE_REDIS_URL="redis://127.0.0.1:16379"
# ============================================================================
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'status')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$redisDir = Join-Path $root '.tools\redis'
$exe = Join-Path $redisDir 'extracted\redis-server.exe'
$cli = Join-Path $redisDir 'extracted\redis-cli.exe'
$port = 16379
$pidFile = Join-Path $redisDir 'redis.pid'

function Get-RunningPid {
  if (Test-Path $pidFile) {
    $procId = [int](Get-Content $pidFile -Raw).Trim()
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) { return $procId }
  }
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conn) { return $conn.OwningProcess }
  return $null
}

function Ensure-Binary {
  if (Test-Path $exe) { return }
  Write-Host "[redis-dev] 未找到 redis-server.exe, 下载 Redis-for-Windows ..."
  New-Item -ItemType Directory -Force -Path $redisDir | Out-Null
  $zip = Join-Path $redisDir 'redis.zip'
  $url = 'https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip'
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath (Join-Path $redisDir 'extracted') -Force
  Remove-Item $zip -Force
  if (-not (Test-Path $exe)) { throw "下载/解压失败: $exe" }
}

switch ($Action) {
  'start' {
    Ensure-Binary
    $running = Get-RunningPid
    if ($running) { Write-Host "[redis-dev] 已在运行 PID=$running (port $port)"; exit 0 }
    $p = Start-Process -FilePath $exe -ArgumentList "--port $port --save '' --appendonly no --daemonize no" -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 2
    $ping = & $cli -p $port ping 2>$null
    if ($ping -ne 'PONG') { Write-Host "[redis-dev] 启动失败 ping=$ping"; exit 1 }
    Set-Content -Path $pidFile -Value $p.Id
    Write-Host "[redis-dev] 真实 Redis 已启动 PID=$($p.Id) port=$port"
    Write-Host "[redis-dev] 联调: `$env:OE_REDIS_URL='redis://127.0.0.1:$port'"
  }
  'stop' {
    $running = Get-RunningPid
    if (-not $running) { Write-Host "[redis-dev] 未在运行"; exit 0 }
    Stop-Process -Id $running -Force -ErrorAction SilentlyContinue
    if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
    Write-Host "[redis-dev] 已停止 PID=$running"
  }
  'status' {
    $running = Get-RunningPid
    if ($running) { Write-Host "[redis-dev] 运行中 PID=$running (port $port)" }
    else { Write-Host "[redis-dev] 未运行 (port $port)" }
  }
}
