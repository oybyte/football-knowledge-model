// ============================================================================
// API 网关 · 健康检查 / 指标端点
// 提供 /api/health（存活+就绪）和 /api/metrics（基础计数）。
// ============================================================================
'use strict';

const { defaultLogger } = require('../lib/logger');

/** 内联 JSON 响应（避免与 http/index.js 的循环依赖）。 */
function writeJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

/**
 * 健康检查处理器
 * @param {object} service 服务实例
 * @param {{ logger?: object }} [opts]
 * @returns {(req: object, res: object) => void}
 */
function createHealthHandler(service, { logger = defaultLogger } = {}) {
  return function healthHandler(req, res) {
    const status = service.getStatus();
    const healthy = {
      status: 'ok',
      service: 'odds-edge',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db: status.dbPath ? 'connected' : 'disconnected',
      rules: {
        versions: status.ruleVersions || 0,
        active: status.activeRules || 0,
      },
      predictions: status.predictions || 0,
      httpPort: status.httpPort || null,
    };
    writeJson(res, 200, healthy);
  };
}

/**
 * 基础指标处理器
 * 仅返回运行时计数，不做 OTel/Prometheus 集成（阶段 1 后期）。
 * @param {object} service
 * @returns {(req: object, res: object) => void}
 */
function createMetricsHandler(service) {
  return function metricsHandler(req, res) {
    const status = service.getStatus();
    const metrics = {
      uptime_seconds: process.uptime(),
      rule_versions_total: status.ruleVersions || 0,
      active_rules_total: status.activeRules || 0,
      predictions_total: status.predictions || 0,
      audit_entries_total: status.auditEntries || 0,
      memory_heap_bytes: process.memoryUsage().heapUsed,
      memory_rss_bytes: process.memoryUsage().rss,
    };
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    let lines = [];
    for (const [k, v] of Object.entries(metrics)) {
      lines.push(`# HELP ${k} ${k.replace(/_/g, ' ')}`);
      lines.push(`# TYPE ${k} gauge`);
      lines.push(`${k} ${v}`);
    }
    res.end(lines.join('\n') + '\n');
  };
}

module.exports = { createHealthHandler, createMetricsHandler };