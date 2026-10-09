// ============================================================================
// 前端契约 · 三页接真实端点渲染冒烟测试
// 在 VM + 最小 DOM 中加载 api-client → feature / backtest → app，接**真实后端**
// （:memory: DB + 临时人工盘赔目录），断言三页渲染出真实数据、mock 双轨仍可用、
// 且「后端未提供」项被诚实标注（不以伪随机/命中率现算填充）。
// 运行：node prototype-1.0.0/test/render-real-pages.js
// 背景：本用例源自 2026-10-09「前端三页接真实端点」改造，并在首次运行时抓到
//       app.js 路由漏挂 window.__rulesBoot 导致规则页永停 loading 的真实缺陷。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { createService } = require('../../server/src');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 最小 盘口数据.md（结构对齐真实文件，使特征端点产出真实数值）。 */
const SAMPLE_MD = `# 盘口截图数据

## 比赛基础信息

- 赛事：日职联
- 比赛：东京绿茵 vs 柏太阳神
- 开赛时间：08-14 18:00
- 数据来源：用户提供截图

## 比赛结果

- 全场比分：1 - 3
- 总进球：4

## 让球盘数据

（主水 / 盘口 / 客水）
| 机构 | 初盘 | 即盘 |
|---|---|---|
| 澳* | 1.00 / -0.5 / 0.84 | 1.02 / -0.5 / 0.82 |
| 36* | 0.98 / -0.5 / 0.83 | 1.00 / -0.5 / 0.80 |

## 胜平负数据

（主胜 / 平局 / 客胜）
| 机构 | 初盘 | 即盘 |
|---|---|---|
| 澳* | 3.90 / 3.22 / 1.84 | 4.00 / 3.20 / 1.82 |

## 必发交易盈亏

| 结果 | 欧指 | 交易量 | 盈亏 | 冷热指数 |
|---|---|---|---|---|
| 胜 | 4.5 | 1,456 | 13,284 | -66 |`;

