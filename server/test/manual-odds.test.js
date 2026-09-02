// ============================================================================
// 本地人工盘赔源 · 接入与解析验收测试
// 覆盖：① 盘口数据.md → MatchSchema 解析（元信息/赛果/多份盘口快照）
//       ② 快照信任分级（src_manual_odds / provisional）与时间防泄漏
//       ③ 目录根动态配置（env:OE_MANUAL_ODDS_ROOT）
//       ④ not_configured（未配置根目录）/ degraded（根目录缺失）
//       ⑤ schema 校验通过
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseOddsMd } = require('../src/data/manual/odds_parser');
const { scanManualOddsRoot } = require('../src/data/manual');
const { loadManualOdds, querySources } = require('../src/data');
const { validateMatch } = require('../src/data/schema');

const SAMPLE = `# 盘口截图数据

## 比赛基础信息

- 赛事：日职联
- 比赛：东京绿茵（中） vs 柏太阳神（用户修正）
- 开赛时间：08-14 18:00
- 数据来源：用户提供截图

## 比赛结果

- 半场比分：1 - 1
- 全场比分：1 - 3
- 总进球：4

## 让球盘数据

（主水 / 盘口 / 客水）
| 机构 | 初盘 | 即盘 |
|---|---|---|
| 澳* | 1.00 / -0.5 / 0.84 | 1.02 / -0.5 / 0.82 |
| 36*(英国) | 0.98 / -0.5 / 0.83 | 1.00 / -0.5 / 0.80 |

## 胜平负数据

（主胜 / 平局 / 客胜）
| 机构 | 初盘 | 即盘 |
|---|---|---|
| 澳* | 3.90 / 3.22 / 1.84 | 4.00 / 3.20 / 1.82 |
| 威*(英国) | 4.40 / 3.25 / 1.80 | 4.20 / 3.20 / 1.85 |

## 澳门让球详细变化

（主水 / 盘口 / 客水）
| 显示时间 | 状态 | 数据 |
|---|---|---|
| 08-14 17:37 | 即 | 1.02 / -0.5 / 0.82 |
| 08-14 14:43 | 即 | 0.96 / -0.5 / 0.88 |

## 澳门胜平负详细变化

| 显示时间 | 状态 | 主胜 / 平局 / 客胜 | 返还率 | 凯利指数 |
|---|---|---|---|---:|
| 08-14 17:37 | 即 | 4.00 / 3.20 / 1.82 | 89.93 | 0.86 / 0.90 / 0.92 |

## 必发交易盈亏

交易量：19,836

| 结果 | 欧指 | 交易量 | 盈亏 | 冷热指数 |
|---|---|---|---:|---:|---:|
| 胜 | 4.5 | 1,456 | 13,284 | -66 |`;

// ═════════════ ① 解析 → MatchSchema ═════════════
test('① 盘口数据.md → MatchSchema：元信息 + 赛果', () => {
  const { ok, match, errors } = parseOddsMd(SAMPLE, { year: 2026 });
  assert.equal(ok, true, JSON.stringify(errors));
  assert.equal(match.league, '日职联');
  assert.equal(match.home_team, '东京绿茵');
  assert.equal(match.away_team, '柏太阳神');
  assert.equal(match.neutral, true); // （中）→ 中立
  assert.equal(match.match_time, '2026-08-14T18:00:00+08:00');
  assert.equal(match.actual_result, 'away_win'); // 1-3
  assert.equal(match.home_score, 1);
  assert.equal(match.away_score, 3);
  assert.equal(match.meta.kickoff_display, '08-14 18:00');
  assert.equal(match.meta.total_goals, 4);
});

test('① 多份盘口快照被解析（handicap/european/bf/澳门时序）', () => {
  const { ok, match } = parseOddsMd(SAMPLE, { year: 2026 });
  assert.equal(ok, true);
  // 让球初即 4 + 欧赔初即 4 + 澳门让球时序 2 + 澳门欧指时序 1 + 必发 1
  assert.equal(match.snapshots.length, 12);
  const markets = new Set(match.snapshots.map((s) => s.market));
  assert.deepEqual([...markets].sort(), ['bf', 'european', 'handicap']);
});

test('① 让球盘机构/盘口/水位归一化正确', () => {
  const { match } = parseOddsMd(SAMPLE, { year: 2026 });
  const hc = match.snapshots.filter((s) => s.market === 'handicap' && s.institution === 'macau');
  const init = hc.find((s) => s.data.timing === 'initial');
  const cur = hc.find((s) => s.data.timing === 'current');
  assert.equal(init.data.line, '-0.5');
  assert.equal(init.data.home_water, 1); // 主水 1.00
  assert.equal(init.data.away_water, 0.84); // 客水 0.84
  assert.equal(cur.data.home_water, 1.02); // 即盘主水 1.02
  assert.equal(cur.data.timing_estimate, true); // 初/即盘为估算时点，显式标记
});

