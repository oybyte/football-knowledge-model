// ============================================================================
// API 网关 · 生产部署形态合并冒烟测试
// 单进程同时启用：HTTPS（自签 TLS）+ 鉴权（API Key）+ Redis 共享限流
// （真实 RESP + OE_RATE_LIMIT_STORE=redis）。跨真实 TLS 套接字逐项断言：
//   /api/health 200（免鉴权）→ /api/matches 缺 Key 401 → 带 Key 200 →
//   超出 Redis 共享限流额度 429（证明 HTTPS 上鉴权+限流并存生效）。
// getStatus() 确认 scheme / infra.backend / infra.rateLimit 三者同时为生产形态。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

const { createService } = require('../src');
const { MinimalRedisServer } = require('./helpers/resp-server');
const { selfSigned } = require('./helpers/selfsigned');

function writeTls() {
  const { certPem, keyPem } = selfSigned();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oe-deploy-'));
  fs.writeFileSync(path.join(dir, 'cert.pem'), certPem);
  fs.writeFileSync(path.join(dir, 'key.pem'), keyPem);
  return { cert: path.join(dir, 'cert.pem'), key: path.join(dir, 'key.pem'), dir };
}
function httpsReq(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    https.request({
      host: '127.0.0.1', port, path: p, method: 'GET',
      rejectUnauthorized: false, servername: 'localhost', headers,
    }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    }).on('error', reject).end();
  });
}

test('生产部署形态：HTTPS + 鉴权 + Redis 共享限流同进程生效（真实 RESP）', async (t) => {
  const savedStore = process.env.OE_RATE_LIMIT_STORE;
  const savedMax = process.env.OE_RATE_LIMIT_MAX;
  process.env.OE_RATE_LIMIT_STORE = 'redis';
  process.env.OE_RATE_LIMIT_MAX = '3'; // 4 步流程：health/401/200 各占 1 次，第 4 次 → 429

  const files = writeTls();
  t.after(() => fs.rmSync(files.dir, { recursive: true, force: true }));
  const resp = new MinimalRedisServer();
  const rPort = await resp.listen();
  t.after(() => resp.close());

  const svc = await createService({
    dbPath: ':memory:',
    http: { port: 0, apiKey: 'prod-key', tlsCertificate: files.cert, tlsKey: files.key },
    redisUrl: `redis://127.0.0.1:${rPort}`,
  });
  const server = svc.server;
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const { port } = server.address();
  t.after(() => { try { server.close(); } catch { /* noop */ } svc.close(); });

  try {
    // 1) 生产形态状态综合确认
    const st = svc.getStatus();
    assert.equal(st.scheme, 'https');
    assert.equal(st.infra.backend, 'redis', '缓存/队列/锁走 Redis');
    assert.equal(st.infra.rateLimit, 'redis', '限流为 Redis 共享后端');

    // 2) health 免鉴权 → 200
    const h = await httpsReq(port, '/api/health');
    assert.equal(h.status, 200);
    assert.equal(h.body.status, 'ok');

    // 3) 缺 Key → 401
    const noKey = await httpsReq(port, '/api/matches');
    assert.equal(noKey.status, 401);

    // 4) 带 Key → 200（鉴权放行；这是同 IP 第 3 次，仍 ≤ max）
    const ok = await httpsReq(port, '/api/matches', { 'x-api-key': 'prod-key' });
    assert.equal(ok.status, 200);

    // 5) 同 IP 第 4 次 → 429（Redis 共享限流在 HTTPS 上生效）
    const limited = await httpsReq(port, '/api/matches', { 'x-api-key': 'prod-key' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
  } finally {
    if (savedStore === undefined) delete process.env.OE_RATE_LIMIT_STORE;
    else process.env.OE_RATE_LIMIT_STORE = savedStore;
    if (savedMax === undefined) delete process.env.OE_RATE_LIMIT_MAX;
    else process.env.OE_RATE_LIMIT_MAX = savedMax;
  }
});