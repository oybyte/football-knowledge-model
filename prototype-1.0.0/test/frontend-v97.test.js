// ============================================================================
// 前端契约 · v97 块贯通测试
// 启动真实后端（真实 DB：含今天录入场次 2041244），在 VM 中加载 api-client
// http 适配器，验证 getMergedAnalysis 返回数据携带 v97 块（命中规则 E14/S25），
// 即「前端 API 层 → 合并分析 → v97 真规则求值」链路贯通，供 UI 渲染消费。
// 运行：node prototype-1.0.0/test/frontend-v97.test.js
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createService } = require('../../server/src');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'api-client', 'api-client.js'), 'utf8');

function fakeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

async function boot() {
  const dbPath = path.join(__dirname, '..', '..', 'server', 'data', 'odds-edge.db');
  process.env.OE_SPORTTERY_ANCHOR = 'odds';
  process.env.OE_MANUAL_ODDS_ROOT = 'F:/ocr_python_data/FootballScreenshotOcr/output';
  const service = await createService({ dbPath, http: { port: 0 } });
  await new Promise((r) => service.server.once('listening', r));
  return service;
}

test('frontend http 适配器：getMergedAnalysis 返回 v97 块（今天场次 2041244）', { timeout: 30000 }, async () => {
  const service = await boot();
  try {
    const port = service.server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const sandbox = {
      localStorage: fakeStorage({ oe_api_mode: 'real', oe_api_base: base }),
      fetch: global.fetch,
      console,
      Promise,
    };
    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox);
    const api = sandbox.__ApiClient.getApi();
    assert.equal(api.name, 'http');

    const r = await api.getMergedAnalysis('2041244');
    assert.equal(r.ok, true, '合并分析请求应成功');
    assert.equal(r.data.merged, true, '期号锚定场次应 merged=true');
    assert.equal(r.data.anchor_source, 'odds');
    assert.ok(r.data.v97, '响应应携带 v97 块');
    assert.equal(r.data.v97.rule_count, 88, '88 条规则全部求值');
    assert.ok(Array.isArray(r.data.v97.fields) && r.data.v97.fields.length >= 12, '字段信封 ≥12');

    const hitIds = r.data.v97.rules.filter((x) => x.status === 'hit').map((x) => x.rule_id);
    assert.ok(hitIds.includes('E14'), 'E14 共振前置应命中');
    assert.ok(hitIds.includes('S25'), 'S25 总进球信号应命中');
    const s25 = r.data.v97.rules.find((x) => x.rule_id === 'S25');
    assert.ok(s25.dimensions.total_goals_signal, 'S25 应输出 total_goals_signal 维度');
  } finally {
    await new Promise((r) => service.server.close(r));
    service.close();
  }
});
