// ============================================================================
// HTTP 层 · 入口 —— createHttpServer（CORS + 路由 + 统一响应壳）
// 7 个 REST 端点全部由真实后端模块驱动（handlers.js），前端可切到真实后端。
// 响应壳：成功 { status:'ok', data }；失败 { status:'error', error }。
// ============================================================================
'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { defaultLogger } = require('../lib/logger');
const handlers = require('./handlers');
const { createGateway } = require('../gateway');

const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
  'Access-Control-Max-Age': '86400',
});

const MAX_BODY = 1_000_000;

/** 解析请求体为 JSON（空体 → {}）。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        req.destroy();
        reject(new Error('payload_too_large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
}

/** 匹配 7 个端点；未命中返回 null。 */
function matchRoute(method, parts) {
  if (method === 'GET') {
    if (parts.length === 2 && parts[0] === 'api' && parts[1] === 'matches') return { handler: 'listMatches' };
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'analysis') return { handler: 'getAnalysis', id: parts[2] };
    if (parts.length === 2 && parts[0] === 'api' && parts[1] === 'rules') return { handler: 'listRules' };
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'rules' && parts[3] === 'versions') return { handler: 'getRuleVersions', id: parts[2] };
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'backtest') return { handler: 'getBacktest', id: parts[2] };
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'ai' && parts[2] === 'candidates') return { handler: 'listAiCandidates' };
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'sources' && parts[2] === 'manual-odds') return { handler: 'getManualOddsStatus' };
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'sources' && parts[2] === 'schedule') return { handler: 'getScheduleStatus' };
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'sources' && parts[2] === 'sporttery-odds') return { handler: 'getSportteryOddsStatus' };
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'sources' && parts[2] === 'merged') return { handler: 'getMergedPool' };
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'merged' && parts[2] === 'analysis') return { handler: 'getMergedAnalysis', id: parts[3] };
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'manual-odds' && parts[2] === 'analysis') return { handler: 'getManualAnalysis', id: parts[3] };
  }
  if (method === 'GET') {
    if (parts.length === 2 && parts[0] === 'api' && parts[1] === 'health') return { handler: 'health' };
    if (parts.length === 2 && parts[0] === 'api' && parts[1] === 'metrics') return { handler: 'metrics' };
  }
  if (method === 'POST') {
    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'ai' && parts[2] === 'candidates' && parts[4] === 'review') return { handler: 'reviewAiCandidate', id: parts[3] };
  }
  return null;
}

/**
 * 创建 HTTP 服务器。
 * @param {Object} service createService 返回的服务上下文
 * @param {Object} [opts]
 * @param {import('../lib/logger').Logger} [opts.logger]
 * @param {string} [opts.apiKey]
 * @param {string[]} [opts.apiKeys]
 * @param {string[]} [opts.revokedKeys]
 * @param {number} [opts.rateLimitMax]
 * @param {number} [opts.rateLimitWindowMs]
 * @param {'memory'|'redis'} [opts.rateLimitStore]
 * @param {object} [opts.redis]
 * @param {string} [opts.tlsCertificate] 证书文件路径（与 tlsKey 同设即以 HTTPS 终止 TLS）
 * @param {string} [opts.tlsKey] 私钥文件路径
 * @returns {import('node:http').Server} 普通 HTTP 或 HTTPS（node:https）服务器
 */
function createHttpServer(service, opts = {}) {
  const logger = opts.logger || defaultLogger;
  // 鉴权事件落库审计（audit_logs，append-only）：成功 INFO / 失败 WARN。
  const audit = (message, payload) => {
    if (service.auditStore) {
      service.auditStore.append({
        level: message === 'auth_ok' ? 'INFO' : 'WARN',
        service: 'gateway',
        message,
        ...payload,
      });
    }
  };
  const gateway = createGateway(service, { ...opts, logger, audit });

  const requestHandler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
      }

      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const route = matchRoute(req.method, parts);

      if (!route) {
        logger.warn('http_route_not_found', { method: req.method, path: url.pathname });
        return sendJson(res, 404, { status: 'error', error: 'not_found' });
      }

      // 限流（所有已匹配路由，含 health/metrics，防单客户端打爆）。
      // Redis 共享限流为异步中间件；await 对同步内存布尔同样成立。
      if (!(await gateway.rateLimit(req, res))) return;

      // 鉴权（health/metrics 除外）
      if (route.handler !== 'health' && route.handler !== 'metrics') {
        if (!gateway.auth(req, res)) return;
      }

      // 特殊路由：health / metrics
      if (route.handler === 'health') return gateway.health(req, res);
      if (route.handler === 'metrics') return gateway.metrics(req, res);

      const fn = handlers[route.handler];
      const body = req.method === 'POST' ? await readBody(req) : {};
      const query = Object.fromEntries(url.searchParams.entries());
      const result = await fn(service, { id: route.id, query }, body);

      const payload = result.status >= 400
        ? { status: 'error', error: result.error }
        : { status: 'ok', data: result.data };
      sendJson(res, result.status, payload);
    } catch (err) {
      logger.error('http_unhandled', { error: err.message });
      sendJson(res, 500, { status: 'error', error: 'internal_error' });
    }
  };

  // TLS 终止（生产网关形态）：同时提供证书与私钥即以 HTTPS 启动。
  // 配置了 TLS 但证书/私钥读取失败 → 抛错快速失败（绝不静默降级明文 HTTP，避免安全降级）。
  if (opts.tlsCertificate || opts.tlsKey) {
    const fs = require('node:fs');
    if (!opts.tlsCertificate || !opts.tlsKey) {
      throw new Error('tls_misconfigured: 需同时设置 tlsCertificate 与 tlsKey');
    }
    let tls;
    try {
      tls = {
        cert: fs.readFileSync(opts.tlsCertificate),
        key: fs.readFileSync(opts.tlsKey),
      };
    } catch (e) {
      throw new Error(`tls_misconfigured: 证书/私钥读取失败（${e.message}）`);
    }
    const https = require('node:https');
    logger.info('http_tls_enabled');
    return https.createServer(tls, requestHandler);
  }

  return http.createServer(requestHandler);
}

module.exports = { createHttpServer, matchRoute, sendJson, CORS_HEADERS };
