// ============================================================================
// 1.1 数据接入层 · 验收测试
// 覆盖实施计划 1.1 的 5 条验收标准：
//   ① 三时间戳缺一拒绝  ② 归一化规则  ③ mock 不污染  ④ 注册表可查询/信任可追溯
//   ⑤ 凭证访问全审计 + AI 无 data_source 权限
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateMatch, ERROR_CODES } = require('../src/data/schema');
const { ingestMatch, ingestMockAll, ingestMockMatch, querySources } = require('../src/data');
const { CredentialVault, UnauthorizedVaultError } = require('../src/vault/credential_vault');
const { filterAudit } = require('../src/vault/audit');
const { normalizeInstitution, normalizeLine, normalizeWater, normalizeResult } = require('../src/data/normalize');

/** 构造一份合法 MatchSchema 的最小样例 */
function validMatch(overrides = {}) {
  return {
    match_id: 'M_TEST_001',
    league: '测试联赛',
    home_team: '主队',
    away_team: '客队',
    neutral: false,
    match_time: '2026-08-14T18:00:00+08:00',
    status: 'scheduled',
    observed_at: '2026-08-14T12:00:00+08:00',
    received_at: '2026-08-14T12:00:30+08:00',
    snapshots: [
      {
        snapshot_id: 's1',
        match_id: 'M_TEST_001',
        institution: 'macau',
        market: 'handicap',
        source_id: 'src_odds_macau',
        trust_level: 'trusted',
        observed_at: '2026-08-14T12:00:00+08:00',
        received_at: '2026-08-14T12:00:30+08:00',
        data: { line: -0.5, home_water: 1.0, away_water: 0.84 },
      },
    ],
    actual_result: null,
    home_score: null,
    away_score: null,
    ...overrides,
  };
}

