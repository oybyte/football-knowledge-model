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
  { id: 'R001', name: '升盘降水', conclusion: '升盘降水看好上盘', category: 'odds_change', direction: 1, threshold: 0.6 },
  { id: 'R003', name: '澳盘深让', conclusion: '澳盘深让偏下', category: 'institution_diff', direction: -1, threshold: -0.25 },
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
  // 原型 features.js 的 computeFeatures（族嵌套输出）——mock getFeature 复用
  sandbox.computeFeatures = () => ({
    cross: { handicap_dispersion: 0.25, home_water_dispersion: 0.06 },
    temp: { move_pattern: '升盘降水' },
    reso: {}, anom: {}, onex: {}, betfair: {},
  });
  // 与 backtest.js 真实 __BACKTEST 同形：makeMetrics 产出全部指标 + evalBt 判门禁
  sandbox.__BACKTEST = {
    THRESHOLDS: { hitRate: 0.55, hit_rate: { op: '>=', value: 0.55 } },
    makeMetrics: () => ({
      eligible: 30, untrusted: 4, direction: 28, hitCount: 17,
      hitRate: 0.607, roi: 0.081, maxDD: 0.09, league: 3,
      leagueNames: ['日职联', '韩K联', '挪超'], timeStab: 0.012,
      trend: [0.55, 0.62, 0.58, 0.66], trendLabels: ['25Q3', '25Q4', '26Q1', '26Q2'],
      failDist: { temporal_integrity: 0, receipt_consistency: 1, result_available: 2, snapshot_complete: 1, rule_active_at_trigger: 0 },
      checks: [],
    }),
    evalBt: () => ({ adjudication: 'validated', pass: true }),
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
  // 默认真实数据（DEFAULT_MODE=real，已切真实数据开发）；本用例显式切 mock 验证离线适配器
  assert.equal(api.getMode(), 'real');
  assert.equal(api.setMode('mock'), 'mock');

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
    // 归一化新增字段：声明方向语义（mock 由数值 direction 归一化）
    assert.equal(rules.data[0].declared_direction, '上盘');
    assert.ok('evidence_count' in rules.data[0]);
    assert.ok('valid_from' in rules.data[0]);

    const versions = await a.getRuleVersions('R001');
    assert.equal(versions.ok, true);
    assert.equal(versions.data[0].version_id, 'R001#1');
    assert.ok('declared_direction' in versions.data[0]);

    // getFeature（mock）：族嵌套结构 + 元信息
    const feat = await a.getFeature('M007');
    assert.equal(feat.ok, true);
    assert.equal(feat.data.match_id, 'M007');
    assert.equal(feat.data.features.cross.handicap_dispersion, 0.25);
    assert.equal(feat.data.feature_version, 'mock');
    assert.equal(feat.data.meta.sources[0], 'mock');

    // 回测：归一化契约（sample_size + metrics.* + v97_real；不再有 admitted）
    const bt = await a.getBacktest('R001');
    assert.equal(bt.ok, true);
    assert.equal(bt.data.sample_size, 30);
    assert.equal(bt.data.metrics.hit_rate, 0.607);
    assert.equal(bt.data.metrics.league_coverage, 3);
    assert.equal(bt.data.untrusted_count, 4);
    assert.equal(bt.data.adjudication, 'validated');
    assert.equal(bt.data.v97_real, null);
    assert.equal(bt.data.thresholds.hit_rate, 0.55, '阈值为扁平数值表');
    assert.ok(bt.data.admission_detail && bt.data.admission_detail.result_available === 2);

    const cand = await a.listAiCandidates();
    assert.equal(cand.data[0].trust, 'untrusted');

    const rev = await a.reviewAiCandidate('C001', 'approve');
    assert.equal(rev.ok, true);
    assert.equal(rev.data.verdict, 'approve');

    // getManualOddsStatus：mock 适配器返回占位契约形状
    const mso = await a.getManualOddsStatus();
    assert.equal(mso.ok, true);
    assert.equal(mso.data.source_id, 'src_manual_odds');
    assert.equal(mso.data.trust_level, 'provisional');
    assert.equal(mso.data.status, 'mock_placeholder');
    assert.ok(Array.isArray(mso.data.matches));

    // getMergedPool：mock 适配器返回占位契约形状（含 meta 统计口径）
    const mrg = await a.getMergedPool();
    assert.equal(mrg.ok, true);
    assert.equal(mrg.data.status, 'degraded');
    assert.equal(mrg.data.meta.pool_size, 0);
    assert.ok(Array.isArray(mrg.data.pool));
    assert.ok(Array.isArray(mrg.data.dismissed));

    // getMergedAnalysis：mock 占位
    const mga = await a.getMergedAnalysis('M_TEST');
    assert.equal(mga.ok, true);
    assert.equal(mga.data.arbitration.direction, 'undecidable');

    // 模式切换
    assert.equal(api.setMode('real'), 'real');
    assert.equal(api.getMode(), 'real');
    assert.equal(s.localStorage.getItem('oe_api_mode_v2'), 'real');
    assert.equal(api.getStatus().mode, 'real');
    assert.equal(api.getApi().name, 'http');
    return 'mock ok';
  })();
}

