// ============================================================================
// HTTP 层 · 集成测试 —— 7 个 REST 端点由真实后端模块驱动
// 覆盖：成功路径 / 404 / CORS 预检 / 异步 review / createService({http}) 集成。
// 服务器监听 127.0.0.1:0（随机端口），避免端口冲突。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createService, resolveHttpPort } = require('../src');
const { createHttpServer } = require('../src/http');

/** 最小 盘口数据.md 样例（结构对齐真实文件，用于端点接入测试）。 */
const SAMPLE_MD = `# 盘口截图数据

## 比赛基础信息

- 赛事：日职联
- 比赛：东京绿茵（中） vs 柏太阳神（用户修正）
- 开赛时间：08-14 18:00
- 数据来源：用户提供截图

## 比赛结果

- 半场比分：1 - 1
- 全场比分：1 - 3
- 总进球：4

## 让球盘数据

（主水 / 盘口 / 客水）
| 机构 | 初盘 | 即盘 |
|---|---|---|
| 澳* | 1.00 / -0.5 / 0.84 | 1.02 / -0.5 / 0.82 |
| 36* | 0.98 / -0.5 / 0.83 | 1.00 / -0.5 / 0.80 |

## 胜平负数据

（主胜 / 平局 / 客胜）
| 机构 | 初盘 | 即盘 |
|---|---|---|
| 澳* | 3.90 / 3.22 / 1.84 | 4.00 / 3.20 / 1.82 |
| 威* | 4.40 / 3.25 / 1.80 | 4.20 / 3.20 / 1.85 |

## 澳门让球详细变化

（主水 / 盘口 / 客水）
| 显示时间 | 状态 | 数据 |
|---|---|---|
| 08-14 17:37 | 即 | 1.02 / -0.5 / 0.82 |
| 08-14 14:43 | 即 | 0.96 / -0.5 / 0.88 |

## 必发交易盈亏

| 结果 | 欧指 | 交易量 | 盈亏 | 冷热指数 |
|---|---|---|---:|---:|---:|
| 胜 | 4.5 | 1,456 | 13,284 | -66 |`;

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

// ───────────────────────── GET /api/sources/manual-odds ─────────────────────────
test('GET /api/sources/manual-odds 在根目录缺失时返回 not_configured', async () => {
  const saved = process.env.OE_MANUAL_ODDS_ROOT;
  delete process.env.OE_MANUAL_ODDS_ROOT;
  try {
    await withServer(async (port) => {
      const r = await request(port, 'GET', '/api/sources/manual-odds');
      assert.equal(r.status, 200);
      assert.equal(r.body.status, 'ok');
      assert.equal(r.body.data.source_id, 'src_manual_odds');
      assert.equal(r.body.data.status, 'not_configured');
      assert.equal(r.body.data.trust_level, 'provisional');
      assert.deepEqual(r.body.data.matches, []);
    });
  } finally {
    if (saved !== undefined) process.env.OE_MANUAL_ODDS_ROOT = saved;
  }
});

