// ============================================================================
// 网关 · 密钥轮换生命周期端到端测试
// 模拟生产中的轮换：dia默默重启换 Key 配置，验证「加入新 Key → 宽限期双 Key
// 并存 → 撤销旧 Key」三个阶段在同一个 HTTP 进程下都符合预期，且审计日志记录
// 各次认证成败（auth_ok INFO / auth_rejected WARN）。
//
//   V1（旧）：OE_API_KEYS=old-key        → old 200，new 401
//   V2（宽限）：OE_API_KEYS=old-key,new-key → old 200，new 200
//   V3（收尾）：OE_API_KEYS=new-key + REVOKED=old-key → new 200，old 401（新配置移除）
//     → 撤销列表生效：把已从有效集合移除的 old-key 视为未配置则该轮无断言，
//       因此额外用一个仍在列表但被撤销的 key 断言 403。见下。
//
// 密钥轮换机制 = 多 Key 生命周期管理：新增 Key 先并行宽限、再切换、再撤销回收。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createService } = require('../src');

function request(port, path, extraHeaders) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path, headers: extraHeaders || {} }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, body: raw }); } });
    });
    req.on('error', reject);
    req.end();
  });
}

/** 以给定环境变量启动一个隔离服务，跑完自动关闭。 */
async function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const svc = await createService({ dbPath: ':memory:', http: { port: 0 } });
  const server = svc.server;
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const port = server.address().port;
  try {
    return await fn(port, svc);
  } finally {
    try { server.close(); } catch { /* noop */ }
    svc.close();
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('密钥轮换生命周期：加入新 Key → 宽限期双 Key 并存 → 撤销回收旧 Key', async () => {
  // V1 只含旧 Key：新 Key 未授权
  await withEnv({ OE_API_KEYS: 'old-key' }, async (port) => {
    assert.equal((await request(port, '/api/matches', { 'x-api-key': 'old-key' })).status, 200);
    assert.equal((await request(port, '/api/matches', { 'x-api-key': 'new-key' })).status, 401);
  });

  // V2 加入新 Key：存量调用不受影响（宽限期，新老 Key 同时有效）
  await withEnv({ OE_API_KEYS: 'old-key,new-key' }, async (port) => {
    assert.equal((await request(port, '/api/matches', { 'x-api-key': 'old-key' })).status, 200);
    assert.equal((await request(port, '/api/matches', { 'x-api-key': 'new-key' })).status, 200);
  });

  // V3 收尾：有效集合切换为 new-key + retiring-key；old-key 经轮换淘汰后放入撤销
  // 名单。撤销优先：即便已从有效集合移除，只要仍在 OE_API_KEY_REVOKED 即恒 403
  // （撤销即永久拒绝，符合安全直觉）。
  await withEnv({ OE_API_KEYS: 'new-key,retiring-key', OE_API_KEY_REVOKED: 'old-key' }, async (port) => {
    assert.equal((await request(port, '/api/matches', { 'x-api-key': 'new-key' })).status, 200);
    assert.equal((await request(port, '/api/matches', { 'x-api-key': 'retiring-key' })).status, 200, '在有效集合且未撤销 → 200');
    assert.equal((await request(port, '/api/matches', { 'x-api-key': 'old-key' })).status, 403, '已撤销 → 撤销优先恒 403 forbidden');
  });
});

test('密钥轮换 · 审计落库区分 auth_ok / auth_rejected', async () => {
  await withEnv({ OE_API_KEYS: 'old-key,new-key', OE_API_KEY_REVOKED: 'old-key' }, async (port, svc) => {
    await request(port, '/api/matches', { 'x-api-key': 'new-key' });         // auth_ok
    await request(port, '/api/matches', { 'x-api-key': 'old-key' });         // revoked → auth_rejected(403)
    await request(port, '/api/matches', { 'x-api-key': 'unknown' });         // invalid → auth_rejected(401)
    await request(port, '/api/matches');                                      // missing → auth_rejected(401)

    const entries = svc.getStatus().auditEntries;
    assert.ok(entries >= 4, `应落库 ≥4 条鉴权审计，实际 ${entries}`);
    // 直接查库确认语义正确
    const logs = svc.auditStore.query({ limit: 200 });
    const authLogs = logs.filter((l) => l.service === 'gateway');
    const okCount = authLogs.filter((l) => l.level === 'INFO' && l.message === 'auth_ok').length;
    const rejCount = authLogs.filter((l) => l.level === 'WARN' && l.message === 'auth_rejected').length;
    assert.ok(okCount >= 1, `应至少 1 条 auth_ok，实际 ${okCount}`);
    assert.ok(rejCount >= 3, `应至少 3 条 auth_rejected，实际 ${rejCount}`);
  });
});