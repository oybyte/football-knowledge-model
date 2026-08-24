// ============================================================================
// 阶段 2.5 · API 客户端 VM 冒烟测试
// 在沙箱中加载 src/api-client/api-client.js，提供原型全局数据 + 假 fetch，
// 验证：mock 适配器六类方法形状正确；模式切换持久化；http 适配器形状一致；
//       getStatus/getApi 正确路由。
// 运行：node prototype-1.0.0/test/api-client.smoke.js
// ============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'api-client', 'api-client.js'), 'utf8');

// ── 假 localStorage ──
function fakeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

// ── 原型全局数据 ──
const MATCHES = [
  { id: 'M007', league: '日职联', home: '东京绿茵', away: '柏太阳神', kickoff: '2026-08-14T18:00:00+08:00' },
];
const RULES = [
  { id: 'R001', conclusion: '升盘降水看好上盘', category: 'odds_change', threshold: 0.6 },
  { id: 'R003', conclusion: '澳盘深让偏下', category: 'institution_diff', threshold: -0.25 },
];
const AI_C = [
  { id: 'C001', pattern: '主水集体下调后临场升盘', source: '挖掘', status: 'pending' },
];

function makeSandbox() {
  const sandbox = {
    localStorage: fakeStorage({}),
    MATCHES, RULES, AI_C,
  };
  sandbox.__DSL = {
    analyze: () => ({
      list: [
        { id: 'R001', hit: true, dir: 1 },
        { id: 'R003', hit: false, dir: -1 },
      ],
    }),
  };
  sandbox.__BACKTEST = {
    THRESHOLDS: { hitRate: 0.55 },
    makeMetrics: () => ({ eligible: 30, metrics: { hitRate: 0.6 }, checks: [] }),
  };
  sandbox.__aiAdopt = (id) => ({ id, verdict: 'approve' });
  sandbox.__aiReject = (id) => ({ id, verdict: 'reject' });
  sandbox.console = console;
  sandbox.Promise = Promise;
  return sandbox;
}

// ① mock 六类方法形状
function testMock() {
  const s = makeSandbox();
  vm.createContext(s);
  vm.runInContext(SRC, s);
  const api = s.__ApiClient;
  assert.ok(api, '__ApiClient 应已挂载');
  assert.equal(api.getMode(), 'mock');

  return (async () => {
    const a = api.getApi();
    assert.equal(a.name, 'mock');

    const matches = await a.listMatches();
    assert.equal(matches.ok, true);
    assert.equal(matches.data[0].match_id, 'M007');
    assert.ok(matches.data[0].home_team, 'home_team 字段应存在');

    const analysis = await a.getAnalysis('M007');
    assert.equal(analysis.ok, true);
    assert.equal(analysis.data.reasoning.length, 2);
    assert.equal(analysis.data.reasoning[0].rule_id, 'R001');
    assert.equal(analysis.data.reasoning[0].hit, true);

    const rules = await a.listRules();
    assert.equal(rules.data.length, 2);
    assert.ok('version' in rules.data[0]);
    assert.ok('status' in rules.data[0]);
    assert.ok('trust_level' in rules.data[0]);

    const versions = await a.getRuleVersions('R001');
    assert.equal(versions.ok, true);
    assert.equal(versions.data[0].version_id, 'R001#1');

    const bt = await a.getBacktest('R001');
    assert.equal(bt.ok, true);
    assert.equal(bt.data.admitted, 30);
    assert.ok(bt.data.thresholds.hitRate === 0.55);

    const cand = await a.listAiCandidates();
    assert.equal(cand.data[0].trust, 'untrusted');

    const rev = await a.reviewAiCandidate('C001', 'approve');
    assert.equal(rev.ok, true);
    assert.equal(rev.data.verdict, 'approve');

    // 模式切换
    assert.equal(api.setMode('real'), 'real');
    assert.equal(api.getMode(), 'real');
    assert.equal(s.localStorage.getItem('oe_api_mode'), 'real');
    assert.equal(api.getStatus().mode, 'real');
    assert.equal(api.getApi().name, 'http');
    return 'mock ok';
  })();
}

// ② http 适配器形状一致（假 fetch）
function testHttp() {
  const s = makeSandbox();
  const calls = [];
  s.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const ok = !/\/missing/.test(url);
    return {
      ok,
      json: () => Promise.resolve(ok ? { ok: true, data: { echo: true, path: url } } : { ok: false, error: 'not_found' }),
    };
  };
  vm.createContext(s);
  vm.runInContext(SRC, s);
  const api = s.__ApiClient;
  api.setMode('real');
  const a = api.getApi();
  assert.equal(a.name, 'http');

  return (async () => {
    const m = await a.listMatches();
    assert.equal(m.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/matches$/);

    const bad = await a.getRuleVersions('missing');
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'not_found');

    const cand = await a.listAiCandidates();
    assert.equal(cand.ok, true);
    const r = await a.reviewAiCandidate('C001', 'reject');
    assert.equal(r.ok, true);
    return 'http ok';
  })();
}

(async () => {
  const [r1, r2] = await Promise.all([testMock(), testHttp()]);
  console.log(r1, '|', r2);
  console.log('API-CLIENT SMOKE PASS');
})().catch((e) => { console.error(e); process.exit(1); });