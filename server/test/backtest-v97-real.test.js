// ============================================================================
// V9.7 真实回测 · v97_real 测试（hermetic 合成数据，不依赖 DB/网络）
// 覆盖：覆盖统计 / 命中台账 / S25 大小球倾向探针数学 / 无赛果不虚报
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { backtestRule, backtestRules, probeRule } = require('../src/backtest/v97_real');

/** 恒命中规则（league=英超 → competition_type=联赛 恒真），effects 输出 S25 式大小球信号。 */
function s25LikeRule() {
  return {
    id: 'S25',
    atoms: [{
      atom_id: 'S25.1',
      all_of: [{ field: 'competition_type', op: 'eq', value: '联赛' }],
      effects: [{ dimension: 'total_goals_signal', value: '赔付放开=略看小球' }],
    }],
  };
}

function mkMatch(over = {}) {
  const base = {
    match_id: 'm1', league: '英超', home_team: 'A', away_team: 'B',
    match_time: '2026-08-14T18:00:00+08:00', status: 'scheduled',
    observed_at: '2026-08-14T10:00:00+08:00', received_at: '2026-08-14T10:00:00+08:00',
    actual_result: 'home_win', home_score: 2, away_score: 0,
    meta: { total_goals: 2, kickoff_display: '08-14 18:00' },
    snapshots: [{
      snapshot_id: 's1', match_id: 'm1', institution: 'macau', market: 'over_under',
      source_id: 'src_manual_odds', trust_level: 'provisional',
      observed_at: '2026-08-14T10:00:00+08:00', received_at: '2026-08-14T10:00:00+08:00',
      data: { line: '2.5', over_odds: 0.9, under_odds: 0.9 },
    }],
    errors: [],
  };
  return { ...base, ...over, snapshots: over.snapshots || base.snapshots };
}

test('v97_real：覆盖统计 + 命中台账 + S25 探针（total_goals vs 线中线）', () => {
  const m1 = mkMatch(); // 总进球 2 < 2.5 → under 命中
  const m2 = mkMatch({ match_id: 'm2', meta: { total_goals: 5 }, home_team: 'C', away_team: 'D' }); // 5 > 2.5 → under 不中
  const m3 = mkMatch({ match_id: 'm3', meta: { total_goals: null }, home_team: 'E', away_team: 'F', actual_result: null }); // 无赛果/无总进球
  const res = backtestRule(s25LikeRule(), [m1, m2, m3]);
  assert.equal(res.tally.hit, 3, '三条恒命中');
  assert.equal(res.tally.insuff, 0);
  assert.equal(res.ledger_count, 3);
  assert.ok(res.probe, 'S25 应有探针');
  assert.equal(res.probe.total, 2, '无总进球者不参与判向（不虚报）');
  assert.equal(res.probe.hits, 1, '2<2.5 under 中；5>2.5 under 不中');
  assert.equal(res.probe.hit_rate, 0.5);
});

test('v97_real：非 S25 规则无探针（effects 无结果语义，不臆造命中率）', () => {
  const rule = { id: 'R01', atoms: [{ atom_id: 'a', all_of: [{ field: 'competition_type', op: 'eq', value: '联赛' }], effects: [{ dimension: 'classification', value: '极致平权盘' }] }] };
  const res = backtestRule(rule, [mkMatch()]);
  assert.equal(res.tally.hit, 1);
  assert.equal(res.probe, undefined, '非探针规则不得输出命中率');
  assert.equal(res.ledger[0].actual_result, 'home_win', '台账带赛果供人工核验');
});

test('v97_real：probeRule 语义映射（小球→under / 大球→over / 无→null）', () => {
  const fn = probeRule('S25');
  assert.equal(fn({ total_goals_signal: ['赔付放开=略看小球'] }).lean, 'under');
  assert.equal(fn({ total_goals_signal: ['略看大球'] }).lean, 'over');
  assert.equal(fn({ signal: ['x'] }).lean, null);
  assert.equal(probeRule('R01'), null, '非探针规则返回 null');
});

test('v97_real：backtestRules 排序 + 仅保留有求值价值规则', () => {
  const res = backtestRules([s25LikeRule(), { id: 'R99', atoms: [{ atom_id: 'a', all_of: [{ field: 'no_such_field_x', op: 'eq', value: 1 }] }] }], [mkMatch()]);
  assert.equal(res.length, 1, 'R99 全 insufficient → 不输出');
  assert.equal(res[0].rule_id, 'S25');
});
