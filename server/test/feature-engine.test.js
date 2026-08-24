// ============================================================================
// 1.2 特征工程服务 · 验收测试
// 覆盖实施计划 1.2 的 3 条验收标准 + 缓存：
//   ① 特征值与原型一致（同一输入同一输出）
//   ② point-in-time：observed_at ≤ T 才参与计算，未来快照被过滤
//   ③ 字段名与 dsl-syntax 字段注册表一致（features 键 ⊆ 注册表字段集合）
//   ④ 缓存：命中/未命中/TTL/失效
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getMockMatch } = require('../src/data/mock');
const { computeMatchFeatures, cacheHitRate, FeatureCache, FEATURE_VERSION } = require('../src/features');
const { adaptMatch } = require('../src/features/adapt');
const { assertNoFutureData } = require('../src/features/pointInTime');

// 设计文档 §3 输出字段全集（23 个）
const OUTPUT_FIELDS = [
  // 3.1 横截面
  'institution.diff_max', 'water.upper.dispersion', 'water.lower.dispersion',
  // 3.2 时序
  'handicap.change', 'handicap.current', 'water.upper.change', 'water.lower.change',
  'water.upper.drop_count', 'water.upper.rise_count', 'time_to_match', 'move_pattern', 'stability_flag',
  // 3.3 共振
  'institution.sync_count', 'consensus_direction',
  // 3.4 异常
  'kelly_index.max', 'kelly_index.min', 'kelly_index.divergence', 'volume.ratio', 'odds.volatility',
  // 3.5 欧指 + 必发
  'kelly_index.home_max', 'betfair.dominant_ratio', 'betfair.heat', 'betfair.turnover',
];

// dsl-syntax 注册表字段集合（§4.1 核心 + §4.2 扩展）
const REGISTRY_FIELDS = new Set([
  ...OUTPUT_FIELDS,
  'match.league', 'match.home_team', 'result.outcome',
]);

const T_FULL = '2026-08-14T17:45:00+08:00'; // 全部快照可得（current 17:30 ≤ T）
const T_EARLY = '2026-08-14T17:00:00+08:00'; // current 快照被过滤

// ───────────────────────── 验收① 特征值与原型一致 ─────────────────────────
test('验收① M007 特征值与原型一致（同一输入同一输出）', () => {
  const m = getMockMatch('M007');
  const { ok, snapshot, errors } = computeMatchFeatures(m, T_FULL);
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  const f = snapshot.features;
  // 横截面（原型 cross.*）
  assert.equal(f['institution.diff_max'], 0);
  assert.equal(f['water.upper.dispersion'], 0.17);
  assert.equal(f['water.lower.dispersion'], 0.05);
  // 时序（原型 temp.*）
  assert.equal(f['handicap.change'], 0);
  assert.equal(f['handicap.current'], -0.5);
  assert.equal(f['water.upper.change'], -0.04);
  assert.equal(f['water.lower.change'], 0.038);
  assert.equal(f['water.upper.drop_count'], 2);
  assert.equal(f['water.upper.rise_count'], 0);
  assert.equal(f.move_pattern, '稳定');
  assert.equal(f.stability_flag, true);
  // 共振（原型 reso.*）
  assert.equal(f['institution.sync_count'], 0);
  assert.equal(f.consensus_direction, '无');
  // 欧指（原型 onex.kelly_home_max）
  assert.equal(f['kelly_index.home_max'], 0.98);
  // 必发（原型 betfair.*）
  assert.equal(f['betfair.dominant_ratio'], 0.588);
  assert.equal(f['betfair.heat'], 110);
  assert.equal(f['betfair.turnover'], 19836);
  // 距开赛时间（match_time 18:00 − T 17:45）
  assert.equal(f.time_to_match, 15);
  // 无数据/预留字段为 null
  assert.equal(f['kelly_index.max'], null);
  assert.equal(f['kelly_index.min'], null);
  assert.equal(f['kelly_index.divergence'], null);
  assert.equal(f['volume.ratio'], null);
  assert.equal(f['odds.volatility'], null);
});

test('验收① FeatureSnapshot 契约字段齐全', () => {
  const m = getMockMatch('M007');
  const { snapshot } = computeMatchFeatures(m, T_FULL);
  assert.ok(snapshot.feature_id.startsWith('feat_M007_'));
  assert.equal(snapshot.match_id, 'M007');
  assert.equal(snapshot.computed_at, T_FULL);
  assert.equal(snapshot.feature_version, FEATURE_VERSION);
  assert.ok(snapshot.meta.snapshot_count > 0);
  assert.equal(snapshot.meta.filtered_out, 0);
  assert.ok(Array.isArray(snapshot.meta.sources));
  assert.ok(snapshot.meta.sources.includes('src_odds_macau'));
});