// ───────────────────────── 验收① 三时间戳缺一拒绝 ─────────────────────────
test('验收① 合法 MatchSchema 通过校验', () => {
  const { ok, errors } = validateMatch(validMatch());
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test('验收① 缺 match_time 拒绝', () => {
  const m = validMatch({ match_time: undefined });
  const { ok, errors } = validateMatch(m);
  assert.equal(ok, false);
  assert.ok(errors.includes(ERROR_CODES.MISSING_MATCH_TIME));
});

test('验收① 缺 observed_at 拒绝', () => {
  const m = validMatch({ observed_at: undefined });
  const { ok, errors } = validateMatch(m);
  assert.equal(ok, false);
  assert.ok(errors.includes(ERROR_CODES.MISSING_OBSERVED));
});

test('验收① 缺 received_at 拒绝', () => {
  const m = validMatch({ received_at: undefined });
  const { ok, errors } = validateMatch(m);
  assert.equal(ok, false);
  assert.ok(errors.includes(ERROR_CODES.MISSING_RECEIVED));
});

test('验收① received_at < observed_at 拒绝', () => {
  const m = validMatch({ received_at: '2026-08-14T11:00:00+08:00' });
  const { ok, errors } = validateMatch(m);
  assert.equal(ok, false);
  assert.ok(errors.includes(ERROR_CODES.RECEIVED_BEFORE_OBSERVED));
});

test('验收① 快照 received_at 晚于 match_time 拒绝（防赛后回灌）', () => {
  const m = validMatch({
    snapshots: [{
      ...validMatch().snapshots[0],
      received_at: '2026-08-14T19:00:00+08:00', // 晚于 18:00 开赛
    }],
  });
  const { ok, errors } = validateMatch(m);
  assert.equal(ok, false);
  assert.ok(errors.includes(ERROR_CODES.SNAPSHOT_AFTER_MATCH));
});

// ───────────────────────── 验收② 归一化规则 ─────────────────────────
test('验收② 机构名归一化', () => {
  assert.equal(normalizeInstitution('澳*'), 'macau');
  assert.equal(normalizeInstitution('澳门'), 'macau');
  assert.equal(normalizeInstitution('36*'), 'ct366');
  assert.equal(normalizeInstitution('威*'), 'william');
  assert.equal(normalizeInstitution('立*'), 'ladbrokes');
  assert.equal(normalizeInstitution('皇冠'), 'crown');
  assert.equal(normalizeInstitution('Bet365'), 'bet365');
  assert.equal(normalizeInstitution('Betfai*'), 'betfair');
  assert.equal(normalizeInstitution('Interwet*'), 'interwetten');
});

test('验收② 盘口格式归一化', () => {
  assert.equal(normalizeLine('2-2.5'), 2.25);
  assert.equal(normalizeLine('0.5'), 0.5);
  assert.equal(normalizeLine(-0.5), -0.5);
  assert.equal(normalizeLine('2.5'), 2.5);
});

test('验收② 水位与赛果归一化', () => {
  assert.equal(normalizeWater(0.845), 0.845);
  assert.equal(normalizeResult(2, 1), 'home_win');
  assert.equal(normalizeResult(1, 1), 'draw');
  assert.equal(normalizeResult(0, 3), 'away_win');
  assert.equal(normalizeResult(null, 1), null);
});

// ───────────────────────── 验收③ mock 不污染 ─────────────────────────
test('验收③ mock 演示场全部归 untrusted 的 src_mock_demo', () => {
  const results = ingestMockAll();
  const demo = results.filter((r) => r.match && /^M00[1-6]$/.test(r.match.match_id));
  assert.equal(demo.length, 6);
  for (const r of demo) {
    assert.equal(r.ok, true);
    for (const s of r.match.snapshots) {
      assert.equal(s.source_id, 'src_mock_demo');
      assert.equal(s.trust_level, 'untrusted');
    }
  }
});

test('验收③ 真实赛程（M007/M008）快照带可信来源与信任级别', () => {
  const r7 = ingestMockMatch('M007');
  assert.equal(r7.ok, true);
  const macau = r7.match.snapshots.find((s) => s.institution === 'macau');
  assert.ok(macau);
  assert.equal(macau.source_id, 'src_odds_macau');
  assert.equal(macau.trust_level, 'trusted');
});

// ───────────────────────── 验收④ 注册表可查询 / 信任可追溯 ─────────────────────────
test('验收④ 数据源注册表可查询', () => {
  const all = querySources();
  assert.ok(all.length >= 10);
  const macau = querySources('src_odds_macau');
  assert.equal(macau.trust_level, 'trusted');
  assert.equal(macau.source_type, 'odds');
  assert.equal(querySources('src_unknown'), null);
});

test('验收④ 每份快照 trust_level 与注册表一致（可追溯）', () => {
  const r7 = ingestMockMatch('M007');
  for (const s of r7.match.snapshots) {
    const src = querySources(s.source_id);
    assert.ok(src, `快照 source_id=${s.source_id} 必须在注册表可查`);
    assert.equal(s.trust_level, src.trust_level);
  }
});

// ───────────────────────── 验收⑤ 凭证隔离 + 审计 ─────────────────────────
test('验收⑤ AI 角色无 data_source 凭证权限', () => {
  const vault = new CredentialVault({
    env: { ODDS_MACAU_API_KEY: 'secret-macau', AI_LLM_KEY: 'secret-ai' },
  });
  const ai = { id: 'llm-1', role: 'ai' };
  assert.equal(vault.canAccess(ai, 'data_source'), false);
  assert.throws(() => vault.get(ai, 'env:ODDS_MACAU_API_KEY'), UnauthorizedVaultError);
  // AI 可读自身域
  assert.equal(vault.get(ai, 'env:AI_LLM_KEY'), 'secret-ai');
});

test('验收⑤ ingest 角色可读数据源凭证且写审计', () => {
  const vault = new CredentialVault({
    env: { ODDS_MACAU_API_KEY: 'secret-macau' },
  });
  const ingest = { id: 'worker-1', role: 'ingest' };
  assert.equal(vault.canAccess(ingest, 'data_source'), true);
  assert.equal(vault.get(ingest, 'env:ODDS_MACAU_API_KEY'), 'secret-macau');
  const credAudits = filterAudit('credential_accessed');
  assert.ok(credAudits.length >= 1);
  assert.equal(credAudits[credAudits.length - 1].actor, 'ingest:worker-1');
  assert.equal(credAudits[credAudits.length - 1].target_id, 'env:ODDS_MACAU_API_KEY');
});

test('验收⑤ 凭证引用格式非法时拒绝', () => {
  const vault = new CredentialVault({ env: {} });
  const ingest = { id: 'w', role: 'ingest' };
  assert.throws(() => vault.get(ingest, 'plain-secret'), UnauthorizedVaultError);
});

// ───────────────────────── 附加：ingest 管线审计 ─────────────────────────
test('ingest 管线对合法/非法数据写审计', () => {
  const okRes = ingestMatch(validMatch());
  assert.equal(okRes.ok, true);
  const badRes = ingestMatch(validMatch({ match_time: undefined }));
  assert.equal(badRes.ok, false);
  assert.ok(badRes.errors.includes(ERROR_CODES.MISSING_MATCH_TIME));
  const received = filterAudit('data_received_ok');
  const rejected = filterAudit('data_rejected');
  assert.ok(received.length >= 1);
  assert.ok(rejected.length >= 1);
});