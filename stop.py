#!/usr/bin/env python3
# ============================================================================
# stop.py —— 停止 football-knowledge-model 所有相关进程
#
# 按命令行匹配本项目的 node 进程（server/bin/start.js、
# prototype-1.0.0/serve.js、run.js），用 taskkill 强制结束。
# 与 run.py 解耦：即使 run.py 已退出，也能清理残留实例。
#
# 用法：python stop.py
# ============================================================================
import subprocess
import sys

PS_FIND = (
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\""
    " | Where-Object { $_.CommandLine -match 'start\\.js|serve\\.js|run\\.js' }"
    " | ForEach-Object { $_.ProcessId }"
)


def find_pids():
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", PS_FIND],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        return [int(x) for x in out.split() if x.strip().isdigit()]
    except Exception as e:
        print(f"[stop] 查找进程失败：{e}")
        return []


def kill_pids(pids):
    killed = []
    for pid in pids:
        try:
            r = subprocess.run(
                ["taskkill", "/F", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if r.returncode == 0:
                killed.append(pid)
            else:
                print(f"[stop] PID={pid} 结束失败（可能已退出或权限不足）")
        except Exception as e:
            print(f"[stop] PID={pid} 结束异常：{e}")
    return killed


def main():
    pids = find_pids()
    if not pids:
        print("[stop] 未发现运行中的项目进程（无需操作）。")
        return
    print(f"[stop] 找到 {len(pids)} 个相关进程：{pids}")
    killed = kill_pids(pids)
    # 二次确认：清理可能残留的进程
    remaining = find_pids()
    if remaining:
        print(f"[stop] 警告：仍有 {len(remaining)} 个进程未结束：{remaining}")
    else:
        print(f"[stop] 已停止 {len(killed)} 个进程，全部清理完成。")


if __name__ == "__main__":
    main()