test('① 澳门分时时序使用真实显示时间（非估算）', () => {
  const { match } = parseOddsMd(SAMPLE, { year: 2026 });
  const tl = match.snapshots.filter((s) => s.data.timing === 'timeline');
  assert.ok(tl.length >= 2);
  for (const s of tl) {
    assert.equal(s.data.timing_estimate, false);
    assert.equal(match.match_time > s.observed_at, true); // 时序点早于开赛
  }
  const tlHc = tl.find((s) => s.market === 'handicap');
  assert.ok(tlHc && tlHc.data.display_time === '08-14 17:37');
});

// ═════════════ ② 信任分级 + 时间防泄漏 ═════════════
test('② 所有快照标记 src_manual_odds / provisional，且时点不晚于开赛', () => {
  const { match } = parseOddsMd(SAMPLE, { year: 2026 });
  const mt = Date.parse(match.match_time);
  for (const s of match.snapshots) {
    assert.equal(s.source_id, 'src_manual_odds');
    assert.equal(s.trust_level, 'provisional');
    assert.equal(Date.parse(s.received_at) >= Date.parse(s.observed_at), true);
    assert.equal(Date.parse(s.observed_at) <= mt, true, s.snapshot_id + ' 泄漏');
    assert.equal(Date.parse(s.received_at) <= mt, true, s.snapshot_id + ' 泄漏');
  }
});

// ═════════════ ⑤ schema 校验 ═════════════
test('⑤ 解析产物通过 validateMatch（errors 为空）', () => {
  const { match } = parseOddsMd(SAMPLE, { year: 2026 });
  const { errors } = validateMatch(match);
  assert.deepEqual(errors, []);
});

// ═════════════ ③ 目录根动态配置 ═════════════
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oe-manual-'));
test('③ 动态配置根目录扫描：读取 盘口数据.md 并接入', () => {
  const sub = path.join(tmpDir, 'match-01');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'empty-dir')); // 无 md 的子目录应被跳过
  fs.writeFileSync(path.join(sub, MD_NAME()), SAMPLE, 'utf8');

  const res = scanManualOddsRoot({ env: { OE_MANUAL_ODDS_ROOT: tmpDir }, actor: { id: 'test', role: 'ingest' }, year: 2026 });
  assert.equal(res.source_id, 'src_manual_odds');
  assert.equal(res.status, 'ok');
  assert.equal(res.meta.total, 1); // 仅统计含 md 的目录
  assert.equal(res.meta.admitted, 1);
  assert.equal(res.matches[0].match_id, res.matches[0].match_id);
  assert.equal(res.matches[0].home_team, '东京绿茵');
});

test('③ 迁移根目录仅需改 env', () => {
  const root2 = path.join(tmpDir, 'moved');
  const sub = path.join(root2, 'match-02');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, MD_NAME()), SAMPLE.replace('日职联', '英超'), 'utf8');

  const res = scanManualOddsRoot({ env: { OE_MANUAL_ODDS_ROOT: root2 }, year: 2026 });
  assert.equal(res.status, 'ok');
  assert.equal(res.matches[0].league, '英超');
  assert.equal(res.meta.total, 1);
});

// ═════════════ ④ 未配置 / 根目录缺失 ═════════════
test('④ 未配置根目录 → not_configured（诚实，零数据）', () => {
  const res = loadManualOdds({ env: {} });
  assert.equal(res.status, 'not_configured');
  assert.equal(res.reason, 'MANUAL_ODDS_ROOT_UNCONFIGURED');
  assert.deepEqual(res.matches, []);
});

test('④ 根目录缺失 → degraded', () => {
  const res = loadManualOdds({ env: { OE_MANUAL_ODDS_ROOT: 'C:/__no_such_dir__' } });
  assert.equal(res.status, 'degraded');
  assert.equal(res.reason, 'MANUAL_ODDS_ROOT_MISSING');
});

test('④ 注册表可查询到本地人工盘赔源', () => {
  const s = querySources('src_manual_odds');
  assert.ok(s);
  assert.equal(s.source_type, 'odds');
  assert.equal(s.trust_level, 'provisional');
  assert.equal(s.config_ref, 'env:OE_MANUAL_ODDS_ROOT');
});

// 清理临时目录（测试结束时）
test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function MD_NAME() { return '盘口数据.md'; }
test('①b 基础信息含「体彩期号：周三001」→ meta.match_num_str 落库（期号锚定输入）', () => {
  const md = `# 盘口截图数据

## 比赛基础信息

- 赛事：日联杯
- 比赛：八户云罗里 vs 杨木市FC（用户修正）
- 开赛时间：09-02 17:30
- 体彩期号：周三001
- 数据来源：用户提供截图

## 让球盘数据

（主水 / 盘口 / 客水）
| 机构 | 初盘 | 即盘 |
|---|---|---|
| 澳* | 0.77 / -0/0.5 / 1.01 | 0.75 / -0/0.5 / 1.03 |
`;
  const r = parseOddsMd(md, { year: 2026 });
  assert.equal(r.ok, true);
  assert.equal(r.match.meta.match_num_str, '周三001');
  assert.equal(r.match.meta.source_kind, 'manual_md');
  // 无期号行 → null（不臆造）
  const r2 = parseOddsMd(md.replace('- 体彩期号：周三001\n', ''), { year: 2026 });
  assert.equal(r2.match.meta.match_num_str, null);
});
