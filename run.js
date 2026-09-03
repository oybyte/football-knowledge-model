// ============================================================================
// 一键启动入口 —— node run.js  |  npm run
// 同时拉起后端 API（server/bin/start.js，端口 OE_PORT/3000）与
// 前端静态服务器（prototype-1.0.0/serve.js，端口 OE_WEB_PORT/8080），
// 等待前端就绪后自动打开浏览器访问 http://localhost:8080。
// 按 Ctrl+C 结束任一进程时，两个子进程都会随本进程一同退出。
//
// 环境变量：
//   OE_WEB_PORT  前端端口    默认 8080
//   OE_PORT      后端端口    默认 3000
//   其余 OE_* 透传给后端（OE_REDIS_URL / OE_MANUAL_ODDS_ROOT / ...）
// ============================================================================
'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

// 本地一键启动时加载仓库 .env，使 OE_MANUAL_ODDS_ROOT / OE_SPORTTERY_ANCHOR 等
// 配置对子进程（后端 start.js / 前端 serve.js）生效（子进程继承本进程 env）。
require('./server/src/lib/load_env').loadDotEnv();

const ROOT = __dirname;
const WEB_PORT = Number(process.env.OE_WEB_PORT) || 8080;
const FRONTEND_URL = `http://localhost:${WEB_PORT}`;

const WEB_SERVER = path.join(ROOT, 'prototype-1.0.0', 'serve.js');
const API_SERVER = path.join(ROOT, 'server', 'bin', 'start.js');

const children = new Set();
let opening = false;

function start(name, file, args = []) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    console.log(`[run] ${name} 已退出 (code=${code}, signal=${signal})`);
    shutdown(`子进程 ${name} 退出`);
  });
  return child;
}

/** 轮询 TCP 端口，就绪后 resolve。 */
function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`端口 ${port} 等待就绪超时`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

function openBrowser(url) {
  if (opening) return;
  opening = true;
  let cmd, args;
  if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  const opener = spawn(cmd, args, { stdio: 'ignore', detached: true });
  opener.on('error', (e) => console.log(`[run] 自动打开浏览器失败，请手动访问 ${url}（${e.message}）`));
  opener.unref();
}

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[run] 收到 ${reason}，正在关闭...`);
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  // 兜底：给子进程 1.5s 优雅退出，超时强杀
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed && child.exitCode === null) child.kill('SIGKILL');
    }
    process.exit(0);
  }, 2000).unref();
}

async function main() {
  console.log('[run] 启动后端 API 与前端静态服务器...');
  start('后端', API_SERVER);
  start('前端', WEB_SERVER);

  try {
    await waitForPort(WEB_PORT);
    console.log(`[run] 前端就绪 → ${FRONTEND_URL}`);
    openBrowser(FRONTEND_URL);
  } catch (e) {
    console.error(`[run] ${e.message}`);
  }

  process.on('SIGINT', () => shutdown('Ctrl+C'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
}

main().catch((e) => {
  console.error('[run] 启动失败:', e);
  shutdown('启动异常');
});