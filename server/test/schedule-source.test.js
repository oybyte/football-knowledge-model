// ============================================================================
// 数据接入层 · 真实赛程源适配器 —— 验收测试
// 覆盖「赛程与赛事元信息归一化 + 适配器骨架」：
//   ① 队名 / 开赛时间（北京时间）归一化
//   ② 端点未配置 → not_configured（诚实降级，绝无假数据）
//   ③ 端点已配置 + 假响应 → 归一化为 MatchSchema（元信息 + 三时间戳合法）
//   ④ 拉取失败 / 报文不完整 → degraded / 按条拒绝
//   ⑤ 凭证经 CredentialVault（ingest 角色）注入并审计；AI 角色无权访问端点
//   ⑥ 纯赛程源（无盘口快照）不被 EMPTY_SNAPSHOTS 硬拒绝
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTeamName, parseMatchTime } = require('../src/data/normalize');
const {
  syncSportterySchedule,
  createRemoteAdapter,
  querySources,
} = require('../src/data');
const { mapFixture, mapStatus, SOURCE_ID } = require('../src/data/adapters/sporttery_schedule');
const { filterAudit } = require('../src/vault/audit');

/** 竞彩官方赛程报文（占位契约字段）。 */
const RAW_FIXTURE = {
  matchId: 'str-1001',
  competitionName: '英超',
  homeTeamName: '曼城',
  awayTeamName: '狼队',
  matchDate: '20260814',
  matchTime: '1830',
  matchStatus: 'scheduled',
  isNeutral: false,
};

const ENDPOINT = 'https://schedule.example.invalid/v1/fixtures';
const FIXED_NOW = Date.parse('2026-08-14T10:00:00Z');

/** 假 fetch：返回统一响应壳 { status, data }。 */
function fakeFetchOk(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}
function fakeFetchThrow(err) {
  return async () => { throw err; };
}

// ───────────────────────── ① 元信息归一化单元 ─────────────────────────
test('① 队名归一化：折叠全角/不换行空格与多余空白', () => {
  assert.equal(normalizeTeamName('\u3000曼城\u00a0狼队'), '曼城 狼队');
  assert.equal(normalizeTeamName('  曼城  '), '曼城');
  assert.equal(normalizeTeamName(''), '');
  assert.equal(normalizeTeamName(null), '');
});

test('① 竞彩开赛时间 → 北京时间 ISO 8601', () => {
  assert.equal(parseMatchTime('20260814', '1830'), '2026-08-14T18:30:00+08:00');
  assert.equal(parseMatchTime('2026-08-14', '18'), '2026-08-14T18:00:00+08:00');
  assert.equal(parseMatchTime('2026/08/14', '18:00'), '2026-08-14T18:00:00+08:00');
});

test('① 非法日期时间不猜测（返回 null）', () => {
  assert.equal(parseMatchTime('20261314', '1830'), null); // 13 月
  assert.equal(parseMatchTime('20260814', '24:00'), null); // 24 时
  assert.equal(parseMatchTime('20260814', null), null);
  assert.equal(parseMatchTime(null, '1830'), null);
});

test('① mapFixture：竞彩报文 → 赛事元信息 MatchSchema', () => {
  const { ok, fixture } = mapFixture(RAW_FIXTURE, '2026-08-14T10:00:00.000Z');
  assert.equal(ok, true);
  assert.equal(fixture.match_id, 'str-1001');
  assert.equal(fixture.league, '英超');
  assert.equal(fixture.home_team, '曼城');
  assert.equal(fixture.away_team, '狼队');
  assert.equal(fixture.match_time, '2026-08-14T18:30:00+08:00');
  assert.equal(fixture.status, 'scheduled');
  assert.equal(fixture.neutral, false);
  assert.deepEqual(fixture.snapshots, []); // basic 赛程源无盘口快照
  assert.equal(Date.parse(fixture.received_at) >= Date.parse(fixture.observed_at), true);
});

test('① mapFixture：default_home=1 主客倒置（客场在前）', () => {
  const { ok, fixture } = mapFixture({
    ...RAW_FIXTURE,
    homeTeamName: '狼队', awayTeamName: '曼城', default_home: 1,
  }, '2026-08-14T10:00:00.000Z');
  assert.equal(ok, true);
  assert.equal(fixture.home_team, '曼城');
  assert.equal(fixture.away_team, '狼队');
});

