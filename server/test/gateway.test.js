// ============================================================================
// API 网关测试 — 鉴权 / 健康检查 / 指标
// ============================================================================
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { createAuthMiddleware } = require('../src/gateway/auth');
const { createHealthHandler, createMetricsHandler } = require('../src/gateway/health');

describe('createAuthMiddleware', () => {
  it('无 API Key 时跳过鉴权', () => {
    const auth = createAuthMiddleware({});
    const res = { statusCode: 0, headers: {}, end() {} };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: {} }, res), true);
  });

  it('有 API Key 时 Header 鉴权通过', () => {
    const auth = createAuthMiddleware({ apiKey: 'test-key-123' });
    const res = { statusCode: 0, headers: {}, end() {} };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'test-key-123' } }, res), true);
  });

  it('有 API Key 时 Query 鉴权通过', () => {
    const auth = createAuthMiddleware({ apiKey: 'test-key-123' });
    const res = { statusCode: 0, headers: {}, end() {} };
    assert.strictEqual(auth({ url: '/api/matches?api_key=test-key-123', method: 'GET', headers: {} }, res), true);
  });

  it('API Key 不匹配时返回 401', () => {
    const auth = createAuthMiddleware({ apiKey: 'correct-key' });
    let status = 0, body = '';
    const res = {
      statusCode: 0,
      setHeader(k, v) { this.headers = this.headers || {}; this.headers[k] = v; },
      end(b) { status = this.statusCode; body = b; },
    };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'wrong-key' } }, res), false);
    assert.strictEqual(res.statusCode, 401);
    const parsed = JSON.parse(body);
    assert.strictEqual(parsed.status, 'error');
    assert.strictEqual(parsed.error, 'unauthorized');
  });
});

describe('createHealthHandler', () => {
  it('返回健康状态 JSON', () => {
    const mockService = {
      getStatus() {
        return { dbPath: '/tmp/test.db', ruleVersions: 18, activeRules: 16, predictions: 0, auditEntries: 0, httpPort: 3000 };
      },
    };
    const handler = createHealthHandler(mockService);
    let status = 0, body = '';
    const res = {
      writeHead(s) { status = s; },
      end(b) { body = b; },
      setHeader() {},
    };
    handler({}, res);
    const data = JSON.parse(body);
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.service, 'odds-edge');
    assert.strictEqual(data.rules.active, 16);
    assert.ok(data.uptime > 0);
  });
});

describe('createMetricsHandler', () => {
  it('返回 Prometheus 格式文本', () => {
    const mockService = {
      getStatus() {
        return { dbPath: '/tmp/test.db', ruleVersions: 18, activeRules: 16, predictions: 5, auditEntries: 10, httpPort: 3000 };
      },
    };
    const handler = createMetricsHandler(mockService);
    let body = '';
    const res = {
      setHeader() {},
      end(b) { body = b; },
    };
    handler({}, res);
    assert.ok(body.includes('rule_versions_total 18'));
    assert.ok(body.includes('active_rules_total 16'));
    assert.ok(body.includes('predictions_total 5'));
    assert.ok(body.includes('uptime_seconds'));
    assert.ok(body.includes('memory_heap_bytes'));
  });
});