// ───────────────────────── 最小 DOM ─────────────────────────
function el(tag) {
  return {
    tagName: tag || 'div', id: '', innerHTML: '', textContent: '', className: '', value: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {}, blur() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}
function fakeDoc() {
  const byId = new Map();
  return {
    getElementById(id) { if (!byId.has(id)) { const e = el(); e.id = id; byId.set(id, e); } return byId.get(id); },
    createElement: (t) => el(t),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: el('body'), documentElement: el('html'), addEventListener() {},
  };
}
function fakeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

const MATCHES = [
  { id: 'M001', league: '日职联', home: '东京绿茵', away: '柏太阳神', kickoff: '2026-08-14T18:00:00+08:00' },
  { id: 'M002', league: '韩K联', home: '首尔', away: '大田', kickoff: '2026-08-15T18:00:00+08:00' },
];
const RULES = [
  { id: 'R001', name: '升盘降水', conclusion: '升盘降水看好上盘', family: 'temporal', direction: 1, hasThreshold: true, threshold: 0.6 },
];
const MOCK_FEATURES = {
  cross: { handicap_dispersion: 0.25 }, temp: { move_pattern: '升盘降水' },
  reso: {}, anom: {}, onex: {}, betfair: {},
};

/** 构造「window === 全局对象」的浏览器同构沙箱，并加载四个脚本。 */
function loadPages(base) {
  const sandbox = {
    document: fakeDoc(),
    localStorage: fakeStorage({ oe_api_mode: 'real', oe_api_base: base }),
    fetch: global.fetch,
    console, Promise, setTimeout, clearTimeout,
    Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
    MATCHES, RULES, LOTTERY_API: '',
    LOTTERY_GROUPS: [{ id: 'today', label: '今日' }, { id: 'all', label: '全部' }],
    computeFeatures: () => MOCK_FEATURES,
    evaluate: () => ({ verdicts: [] }),
    module: { exports: {} },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(read('src/api-client/api-client.js'), sandbox, { filename: 'api-client.js' });
  vm.runInContext(read('feature.js'), sandbox, { filename: 'feature.js' });
  const featMod = sandbox.module.exports;      // FEAT_STATE
  sandbox.module.exports = {};
  vm.runInContext(read('backtest.js'), sandbox, { filename: 'backtest.js' });
  const btState = sandbox.__BACKTEST.BT_STATE;
  sandbox.module.exports = {};
  vm.runInContext(read('app.js'), sandbox, { filename: 'app.js' });

  return {
    sandbox,
    main: sandbox.document.getElementById('main'),
    featState: featMod.FEAT_STATE,
    btState,
  };
}

async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

/** 启动隔离后端（内存库 + 临时人工盘赔目录），返回 { svc, base, root }。 */
async function withBackend(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oe-render-'));
  fs.mkdirSync(path.join(root, 'm1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'm1', '盘口数据.md'), SAMPLE_MD, 'utf8');

  const saved = {};
  for (const k of ['OE_MANUAL_ODDS_ROOT', 'ODDS_SPORTTERY_SCHEDULE_BASE', 'OE_SPORTTERY_ANCHOR']) saved[k] = process.env[k];
  process.env.OE_MANUAL_ODDS_ROOT = root;
  delete process.env.ODDS_SPORTTERY_SCHEDULE_BASE;
  delete process.env.OE_SPORTTERY_ANCHOR;   // 默认锚源=赛程（未配置端点）→ 合并池 = 本地人工盘赔

  const svc = await createService({ dbPath: ':memory:', http: { port: 0 } });
  await new Promise((r) => svc.server.once('listening', r));
  const base = `http://127.0.0.1:${svc.server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => svc.server.close(r));
    svc.close();
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const MATCH_ID = '日职联_东京绿茵_vs_柏太阳神';

test('特征引擎页：接 /api/features/:id 渲染真实字段，未产出项诚实标注', { timeout: 40000 }, async () => {
  await withBackend(async (base) => {
    const { sandbox, main, featState } = loadPages(base);

    // app.js 顶层 `const state` 会遮蔽沙箱上的同名属性 → 统一用 setPage 驱动路由
    sandbox.setPage('feature');
    await waitFor(() => (main.innerHTML || '').includes('字段产出'));
    let h = main.innerHTML;

    assert.ok(h.includes('后端 /api/features/:id'), '应指明真实数据来源');
    assert.ok(!h.includes('Mock 计算示意'), 'real 模式不得显示 Mock 徽章');
    assert.ok(h.includes('未产出'), '应展示未产出统计');
    assert.ok(h.includes('后端未产出'), '未产出的字段须标注来源为后端未产出');
    assert.ok(!h.includes('后端不可用'), '不应进入错误态');

    const m = h.match(/字段产出<\/b><span>(\d+) \/ (\d+)<\/span>/);
    assert.ok(m, '应有字段产出计数');
    assert.equal(m[2], '27', '前端族字段契约合计 27 项');
    assert.ok(Number(m[1]) > 0 && Number(m[1]) < Number(m[2]), '真实后端应产出部分（非全部）字段');
    assert.ok(h.includes('计算'), '应展示 computed_at / feature_version');

    // mock 双轨仍可用（离线降级未被破坏）
    sandbox.__ApiClient.setMode('mock');
    featState.pool = []; featState.data = null; featState.matchId = null;
    sandbox.__featBoot();
    await waitFor(() => (main.innerHTML || '').includes('Mock 计算示意'));
    h = main.innerHTML;
    assert.ok(h.includes('Mock 计算示意'), 'mock 模式应显示 Mock 徽章');
    assert.ok(h.includes('横截面差异') && h.includes('必发资金面'), 'mock 模式仍渲染六族');
  });
});

test('回测页：真实指标 + V9.7 台账卡，未提供项不伪装', { timeout: 40000 }, async () => {
  await withBackend(async (base) => {
    const { sandbox, main, btState } = loadPages(base);

    sandbox.setPage('backtest');
    await waitFor(() => (main.innerHTML || '').includes('V9.7 真实回测'));
    let h = main.innerHTML;

    assert.ok(h.includes('5 项准入校验') && h.includes('6 项指标'), '应含准入与指标卡');
    assert.ok(h.includes('V9.7 真实回测'), '应含 V9.7 真实台账卡');
    assert.ok(h.includes('旧 DSL 合成（占位）'), 'synthetic=true 须强制标注占位');
    assert.ok(h.includes('明细未提供'), '准入逐项明细未提供时须诚实标注');
    assert.ok(h.includes('季度命中率序列后端未提供'), '缺季度序列时不得现算');
    assert.ok(h.includes('后端回测响应未返回置信度'), 'G19 不得以命中率现算');
    assert.ok(!h.includes('Mock 回测示意'), 'real 模式不得显示 Mock 徽章');
    assert.ok(!h.includes('后端不可用'), '不应进入错误态');
    assert.ok(h.includes('window.__btSelect'), '规则下拉应可切换');

    // mock 双轨
    sandbox.__ApiClient.setMode('mock');
    btState.rules = []; btState.ruleId = null; btState.data = null;
    sandbox.__btBoot();
    await waitFor(() => (main.innerHTML || '').includes('Mock 回测示意'));
    assert.ok((main.innerHTML || '').includes('Mock 回测示意'), 'mock 模式应显示 Mock 徽章');
  });
});

test('规则库页：接 /api/rules 只读渲染，方向语义原样展示，可查版本历史', { timeout: 40000 }, async () => {
  await withBackend(async (base) => {
    const { sandbox, main } = loadPages(base);

    sandbox.setPage('rules');   // 路由 → renderRulesPage + window.__rulesBoot
    await waitFor(() => (main.innerHTML || '').includes('凯利0.05平权判定标准'));
    const h = main.innerHTML;

    assert.ok(h.includes('R01'), '应渲染 V9.7 真实规则 ID');
    assert.ok(h.includes('凯利0.05平权判定标准'), '名称应取 v97.name（后端无顶层 name）');
    assert.ok(h.includes('后端 /api/rules'), '应指明真实数据来源');
    assert.ok(h.includes('盘性') && h.includes('让球盘'), '分类 chips 应由数据动态聚合');
    assert.ok(h.includes('方向语义'), '方向列须明确为「声明语义」');
    assert.ok(h.includes('发起变更提案'), 'real 模式新建入口应改为治理提案');
    assert.ok(h.includes('版本历史') && !h.includes('>编辑<'), '行内操作应为版本历史（只读）');
    assert.ok(!h.includes('检索命中') && !h.includes('DSL条件'), '旧 mock 列应已移除');
    assert.ok(!h.includes('后端不可用'), '不应进入错误态');

    // 版本历史端点可读且为瘦视图
    const v = await sandbox.__ApiClient.getApi().getRuleVersions('R01');
    assert.equal(v.ok, true);
    assert.equal(v.data[0].rule_id, 'R01');
    assert.ok(!('v97' in v.data[0]), '版本瘦视图不应携带 v97 大对象');
  });
});

test('特征端点：扁平键归一化为族结构，未产出键不进入族', { timeout: 40000 }, async () => {
  await withBackend(async (base) => {
    const { sandbox } = loadPages(base);
    const api = sandbox.__ApiClient.getApi();

    const feat = await api.getFeature(MATCH_ID);
    assert.equal(feat.ok, true);
    assert.ok(feat.data.features.cross && 'handicap_dispersion' in feat.data.features.cross, '横截面应归一化入族');
    assert.ok('move_pattern' in feat.data.features.temp, '时序应归一化入族');
    assert.ok('turnover' in feat.data.features.betfair, '必发应归一化入族');
    assert.ok(!('heat_min' in feat.data.features.betfair), '后端未产出键不得进入族结构');
    assert.ok(feat.data.meta && feat.data.meta.snapshot_count > 0);

    // 未在场次池中的 id → 诚实失败（不返回空特征冒充）
    const bad = await api.getFeature('NOPE');
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'match_not_found_in_merged_pool');
  });
});