test('① mapFixture：元信息不完整则拒绝且不置默认', () => {
  assert.equal(mapFixture({ ...RAW_FIXTURE, awayTeamName: '' }, 'x').ok, false);
  assert.equal(mapFixture({ ...RAW_FIXTURE, matchDate: null }, 'x').ok, false);
  assert.equal(mapFixture(null, 'x').ok, false);
});

// ───────────────────────── ② 端点未配置 → not_configured ─────────────────────────
test('② 端点未配置：诚实返回 not_configured，零假数据', async () => {
  const res = await syncSportterySchedule({
    env: {}, // 无真实端点
    fetchImpl: fakeFetchOk([RAW_FIXTURE]),
  });
  assert.equal(res.source_id, SOURCE_ID);
  assert.equal(res.ok, false);
  assert.equal(res.status, 'not_configured');
  assert.equal(res.reason, 'SPORTTERY_SCHEDULE_UNCONFIGURED');
  assert.deepEqual(res.matches, []);
  // 即使 fetch 会返回数据也不能伪造：必须走 not_configured
});

test('② not_configured 写审计 source_not_configured', async () => {
  await syncSportterySchedule({ env: {} });
  const evts = filterAudit('source_not_configured');
  assert.equal(evts[evts.length - 1].target_id, SOURCE_ID);
});

