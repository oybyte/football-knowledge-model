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
const { normalizeLeague, normalizeTeamName, parseMatchPeriod } = require('../src/data/normalize');

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

// ───────────────────────── ⑥ 联赛别名收敛对齐（官方全称 ↔ 人工简称）─────────────────────────
test('⑥ 官方「韩国职业联赛」与人工「韩K联」别名对齐 → merged:true', () => {
  // 001 场真实场景：官方赛程用联赛全称，人工盘赔用简称
  const sched = scheduleMatch({ match_id: '2041991', league: '韩国职业联赛', home_team: '金泉尚武', away_team: '全北现代', match_time: '2026-08-25T18:30:00+08:00' });
  const manual = manualMatch({ match_id: '韩K联_金泉尚武_vs_全北现代', league: '韩K联', home_team: '金泉尚武', away_team: '全北现代', match_time: '2026-08-25T18:30:00+08:00', observed_at: '2026-08-25T10:00:00+08:00', received_at: '2026-08-25T10:00:00+08:00' });
  const res = mergeMatchSources({ schedule: { matches: [sched] }, manual: { matches: [manual] } });
  assert.equal(res.meta.aligned, 1);
  assert.equal(res.meta.manual_only, 0);
  assert.equal(res.meta.conflicts, 0);
  assert.equal(res.pool[0].meta.merged, true);
  assert.equal(res.pool[0].match_id, '2041991');            // 官方数字 ID
  assert.equal(res.pool[0].league, '韩国职业联赛');            // 官方联赛名
  assert.equal(res.pool[0].snapshots[0].match_id, '2041991'); // 快照 match_id 跟随
});

test('⑥b normalizeLeague 别名表：全称→简称，简称幂等，未知原样', () => {
  assert.equal(normalizeLeague('韩国职业联赛'), '韩K联');
  assert.equal(normalizeLeague('　韩国职业联赛　'), '韩K联'); // 全角空白先折叠再收敛
  assert.equal(normalizeLeague('韩K联'), '韩K联');            // 已为简称幂等
  assert.equal(normalizeLeague('欧洲冠军联赛'), '欧冠杯');
  assert.equal(normalizeLeague('英超'), '英超');
  assert.equal(normalizeLeague(normalizeTeamName('西班牙甲级联赛')), '西甲');
  assert.equal(normalizeLeague('自定义联赛'), '自定义联赛');     // 未知原样
});
// ───────────────────────── ⑦ 期号锚定（确定性对齐，绕过队名 OCR 变体）─────────────────────────
test('⑦ 官方期号一致 → 队名 OCR 变体也对齐（align_via=match_num）', () => {
  // 真实场景：官方 2041244「日本联赛杯 八户南源 vs 枥木城」；人工 md 队名 OCR 为
  // 「日联杯 八户云罗里 vs 杨木市FC」，但录入流程显式标注同一官方期号「周三001」。
  const sched = scheduleMatch({
    match_id: '2041244', league: '日本联赛杯', home_team: '八户南源', away_team: '枥木城',
    match_time: '2026-09-02T17:30:00+08:00',
    meta: { match_num_str: '周三001', match_num_date: '260902' },
  });
  const manual = manualMatch({
    match_id: '日联杯_八户云罗里_vs_杨木市FC', league: '日联杯', home_team: '八户云罗里', away_team: '杨木市FC',
    match_time: '2026-09-02T17:30:00+08:00',
    observed_at: '2026-09-02T13:56:00+08:00', received_at: '2026-09-02T13:56:00+08:00',
    meta: { match_num_str: '周三001', match_num_date: '260902' },
  });
  const res = mergeMatchSources({ schedule: { matches: [sched] }, manual: { matches: [manual] } });
  assert.equal(res.meta.aligned, 1, '期号一致应确定性对齐');
  assert.equal(res.meta.conflicts, 0);
  assert.equal(res.pool[0].meta.merged, true);
  assert.equal(res.pool[0].meta.align_via, 'match_num');
  assert.equal(res.pool[0].meta.schedule_match_id, '2041244');
  assert.equal(res.pool[0].match_id, '2041244', '官方数字 ID 接管');
  assert.equal(res.pool[0].home_team, '八户南源', '官方队名覆盖 OCR 变体');
});