// ───────────────────────── 验收② point-in-time ─────────────────────────
test('验收② T 早于 current 快照时被过滤且不泄漏', () => {
  const m = getMockMatch('M007');
  const { ok, snapshot } = computeMatchFeatures(m, T_EARLY);
  assert.equal(ok, true);
  // 16 份 current 快照（4 让球 + 6 欧指 + 5 大小 + 1 必发）observed_at=17:30 > T
  assert.ok(snapshot.meta.filtered_out > 0);
  // 必发快照被过滤 → 必发特征为 null
  assert.equal(snapshot.features['betfair.dominant_ratio'], null);
  assert.equal(snapshot.features['betfair.turnover'], null);
  // 距开赛时间 = 60 分钟
  assert.equal(snapshot.features.time_to_match, 60);
  // 防御性校验：参与计算的快照均 observed_at ≤ T
  const { markets } = adaptMatch(m, T_EARLY);
  const pit = assertNoFutureData(markets, T_EARLY);
  assert.equal(pit.ok, true);
  assert.deepEqual(pit.leaks, []);
});

test('验收② 防御性校验拒绝未来数据', () => {
  const markets = {
    handicap: {
      macau: {
        initial: { line: -0.5, observed_at: '2026-08-14T12:00:00+08:00' },
        current: { line: -0.5, observed_at: '2026-08-14T19:00:00+08:00' }, // 开赛后
      },
    },
  };
  const pit = assertNoFutureData(markets, '2026-08-14T18:00:00+08:00');
  assert.equal(pit.ok, false);
  assert.ok(pit.leaks.length >= 1);
  assert.ok(pit.leaks[0].includes('handicap:macau:current'));
});

// ───────────────────────── 验收③ 字段名与注册表一致 ─────────────────────────
test('验收③ 输出字段名 ⊆ dsl-syntax 注册表字段集合', () => {
  const m = getMockMatch('M007');
  const { snapshot } = computeMatchFeatures(m, T_FULL);
  for (const k of Object.keys(snapshot.features)) {
    assert.ok(REGISTRY_FIELDS.has(k), `字段 ${k} 必须在注册表登记`);
  }
});

test('验收③ 输出字段集与设计文档 §3 完全一致', () => {
  const m = getMockMatch('M007');
  const { snapshot } = computeMatchFeatures(m, T_FULL);
  assert.deepEqual(Object.keys(snapshot.features).sort(), [...OUTPUT_FIELDS].sort());
});

// ───────────────────────── 验收④ 缓存 ─────────────────────────
test('验收④ FeatureCache 命中/未命中与命中率', () => {
  const c = new FeatureCache();
  assert.equal(c.get('M1', 'T1'), null);
  c.set('M1', 'T1', { v: 1 });
  assert.deepEqual(c.get('M1', 'T1'), { v: 1 });
  assert.equal(c.get('M1', 'T2'), null); // 不同时点 → 不同键 → 未命中
  assert.equal(c.hitRate(), 1 / 3); // 1 命中 / 3 次访问
});

test('验收④ FeatureCache TTL 过期', () => {
  const c = new FeatureCache({ ttlMs: -1 }); // 立即过期
  c.set('M1', 'T1', { v: 1 });
  assert.equal(c.get('M1', 'T1'), null);
});

test('验收④ FeatureCache invalidate 主动失效', () => {
  const c = new FeatureCache();
  c.set('M1', 'T1', { v: 1 });
  c.set('M1', 'T2', { v: 2 });
  c.invalidate('M1');
  assert.equal(c.get('M1', 'T1'), null);
  assert.equal(c.get('M1', 'T2'), null);
});

test('验收④ computeMatchFeatures 同 T 二次调用命中缓存', () => {
  const m = getMockMatch('M007');
  const before = cacheHitRate();
  const r1 = computeMatchFeatures(m, T_FULL);
  const r2 = computeMatchFeatures(m, T_FULL);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r1.snapshot, r2.snapshot); // 同一引用 → 缓存命中
  assert.ok(cacheHitRate() > before);
});

// ───────────────────────── 附加：输入防御 ─────────────────────────
test('无效 match 返回错误', () => {
  const { ok, snapshot, errors } = computeMatchFeatures(null, T_FULL);
  assert.equal(ok, false);
  assert.equal(snapshot, null);
  assert.ok(errors.includes('invalid_match'));
});
