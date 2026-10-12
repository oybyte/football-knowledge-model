// ============================================================================
// HTTP 层 · 集成测试 —— 7 个 REST 端点由真实后端模块驱动
// 覆盖：成功路径 / 404 / CORS 预检 / 异步 review / createService({http}) 集成。
// 服务器监听 127.0.0.1:0（随机端口），避免端口冲突。
// ============================================================================
'use strict';

// 规则源夹具（2026-10-10）：测试自带一份 V9.7 注册表，不依赖仓库外绝对路径。
// 生产默认走 server/config/registry-empty（空注册表——规则体系已停用）；
// 但 loader → migrate → store → HTTP 呈现 这条管线仍需真规则源来回归，夹具提供 88 条。
// 必须在 require('../src/...') 之前设置：v97loader 在调用时读 env。
process.env.OE_V97_REGISTRY_DIR = require('node:path').join(__dirname, 'fixtures', 'v97-registry');

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createService, resolveHttpPort } = require('../src');
const { createHttpServer } = require('../src/http');
const { MinimalRedisServer } = require('./helpers/resp-server');

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
function request(port, method, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(extraHeaders || {}),
      },
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
    assert.ok(Array.isArray(d.reasoning));
    // 仲裁结构始终存在（无命中时为空仲裁 direction=null）。
    // 注：V9.7 真规则的引擎消费（atoms→effects 求值）属 Phase 2，Phase 1 仅完成入库与门禁，
    // 故此处不要求 hits.length>0 或 prediction.final_direction。
    assert.ok(d.arbitration && typeof d.arbitration.direction !== 'undefined');
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
test('GET /api/rules/R01/versions 返回版本链', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/rules/R01/versions');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.ok(Array.isArray(r.body.data));
    assert.ok(r.body.data.length >= 1);
    assert.equal(r.body.data[0].rule_id, 'R01');
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
test('GET /api/backtest/R01 返回回测作业与指标', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/backtest/R01');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    const d = r.body.data;
    assert.ok(d.job_id);
    assert.ok(d.metrics && typeof d.metrics.sample_size === 'number');
    assert.ok(d.thresholds && typeof d.thresholds.hit_rate === 'number');
    assert.equal(d.synthetic, true);
    // 新增：真实区间 / V9.7 短名 / 未提供字段显式回 null（前端据此标注「未提供」）
    assert.ok(d.date_range && d.date_range.from && d.date_range.to);
    assert.ok(d.rule_name, '应携带 V9.7 规则短名');
    assert.ok(d.rule_version != null);
    assert.equal(d.admission_detail, null);
    assert.equal(d.untrusted_count, null);
    assert.ok('v97_real' in d);
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

// ───────────────────────── GET /api/rules（V9.7 真规则视图）─────────────────────────
test('GET /api/rules 携带 V9.7 短名 / 分类 / 声明方向语义（瘦视图，不含 v97 大对象）', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/rules');
    assert.equal(r.status, 200);
    const d = r.body.data;
    assert.ok(d.length >= 80, 'V9.7 规则应完整下发');
    assert.ok(d.every((v) => 'name' in v && 'declared_direction' in v && 'evidence_count' in v && 'rule_type' in v), '应含新增归一化字段');
    assert.ok(d.every((v) => !('v97' in v)), '瘦视图不应携带 v97 大对象');
    const r01 = d.find((v) => v.rule_id === 'R01');
    assert.equal(r01.name, '凯利0.05平权判定标准');
    assert.equal(r01.rule_type, 'R');
    assert.equal(r01.category, '盘性');
    assert.equal(r01.status, 'active');
    // E01 声明了 direction 语义（文本，不是上盘/下盘）
    const e01 = d.find((v) => v.rule_id === 'E01');
    assert.ok(e01.declared_direction && e01.declared_direction.includes('E01'), '声明方向语义应原样取自 v97.effects');
  });
});

test('GET /api/rules/:id/versions 返回瘦版本视图（保留版本链字段）', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/rules/R01/versions');
    assert.equal(r.status, 200);
    const v = r.body.data[0];
    assert.equal(v.rule_id, 'R01');
    assert.ok(v.version_id);
    assert.ok('previous_version_id' in v);
    assert.ok(!('v97' in v), '版本瘦视图不应携带 v97');
  });
});