test('GET /api/sources/manual-odds 在配置根目录后返回已接入场次', async () => {
  const saved = process.env.OE_MANUAL_ODDS_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oe-http-md-'));
  const sub = path.join(root, 'match-x');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, '盘口数据.md'), SAMPLE_MD, 'utf8');
  process.env.OE_MANUAL_ODDS_ROOT = root;
  try {
    await withServer(async (port) => {
      const r = await request(port, 'GET', '/api/sources/manual-odds');
      assert.equal(r.status, 200);
      assert.equal(r.body.data.status, 'ok');
      assert.equal(r.body.data.meta.total, 1);
      assert.equal(r.body.data.meta.admitted, 1);
      assert.equal(r.body.data.matches[0].home_team, '东京绿茵');
      assert.ok(r.body.data.matches[0].snapshots > 0);
    });
  } finally {
    if (saved !== undefined) process.env.OE_MANUAL_ODDS_ROOT = saved;
    else delete process.env.OE_MANUAL_ODDS_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/manual-odds/analysis/:id 打通 盘口→特征→推理链', async () => {
  const saved = process.env.OE_MANUAL_ODDS_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oe-http-ana-'));
  const sub = path.join(root, 'match-a');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, '盘口数据.md'), SAMPLE_MD, 'utf8');
  process.env.OE_MANUAL_ODDS_ROOT = root;
  try {
    await withServer(async (port) => {
      const id = encodeURIComponent('日职联_东京绿茵_vs_柏太阳神');
      const r = await request(port, 'GET', `/api/manual-odds/analysis/${id}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.source, 'src_manual_odds');
      assert.equal(r.body.data.trust_level, 'provisional');
      assert.ok(r.body.data.snapshots > 0);
      assert.ok(Array.isArray(r.body.data.hits));
      assert.ok(Array.isArray(r.body.data.reasoning));
      assert.ok(r.body.data.arbitration);
      assert.ok('direction' in r.body.data.arbitration);
    });
  } finally {
    if (saved !== undefined) process.env.OE_MANUAL_ODDS_ROOT = saved;
    else delete process.env.OE_MANUAL_ODDS_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/manual-odds/analysis 未配置时返回 503', async () => {
  const saved = process.env.OE_MANUAL_ODDS_ROOT;
  delete process.env.OE_MANUAL_ODDS_ROOT;
  try {
    await withServer(async (port) => {
      const r = await request(port, 'GET', '/api/manual-odds/analysis/M000');
      assert.equal(r.status, 503);
      assert.equal(r.body.error, 'manual_odds_not_configured');
    });
  } finally {
    if (saved !== undefined) process.env.OE_MANUAL_ODDS_ROOT = saved;
  }
});

// ───────────────────────── 其他 / 服务装配 ─────────────────────────
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
  assert.notEqual(port, 3000, 'port 0 应绑定随机端口而非默认 3000');
  assert.equal(svc.getStatus().httpPort, port);
  // 实际可访问
  const r = await request(port, 'GET', '/api/matches');
  assert.equal(r.status, 200);
  await new Promise((resolve) => svc.server.close(resolve));
  svc.close();
});

// 默认端口解析为纯函数（不绑定真实 3000，避免与常驻后端冲突）。
test('createService({http:true}) 无 OE_PORT 时默认解析为 3000', () => {
  const saved = process.env.OE_PORT;
  delete process.env.OE_PORT;
  try {
    assert.equal(resolveHttpPort(true, {}), 3000);
    assert.equal(resolveHttpPort(true, { OE_PORT: '' }), 3000);
    assert.equal(resolveHttpPort(true, { OE_PORT: '0' }), 3000); // OE_PORT='0' 视同未设置，走默认
  } finally {
    if (saved !== undefined) process.env.OE_PORT = saved;
  }
});

// 显式端口（含 0 = 随机）优先；OE_PORT 生效；均不触碰真实绑定。
test('resolveHttpPort 优先级：显式 > OE_PORT > 默认 3000', () => {
  assert.equal(resolveHttpPort(0, {}), 0);
  assert.equal(resolveHttpPort({ port: 0 }, {}), 0);
  assert.equal(resolveHttpPort({ port: 4567 }, {}), 4567);
  assert.equal(resolveHttpPort(true, { OE_PORT: '7890' }), 7890);
  assert.equal(resolveHttpPort(false, {}), 3000); // false → 视同默认
});

// ───────────────────────── 双源合并端点（GET /api/sources/merged）─────────────────────────
test('GET /api/sources/merged 未配置真实源时诚实降级', async () => {
  const savedRoot = process.env.OE_MANUAL_ODDS_ROOT;
  const savedSched = process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  delete process.env.OE_MANUAL_ODDS_ROOT;
  delete process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  try {
    await withServer(async (port) => {
      const r = await request(port, 'GET', '/api/sources/merged');
      assert.equal(r.status, 200);
      assert.equal(r.body.status, 'ok');
      assert.equal(r.body.data.status, 'degraded'); // 无真实源 → 诚实降级
      assert.equal(r.body.data.meta.schedule_total, 0);
      assert.equal(r.body.data.meta.manual_total, 0);
      assert.deepEqual(r.body.data.pool, []);
    });
  } finally {
    if (savedRoot !== undefined) process.env.OE_MANUAL_ODDS_ROOT = savedRoot;
    if (savedSched !== undefined) process.env.ODDS_SPORTTERY_SCHEDULE_BASE = savedSched;
  }
});

test('GET /api/sources/merged 配置本地盘赔后返回 manual_only 场次', async () => {
  const savedRoot = process.env.OE_MANUAL_ODDS_ROOT;
  const savedSched = process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oe-http-mrg-'));
  const sub = path.join(root, 'match-m');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, '盘口数据.md'), SAMPLE_MD, 'utf8');
  process.env.OE_MANUAL_ODDS_ROOT = root;
  delete process.env.ODDS_SPORTTERY_SCHEDULE_BASE; // 无赛程端点 → 仅盘赔
  try {
    await withServer(async (port) => {
      const r = await request(port, 'GET', '/api/sources/merged');
      assert.equal(r.status, 200);
      assert.equal(r.body.data.status, 'ok');
      assert.equal(r.body.data.meta.manual_total, 1);
      assert.equal(r.body.data.meta.manual_only, 1);
      assert.equal(r.body.data.pool.length, 1);
      assert.equal(r.body.data.pool[0].merged, false);
      assert.ok(r.body.data.pool[0].snapshots > 0);
    });
  } finally {
    if (savedRoot !== undefined) process.env.OE_MANUAL_ODDS_ROOT = savedRoot;
    else delete process.env.OE_MANUAL_ODDS_ROOT;
    if (savedSched !== undefined) process.env.ODDS_SPORTTERY_SCHEDULE_BASE = savedSched;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/merged/analysis/:id 在合并池上打通推理链', async () => {
  const savedRoot = process.env.OE_MANUAL_ODDS_ROOT;
  const savedSched = process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oe-http-mga-'));
  const sub = path.join(root, 'match-a');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, '盘口数据.md'), SAMPLE_MD, 'utf8');
  process.env.OE_MANUAL_ODDS_ROOT = root;
  delete process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  try {
    await withServer(async (port) => {
      const id = encodeURIComponent('日职联_东京绿茵_vs_柏太阳神');
      const r = await request(port, 'GET', `/api/merged/analysis/${id}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.source, 'src_merged_pool');
      assert.equal(r.body.data.merged, false); // 无赛程 → manual_only
      assert.ok(r.body.data.snapshots > 0);
      assert.ok(Array.isArray(r.body.data.hits));
      assert.ok(r.body.data.arbitration);
      assert.ok('direction' in r.body.data.arbitration);
    });
  } finally {
    if (savedRoot !== undefined) process.env.OE_MANUAL_ODDS_ROOT = savedRoot;
    else delete process.env.OE_MANUAL_ODDS_ROOT;
    if (savedSched !== undefined) process.env.ODDS_SPORTTERY_SCHEDULE_BASE = savedSched;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/merged/analysis 未配置真实源时返回 404（场次不在池中）', async () => {
  const savedRoot = process.env.OE_MANUAL_ODDS_ROOT;
  const savedSched = process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  delete process.env.OE_MANUAL_ODDS_ROOT;
  delete process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  try {
    await withServer(async (port) => {
      const r = await request(port, 'GET', '/api/merged/analysis/M000');
      assert.equal(r.status, 404);
      assert.equal(r.body.error, 'match_not_found_in_merged_pool');
    });
  } finally {
    if (savedRoot !== undefined) process.env.OE_MANUAL_ODDS_ROOT = savedRoot;
    if (savedSched !== undefined) process.env.ODDS_SPORTTERY_SCHEDULE_BASE = savedSched;
  }
});