test('⑦b 期号不一致 → 回退语义键；语义键也不中 → manual_only（诚实不硬配）', () => {
  const sched = scheduleMatch({ match_id: 'A1', league: '英超', home_team: '曼城', away_team: '狼队', meta: { match_num_str: '周三002' } });
  const manual = manualMatch({ league: '英超', home_team: '曼城', away_team: '狼队', meta: { match_num_str: '周三003' } });
  const res = mergeMatchSources({ schedule: { matches: [sched] }, manual: { matches: [manual] } });
  assert.equal(res.pool[0].meta.merged, true, '期号不中但语义键中 → 语义键对齐');
  assert.equal(res.pool[0].meta.align_via, 'semantic_key');

  const res2 = mergeMatchSources({ schedule: { matches: [] }, manual: { matches: [manualMatch({ meta: { match_num_str: '周三003' } })] } });
  assert.equal(res2.meta.manual_only, 1, '无官方源 → 诚实 manual_only');
});

test('⑦c normalizeLeague 日联杯系别名收敛（日本联赛杯/日联赛杯 → 日联杯）', () => {
  assert.equal(normalizeLeague('日本联赛杯'), '日联杯');
  assert.equal(normalizeLeague('日联赛杯'), '日联杯');
  assert.equal(normalizeLeague('日联杯'), '日联杯');
});

test('⑦d 跨格式期号锚定：人工「业务日-序号」 vs 官方「周X序号」', () => {
  // 真实场景：官方 2041922「意大利甲级联赛 亚特兰大 vs 威尼斯」，serial=周一002 / serial_date=261012。
  // 人工 md 记「体彩期号：261012-002」→ 经 parseMatchPeriod 归一化为「周一002」后应确定性对齐。
  // 这里刻意让队名带 OCR 变体残留，使语义键必然不中——只有期号通道能救。
  const sched = scheduleMatch({
    match_id: '2041922', league: '意大利甲级联赛', home_team: '亚特兰大', away_team: '威尼斯',
    match_time: '2026-10-13T00:30:00+08:00',
    meta: { match_num_str: '周一002', match_num_date: '261012', business_date: '2026-10-12' },
  });
  const manual = manualMatch({
    match_id: '意甲_亚特兰大_vs_威尼斯（人工确认）', league: '意甲',
    home_team: '亚特兰大', away_team: '威尼斯（人工确认）',
    match_time: '2026-10-13T00:30:00+08:00',
    observed_at: '2026-10-12T20:00:00+08:00', received_at: '2026-10-12T20:00:00+08:00',
    meta: {
      match_num_str: parseMatchPeriod('261012-002').match_num_str,
      match_num_date: parseMatchPeriod('261012-002').match_num_date,
    },
  });
  const res = mergeMatchSources({ schedule: { matches: [sched] }, manual: { matches: [manual] } });
  assert.equal(res.meta.aligned, 1, '跨格式期号应确定性对齐');
  assert.equal(res.meta.conflicts, 0);
  assert.equal(res.pool[0].meta.align_via, 'match_num');
  assert.equal(res.pool[0].match_id, '2041922', '官方数字 ID 接管');
  assert.equal(res.pool[0].away_team, '威尼斯', '官方队名覆盖 OCR 变体');
});

test('⑦e 仅业务日（无序号）不得锚定：回退语义键，语义键不中则 manual_only', () => {
  const sched = scheduleMatch({
    match_id: '2041922', league: '意大利甲级联赛', home_team: '亚特兰大', away_team: '威尼斯',
    match_time: '2026-10-13T00:30:00+08:00',
    meta: { match_num_str: '周一002', match_num_date: '261012' },
  });
  const manual = manualMatch({
    league: '意甲', home_team: '亚特兰大', away_team: '威尼斯',
    match_time: '2026-10-13T00:30:00+08:00',
    observed_at: '2026-10-12T20:00:00+08:00', received_at: '2026-10-12T20:00:00+08:00',
    meta: { match_num_str: null, match_num_date: '261012' }, // 仅业务日，无序号
  });
  const res = mergeMatchSources({ schedule: { matches: [sched] }, manual: { matches: [manual] } });
  assert.equal(res.pool[0].meta.align_via, 'semantic_key', '无序号只能走语义键');
  assert.notEqual(res.pool[0].meta.align_via, 'match_num');
});

