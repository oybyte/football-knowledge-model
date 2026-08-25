// ============================================================================
// 数据接入层 · 双源合并（竞彩赛程 ∪ 本地人工盘赔）—— 验收测试
// 覆盖语义键对齐 / 官方元信息覆盖 / 时间防线 / 未命中保留 / 队名归一化：
//   ① 同语义键 → aligned：官方 match_id/队名/开赛时间覆盖，快照 match_id 同步，入池
//   ② 时间防线：官方 match_time 早于盘口快照接收 → conflicts 剔除，绝不入池
//   ③ 未命中赛程的人工场次 → manual_only 保留（诚实 provisional，merged=false）
//   ④ 队名需归一化对齐：全角不换行空格折叠后仍命中
//   ⑤ 对齐统计 meta 正确（schedule_total / manual_total / aligned / manual_only / conflicts）
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeMatchSources } = require('../src/data');

/** 竞彩赛程元信息场次（basic，无快照，EMPTY_SNAPSHOTS 非致命）。 */
function scheduleMatch(over = {}) {
  return {
    match_id: '2041049',
    league: '英超',
    home_team: '曼城',
    away_team: '狼队',
    neutral: false,
    match_time: '2026-08-14T18:30:00+08:00',
    status: 'scheduled',
    observed_at: '2026-08-14T06:00:00Z',
    received_at: '2026-08-14T06:00:00Z',
    snapshots: [],
    actual_result: null, home_score: null, away_score: null, errors: [],
    ...over,
  };
}

/** 本地人工盘赔场次（带盘口快照）。 */
function manualMatch(over = {}) {
  const base = {
    match_id: '英超_曼城vs狼队',
    league: '英超', home_team: '曼城', away_team: '狼队', neutral: false,
    match_time: '2026-08-14T18:30:00+08:00', status: 'scheduled',
    observed_at: '2026-08-14T12:00:00+08:00', received_at: '2026-08-14T12:00:00+08:00',
    snapshots: [{
      snapshot_id: 'manual_1_macau_handicap', match_id: '英超_曼城vs狼队',
      institution: 'macau', market: 'handicap',
      source_id: 'src_manual_odds', trust_level: 'provisional',
      observed_at: '2026-08-14T12:00:00+08:00', received_at: '2026-08-14T12:00:00+08:00',
      data: { line: '-0.5', home_water: 0.9, away_water: 0.9 },
    }],
    actual_result: null, home_score: null, away_score: null, errors: [],
  };
  return { ...base, ...over, snapshots: over.snapshots || base.snapshots };
}

const SNAP_AFTER = {
  observed_at: '2026-08-14T17:00:00+08:00', received_at: '2026-08-14T17:30:00+08:00',
};

// ───────────────────────── ① 语义键对齐 → aligned ─────────────────────────
test('① 同语义键 → aligned：官方元信息覆盖，快照 match_id 同步，入池', () => {
  const res = mergeMatchSources({ schedule: { matches: [scheduleMatch()] }, manual: { matches: [manualMatch()] } });
  assert.equal(res.ok, true);
  assert.equal(res.meta.aligned, 1);
  assert.equal(res.meta.manual_only, 0);
  assert.equal(res.meta.conflicts, 0);
  assert.equal(res.pool.length, 1);
  const m = res.pool[0];
  assert.equal(m.match_id, '2041049');               // 官方数字 ID
  assert.equal(m.home_team, '曼城');
  assert.equal(m.match_time, '2026-08-14T18:30:00+08:00');
  assert.equal(m.meta.merged, true);
  assert.equal(m.meta.schedule_match_id, '2041049');
  assert.equal(m.snapshots.length, 1);
  assert.equal(m.snapshots[0].match_id, '2041049');  // 快照 match_id 跟随顶层
  assert.equal(m.snapshots[0].trust_level, 'provisional'); // 盘口信任不变
});

// ───────────────────────── ② 时间防线 ─────────────────────────
test('② 官方 match_time 早于快照接收 → conflicts，绝不入池', () => {
  // 官方开赛 12:00，人工快照 17:30 接收（赛后回灌形）→ 违例
  const manual = manualMatch({ snapshots: [{ ...manualMatch().snapshots[0], ...SNAP_AFTER }] });
  const res = mergeMatchSources({ schedule: { matches: [scheduleMatch({ match_time: '2026-08-14T12:00:00+08:00' })] }, manual: { matches: [manual] } });
  assert.equal(res.pool.length, 0);
  assert.equal(res.meta.aligned, 0);
  assert.equal(res.meta.conflicts, 1);
  assert.match(res.dismissed[0].reason, /schedule_time_precedes_snapshot/);
});

// ───────────────────────── ③ 未命中赛程 → manual_only ─────────────────────────
test('③ 未命中赛程的人工场次保留入池，merged=false', () => {
  const res = mergeMatchSources({ schedule: { matches: [] }, manual: { matches: [manualMatch()] } });
  assert.equal(res.ok, true);
  assert.equal(res.pool.length, 1);
  assert.equal(res.meta.manual_only, 1);
  assert.equal(res.meta.aligned, 0);
  assert.equal(res.pool[0].match_id, '英超_曼城vs狼队');
  assert.equal(res.pool[0].meta.merged, false);
});

// ───────────────────────── ④ 队名空白归一化对齐 ─────────────────────────
test('④ 队名首尾空白折叠后仍对齐', () => {
  const manual = manualMatch({ home_team: '  曼城  ' }); // 人为多带首尾空白
  const res = mergeMatchSources({ schedule: { matches: [scheduleMatch()] }, manual: { matches: [manual] } });
  assert.equal(res.meta.aligned, 1);
  assert.equal(res.pool[0].home_team, '曼城'); // 采用官方归一化队名
});

// ───────────────────────── ⑤ 对齐统计 meta ─────────────────────────
test('⑤ meta 统计口径正确（含 schedule_total / manual_total）', () => {
  const sched = [scheduleMatch({ match_id: '2041049' }), scheduleMatch({ match_id: '2041050', away_team: '布莱顿' })];
  const manual = [
    manualMatch(),                                                                  // 命中 2041049
    manualMatch({ away_team: '布莱顿', match_id: '英超_曼城vs布莱顿' }),             // 命中 2041050
    manualMatch({ away_team: '布伦特福德', match_id: '英超_曼城vs布伦特福德' }),     // 未命中
  ];
  const res = mergeMatchSources({ schedule: { matches: sched }, manual: { matches: manual } });
  assert.equal(res.meta.schedule_total, 2);
  assert.equal(res.meta.manual_total, 3);
  assert.equal(res.meta.aligned, 2);
  assert.equal(res.meta.manual_only, 1);
  assert.equal(res.meta.pool_size, 3);
  assert.equal(res.dismissed.length, 0);
});