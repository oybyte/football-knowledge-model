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
const { assertNoFutureData } = require('../src/features/point_in_time');

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
  const { ok, snapshot, errors } = computeMatchFeatures(m, T_FULL, { analyzedAt: T_FULL });
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
  // 距开赛时间 = match_time 18:00 − analyzedAt 17:45。
  // 注意：analyzedAt 必须显式传入——它表示「分析时刻」，与数据截取上界 T 是两个语义，
  // 历史缺陷是把二者混用（拿 T 当分析时刻），导致该字段恒为 0。
  assert.equal(f.time_to_match, 15);
  // 异常族凯利：取自**欧指**（各机构 latest_kelly 的 kelly_home/draw/away 全集极值）。
  // 历史缺陷：曾从让球盘读 current.kelly（该字段不存在）→ 无论数据多全恒为 null。
  assert.equal(f['kelly_index.max'], 0.99);
  assert.equal(f['kelly_index.min'], 0.86);
  assert.equal(f['kelly_index.divergence'], 0.13);
  // 以下两个仍为 null 属数据源限制 / 规划内占位，非实现缺失：
  //   volume.ratio 需必发成交量（本数据源无必发章节）；odds.volatility 为预留字段。
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
  const { ok, snapshot } = computeMatchFeatures(m, T_EARLY, { analyzedAt: T_EARLY });
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
  // 命中判定用 cacheHitRate 提升，而非引用相等：`time_to_match` 依赖「分析时刻」（默认取当前
  // 时刻），不能进缓存，故命中路径会返回按本次 analyzedAt 覆写后的浅拷贝（见 features/index.js）。
  assert.ok(cacheHitRate() > before, '同 (match_id, T) 二次调用应命中缓存');
  assert.equal(r1.snapshot.feature_id, r2.snapshot.feature_id);
  assert.deepEqual(r1.snapshot.features, r2.snapshot.features);
});

// ───────────────── 验收⑤ 凯利取点（2026-10-12 修复回归） ─────────────────
test('验收⑤ latest_kelly 取最近一条带凯利的观测，且同样受 T 过滤', () => {
  const m = getMockMatch('M007');
  // 凯利行分布在多个时点（12:00 与 17:30），而欧指 current 是「即盘估算行」——
  // 历史缺陷用 current.kelly_home 取凯利，取不到才是问题；latest_kelly 明确取最近一条带凯利的行。
  const full = adaptMatch(m, T_FULL).markets.european;
  assert.equal(full.betfair.latest_kelly.kelly_home, 0.98);
  assert.equal(full.betfair.latest_kelly.observed_at, '2026-08-14T17:30:00+08:00');
  assert.equal(full.macau.latest_kelly.kelly_home, 0.86);
  // 防泄漏边界：T 早于最晚凯利行时，自动回退到 T 之前的那条，绝不越过截取上界
  const early = adaptMatch(m, T_EARLY).markets.european;
  assert.equal(early.betfair.latest_kelly.observed_at, '2026-08-14T12:00:00+08:00');
  // T 早于全部凯利行 → 不得入选
  const none = adaptMatch(m, '2026-08-14T11:00:00+08:00').markets.european || {};
  assert.ok(!none.betfair || none.betfair.latest_kelly == null, 'T 之前的凯利行不得入选');
});

test('验收⑤ 异常族凯利取自欧指（不再错读让球盘而恒为 null）', () => {
  const { computeAnom } = require('../src/features/compute');
  // 空输入：五个字段全 null，不得抛错
  assert.deepEqual(computeAnom({}), {
    'kelly_index.max': null, 'kelly_index.min': null, 'kelly_index.divergence': null,
    'volume.ratio': null, 'odds.volatility': null,
  });
  // 传入欧指 latest_kelly → 全市场（各机构 × 胜平负三种）凯利极值与极差
  const out = computeAnom({
    macau: { latest_kelly: { kelly_home: 0.86, kelly_draw: 0.9, kelly_away: 0.92 } },
    william: { latest_kelly: { kelly_home: 0.98, kelly_draw: 0.8, kelly_away: 0.9 } },
  });
  assert.equal(out['kelly_index.max'], 0.98);
  assert.equal(out['kelly_index.min'], 0.8);
  assert.equal(out['kelly_index.divergence'], 0.18);
  // 无凯利行时回退 current；两者皆无则 null（诚实）
  assert.equal(computeAnom({ x: { current: { home_odds: 2 } } })['kelly_index.max'], null);
  // 量比与波动率是数据源限制/预留，不因传入凯利而有值
  assert.equal(out['volume.ratio'], null);
  assert.equal(out['odds.volatility'], null);
});

// ───────────────── 验收⑥ time_to_match 与数据截取上界解耦 ─────────────────
test('验收⑥ time_to_match 由 analyzedAt 决定，且不因缓存而陈旧', () => {
  const m = getMockMatch('M007'); // match_time 2026-08-14T18:00:00+08:00
  const at = (iso) => computeMatchFeatures(m, T_FULL, { analyzedAt: iso }).snapshot.features.time_to_match;
  // 同一个 T（→ 缓存命中）下，不同分析时刻必须得到不同值：这同时验证了
  // time_to_match 未随缓存固化（缓存命中路径会按本次 analyzedAt 覆写）
  assert.equal(at('2026-08-14T17:45:00+08:00'), 15);
  assert.equal(at('2026-08-14T17:00:00+08:00'), 60);
  assert.equal(at('2026-08-14T16:00:00+08:00'), 120);
  // 已开赛 → 负值，语义诚实不做 clamp
  assert.equal(at('2026-08-14T19:00:00+08:00'), -60);
});

test('验收⑥ minutesUntil 边界：非法时间返回 null', () => {
  const { minutesUntil } = require('../src/features/compute');
  assert.equal(minutesUntil('2026-08-14T18:00:00+08:00', '2026-08-14T17:45:00+08:00'), 15);
  assert.equal(minutesUntil('not-a-time', '2026-08-14T17:45:00+08:00'), null);
  assert.equal(minutesUntil('2026-08-14T18:00:00+08:00', 'nope'), null);
});

// ───────────────────────── 附加：输入防御 ─────────────────────────
test('无效 match 返回错误', () => {
  const { ok, snapshot, errors } = computeMatchFeatures(null, T_FULL);
  assert.equal(ok, false);
  assert.equal(snapshot, null);
  assert.ok(errors.includes('invalid_match'));
});
