#!/usr/bin/env python3
# ============================================================================
# run.py —— 一键启动 football-knowledge-model（后端 + 前端）并打开浏览器
#
# 行为：
#   1. 先停掉本项目已有的 node 实例（避免端口冲突 / 重复拉起）
#   2. 读取根目录 .env 注入环境变量（node run.js 本身不自动加载 .env）
#   3. 启动后端 server/bin/start.js（OE_PORT，默认 3000）
#      与前端 prototype-1.0.0/serve.js（OE_WEB_PORT，默认 8080）
#   4. 待前端端口就绪后，自动打开默认浏览器访问 http://localhost:8080
#   5. 常驻运行，Ctrl+C 优雅停止两个子进程
#
# 用法：python run.py
# ============================================================================
import os
import sys
import time
import json
import shutil
import socket
import subprocess
import webbrowser
import pathlib

# 管道/后台运行时 stdout 默认块缓冲，这里改成按行刷新，保证 [run] 横幅及时可见
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parent
WEB_PORT = int(os.environ.get("OE_WEB_PORT", "8080"))
API_PORT = int(os.environ.get("OE_PORT", "3000"))
FRONTEND_URL = f"http://localhost:{WEB_PORT}"

PS_FIND = (
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\""
    " | Where-Object { $_.CommandLine -match 'start\\.js|serve\\.js|run\\.js' }"
    " | ForEach-Object { $_.ProcessId }"
)


def find_node():
    node = shutil.which("node")
    if node:
        return node
    for cand in (
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Users\lcz\.workbuddy\binaries\node\versions\22.22.2-2\node.exe",
    ):
        if os.path.exists(cand):
            return cand
    return None


def load_dotenv():
    """极简 .env 解析：KEY=VALUE，忽略 # 注释与空行，支持引号与 export 前缀。"""
    env = {}
    p = ROOT / ".env"
    if not p.exists():
        return env
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def find_pids():
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", PS_FIND],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        return [int(x) for x in out.split() if x.strip().isdigit()]
    except Exception:
        return []


def kill_pids(pids):
    for pid in pids:
        try:
            subprocess.run(
                ["taskkill", "/F", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except Exception:
            pass


def port_open(port, host="127.0.0.1", timeout=0.4):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def wait_port(port, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_open(port):
            return True
        time.sleep(0.3)
    return False


def main():
    node = find_node()
    if not node:
        print("[run] 未找到 node，请确认已安装并加入 PATH，或在脚本内补充 node 路径。")
        sys.exit(1)

    # 1) 停掉已有实例
    existing = find_pids()
    if existing:
        print(f"[run] 发现 {len(existing)} 个已有实例，先停止…")
        kill_pids(existing)
        time.sleep(1)

    # 2) 合并 .env 到子进程环境
    dotenv = load_dotenv()
    child_env = dict(os.environ)
    child_env.update(dotenv)
    child_env.setdefault("OE_WEB_PORT", str(WEB_PORT))
    child_env.setdefault("OE_PORT", str(API_PORT))

    # 3) 启动后端 + 前端
    api = subprocess.Popen(
        [node, str(ROOT / "server" / "bin" / "start.js")],
        cwd=str(ROOT), env=child_env,
    )
    web = subprocess.Popen(
        [node, str(ROOT / "prototype-1.0.0" / "serve.js")],
        cwd=str(ROOT), env=child_env,
    )
    print(f"[run] 后端启动 PID={api.pid}  (端口 {API_PORT})")
    print(f"[run] 前端启动 PID={web.pid}  (端口 {WEB_PORT})")

    # 4) 等待前端就绪并打开浏览器
    if not wait_port(WEB_PORT, 30):
        print("[run] 前端端口等待超时，请检查 serve.js 输出。服务可能仍在后台运行。")
    else:
        print(f"[run] 前端就绪 → {FRONTEND_URL}")
        try:
            webbrowser.open(FRONTEND_URL)
            print("[run] 已尝试打开浏览器（若未弹出请手动访问上方地址）")
        except Exception as e:
            print(f"[run] 自动打开浏览器失败：{e}（请手动访问 {FRONTEND_URL}）")

    # 5) 常驻，Ctrl+C 优雅退出
    print("[run] 运行中（Ctrl+C 停止）…")
    try:
        while True:
            time.sleep(1)
            if api.poll() is not None and web.poll() is not None:
                print("[run] 子进程已退出。")
                break
    except KeyboardInterrupt:
        print("\n[run] 收到 Ctrl+C，正在停止…")
    finally:
        for p in (api, web):
            try:
                if p.poll() is None:
                    p.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    main()
