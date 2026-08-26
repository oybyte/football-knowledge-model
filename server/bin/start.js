// ============================================================================
// 服务启动 CLI —— node bin/start.js
// 启动持久化服务（SQLite 落库 + createRuleService 装配）+ HTTP 层，打印状态，优雅停机。
// 环境变量：
//   OE_DB_PATH  SQLite 文件路径（默认 server/data/odds-edge.db）
//   OE_PORT     HTTP 端口（默认 3000）
//   OE_API_KEY  API 密钥（设置后启用鉴权，默认无鉴权）
//   OE_TLS_CERT / OE_TLS_KEY  证书/私钥文件路径（同设即以 HTTPS 终止 TLS，默认 HTTP）
//   OE_REDIS_URL Redis 连接（可选，设置后启用 Redis 缓存/锁/队列）
//   OE_MANUAL_ODDS_ROOT 本地人工盘赔根目录（经 CredentialVault env: 注入，
//     扫描其下各比赛子目录的 盘口数据.md；不配置则手动源为 not_configured）
//   示例：node 启动前注入 $env:OE_MANUAL_ODDS_ROOT="F:\ocr_python_data\FootballScreenshotOcr\output"
//   ODDS_SPORTTERY_SCHEDULE_BASE 竞彩官方赛程端点（经 CredentialVault env: 注入，
//     双源合并以官方元信息升级人工盘赔；不配置则合并池为 manual_only）
//   示例：$env:ODDS_SPORTTERY_SCHEDULE_BASE="https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=hhad,had,crs,ttg,hafu&channel=c"
// ============================================================================
'use strict';

const { createService, resolveHttpPort } = require('../src');
const { defaultLogger } = require('../src/lib/logger');

const logger = defaultLogger;
const redisUrl = process.env.OE_REDIS_URL;

const httpPort = resolveHttpPort({ port: parseInt(process.env.OE_PORT, 10) || 3000 }, process.env);

createService({
  http: { port: httpPort, apiKey: process.env.OE_API_KEY },
  logger,
  redisUrl,
}).then((service) => {
  console.log('[odds-edge] service started');
  console.log(JSON.stringify(service.getStatus(), null, 2));
  if (service.server) {
    const scheme = service.getStatus().scheme || 'http';
    console.log(`[odds-edge] ${scheme} listening on ${scheme}://localhost:${service.port}`);
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
}).catch((e) => {
  logger.error('service_start_failed', { error: e.message, stack: e.stack });
  process.exit(1);
});
