// ============================================================================
// 数据接入层 · 锚定端点（odds 锚源）集成测试
// 验证：OE_SPORTTERY_ANCHOR=odds 时，官方赔率端点（webapi.sporttery.cn）拉取的
// 赛程骨架（含 matchNumStr / businessDate / Selling 状态）能与本地人工盘赔经
// mergeMatchSources 确定性/语义对齐 → aligned（在售态），不再 manual_only 降级。
// 直接对应「体彩锚定端点配置」快赢：让「今日可买」场次正确锚定为在售态。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { syncSportteryOdds, mergeMatchSources } = require('../src/data');
const { anchorSource } = require('../src/http/handlers');

// ── 竞彩官方赔率端点真实报文形状（getMatchCalculatorV1）──
const SPORTTERY_PAYLOAD = {
  success: true,
  errorCode: '0',
  value: {
    matchInfoList: [
      {
        businessDate: '20260903',
        subMatchList: [
          {
            matchId: 2041049,
            matchNumStr: '周三001',
            matchNum: 2001,
            businessDate: '20260903',
            matchDate: '20260903',
            matchTime: '18:30:00',
            matchStatus: 'Selling',
            leagueAllName: '英超',
            leagueCode: 'PL',
            homeTeamAllName: '曼城',
            awayTeamAllName: '狼队',
            homeRank: '[英超1]',
            awayRank: '[英超14]',
            had: { h: 1.85, d: 3.20, a: 3.95 },
          },
        ],
      },
    ],
  },
};

// 无 matchNumStr 的报文（走语义键对齐兜底）
const SPORTTERY_PAYLOAD_NO_NUM = {
  success: true,
  errorCode: '0',
  value: {
    matchInfoList: [
      {
        businessDate: '20260903',
        subMatchList: [
          {
            matchId: 2041050,
            businessDate: '20260903',
            matchDate: '20260903',
            matchTime: '21:00:00',
            matchStatus: 'Selling',
            leagueAllName: '英超',
            homeTeamAllName: '曼城',
            awayTeamAllName: '狼队',
            had: { h: 1.85, d: 3.20, a: 3.95 },
          },
        ],
      },
    ],
  },
};

