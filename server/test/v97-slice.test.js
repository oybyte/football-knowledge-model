// ============================================================================
// V9.7 引擎垂直切片测试
// 覆盖：盘口符号约定 / 档位规范化 / 算子 / 缺值三态 / R13 端到端
// 说明：用合成夹具保持 hermetic（不依赖外部 registry 目录）；
//       真实 registry + 真实 161 场数据的验证见 scripts/v97-slice-run.js
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { resolveHandicap, depthBand, canonicalBand, parseDepth, deriveKelly, isSaneWater } = require('../src/engine/v97/handicap');
const { ok, estimated, insufficient, isUsable, STATUS } = require('../src/engine/v97/envelope');
const { evaluate: evalOp, UNKNOWN } = require('../src/engine/v97/ops');
const { getField } = require('../src/engine/v97/fields');
const { runRule, STATUS: RUN_STATUS } = require('../src/engine/v97/run');

// ---------- 盘口符号约定（关键：搞反会让「上盘超高水」算成下盘水位）----------

test('① 让球方判定：line<0 → 主队受让，上盘=客队', () => {
  const r = resolveHandicap({ line: '-0.5', home_water: 1.0, away_water: 0.84 });
  assert.strictEqual(r.depth, 0.5);
  assert.strictEqual(r.upper, 'away', '负号表示主队受让，让球方应为客队');
  assert.strictEqual(r.upperWater, 0.84);
});

test('② 让球方判定：line>0 → 主队让球，上盘=主队', () => {
  const r = resolveHandicap({ line: '1', home_water: 0.9, away_water: 0.95 });
  assert.strictEqual(r.upper, 'home');
  assert.strictEqual(r.upperWater, 0.9);
});

test('③ 双盘口取中位： "-1.5/2" → 1.75（负号作用于整体，非仅第一段）', () => {
  const r = resolveHandicap({ line: '-1.5/2', home_water: 0.9, away_water: 0.95 });
  assert.strictEqual(r.depth, 1.75, '应为 1.75；若按 / 直接拆分会错算成 0.25');
  assert.strictEqual(r.isDual, true);
  assert.strictEqual(r.sign, -1);
  assert.strictEqual(r.upper, 'away', '双盘口同样由符号定让球方，不得因 NaN 走默认分支');
  assert.strictEqual(r.upperWater, 0.95);
});

test('③b 双盘口正号： "0/0.5" → 0.25，上盘=主队', () => {
  const r = resolveHandicap({ line: '0/0.5', home_water: 0.96, away_water: 0.88 });
  assert.strictEqual(r.depth, 0.25);
  assert.strictEqual(r.sign, 1);
  assert.strictEqual(r.upper, 'home');
});

test('④ 平手盘(line=0)：无让球方，约定取主队为上盘', () => {
  const r = resolveHandicap({ line: '0', home_water: 0.93, away_water: 0.85 });
  assert.strictEqual(r.depth, 0);
  assert.strictEqual(r.upper, 'home');
});

test('⑤ 脏水位(如 hw=57)被判定为不可用，而非静默参与计算', () => {
  assert.strictEqual(isSaneWater(57), false);
  const r = resolveHandicap({ line: '-0.5', home_water: 57, away_water: 0.95 });
  assert.strictEqual(r.upper, null, '水位越界时不应判定让球方');
  assert.match(r.reason, /水位缺失或越界/);
});

// ---------- 档位 ----------

test('⑥ 盘口深度分档边界：≤0.25 浅盘 / ≤0.5 中盘 / >0.5 深盘', () => {
  assert.strictEqual(depthBand(0), '浅盘');
  assert.strictEqual(depthBand(0.25), '浅盘');
  assert.strictEqual(depthBand(0.5), '中盘');
  assert.strictEqual(depthBand(0.75), '深盘');
  assert.strictEqual(depthBand(1), '深盘');
  assert.strictEqual(depthBand(null), null);
});

test('⑦ 档位字面量规范化：R01 的「深盘(≥半一)」≡ R13 的「深盘」', () => {
  assert.strictEqual(canonicalBand('深盘(≥半一)'), '深盘');
  assert.strictEqual(canonicalBand('浅盘(≤平半)'), '浅盘');
  assert.strictEqual(canonicalBand('深盘'), '深盘');
});

