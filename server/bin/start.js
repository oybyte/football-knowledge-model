// ============================================================================
// 服务启动 CLI —— node bin/start.js
// 启动持久化服务（SQLite 落库 + createRuleService 装配）+ HTTP 层，打印状态，优雅停机。
// 环境变量：OE_DB_PATH 指定 SQLite 文件路径（默认 server/data/odds-edge.db）；
//           OE_PORT 指定 HTTP 端口（默认 3000）。
// ============================================================================
'use strict';

const { createService } = require('../src');

const service = createService({ http: true });
console.log('[odds-edge] service started');
console.log(JSON.stringify(service.getStatus(), null, 2));
if (service.server) {
  console.log(`[odds-edge] http listening on http://localhost:${service.port}`);
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[odds-edge] received ${signal}, shutting down...`);
  service.close();
  console.log('[odds-edge] db closed, bye');
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 保持进程存活，等待信号触发优雅停机
setInterval(() => {}, 1 << 30);