test('⑦f 同序号但业务日不同 → 不得锚定（序号仅在同一业务日内唯一）', () => {
  // 真实回归取证：09-08 的「周一002」与 10-12 的「周一002」是两场完全不同的比赛。
  // 曾因只按「周X+序号」匹配（丢掉业务日），历史场次被错锚到当天在售场次，
  // 造成 7 组 / 13 条重复池条目，并把别场的赛果挂到本场。
  const sched = scheduleMatch({
    match_id: '2041922', league: '意大利甲级联赛', home_team: '亚特兰大', away_team: '威尼斯',
    match_time: '2026-10-13T00:30:00+08:00',
    meta: { match_num_str: '周一002', match_num_date: '261012' }, // 业务日 2026-10-12
  });
  const manual = manualMatch({
    match_id: '西甲_赫塔菲_vs_塞尔塔', league: '西甲', home_team: '赫塔菲', away_team: '塞尔塔',
    match_time: '2026-09-08T03:30:00+08:00',
    observed_at: '2026-09-07T20:00:00+08:00', received_at: '2026-09-07T20:00:00+08:00',
    meta: { match_num_str: '周一002', match_num_date: '260907' }, // 业务日 2026-09-07（另一个周一）
  });
  const res = mergeMatchSources({ schedule: { matches: [sched] }, manual: { matches: [manual] } });
  assert.equal(res.meta.aligned, 0, '业务日不同 → 不得锚定');
  assert.equal(res.meta.manual_only, 1);
  assert.equal(res.pool[0].match_id, '西甲_赫塔菲_vs_塞尔塔', '保留人工侧 id，未被官方接管');
  assert.equal(res.pool[0].meta.merged, false);
});

test('⑦g 缺业务日 → 不做确定性锚定，诚实回退语义键', () => {
  const sched = scheduleMatch({
    match_id: '2041049', league: '英超', home_team: '曼城', away_team: '狼队',
    meta: { match_num_str: '周三001' }, // 官方缺 match_num_date
  });
  const manual = manualMatch({ meta: { match_num_str: '周三001' } }); // 人工缺 match_num_date
  const res = mergeMatchSources({ schedule: { matches: [sched] }, manual: { matches: [manual] } });
  assert.equal(res.pool[0].meta.merged, true);
  assert.equal(res.pool[0].meta.align_via, 'semantic_key', '无业务日不得走期号锚定');
});

test('⑦h 两场人工数据指向同一官方场次 → 后到者剔除，不产生重复池条目', () => {
  const sched = scheduleMatch({
    match_id: '2041922', league: '意大利甲级联赛', home_team: '亚特兰大', away_team: '威尼斯',
    match_time: '2026-10-13T00:30:00+08:00',
    meta: { match_num_str: '周一002', match_num_date: '261012' },
  });
  const mk = (id) => manualMatch({
    match_id: id, league: '意甲', home_team: '亚特兰大', away_team: '威尼斯',
    match_time: '2026-10-13T00:30:00+08:00',
    observed_at: '2026-10-12T20:00:00+08:00', received_at: '2026-10-12T20:00:00+08:00',
    meta: { match_num_str: '周一002', match_num_date: '261012' },
  });
  const res = mergeMatchSources({ schedule: { matches: [sched] }, manual: { matches: [mk('人工A'), mk('人工B')] } });
  const hits = res.pool.filter((m) => m.match_id === '2041922');
  assert.equal(hits.length, 1, '同一官方 match_id 只允许一条池条目');
  assert.equal(hits[0].meta.manual_match_id, '人工A', '首到者胜出，且保留人工侧 id 供溯源');
  const dup = res.dismissed.filter((d) => d.reason === 'duplicate_official_anchor');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].manual_match_id, '人工B');
});

test('⑦i 合并 meta 保留 manual_match_id（顶层 id 被官方接管后仍可溯源）', () => {
  const sched = scheduleMatch({
    match_id: '2041922', league: '意大利甲级联赛', home_team: '亚特兰大', away_team: '威尼斯',
    match_time: '2026-10-13T00:30:00+08:00',
    meta: { match_num_str: '周一002', match_num_date: '261012' },
  });
  const manual = manualMatch({
    match_id: '意甲_亚特兰大_vs_威尼斯', league: '意甲', home_team: '亚特兰大', away_team: '威尼斯',
    match_time: '2026-10-13T00:30:00+08:00',
    observed_at: '2026-10-12T20:00:00+08:00', received_at: '2026-10-12T20:00:00+08:00',
    meta: { match_num_str: '周一002', match_num_date: '261012' },
  });
  const res = mergeMatchSources({ schedule: { matches: [sched] }, manual: { matches: [manual] } });
  assert.equal(res.pool[0].match_id, '2041922');
  assert.equal(res.pool[0].meta.manual_match_id, '意甲_亚特兰大_vs_威尼斯');
});