test('⑧ 盘口名解析：中文名与数值互通', () => {
  assert.strictEqual(parseDepth('平半').depth, 0.25);
  assert.strictEqual(parseDepth('半一').depth, 0.75);
  assert.strictEqual(parseDepth('球半').depth, 1.5);
});

// ---------- 算子 ----------

test('⑨ eq 支持档位别名（注册表字面量不统一）', () => {
  assert.strictEqual(evalOp('eq', '深盘', '深盘(≥半一)'), true);
  assert.strictEqual(evalOp('eq', '深盘', '浅盘'), false);
});

test('⑩ gte/lte 支持中文盘口名的序数比较', () => {
  assert.strictEqual(evalOp('lte', 0.25, '平半'), true);
  assert.strictEqual(evalOp('gte', 0.75, '主让半一'), true);
  assert.strictEqual(evalOp('gte', 0.5, '半一'), false);
});

test('⑪ 数值比较与布尔等值', () => {
  assert.strictEqual(evalOp('gte', 1.02, 0.95), true);
  assert.strictEqual(evalOp('lte', 0.84, 0.95), true);
  assert.strictEqual(evalOp('eq', true, true), true);
  assert.strictEqual(evalOp('ne', 'a', 'b'), true);
});

test('⑫ 未实现的 custom 算子返回 UNKNOWN（而非 false）', () => {
  assert.strictEqual(evalOp('custom', 1, 1), UNKNOWN);
  assert.strictEqual(evalOp('custom', 1, 1), null);
});

// ---------- 缺值语义（决策 c 的核心）----------

test('⑬ insufficient_data 不是 false：信封可被使用性判定区分', () => {
  const miss = insufficient('无数据', { field: 'x' });
  assert.strictEqual(isUsable(miss), false);
  assert.strictEqual(miss.status, STATUS.INSUFFICIENT);
  assert.strictEqual(miss.value, null);
  assert.ok(miss.reason);
  assert.strictEqual(isUsable(ok(1)), true);
  assert.strictEqual(isUsable(estimated(1, { source: 's', method: 'm' })), true);
});

test('⑭ 未实现字段 → atom 标 insufficient_data，而非 miss（禁止静默跳过）', () => {
  const atom = { atom_id: 'X.1', all_of: [{ field: 'key_injury_confirmed', op: 'eq', value: true }], effects: [{ dimension: 'signal', value: 'S' }] };
  const ctx = { markets: { handicap: {} } };
  const { runRule: rr } = require('../src/engine/v97/run');
  const rule = { id: 'RX', atoms: [atom] };
  const res = rr(rule, ctx);
  assert.strictEqual(res.status, RUN_STATUS.INSUFFICIENT, '字段缺失应无结论，不能判为未命中');
  assert.deepStrictEqual(res.missing, ['key_injury_confirmed']);
  assert.deepStrictEqual(res.effects, [], '无结论时不得输出 effects');
});

test('⑮ required_inputs 缺失同样导致无结论', () => {
  const atom = { atom_id: 'Y.1', all_of: [{ field: 'water_level', op: 'gte', value: 0.95 }], required_inputs: ['kelly_range'], effects: [] };
  const ctx = {
    markets: { handicap: { macau: { current: { line: '1', home_water: 1.02, away_water: 0.82 } } } },
  };
  const { runRule: rr } = require('../src/engine/v97/run');
  const res = rr({ id: 'RY', atoms: [atom] }, ctx);
  // 只有 1 家机构 → kelly_range 无法计算 → insufficient
  assert.strictEqual(res.status, RUN_STATUS.INSUFFICIENT);
  assert.ok(res.missing.includes('kelly_range'));
});

// ---------- R13 端到端 ----------

/** 构造 R13 规则（结构与 registry 中 R13.1 一致）。 */
function r13Rule() {
  return {
    id: 'R13',
    name: '深盘超高水分级规则',
    category: '让球盘',
    type: 'R',
    atoms: [{
      atom_id: 'R13.1',
      action: '深盘超高水按分级规则执行',
      all_of: [
        { field: 'handicap_depth_band', op: 'eq', value: '深盘' },
        { field: 'water_level', op: 'gte', value: 0.95 },
      ],
      effects: [{ dimension: 'signal', value: '超高水分级' }],
      required_inputs: ['handicap_depth_band', 'water_level'],
    }],
  };
}

