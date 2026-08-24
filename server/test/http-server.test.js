// ============================================================================
// HTTP 层 · 集成测试 —— 7 个 REST 端点由真实后端模块驱动
// 覆盖：成功路径 / 404 / CORS 预检 / 异步 review / createService({http}) 集成。
// 服务器监听 127.0.0.1:0（随机端口），避免端口冲突。
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
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 启动一个隔离服务 + 服务器，跑完自动关闭。 */
async function withServer(fn) {
  const svc = createService({ dbPath: ':memory:' });
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

// ───────────────────────── GET /api/matches ─────────────────────────
test('GET /api/matches 返回全部 mock 场次', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/matches');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.ok(Array.isArray(r.body.data));
    assert.ok(r.body.data.some((m) => m.match_id === 'M001'));
    assert.ok(r.body.data.every((m) => m.match_id && m.league && m.kickoff));
  });
});

// ───────────────────────── GET /api/analysis/:id ─────────────────────────
test('GET /api/analysis/M001 返回完整推理链', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/analysis/M001');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    const d = r.body.data;
    assert.equal(d.match_id, 'M001');
    assert.ok(Array.isArray(d.hits));
    assert.ok(d.hits.length > 0, 'M001 应命中规则（特征快照须以扁平对象传入）');
    assert.ok(Array.isArray(d.reasoning));
    assert.ok(d.arbitration && typeof d.arbitration.direction !== 'undefined');
    assert.ok(d.prediction && d.prediction.final_direction, 'M001 应产出可判定预测');
  });
});

test('GET /api/analysis/NOPE 返回 404 match_not_found', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/analysis/NOPE');
    assert.equal(r.status, 404);
    assert.equal(r.body.status, 'error');
    assert.equal(r.body.error, 'match_not_found');
  });
});

// ───────────────────────── GET /api/rules ─────────────────────────
test('GET /api/rules 返回活跃规则', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/rules');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.ok(Array.isArray(r.body.data));
    assert.ok(r.body.data.length > 0);
    assert.ok(r.body.data.every((v) => v.rule_id && v.status === 'active'));
  });
});

// ───────────────────────── GET /api/rules/:id/versions ─────────────────────────
test('GET /api/rules/R001/versions 返回版本链', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/rules/R001/versions');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.ok(Array.isArray(r.body.data));
    assert.ok(r.body.data.length >= 1);
    assert.equal(r.body.data[0].rule_id, 'R001');
  });
});

test('GET /api/rules/NOPE/versions 返回 404 rule_not_found', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/rules/NOPE/versions');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'rule_not_found');
  });
});

// ───────────────────────── GET /api/backtest/:id ─────────────────────────
test('GET /api/backtest/R001 返回回测作业与指标', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/backtest/R001');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    const d = r.body.data;
    assert.ok(d.job_id);
    assert.ok(d.metrics && typeof d.metrics.sample_size === 'number');
    assert.ok(d.thresholds && typeof d.thresholds.hit_rate === 'number');
    assert.equal(d.synthetic, true);
  });
});

test('GET /api/backtest/NOPE 返回 404 rule_not_found', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/backtest/NOPE');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'rule_not_found');
  });
});

// ───────────────────────── GET /api/ai/candidates ─────────────────────────
test('GET /api/ai/candidates 返回 untrusted 候选', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/ai/candidates');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    const d = r.body.data;
    assert.ok(Array.isArray(d.candidates));
    assert.equal(d.synthetic, true);
    assert.ok(d.candidates.length > 0);
    assert.ok(d.candidates.every((c) => c.trust === 'untrusted'));
  });
});

// ───────────────────────── POST /api/ai/candidates/:id/review ─────────────────────────
test('POST review approve 将候选转正为 proposed', async () => {
  await withServer(async (port) => {
    const list = await request(port, 'GET', '/api/ai/candidates');
    const candidate = list.body.data.candidates[0];
    const r = await request(port, 'POST', `/api/ai/candidates/${candidate.id}/review`, { verdict: 'approve' });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.equal(r.body.data.rule_id, candidate.id);
    assert.equal(r.body.data.status, 'proposed');
    assert.ok(r.body.data.version_id);
  });
});

test('POST review 非法 verdict 返回 400', async () => {
  await withServer(async (port) => {
    const list = await request(port, 'GET', '/api/ai/candidates');
    const candidate = list.body.data.candidates[0];
    const r = await request(port, 'POST', `/api/ai/candidates/${candidate.id}/review`, { verdict: 'maybe' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_verdict');
  });
});

test('POST review 未知候选返回 404', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'POST', '/api/ai/candidates/NOPE/review', { verdict: 'approve' });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'candidate_not_found');
  });
});

// ───────────────────────── 404 / CORS ─────────────────────────
test('未知路径返回 404 not_found', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/unknown');
    assert.equal(r.status, 404);
    assert.equal(r.body.status, 'error');
    assert.equal(r.body.error, 'not_found');
  });
});

test('OPTIONS 预检返回 204 + CORS 头', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'OPTIONS', '/api/rules');
    assert.equal(r.status, 204);
    assert.equal(r.headers['access-control-allow-origin'], '*');
    assert.ok(r.headers['access-control-allow-methods'].includes('POST'));
  });
});

test('正常响应携带 CORS 头', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/matches');
    assert.equal(r.headers['access-control-allow-origin'], '*');
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
  });
});

// ───────────────────────── createService({http}) 集成 ─────────────────────────
test('createService({http}) 启动服务器并优雅关闭', async () => {
  const svc = createService({ dbPath: ':memory:', http: { port: 0 } });
  assert.ok(svc.server, '应创建 server');
  await new Promise((resolve) => svc.server.once('listening', resolve));
  const port = svc.server.address().port;
  assert.equal(svc.getStatus().httpPort, port);
  // 实际可访问
  const r = await request(port, 'GET', '/api/matches');
  assert.equal(r.status, 200);
  await new Promise((resolve) => svc.server.close(resolve));
  svc.close();
});
