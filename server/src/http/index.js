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

const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'manual-odds' && parts[2] === 'analysis') return { handler: 'getManualAnalysis', id: parts[3] };
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
 * @returns {import('node:http').Server}
 */
function createHttpServer(service, opts = {}) {
  const logger = opts.logger || defaultLogger;

  return http.createServer(async (req, res) => {
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

      const fn = handlers[route.handler];
      const body = req.method === 'POST' ? await readBody(req) : {};
      const result = await fn(service, { id: route.id }, body);

      const payload = result.status >= 400
        ? { status: 'error', error: result.error }
        : { status: 'ok', data: result.data };
      sendJson(res, result.status, payload);
    } catch (err) {
      logger.error('http_unhandled', { error: err.message });
      sendJson(res, 500, { status: 'error', error: 'internal_error' });
    }
  });
}

module.exports = { createHttpServer, matchRoute, sendJson, CORS_HEADERS };