test('⑯ R13 端到端：深盘 + 上盘高水 → 命中，输出 signal 维度', () => {
  const ctx = {
    markets: {
      handicap: {
        macau: { current: { line: '1', home_water: 1.02, away_water: 0.82 } }, // 主队让1球，上盘=主队，水位1.02
      },
    },
  };
  const res = runRule(r13Rule(), ctx);
  assert.strictEqual(res.status, RUN_STATUS.HIT);
  assert.deepStrictEqual(res.dimensions, { signal: ['超高水分级'] });
});

test('⑰ R13 端到端：中盘 → 真实未命中（miss，不是 insufficient）', () => {
  const ctx = {
    markets: {
      handicap: {
        macau: { current: { line: '-0.5', home_water: 1.0, away_water: 0.84 } }, // 客队让0.5 → 中盘
      },
    },
  };
  const res = runRule(r13Rule(), ctx);
  assert.strictEqual(res.status, RUN_STATUS.MISS);
  assert.deepStrictEqual(res.missing, [], '字段均有值，不应报缺失');
});

test('⑱ R13 端到端：深盘但上盘低水 → 未命中', () => {
  const ctx = {
    markets: {
      handicap: {
        macau: { current: { line: '1', home_water: 0.85, away_water: 1.0 } }, // 上盘=主队，水位0.85 < 0.95
      },
    },
  };
  const res = runRule(r13Rule(), ctx);
  assert.strictEqual(res.status, RUN_STATUS.MISS);
});

test('⑲ 字段信封携带来源与方法（可追溯）', () => {
  const ctx = {
    markets: { handicap: { macau: { current: { line: '1', home_water: 1.02, away_water: 0.82 } } } },
  };
  const wl = getField('water_level', ctx);
  assert.strictEqual(wl.status, STATUS.OK);
  assert.strictEqual(wl.value, 1.02);
  assert.match(wl.method, /上盘=主队/);
  assert.strictEqual(wl.source, 'src_manual_odds');
});

test('㉑ 规则形态兼容：RuleVersion（atoms 在 v97 里）不得被静默判为 miss', () => {
  // v97loader 产出的是 RuleVersion，atoms 在 rule.v97 内；只认 rule.atoms 会取到空数组。
  const ruleVersion = {
    rule_id: 'R13',
    rule_type: 'R',
    category: '让球盘',
    condition: { kind: 'v97_atoms', atom_count: 1 },
    v97: {
      id: 'R13',
      name: '深盘超高水分级规则',
      atoms: [{
        atom_id: 'R13.1',
        all_of: [
          { field: 'handicap_depth_band', op: 'eq', value: '深盘' },
          { field: 'water_level', op: 'gte', value: 0.95 },
        ],
        effects: [{ dimension: 'signal', value: '超高水分级' }],
      }],
    },
  };
  const ctx = { markets: { handicap: { macau: { current: { line: '1', home_water: 1.02, away_water: 0.82 } } } } };
  const res = runRule(ruleVersion, ctx);
  assert.strictEqual(res.status, RUN_STATUS.HIT, 'RuleVersion 形态必须同样能求值');
  assert.strictEqual(res.rule_id, 'R13');
  assert.strictEqual(res.name, '深盘超高水分级规则');
  assert.deepStrictEqual(res.dimensions, { signal: ['超高水分级'] });
});

test('㉒ 无 atom 的规则报 insufficient（形态错配显式暴露，不静默 miss）', () => {
  const res = runRule({ id: 'RZ', atoms: [] }, { markets: { handicap: {} } });
  assert.strictEqual(res.status, RUN_STATUS.INSUFFICIENT);
  assert.strictEqual(res.no_atoms, true);
});

test('⑳ 凯利派生：多家机构分歧 → 极差 > 0；单机构 → insufficient', () => {
  const rows = [
    { institution: 'a', home_water: 1.02, away_water: 0.82, upper: 'home' },
    { institution: 'b', home_water: 0.9, away_water: 0.95, upper: 'away' },
  ];
  const k = deriveKelly(rows);
  assert.strictEqual(k.n, 2);
  assert.ok(k.range > 0, '两家机构应有分歧');
  assert.strictEqual(deriveKelly([rows[0]]).range, null, '单机构无法衡量分歧');

  const ctx = { markets: { handicap: { macau: { current: { line: '1', home_water: 1.02, away_water: 0.82 } } } } };
  const kr = getField('kelly_range', ctx);
  assert.strictEqual(kr.status, STATUS.INSUFFICIENT, '机构不足 2 家应无结论，不得猜 0');
});