// ───────────────────────── GET /api/features/:id（单场特征薄端点）─────────────────────────
test('GET /api/features/:id 在合并池上返回特征快照（未产出字段不补零）', async () => {
  const savedRoot = process.env.OE_MANUAL_ODDS_ROOT;
  const savedSched = process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oe-http-feat-'));
  const sub = path.join(root, 'match-f');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, '盘口数据.md'), SAMPLE_MD, 'utf8');
  process.env.OE_MANUAL_ODDS_ROOT = root;
  delete process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  try {
    await withServer(async (port) => {
      const id = encodeURIComponent('日职联_东京绿茵_vs_柏太阳神');
      const r = await request(port, 'GET', `/api/features/${id}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.status, 'ok');
      const d = r.body.data;
      assert.equal(d.match_id, '日职联_东京绿茵_vs_柏太阳神');
      assert.ok(d.features && typeof d.features === 'object');
      // 注册表点分扁平键：有数据的字段必须存在
      assert.ok('institution.diff_max' in d.features, '横截面盘口离散应产出');
      assert.ok('move_pattern' in d.features, '时序形态应产出');
      assert.ok('betfair.turnover' in d.features, '必发成交额应产出');
      // 后端未产出的字段不得出现（前端据此标注未产出，绝不补零）
      assert.ok(!('betfair.heat_min' in d.features), '未产出字段不应补零/补 null');
      assert.ok(!('onex.kelly_home_min' in d.features), '未产出字段不应出现');
      // 快照元信息
      assert.ok(d.meta && d.meta.snapshot_count > 0);
      assert.ok(Array.isArray(d.meta.sources));
      assert.equal(d.trust_level, 'provisional');
      assert.ok(d.computed_at);
      assert.ok(d.feature_version);
    });
  } finally {
    if (savedRoot !== undefined) process.env.OE_MANUAL_ODDS_ROOT = savedRoot;
    else delete process.env.OE_MANUAL_ODDS_ROOT;
    if (savedSched !== undefined) process.env.ODDS_SPORTTERY_SCHEDULE_BASE = savedSched;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/features 未配置真实源时返回 404（不返回空特征冒充）', async () => {
  const savedRoot = process.env.OE_MANUAL_ODDS_ROOT;
  const savedSched = process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  delete process.env.OE_MANUAL_ODDS_ROOT;
  delete process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  try {
    await withServer(async (port) => {
      const r = await request(port, 'GET', '/api/features/M000');
      assert.equal(r.status, 404);
      assert.equal(r.body.status, 'error');
      assert.equal(r.body.error, 'match_not_found_in_merged_pool');
    });
  } finally {
    if (savedRoot !== undefined) process.env.OE_MANUAL_ODDS_ROOT = savedRoot;
    if (savedSched !== undefined) process.env.ODDS_SPORTTERY_SCHEDULE_BASE = savedSched;
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

// ───────────────────────── 网关鉴权集成（http 层）─────────────────────────
/** 带鉴权配置启动隔离服务器；env 为临时环境变量（结束后恢复）。 */
async function withAuthServer(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const svc = await createService({ dbPath: ':memory:', http: { port: 0 } });
  const server = svc.server;
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const port = server.address().port;
  try {
    await fn(port, svc);
  } finally {
    await new Promise((r) => server.close(r));
    svc.close();
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('鉴权 · 配置 OE_API_KEY 后无 Key 请求返回 401', async () => {
  await withAuthServer({ OE_API_KEY: 'gw-key-1' }, async (port) => {
    const r = await request(port, 'GET', '/api/matches');
    assert.equal(r.status, 401);
    assert.equal(r.body.status, 'error');
    assert.equal(r.body.error, 'unauthorized');
  });
});

test('鉴权 · 配置 OE_API_KEY 后错误 Key 返回 401', async () => {
  await withAuthServer({ OE_API_KEY: 'gw-key-1' }, async (port) => {
    const r = await request(port, 'GET', '/api/matches', null, { 'X-Api-Key': 'wrong' });
    assert.equal(r.status, 401);
  });
});

test('鉴权 · 正确 Key（Header）通过并返回数据', async () => {
  await withAuthServer({ OE_API_KEY: 'gw-key-1' }, async (port) => {
    const r = await request(port, 'GET', '/api/matches', null, { 'X-Api-Key': 'gw-key-1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
  });
});

test('鉴权 · 正确 Key（Query）通过', async () => {
  await withAuthServer({ OE_API_KEY: 'gw-key-1' }, async (port) => {
    const r = await request(port, 'GET', '/api/matches?api_key=gw-key-1');
    assert.equal(r.status, 200);
  });
});

test('鉴权 · 多 Key（OE_API_KEYS）任一有效 Key 通过', async () => {
  await withAuthServer({ OE_API_KEYS: 'gw-a, gw-b' }, async (port) => {
    const ra = await request(port, 'GET', '/api/matches', null, { 'X-Api-Key': 'gw-a' });
    assert.equal(ra.status, 200);
    const rb = await request(port, 'GET', '/api/matches', null, { 'X-Api-Key': 'gw-b' });
    assert.equal(rb.status, 200);
  });
});

test('鉴权 · 撤销 Key（OE_API_KEY_REVOKED）返回 403 forbidden', async () => {
  await withAuthServer({ OE_API_KEYS: 'gw-a, gw-b', OE_API_KEY_REVOKED: 'gw-b' }, async (port) => {
    const rb = await request(port, 'GET', '/api/matches', null, { 'X-Api-Key': 'gw-b' });
    assert.equal(rb.status, 403);
    assert.equal(rb.body.error, 'forbidden');
    const ra = await request(port, 'GET', '/api/matches', null, { 'X-Api-Key': 'gw-a' });
    assert.equal(ra.status, 200);
  });
});

test('鉴权 · health/metrics 跳过鉴权（无 Key 可访问）', async () => {
  await withAuthServer({ OE_API_KEY: 'gw-key-1' }, async (port) => {
    const h = await request(port, 'GET', '/api/health');
    assert.equal(h.status, 200);
    assert.equal(h.body.status, 'ok');
    const m = await request(port, 'GET', '/api/metrics');
    assert.equal(m.status, 200);
    assert.ok(m.raw.includes('uptime_seconds'));
  });
});

test('鉴权 · 失败/成功请求写入审计落库（auditStore）', async () => {
  await withAuthServer({ OE_API_KEY: 'gw-key-1' }, async (port, svc) => {
    await request(port, 'GET', '/api/matches'); // 无 Key → 401
    await request(port, 'GET', '/api/matches', null, { 'X-Api-Key': 'gw-key-1' }); // 成功
    const entries = svc.auditStore.query({ limit: 20 });
    const rejected = entries.filter((e) => e.message === 'auth_rejected');
    const ok = entries.filter((e) => e.message === 'auth_ok');
    assert.ok(rejected.length >= 1, '应有 auth_rejected 审计');
    assert.equal(rejected[0].status, 401);
    assert.equal(rejected[0].service, 'gateway');
    assert.ok(ok.length >= 1, '应有 auth_ok 审计');
  });
});

test('限流 · OE_RATE_LIMIT_MAX 超限返回 429 + Retry-After', async () => {
  await withAuthServer({ OE_RATE_LIMIT_MAX: '2' }, async (port) => {
    const r1 = await request(port, 'GET', '/api/matches');
    const r2 = await request(port, 'GET', '/api/matches');
    const r3 = await request(port, 'GET', '/api/matches');
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
    assert.equal(r3.body.error, 'rate_limited');
    assert.ok(Number(r3.headers['retry-after']) >= 1);
  });
});

test('限流 · OE_RATE_LIMIT_STORE=redis 走 Redis 共享计数（真实 RESP）', async (t) => {
  const savedStore = process.env.OE_RATE_LIMIT_STORE;
  const savedMax = process.env.OE_RATE_LIMIT_MAX;
  const resp = new MinimalRedisServer();
  const port = await resp.listen();
  t.after(() => resp.close());
  process.env.OE_RATE_LIMIT_STORE = 'redis';
  process.env.OE_RATE_LIMIT_MAX = '2';
  const svc = await createService({ dbPath: ':memory:', http: { port: 0 }, redisUrl: `redis://127.0.0.1:${port}` });
  const server = svc.server;
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const sPort = server.address().port;
  try {
    assert.equal(svc.getStatus().infra.rateLimit, 'redis', 'infra 应上报 redis 限流后端');
    assert.equal(svc.getStatus().infra.backend, 'redis', 'Redis 已接线');
    const r1 = await request(sPort, 'GET', '/api/matches');
    const r2 = await request(sPort, 'GET', '/api/matches');
    const r3 = await request(sPort, 'GET', '/api/matches');
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
    assert.equal(r3.body.error, 'rate_limited');
    assert.ok(Number(r3.headers['retry-after']) >= 1);
  } finally {
    await new Promise((r) => server.close(r));
    svc.close();
    if (savedStore === undefined) delete process.env.OE_RATE_LIMIT_STORE;
    else process.env.OE_RATE_LIMIT_STORE = savedStore;
    if (savedMax === undefined) delete process.env.OE_RATE_LIMIT_MAX;
    else process.env.OE_RATE_LIMIT_MAX = savedMax;
  }
});

// ───────────────────────── createService({http}) 集成 ─────────────────────────
test('createService({http}) 启动服务器并优雅关闭', async () => {
  const svc = await createService({ dbPath: ':memory:', http: { port: 0 } });
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
      // 溯源键必须透出（2026-10-12 新增）：顶层 match_id 会被官方接管，不留这两个键就无法
      // 回答「这条来自哪场人工盘赔、靠什么锚定上的」。未对齐时 align_via 诚实为 null。
      assert.equal(r.body.data.pool[0].align_via, null);
      assert.ok(r.body.data.pool[0].manual_match_id, 'manual_match_id 应透出以便溯源');
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