function fakeFetchOk(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

/** 本地人工盘赔场次（带盘口快照，provisional）。 */
function manualMatch(over = {}) {
  const base = {
    match_id: '英超_曼城vs狼队',
    league: '英超', home_team: '曼城', away_team: '狼队', neutral: false,
    match_time: '2026-09-03T18:30:00+08:00', status: 'scheduled',
    observed_at: '2026-09-03T13:56:00+08:00', received_at: '2026-09-03T13:56:00+08:00',
    snapshots: [{
      snapshot_id: 'manual_1_macau_handicap', match_id: '英超_曼城vs狼队',
      institution: 'macau', market: 'handicap',
      source_id: 'src_manual_odds', trust_level: 'provisional',
      observed_at: '2026-09-03T13:56:00+08:00', received_at: '2026-09-03T13:56:00+08:00',
      data: { line: '-0.5', home_water: 0.9, away_water: 0.9 },
    }],
    actual_result: null, home_score: null, away_score: null, errors: [],
    meta: {},
  };
  return {
    ...base,
    ...over,
    snapshots: over.snapshots || base.snapshots,
    meta: { ...base.meta, ...(over.meta || {}) },
  };
}

// ───────────────────────── ① 官方赔率源 → 赛程骨架（在售态）─────────────────────────
test('① syncSportteryOdds：官方赔率报文 → MatchSchema（含期号/业务日/在售态）', async () => {
  const odds = await syncSportteryOdds({ fetchImpl: fakeFetchOk(SPORTTERY_PAYLOAD) });
  assert.equal(odds.status, 'ok', '有在售场次应 ok');
  assert.equal(odds.matches.length, 1);
  const o = odds.matches[0];
  assert.equal(o.match_id, '2041049');                 // 官方数字 ID
  assert.equal(o.league, '英超');
  assert.equal(o.home_team, '曼城');
  assert.equal(o.away_team, '狼队');
  assert.equal(o.status, 'scheduled', 'Selling → scheduled（在售态）');
  assert.equal(o.meta.match_num_str, '周三001', '期号供确定性锚定');
  assert.equal(o.meta.business_date, '20260903', '业务日决定「今日可买」批次');
  assert.equal(o.snapshots.length > 0, true, '官方盘口快照入列');
});

// ───────────────────────── ② 期号确定性对齐 → aligned（在售态接管）─────────────────────────
test('② 期号一致 → 确定性对齐：官方 match_id 接管，align_via=match_num，status=在售', async () => {
  const odds = await syncSportteryOdds({ fetchImpl: fakeFetchOk(SPORTTERY_PAYLOAD) });
  const manual = { matches: [manualMatch({ meta: { match_num_str: '周三001' } })] };
  const res = mergeMatchSources({ schedule: odds, manual });
  assert.equal(res.ok, true);
  assert.equal(res.meta.aligned, 1);
  assert.equal(res.meta.manual_only, 0);
  assert.equal(res.meta.conflicts, 0);
  const m = res.pool[0];
  assert.equal(m.match_id, '2041049', '官方数字 ID 接管人工语义 ID');
  assert.equal(m.meta.merged, true);
  assert.equal(m.meta.align_via, 'match_num');
  assert.equal(m.meta.schedule_match_id, '2041049');
  assert.equal(m.status, 'scheduled', '在售态承接官方 Selling');
  // 官方 meta（business_date 等）须透传，供「今日可买」批次分组与期号溯源
  assert.equal(m.meta.business_date, '20260903', '官方业务日透传（合并曾丢失，导致首页分组失真）');
  assert.equal(m.meta.match_num_str, '周三001', '官方期号透传');
  assert.equal(m.snapshots[0].match_id, '2041049', '快照 match_id 跟随顶层');
  assert.equal(m.snapshots[0].trust_level, 'provisional', '盘口快照信任不变');
});

// ───────────────────────── ③ 语义键兜底对齐（无期号亦 aligned）─────────────────────────
test('③ 无期号 → 语义键（联赛+队名）对齐：align_via=semantic_key，仍 aligned', async () => {
  const odds = await syncSportteryOdds({ fetchImpl: fakeFetchOk(SPORTTERY_PAYLOAD_NO_NUM) });
  const manual = { matches: [manualMatch()] }; // 无 match_num_str，靠联赛+队名
  const res = mergeMatchSources({ schedule: odds, manual });
  assert.equal(res.meta.aligned, 1);
  assert.equal(res.meta.manual_only, 0);
  assert.equal(res.meta.conflicts, 0);
  assert.equal(res.pool[0].meta.align_via, 'semantic_key');
  assert.equal(res.pool[0].match_id, '2041050');
  assert.equal(res.pool[0].status, 'scheduled');
});

// ───────────────────────── ④ 锚定端点升级对比：broken schedule → manual_only；odds 锚 → aligned ─────────────────────────
test('④ 对比：同一人工场次，坏锚源降级 manual_only，odds 锚源升级 aligned', async () => {
  const odds = await syncSportteryOdds({ fetchImpl: fakeFetchOk(SPORTTERY_PAYLOAD) });
  const manual = { matches: [manualMatch({ meta: { match_num_str: '周三001' } })] };

  // 模拟「赛程锚源不可达」：官方源为空 → 人工场诚实保留 manual_only
  const degraded = mergeMatchSources({ schedule: { matches: [] }, manual });
  assert.equal(degraded.meta.aligned, 0);
  assert.equal(degraded.meta.manual_only, 1, '坏锚源下人工场降级为 manual_only');

  // 切换为 odds 锚源（本机可达，自带赛程骨架）→ 升级为 aligned 在售
  const upgraded = mergeMatchSources({ schedule: odds, manual });
  assert.equal(upgraded.meta.aligned, 1, 'odds 锚源使同一场正确锚定为在售');
  assert.equal(upgraded.meta.manual_only, 0);
});

// ───────────────────────── ⑤ 时间防线：官方在售但快照赛后回灌仍剔除 ─────────────────────────
test('⑤ 时间防线不放松：即便 odds 锚源在售，盘口快照晚于开赛仍 conflicts', async () => {
  const odds = await syncSportteryOdds({ fetchImpl: fakeFetchOk(SPORTTERY_PAYLOAD) });
  const late = manualMatch({
    observed_at: '2026-09-03T19:00:00+08:00',
    received_at: '2026-09-03T19:30:00+08:00', // 晚于 18:30 开赛 → 赛后回灌形
    snapshots: [{
      snapshot_id: 'manual_late', match_id: '英超_曼城vs狼队',
      institution: 'macau', market: 'handicap',
      source_id: 'src_manual_odds', trust_level: 'provisional',
      observed_at: '2026-09-03T19:00:00+08:00', received_at: '2026-09-03T19:30:00+08:00',
      data: { line: '-0.5', home_water: 0.9, away_water: 0.9 },
    }],
    meta: { match_num_str: '周三001' },
  });
  const res = mergeMatchSources({ schedule: odds, manual: { matches: [late] } });
  assert.equal(res.meta.aligned, 0);
  assert.equal(res.meta.conflicts, 1, '时间防线在锚定路径同样生效');
  assert.match(res.dismissed[0].reason, /schedule_time_precedes_snapshot/);
});

// ───────────────────────── ⑥ 锚源选择：env 决定走 odds 还是 schedule ─────────────────────────
test('⑥ anchorSource()：OE_SPORTTERY_ANCHOR=odds 选 odds，否则默认 schedule', () => {
  const prev = process.env.OE_SPORTTERY_ANCHOR;
  try {
    process.env.OE_SPORTTERY_ANCHOR = 'odds';
    assert.equal(anchorSource(), 'odds', '显式 odds → 走官方赔率锚源');
    delete process.env.OE_SPORTTERY_ANCHOR;
    assert.equal(anchorSource(), 'schedule', '未设置 → 默认官方赛程锚源');
    process.env.OE_SPORTTERY_ANCHOR = 'schedule';
    assert.equal(anchorSource(), 'schedule', '显式 schedule → 官方赛程锚源');
  } finally {
    if (prev === undefined) delete process.env.OE_SPORTTERY_ANCHOR;
    else process.env.OE_SPORTTERY_ANCHOR = prev;
  }
});