// ---------- 第二批字段（线/水位变动、比赛类型、机构共振）----------

test('㉓ initial_line：初盘深度（参考机构，数值可参与 gte/lte）', () => {
  const ctx = {
    match: { league: '英超' },
    markets: { handicap: { macau: { initial: { line: '0.5', home_water: 1.0, away_water: 0.84 }, current: { line: '0.5', home_water: 1.0, away_water: 0.84 } } } },
  };
  const f = getField('initial_line', ctx);
  assert.strictEqual(f.status, STATUS.OK);
  assert.strictEqual(f.value, 0.5);
  assert.match(f.method, /初盘/);
  // 与中文盘口名可比：gte '半一' 应为 false（0.5 < 0.75）
  assert.strictEqual(evalOp('gte', f.value, '半一'), false);
});

test('㉔ line_change：初盘0.5 → 即盘0.25 → 退盘；幅度 0.25', () => {
  const ctx = {
    match: { league: '英超' },
    markets: { handicap: { macau: { initial: { line: '0.5', home_water: 1.0, away_water: 0.84 }, current: { line: '0.25', home_water: 1.0, away_water: 0.84 } } } },
  };
  const f = getField('line_change', ctx);
  assert.strictEqual(f.status, STATUS.OK);
  assert.strictEqual(f.value, '退盘');
  const mag = getField('line_change_magnitude', ctx);
  assert.strictEqual(mag.value, 0.25);
});

test('㉕ line_change：缺初盘 → insufficient（不得假横盘）', () => {
  const ctx = {
    match: { league: '英超' },
    markets: { handicap: { macau: { current: { line: '0.5', home_water: 1.0, away_water: 0.84 } } } },
  };
  assert.strictEqual(getField('line_change', ctx).status, STATUS.INSUFFICIENT);
});

test('㉖ total_goals_line_move + over_water_move：2/2.5→2.5 升盘 + 大球水位升水', () => {
  const ctx = {
    match: { league: '英超' },
    markets: { over_under: { macau: { initial: { line: '2/2.5', over_odds: 0.9, under_odds: 0.9 }, current: { line: '2.5', over_odds: 1.0, under_odds: 0.8 } } } },
  };
  assert.strictEqual(getField('total_goals_line_move', ctx).value, '升盘');
  assert.strictEqual(getField('over_water_move', ctx).value, '升水');
});

test('㉗ competition_type：联赛名粗粒度分类', () => {
  const mk = (league) => getField('competition_type', { match: { league }, markets: {} });
  assert.strictEqual(mk('英联杯').value, '杯赛');
  assert.strictEqual(mk('日职联').value, '联赛');
  assert.strictEqual(mk('友谊赛').value, '友谊赛');
  assert.strictEqual(mk('欧冠杯').value, '杯赛');
  assert.strictEqual(mk('未知赛制').status, STATUS.INSUFFICIENT, '无法判定不得瞎猜');
});

test('㉘ bookmakers_resonant_count：同深度机构数（静态共识近似）', () => {
  const ctx = {
    match: { league: '英超' },
    markets: { handicap: {
      macau: { current: { line: '1', home_water: 1.0, away_water: 0.84 } },
      ct366: { current: { line: '1', home_water: 0.98, away_water: 0.83 } },
      william: { current: { line: '0.5', home_water: 0.95, away_water: 0.85 } },
    } },
  };
  const f = getField('bookmakers_resonant_count', ctx);
  assert.strictEqual(f.status, STATUS.ESTIMATED);
  assert.strictEqual(f.value, 2, '参考机构 macau depth=1，同深度 ct366 共 2 家');
});

test('㉙ toOrdinal 兼容「盘」后缀：平半盘 → 0.25（R24 none_of 比较可用）', () => {
  assert.strictEqual(evalOp('eq', 0.25, '平半盘'), true, '数值 0.25 应等值于「平半盘」');
  assert.strictEqual(evalOp('eq', 0.5, '半球盘'), true);
});
