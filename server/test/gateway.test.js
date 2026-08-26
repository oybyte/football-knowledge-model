// ============================================================================
// API 网关测试 — 鉴权 / 健康检查 / 指标
// ============================================================================
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { createAuthMiddleware, sha256Hex, keyMatches, timingSafeEqualStr } = require('../src/gateway/auth');
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

  it('缺少 API Key 时返回 401', () => {
    const auth = createAuthMiddleware({ apiKey: 'correct-key' });
    let status = 0, body = '';
    const res = {
      statusCode: 0,
      setHeader(k, v) { this.headers = this.headers || {}; this.headers[k] = v; },
      end(b) { status = this.statusCode; body = b; },
    };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: {} }, res), false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(JSON.parse(body).error, 'unauthorized');
  });

  it('多 Key：任一有效 Key 均通过（Header / Query）', () => {
    const auth = createAuthMiddleware({ apiKeys: ['key-a', 'key-b'] });
    const res = { statusCode: 0, headers: {}, end() {} };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'key-a' } }, res), true);
    assert.strictEqual(auth({ url: '/api/matches?api_key=key-b', method: 'GET', headers: {} }, res), true);
  });

  it('多 Key：不在列表中的 Key 返回 401', () => {
    const auth = createAuthMiddleware({ apiKeys: ['key-a', 'key-b'] });
    let status = 0, body = '';
    const res = {
      statusCode: 0,
      setHeader(k, v) { this.headers = this.headers || {}; this.headers[k] = v; },
      end(b) { status = this.statusCode; body = b; },
    };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'key-c' } }, res), false);
    assert.strictEqual(res.statusCode, 401);
  });

  it('撤销 Key：有效但被撤销的 Key 返回 403 forbidden', () => {
    const auth = createAuthMiddleware({ apiKeys: ['key-a', 'key-b'], revokedKeys: ['key-b'] });
    let status = 0, body = '';
    const res = {
      statusCode: 0,
      setHeader(k, v) { this.headers = this.headers || {}; this.headers[k] = v; },
      end(b) { status = this.statusCode; body = b; },
    };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'key-b' } }, res), false);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(JSON.parse(body).error, 'forbidden');
    // 未撤销的 Key 仍可用
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'key-a' } }, res), true);
  });

  it('撤销 Key：单 Key 全部被撤销时跳过鉴权（视为未配置）', () => {
    const auth = createAuthMiddleware({ apiKey: 'only-key', revokedKeys: ['only-key'] });
    const res = { statusCode: 0, headers: {}, end() {} };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: {} }, res), true);
  });

  it('parseKeyList：逗号分隔、去空白、去空项', () => {
    const { parseKeyList } = require('../src/gateway/auth');
    assert.deepEqual(parseKeyList(' a , b ,, c '), ['a', 'b', 'c']);
    assert.deepEqual(parseKeyList(''), []);
    assert.deepEqual(parseKeyList(undefined), []);
  });

  it('sha256 哈希配置：明文 Key 通过、错误 Key 401、配置不落明文', () => {
    const hashed = `sha256:${sha256Hex('secret-key')}`;
    assert.ok(!hashed.includes('secret-key'), '配置值不得包含明文');
    const auth = createAuthMiddleware({ apiKey: hashed });
    const res = { statusCode: 0, headers: {}, end() {} };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'secret-key' } }, res), true);
    let status = 0;
    const bad = { statusCode: 0, setHeader() {}, end() { status = this.statusCode; } };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'wrong' } }, bad), false);
    assert.strictEqual(bad.statusCode, 401);
  });

  it('撤销哈希：撤销列表用 sha256 哈希吊销明文 Key → 403', () => {
    const auth = createAuthMiddleware({ apiKeys: ['key-a', 'key-b'], revokedKeys: [`sha256:${sha256Hex('key-b')}`] });
    let status = 0;
    const res = { statusCode: 0, setHeader() {}, end() { status = this.statusCode; } };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'key-b' } }, res), false);
    assert.strictEqual(res.statusCode, 403);
    const ok = { statusCode: 0, headers: {}, end() {} };
    assert.strictEqual(auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'key-a' } }, ok), true);
  });

  it('keyMatches：明文/哈希匹配与常量时间比较', () => {
    assert.equal(keyMatches('abc', 'abc'), true);
    assert.equal(keyMatches('abc', 'abd'), false);
    assert.equal(keyMatches('abc', `sha256:${sha256Hex('abc')}`), true);
    assert.equal(keyMatches('abc', `sha256:${sha256Hex('abd')}`), false);
    assert.equal(timingSafeEqualStr('same', 'same'), true);
    assert.equal(timingSafeEqualStr('same', 'diff'), false);
    assert.equal(timingSafeEqualStr('a', 'longer'), false);
  });

  it('审计回调：成功 auth_ok / 失败 auth_rejected 事件触发', () => {
    const events = [];
    const auth = createAuthMiddleware({ apiKey: 'audit-key', audit: (m, p) => events.push({ m, ...p }) });
    const ok = { statusCode: 0, headers: {}, end() {} };
    auth({ url: '/api/matches', method: 'GET', headers: { 'x-api-key': 'audit-key' } }, ok);
    let status = 0;
    const bad = { statusCode: 0, setHeader() {}, end() { status = this.statusCode; } };
    auth({ url: '/api/rules', method: 'GET', headers: { 'x-api-key': 'nope' } }, bad);
    assert.equal(events.length, 2);
    assert.equal(events[0].m, 'auth_ok');
    assert.equal(events[0].status, 200);
    assert.equal(events[1].m, 'auth_rejected');
    assert.equal(events[1].status, 401);
    assert.equal(events[1].reason, 'invalid_key');
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