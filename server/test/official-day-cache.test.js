// ============================================================================
// 体彩官方数据「当天缓存」测试 —— 公益网站减负
// 中国体彩官网为公益网站：自动请求每天最多直连官方一次；
// 重复自动请求命中当天缓存（零直连）；仅 ?refresh=1（用户手动）强制直连。
// 覆盖：
//   ① 竞彩赔率端点：首次直连 → 缓存命中 → 手动刷新再直连（stub globalThis.fetch 计数）
//   ② 竞彩赛程端点：同上（env 端点注入 + stub fetch 计数）
//   ③ 合并池端点：官方赛程同样命中当天缓存（赛程直连次数不随请求增长）
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createService } = require('../src');
const { createHttpServer } = require('../src/http');

/** 发起一次 HTTP 请求。 */
function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* 非 JSON 响应 */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 启动一个隔离服务 + 服务器（每次 fresh 实例 → fresh 当天缓存），跑完自动关闭。 */
async function withServer(fn) {
  const svc = await createService({ dbPath: ':memory:' });
  const server = createHttpServer(svc);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    await fn(port, svc);
  } finally {
    await new Promise((r) => server.close(r));
    svc.close();
  }
}

/** 计数 stub：替换 globalThis.fetch，统计对官方端点的直连次数。 */
function stubFetch(payload) {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => payload };
  };
  return {
    get calls() { return calls; },
    restore() { globalThis.fetch = real; },
  };
}

/** 竞彩官方赔率报文（结构对齐 webapi.sporttery.cn getMatchCalculatorV1；远期开赛防时间倒挂）。 */
function oddsPayload() {
  return {
    success: true,
    value: {
      lastUpdateTime: '2026-08-25 12:00:00',
      matchInfoList: [{
        subMatchList: [{
          matchId: '2041900',
          leagueAllName: '韩国职业联赛',
          homeTeamAllName: '金泉尚武',
          awayTeamAllName: '全北现代',
          matchDate: '20261231',
          matchTime: '20:00:00',
          matchStatus: 'Selling',
          had: { h: '2.10', d: '3.20', a: '3.10' },
          hhad: { h: '2.30', d: '3.10', a: '2.70', goalLineValue: '-1' },
        }],
      }],
    },
  };
}

/** 竞彩官方赛程报文（占位契约字段；远期开赛防时间倒挂）。 */
function schedulePayload() {
  return {
    status: 'ok',
    data: [{
      matchId: 'str-9001',
      competitionName: '英超',
      homeTeamName: '曼城',
      awayTeamName: '狼队',
      matchDate: '20261231',
      matchTime: '2300',
      matchStatus: 'scheduled',
      isNeutral: false,
    }],
  };
}

// ───────────────────────── ① 竞彩赔率端点 ─────────────────────────
test('① 赔率端点当天缓存：自动一次直连 → 缓存命中零直连 → 手动 refresh 再直连', async () => {
  const stub = stubFetch(oddsPayload());
  try {
    await withServer(async (port) => {
      // 首次自动请求：直连官方一次
      const r1 = await request(port, 'GET', '/api/sources/sporttery-odds');
      assert.equal(r1.status, 200);
      assert.equal(r1.body.status, 'ok');
      assert.equal(r1.body.data.status, 'ok');
      assert.equal(r1.body.data.cached, false);
      assert.equal(r1.body.data.meta.admitted, 1);
      assert.equal(stub.calls, 1);

      // 重复自动请求：命中当天缓存，零直连（公益网站减负）
      const r2 = await request(port, 'GET', '/api/sources/sporttery-odds');
      assert.equal(r2.status, 200);
      assert.equal(r2.body.data.cached, true);
      assert.equal(r2.body.data.meta.admitted, 1); // 缓存数据完整
      assert.equal(stub.calls, 1);

      // 手动刷新（?refresh=1）：跳过缓存强制直连并更新缓存
      const r3 = await request(port, 'GET', '/api/sources/sporttery-odds?refresh=1');
      assert.equal(r3.status, 200);
      assert.equal(r3.body.data.cached, false);
      assert.equal(stub.calls, 2);

      // 手动刷新后再自动请求：仍命中（新）缓存
      const r4 = await request(port, 'GET', '/api/sources/sporttery-odds');
      assert.equal(r4.body.data.cached, true);
      assert.equal(stub.calls, 2);
    });
  } finally {
    stub.restore();
  }
});

// ───────────────────────── ② 竞彩赛程端点 ─────────────────────────
test('② 赛程端点当天缓存：自动一次直连 → 缓存命中零直连 → 手动 refresh 再直连', async () => {
  const savedBase = process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  process.env.ODDS_SPORTTERY_SCHEDULE_BASE = 'https://schedule.example.invalid/v1/fixtures';
  const stub = stubFetch(schedulePayload());
  try {
    await withServer(async (port) => {
      const r1 = await request(port, 'GET', '/api/sources/schedule');
      assert.equal(r1.status, 200);
      assert.equal(r1.body.data.status, 'ok');
      assert.equal(r1.body.data.cached, false);
      assert.equal(r1.body.data.meta.admitted, 1);
      assert.equal(stub.calls, 1);

      const r2 = await request(port, 'GET', '/api/sources/schedule');
      assert.equal(r2.body.data.cached, true);
      assert.equal(stub.calls, 1);

      const r3 = await request(port, 'GET', '/api/sources/schedule?refresh=1');
      assert.equal(r3.body.data.cached, false);
      assert.equal(stub.calls, 2);
    });
  } finally {
    stub.restore();
    if (savedBase !== undefined) process.env.ODDS_SPORTTERY_SCHEDULE_BASE = savedBase;
    else delete process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  }
});

// ───────────────────────── ③ 合并池端点（官方赛程同样走当天缓存） ─────────────────────────
test('③ 合并池端点：官方赛程命中当天缓存，直连次数不随请求增长', async () => {
  const savedBase = process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  const savedRoot = process.env.OE_MANUAL_ODDS_ROOT;
  process.env.ODDS_SPORTTERY_SCHEDULE_BASE = 'https://schedule.example.invalid/v1/fixtures';
  delete process.env.OE_MANUAL_ODDS_ROOT;
  const stub = stubFetch(schedulePayload());
  try {
    await withServer(async (port) => {
      const r1 = await request(port, 'GET', '/api/sources/merged');
      assert.equal(r1.status, 200);
      assert.equal(r1.body.data.meta.schedule_total, 1);
      assert.equal(stub.calls, 1); // 仅首次直连官方赛程

      const r2 = await request(port, 'GET', '/api/sources/merged');
      assert.equal(r2.body.data.meta.schedule_total, 1);
      assert.equal(stub.calls, 1); // 第二次命中缓存：零直连
    });
  } finally {
    stub.restore();
    if (savedBase !== undefined) process.env.ODDS_SPORTTERY_SCHEDULE_BASE = savedBase;
    else delete process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
    if (savedRoot !== undefined) process.env.OE_MANUAL_ODDS_ROOT = savedRoot;
    else delete process.env.OE_MANUAL_ODDS_ROOT;
  }
});