// ───────────────────────── ③ 已配置 + 假响应 → 归一化成功 ─────────────────────────
test('③ 端点已配置：竞彩赛程归一化为 MatchSchema（元信息 + 三时间戳合法）', async () => {
  const res = await syncSportterySchedule({
    env: { ODDS_SPORTTERY_SCHEDULE_BASE: ENDPOINT },
    fetchImpl: fakeFetchOk({ status: 'ok', data: [RAW_FIXTURE] }),
    now: () => FIXED_NOW,
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'ok');
  assert.equal(res.meta.total, 1);
  assert.equal(res.meta.admitted, 1);
  const m = res.matches[0];
  assert.equal(m.match_id, 'str-1001');
  assert.equal(m.match_time, '2026-08-14T18:30:00+08:00');
  assert.equal(m.league, '英超');
  // 三时间戳均由本次采集时刻派生，合法且防泄漏
  assert.ok(m.observed_at && m.received_at);
  assert.equal(Date.parse(m.received_at) >= Date.parse(m.observed_at), true);
  assert.equal(Date.parse(m.received_at) < Date.parse(m.match_time), true);
});

test('③ 多场报文：仅合法场次入列，非法场次拒绝并计数', async () => {
  const res = await syncSportterySchedule({
    env: { ODDS_SPORTTERY_SCHEDULE_BASE: ENDPOINT },
    fetchImpl: fakeFetchOk({ status: 'ok', data: [
      RAW_FIXTURE,
      { ...RAW_FIXTURE, matchId: 'str-1002', matchDate: null }, // 时间缺失 → 拒绝
      { ...RAW_FIXTURE, matchId: 'str-1003', matchStatus: 'bogus' }, // 状态非法 → 拒绝
    ] }),
  });
  assert.equal(res.meta.total, 3);
  assert.equal(res.meta.admitted, 1);
  assert.equal(res.meta.rejected, 2);
});

test('③ 真实端点报文形状：value.matchInfoList[].subMatchList + 真实字段 + Selling', async () => {
  const REAL_PAYLOAD = {
    success: true,
    errorCode: '0',
    value: {
      matchInfoList: [
        {
          businessDate: '2026-08-25',
          subMatchList: [
            {
              matchId: 2041049,
              matchNumStr: '周二001',
              matchNum: 2001,
              matchDate: '2026-08-25',
              matchTime: '18:30:00',
              matchStatus: 'Selling',
              leagueAllName: '韩国职业联赛',
              leagueCode: 'KD1',
              homeTeamAllName: '金泉尚武',
              awayTeamAllName: '全北现代',
              homeRank: '[韩职11]',
              awayRank: '[韩职3]',
            },
          ],
        },
      ],
    },
  };
  const res = await syncSportterySchedule({
    env: { ODDS_SPORTTERY_SCHEDULE_BASE: ENDPOINT },
    fetchImpl: fakeFetchOk(REAL_PAYLOAD),
    now: () => Date.parse('2026-08-25T06:00:00Z'),
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'ok');
  assert.equal(res.meta.total, 1);
  const m = res.matches[0];
  assert.equal(m.match_id, '2041049');
  assert.equal(m.home_team, '金泉尚武');
  assert.equal(m.away_team, '全北现代');
  assert.equal(m.league, '韩国职业联赛');
  assert.equal(m.status, 'scheduled'); // Selling → scheduled
  assert.equal(m.match_time, '2026-08-25T18:30:00+08:00');
  assert.equal(Date.parse(m.match_time) > Date.parse(m.observed_at), true);
});

test('③ mapStatus：真实枚举映射 + 未知拒绝', () => {
  assert.equal(mapStatus('Selling'), 'scheduled');
  assert.equal(mapStatus('PreSale'), 'scheduled');
  assert.equal(mapStatus('Playing'), 'live');
  assert.equal(mapStatus('Finished'), 'finished');
  assert.equal(mapStatus('Cancelled'), 'cancelled');
  assert.equal(mapStatus('bogus'), null);
  assert.equal(mapStatus(''), 'scheduled');
});

// ───────────────────────── ④ 拉取失败 → degraded ─────────────────────────
test('④ fetch 抛错：degraded，不产生假数据', async () => {
  const res = await syncSportterySchedule({
    env: { ODDS_SPORTTERY_SCHEDULE_BASE: ENDPOINT },
    fetchImpl: fakeFetchThrow(new Error('ECONNREFUSED')),
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 'degraded');
  assert.equal(res.reason, 'SCHEDULE_FETCH_FAILED');
  assert.deepEqual(res.matches, []);
  const audits = filterAudit('source_fetch_failed');
  assert.equal(audits[audits.length - 1].target_id, SOURCE_ID);
});

test('④ HTTP 非 2xx：degraded', async () => {
  const res = await syncSportterySchedule({
    env: { ODDS_SPORTTERY_SCHEDULE_BASE: ENDPOINT },
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal(res.status, 'degraded');
});

// ───────────────────────── ⑤ 凭证经 CredentialVault 注入 + 审计 ─────────────────────────
test('⑤ ingest 角色经 CredentialVault 读取真实端点并写 credential_accessed 审计', async () => {
  const res = await syncSportterySchedule({
    env: { ODDS_SPORTTERY_SCHEDULE_BASE: ENDPOINT },
    fetchImpl: fakeFetchOk([RAW_FIXTURE]),
  });
  assert.equal(res.status, 'ok');
  const audits = filterAudit('credential_accessed');
  const last = audits[audits.length - 1];
  assert.equal(last.target_id, 'env:ODDS_SPORTTERY_SCHEDULE_BASE');
  assert.equal(last.actor, 'ingest:sporttery:worker');
});

test('⑤ AI 角色无权访问数据源端点 → 视为未配置（诚实 not_configured）', async () => {
  const ai = { id: 'llm-1', role: 'ai' };
  const res = await syncSportterySchedule({
    env: { ODDS_SPORTTERY_SCHEDULE_BASE: ENDPOINT }, // 端点虽配置，但 AI 无权读
    fetchImpl: async () => { throw new Error('AI_SHOULD_NOT_TOUCH_DATA_SOURCE'); }, // 若被调用将 throw → degraded
    actor: ai,
  });
  // 未调用 fetch，故为 not_configured 而非 degraded → 证明 AI 未触碰数据源端点
  assert.equal(res.status, 'not_configured');
  assert.equal(res.reason, 'SPORTTERY_SCHEDULE_UNCONFIGURED');
});

// ───────────────────────── ⑥ 纯赛程源（空快照）不被硬拒绝 ─────────────────────────
test('⑥ basic 赛程源：EmptySnapshots 被容错放行（元信息入列）', async () => {
  const res = await syncSportterySchedule({
    env: { ODDS_SPORTTERY_SCHEDULE_BASE: ENDPOINT },
    fetchImpl: fakeFetchOk([RAW_FIXTURE]),
  });
  assert.equal(res.status, 'ok');
  assert.equal(res.meta.admitted, 1);
});

test('⑥ 注册表可查询到竞彩官方赛程源', () => {
  const s = querySources(SOURCE_ID);
  assert.ok(s);
  assert.equal(s.source_type, 'basic');
  assert.equal(s.trust_level, 'trusted');
  assert.equal(s.config_ref, 'env:ODDS_SPORTTERY_SCHEDULE_BASE');
});

// ⑥ createRemoteAdapter 工厂可创建赛程适配器
test('⑥ createRemoteAdapter 按 source_id 创建适配器；未知源拒绝', () => {
  const a = createRemoteAdapter(SOURCE_ID, { env: {} });
  assert.equal(a.source_id, SOURCE_ID);
  assert.throws(() => createRemoteAdapter('src_unknown_src'), /adapter_not_registered/);
});