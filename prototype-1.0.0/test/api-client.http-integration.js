// ============================================================================
// 阶段 2.5 · API 客户端 ↔ 本地服务 联调测试
// 启动真实后端（createService + http，随机端口），在 VM 中加载 api-client.js，
// 以 real 模式（http 适配器 + Node 原生 fetch）端到端验证 7 类能力契约归一化。
// 运行：node prototype-1.0.0/test/api-client.http-integration.js
// ============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createService } = require('../../server/src');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'api-client', 'api-client.js'), 'utf8');

function fakeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

(async () => {
  const service = await createService({ dbPath: ':memory:', http: { port: 0 } });
  await new Promise((r) => service.server.once('listening', r));
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
  const api = sandbox.__ApiClient;
  assert.equal(api.getMode(), 'real');
  const a = api.getApi();
  assert.equal(a.name, 'http');

  // ① 比赛列表
  const matches = await a.listMatches();
  assert.equal(matches.ok, true, 'listMatches 应成功');
  assert.ok(matches.data.some((m) => m.match_id === 'M001'), '应含 M001');

  // ② 分析推理链（归一化后含 hit/dir/note）
  // 注：V9.7 接入后 mock M001 场次的旧 DSL 推理链为空属预期（现役规则 atoms 不喂 DSL）；
  // 真规则求值经合并池 /api/merged/analysis 的 v97 块验证（见 frontend-v97.test.js）。
  const analysis = await a.getAnalysis('M001');
  assert.equal(analysis.ok, true, 'getAnalysis 应成功');
  assert.ok(Array.isArray(analysis.data.reasoning), '推理链应为数组');
  assert.ok('arbitration' in analysis.data, '应含仲裁结果');

  // ③ 规则库（rule_id → id 归一化）
  const rules = await a.listRules();
  assert.equal(rules.ok, true);
  assert.ok(rules.data.length > 0);
  assert.ok('id' in rules.data[0], 'http 规则应归一化为 id');
  assert.equal(rules.data[0].status, 'active');

  // ④ 规则版本链（V9.7 真规则 id 为 R01/R13…，非旧原型 R001）
  const versions = await a.getRuleVersions('R01');
  assert.equal(versions.ok, true);
  assert.ok(versions.data.length >= 1);
  assert.equal(versions.data[0].rule_id, 'R01');

  // ⑤ 回测（sample_size → admitted 归一化）
  const bt = await a.getBacktest('R01');
  assert.equal(bt.ok, true);
  assert.ok(typeof bt.data.admitted === 'number', '回测应归一化为 admitted');
  assert.ok(bt.data.thresholds && typeof bt.data.thresholds.hit_rate === 'number');

  // ⑥ AI 候选（candidates 数组 → 视图契约）
  const cand = await a.listAiCandidates();
  assert.equal(cand.ok, true);
  assert.ok(Array.isArray(cand.data), 'AI 候选应归一化为数组');
  assert.ok(cand.data.length > 0, '应至少 1 个候选');
  assert.equal(cand.data[0].trust, 'untrusted');
  assert.ok('id' in cand.data[0]);

  // ⑦ 审核：采纳 → proposed；再驳回另一候选
  const first = cand.data[0];
  const rev = await a.reviewAiCandidate(first.id, 'approve');
  assert.equal(rev.ok, true, '采纳应成功');
  assert.equal(rev.data.status, 'proposed');

  const cand2 = await a.listAiCandidates();
  const second = cand2.data[0];
  const rej = await a.reviewAiCandidate(second.id, 'reject');
  assert.equal(rej.ok, true, '驳回应成功');

  // ⑧ 404 → errBody
  const bad = await a.getRuleVersions('NOPE');
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'rule_not_found');

  console.log(`HTTP INTEGRATION PASS · base=${base} · matches=${matches.data.length} rules=${rules.data.length} ai=${cand.data.length}`);
  await new Promise((r) => service.server.close(r));
  service.close();
})().catch((e) => { console.error(e); process.exit(1); });