// ② http 适配器形状一致（假 fetch，返回真实后端统一响应壳形状）
function testHttp() {
  const s = makeSandbox();
  const calls = [];
  const respond = (status, payload) => ({
    ok: status < 400,
    status,
    json: () => Promise.resolve(payload),
  });
  s.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (path === '/api/matches') return respond(200, { status: 'ok', data: [{ match_id: 'M007', league: '日职联', home_team: '东京绿茵', away_team: '柏太阳神', kickoff: '2026-08-14T18:00:00+08:00' }] });
    if (path === '/api/rules') return respond(200, { status: 'ok', data: [{ rule_id: 'R001', version_id: 'R001#1', version: 1, status: 'active', category: 'odds_change', direction: 'favor_upper', base_confidence: 0.5, priority: 50, trust_level: 'untrusted', conclusion: '升盘降水看好上盘' }] });
    if (path === '/api/analysis/M007') return respond(200, { status: 'ok', data: { match_id: 'M007', at: '2026-08-14T18:00:00+08:00', hits: [{ rule_id: 'R001', version_id: 'R001#1', direction: 'favor_upper', confidence: 0.5, exact: true }], reasoning: [{ rule_id: 'R001', hit: true, dir: 'favor_upper', note: '条件满足，纳入推理链（conf=0.5）' }], prediction: { prediction_id: 'p1', final_direction: 'favor_upper', final_confidence: 0.5, created_at: 'x' }, arbitration: { direction: 'favor_upper', confidence: 0.5, dominant_rule_version_id: 'R001#1', manual_review_required: false, review_note: null } } });
    if (path === '/api/rules/R001/versions') return respond(200, { status: 'ok', data: [{ version_id: 'R001#1', rule_id: 'R001', version: 1, status: 'active', trust_level: 'untrusted', category: 'odds_change', conclusion: '升盘降水看好上盘', created_at: 'x' }] });
    if (path === '/api/features/M007') return respond(200, { status: 'ok', data: { match_id: 'M007', league: '日职联', home_team: '东京绿茵', away_team: '柏太阳神', match_time: '2026-08-14T18:00:00+08:00', merged: true, trust_level: 'provisional', computed_at: '2026-08-14T18:00:00+08:00', feature_version: '1.0.0', features: { 'institution.diff_max': 0.25, 'move_pattern': '升盘降水', 'kelly_index.home_max': 1.02 }, meta: { snapshot_count: 42, filtered_out: 1, sources: ['src_manual_odds'] } } });
    if (path === '/api/backtest/R001') return respond(200, { status: 'ok', data: { rule_id: 'R001', rule_name: '升盘降水', rule_version: 1, job_id: 'bt_0001', adjudication: 'validated', sample_size: 30, metrics: { hit_rate: 0.6, sample_size: 30 }, thresholds: { hit_rate: 0.55 }, date_range: { from: '2026-08-01', to: '2026-08-20' }, synthetic: true, v97_real: { covered: 71, tally: { hit: 47, miss: 24, insuff: 6 }, ledger_count: 71, ledger_sample: [], probe: { total: 76, hits: 47, hit_rate: 0.6184, note: 'S25 探针' } }, admission_detail: null, untrusted_count: null } });
    if (path === '/api/ai/candidates') return respond(200, { status: 'ok', data: { candidates: [{ id: 'AI001', field: 'move_pattern', op: 'EQ', value: '升盘降水', direction: 'favor_upper', rationale: '升盘降水代表资金压向主队', sample_size: 6, hit_rate: 0.7, edge: 0.2, trust: 'untrusted', candidate_status: 'candidate', candidate_source: 'mock' }], provider: 'mock', degraded: false, baseline: {}, sample_count: 8, synthetic: true } });
    if (/^\/api\/ai\/candidates\/[^/]+\/review$/.test(path)) return respond(200, { status: 'ok', data: { rule_id: 'AI001', version_id: 'AI001#1', status: 'proposed' } });
    if (path === '/api/sources/manual-odds') return respond(200, { status: 'ok', data: { source_id: 'src_manual_odds', name: '本地人工盘赔', trust_level: 'provisional', status: 'ok', reason: null, mode: 'http', meta: { total: 2, admitted: 1, rejected: 1 }, matches: [{ match_id: 'M_TEST', league: '日职联', home_team: '东京绿茵', away_team: '柏太阳神', match_time: '2026-08-14T18:00:00+08:00', snapshots: 42 }] } });
    if (path === '/api/sources/merged') return respond(200, { status: 'ok', data: { source: 'src_merged_pool', status: 'ok', mode: 'http', meta: { schedule_total: 1, manual_total: 1, aligned: 1, manual_only: 0, conflicts: 0, pool_size: 1 }, pool: [{ match_id: '2041049', league: '日职联', home_team: '东京绿茵', away_team: '柏太阳神', match_time: '2026-08-14T18:00:00+08:00', merged: true, snapshots: 42, actual_result: null }], dismissed: [] } });
    if (/^\/api\/merged\/analysis\//.test(path)) return respond(200, { status: 'ok', data: { source: 'src_merged_pool', match_id: '2041049', merged: true, snapshots: 42, hits: [{ rule_id: 'R001', version_id: 'R001#1', direction: 'favor_upper', confidence: 0.5, exact: true }], reasoning: [{ rule_id: 'R001', hit: true, dir: 'favor_upper', note: '条件满足' }], arbitration: { direction: 'favor_upper', confidence: 0.5, dominant_rule_version_id: 'R001#1', manual_review_required: false, review_note: null }, mode: 'http' } });
    return respond(404, { status: 'error', error: 'not_found' });
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
    assert.equal(m.data[0].match_id, 'M007');
    assert.match(calls[0].url, /\/api\/matches$/);

    // 规则归一化：rule_id → id（并补齐声明语义/证据字段）
    const rules = await a.listRules();
    assert.equal(rules.ok, true);
    assert.equal(rules.data[0].id, 'R001');
    assert.equal(rules.data[0].trust_level, 'untrusted');
    assert.equal(rules.data[0].status, 'active');
    assert.ok('declared_direction' in rules.data[0], '应含 declared_direction 字段');
    assert.ok('evidence_count' in rules.data[0], '应含 evidence_count 字段');

    // 推理链归一化：保留 { rule_id, hit, dir, note }
    const analysis = await a.getAnalysis('M007');
    assert.equal(analysis.ok, true);
    assert.equal(analysis.data.reasoning[0].rule_id, 'R001');
    assert.equal(analysis.data.reasoning[0].hit, true);
    assert.equal(analysis.data.reasoning[0].dir, 'favor_upper');

    // 特征归一化：后端扁平点分键 → 前端六族嵌套
    const feat = await a.getFeature('M007');
    assert.equal(feat.ok, true);
    assert.equal(feat.data.features.cross.handicap_dispersion, 0.25);
    assert.equal(feat.data.features.temp.move_pattern, '升盘降水');
    assert.equal(feat.data.features.onex.kelly_home_max, 1.02);
    assert.equal(feat.data.features.betfair.turnover, undefined, '未映射键不进入族结构');
    assert.equal(feat.data.meta.filtered_out, 1);
    assert.equal(feat.data.mode, 'http');

    // 回测归一化：sample_size 保留 + v97_real 透传（真实数字）
    const bt = await a.getBacktest('R001');
    assert.equal(bt.ok, true);
    assert.equal(bt.data.sample_size, 30);
    assert.equal(bt.data.thresholds.hit_rate, 0.55);
    assert.equal(bt.data.synthetic, true);
    assert.equal(bt.data.v97_real.covered, 71);
    assert.equal(bt.data.v97_real.probe.hits, 47);
    assert.equal(bt.data.date_range.from, '2026-08-01');

    // AI 候选归一化：candidates 数组 → 视图契约
    const cand = await a.listAiCandidates();
    assert.equal(cand.ok, true);
    assert.equal(cand.data[0].id, 'AI001');
    assert.equal(cand.data[0].pattern, '升盘降水代表资金压向主队');
    assert.equal(cand.data[0].status, 'candidate');
    assert.equal(cand.data[0].trust, 'untrusted');

    // review 归一化
    const rev = await a.reviewAiCandidate('AI001', 'approve');
    assert.equal(rev.ok, true);
    assert.equal(rev.data.status, 'proposed');

    // getManualOddsStatus：http 适配器命中端点并保留字段
    const mso = await a.getManualOddsStatus();
    assert.equal(mso.ok, true);
    assert.equal(mso.data.source_id, 'src_manual_odds');
    assert.equal(mso.data.status, 'ok');
    assert.equal(mso.data.mode, 'http');
    assert.equal(mso.data.meta.admitted, 1);
    assert.equal(mso.data.matches[0].match_id, 'M_TEST');
    assert.equal(mso.data.matches[0].snapshots, 42);

    // getMergedPool：http 适配器命中合并端点，保留 meta 统计口径
    const mrg = await a.getMergedPool();
    assert.equal(mrg.ok, true);
    assert.equal(mrg.data.status, 'ok');
    assert.equal(mrg.data.mode, 'http');
    assert.equal(mrg.data.meta.aligned, 1);
    assert.equal(mrg.data.pool[0].match_id, '2041049');
    assert.equal(mrg.data.pool[0].merged, true);

    // getMergedAnalysis：http 适配器命中合并分析端点，推理链归一化
    const mga = await a.getMergedAnalysis('2041049');
    assert.equal(mga.ok, true);
    assert.equal(mga.data.mode, 'http');
    assert.equal(mga.data.merged, true);
    assert.equal(mga.data.reasoning[0].rule_id, 'R001');
    assert.equal(mga.data.reasoning[0].hit, true);
    assert.equal(mga.data.reasoning[0].dir, 'favor_upper');

    // 404 → errBody
    const bad = await a.getRuleVersions('missing');
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'not_found');
    return 'http ok';
  })();
}

(async () => {
  const [r1, r2] = await Promise.all([testMock(), testHttp()]);
  console.log(r1, '|', r2);
  console.log('API-CLIENT SMOKE PASS');
})().catch((e) => { console.error(e); process.exit(1); });