// ============================================================================
// API 网关 · TLS 终止测试
// 覆盖：自签证书生成器产出合法 X.509 v3 且自签校验通过；createHttpServer 配
// 证书/私钥即启动 HTTPS（真实 https 请求往返）；createService 装配后
// getStatus().scheme === 'https'；缺一对证书/私钥 → 快速失败抛 tls_misconfigured。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { X509Certificate } = require('node:crypto');

const { selfSigned } = require('./helpers/selfsigned');
const { createHttpServer } = require('../src/http');
const { createService } = require('../src');

// 生成一次性证书/私钥文件，返回 { cert, key, dir }
function writeTlsFiles() {
  const { certPem, keyPem } = selfSigned();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oe-tls-'));
  const cert = path.join(dir, 'cert.pem');
  const key = path.join(dir, 'key.pem');
  fs.writeFileSync(cert, certPem);
  fs.writeFileSync(key, keyPem);
  return { cert, key, dir };
}
function httpsGet(port, p) {
  return new Promise((resolve, reject) => {
    https.request({ host: '127.0.0.1', port, path: p, rejectUnauthorized: false, servername: 'localhost' }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject).end();
  });
}

test('自签证书生成器 · 产出合法 X.509 v3 且自签校验通过', () => {
  const { certPem, keyPem } = selfSigned();
  const x = new X509Certificate(certPem);
  assert.match(x.subject, /CN=odds-edge-selfsigned/);
  assert.equal(x.issuer, x.subject, '自签签发者=主体');
  assert.equal(x.verify(crypto.createPublicKey({ key: certPem, format: 'pem' })), true, '自签名校验通过');
  assert.match(keyPem, /BEGIN PRIVATE KEY/);
  // SAN 含 localhost
  assert.match(x.subjectAltName, /localhost/);
});

test('createHttpServer · 提供证书/私钥即启动 HTTPS，真实 https 往返', async (t) => {
  const files = writeTlsFiles();
  t.after(() => fs.rmSync(files.dir, { recursive: true, force: true }));

  const svc = { auditStore: null, getStatus() { return {}; } };
  const server = createHttpServer(svc, { tlsCertificate: files.cert, tlsKey: files.key });
  assert.equal(server.constructor.name, 'Server', '应返回 node:https 服务器');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const { port } = server.address();

  const res = await httpsGet(port, '/api/health');
  assert.equal(res.status, 200);
  assert.ok(JSON.parse(res.body).status === 'ok');
});

test('createService · 装配 TLS 后 getStatus().scheme === https', async (t) => {
  const files = writeTlsFiles();
  t.after(() => fs.rmSync(files.dir, { recursive: true, force: true }));

  const svc = await createService({
    dbPath: ':memory:',
    http: { port: 0, tlsCertificate: files.cert, tlsKey: files.key },
  });
  const server = svc.server;
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  t.after(() => { try { server.close(); } catch { /* noop */ } svc.close(); });
  const { port } = server.address();

  assert.equal(svc.getStatus().scheme, 'https');
  const res = await httpsGet(port, '/api/health');
  assert.equal(res.status, 200);
});

test('createHttpServer · 只给证书缺私钥 → 快速失败抛 tls_misconfigured', () => {
  const files = writeTlsFiles();
  fs.rmSync(files.dir, { recursive: true, force: true });
  const svc = { auditStore: null, getStatus() { return {}; } };
  assert.throws(() => createHttpServer(svc, { tlsCertificate: '/nope/cert.pem' }), /tls_misconfigured/);
  assert.throws(() => createHttpServer(svc, { tlsCertificate: '/nope/cert.pem', tlsKey: '/nope/key.pem' }), /tls_misconfigured/);
});