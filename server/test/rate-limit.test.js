// ============================================================================
// API 网关 · 限流中间件测试
// 覆盖：未超限放行 + X-RateLimit 头 / 超限 429 + Retry-After / 不同 IP 独立计数 /
// max<=0 禁用 / clientIp 提取。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimitMiddleware, clientIp } = require('../src/gateway/rate_limit');

function mkRes() {
  const headers = {};
  return {
    headers,
    statusCode: 0,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    end() {},
  };
}

function mkReq(ip, url = '/api/matches') {
  return { url, method: 'GET', headers: {}, socket: { remoteAddress: ip } };
}

test('限流 · 未超限放行并带 X-RateLimit 头', () => {
  const rl = createRateLimitMiddleware({ max: 3, windowMs: 60_000 });
  for (let i = 0; i < 3; i++) {
    const res = mkRes();
    assert.equal(rl(mkReq('1.2.3.4'), res), true);
    assert.equal(res.headers['x-ratelimit-limit'], '3');
    assert.equal(res.headers['x-ratelimit-remaining'], String(3 - i - 1));
  }
});

test('限流 · 超限返回 429 + Retry-After', () => {
  const rl = createRateLimitMiddleware({ max: 2, windowMs: 60_000 });
  const res1 = mkRes();
  const res2 = mkRes();
  const res3 = mkRes();
  assert.equal(rl(mkReq('1.2.3.4'), res1), true);
  assert.equal(rl(mkReq('1.2.3.4'), res2), true);
  assert.equal(rl(mkReq('1.2.3.4'), res3), false);
  assert.equal(res3.statusCode, 429);
  assert.ok(Number(res3.headers['retry-after']) >= 1);
  assert.equal(res3.headers['x-ratelimit-remaining'], '0');
});

test('限流 · 不同 IP 独立计数', () => {
  const rl = createRateLimitMiddleware({ max: 1, windowMs: 60_000 });
  const a1 = mkRes();
  const a2 = mkRes();
  const b1 = mkRes();
  assert.equal(rl(mkReq('1.1.1.1'), a1), true);
  assert.equal(rl(mkReq('1.1.1.1'), a2), false, '同 IP 第二次超限');
  assert.equal(rl(mkReq('2.2.2.2'), b1), true, '不同 IP 不受影响');
});

test('限流 · max<=0 禁用（恒放行）', () => {
  const rl = createRateLimitMiddleware({ max: 0, windowMs: 60_000 });
  for (let i = 0; i < 5; i++) {
    const res = mkRes();
    assert.equal(rl(mkReq('1.2.3.4'), res), true);
  }
});

test('限流 · 窗口过期后重置计数', () => {
  const rl = createRateLimitMiddleware({ max: 1, windowMs: 50 });
  const res1 = mkRes();
  assert.equal(rl(mkReq('1.2.3.4'), res1), true);
  const res2 = mkRes();
  assert.equal(rl(mkReq('1.2.3.4'), res2), false);
  // 等待窗口过期后应放行
  return new Promise((resolve) => {
    setTimeout(() => {
      const res3 = mkRes();
      assert.equal(rl(mkReq('1.2.3.4'), res3), true);
      resolve();
    }, 80);
  });
});

test('限流 · clientIp 优先 X-Forwarded-For 首项，其次 socket', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': ' 8.8.8.8, 1.1.1.1 ' }, socket: {} }), '8.8.8.8');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
  assert.equal(clientIp({ headers: {}, socket: {} }), 'unknown');
});
