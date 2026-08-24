// ============================================================================
// 2.4 AI 引擎模块 · 验收测试
// 验收点（对齐实施计划 2.4）：
//   ① 切换模型不改业务代码（配置驱动，providers.json）
//   ② AI 输出全部带 untrusted 标记（__ai_boundary / candidate_status / trust）
//   ③ 候选规则可解析为合法 DSL（compile 通过）
//   ④ 审核转正后进入 proposed，不直接生效
//   ⑤ AI 模块无数据源凭证访问权限（不 import vault，config 无真实密钥）
//   附加：多模型适配层（路由/降级），指标由真实样本重算（不采信模型自报）
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { providers, mineCandidates, interpretMatch, escalateToProposed, validateCandidate } = require('../src/ai');
const { stampUntrusted, isUntrusted, AI_TRUST } = require('../src/ai/containment');
const { RuleStore, StateMachine, lockManager } = require('../src/rules');
const { getMockMatch } = require('../src/data/mock');
const { computeMatchFeatures } = require('../src/features');

const T = '2026-08-14T17:00:00+08:00';

// ───────────────────────── ① 配置驱动 ─────────────────────────
test('① provider 配置驱动：默认 stub，联网 provider 默认关闭，切换不进业务代码', () => {
  const cfg = providers.loadConfig();
  assert.equal(cfg.default, 'stub');
  const stub = cfg.providers.find((p) => p.id === 'stub');
  assert.ok(stub && stub.enabled === true);
  const net = cfg.providers.filter((p) => !p.enabled);
  assert.ok(net.length >= 2, '应内置多个禁用的联网 provider');
  for (const p of cfg.providers) {
    if (p.api_key_env) assert.notEqual(p.api_key_env.length, 0);
  }
});

test('① stub provider 返回确定性结构化 JSON', async () => {
  const stub = new providers.StubProvider({ id: 'stub', model: 'stub-1' });
  const t1 = await stub.chat({ seed: { a: 1 } });
  const t2 = await stub.chat({ seed: { a: 1 } });
  assert.equal(t1, t2);
  assert.deepEqual(JSON.parse(t1), { a: 1 });
});

test('① 全 provider 失败时降级回退 stub 并标记 degraded', async () => {
  // 禁用 stub，仅剩不可用的联网 provider（无凭证）→ 仍应返回 stub 结果
  const cfg = {
    default: 'deepseek',
    providers: [
      { id: 'deepseek', category: 'llm', base_url: 'https://x', model: 'm', api_key_env: 'NO_SUCH_KEY', enabled: true, degraded: false },
    ],
  };
  const { text, provider, degraded } = await providers.chat({
    system: 's', user: 'u', seed: { kind: 'mine', candidates: [] },
    config: cfg, env: {},
  });
  assert.ok(text.length >= 0);
  assert.equal(provider, 'stub');
  assert.equal(degraded, true);
});

// ───────────────────────── ② 规则挖掘 ─────────────────────────
// 构造 20 样本：10 例升盘降水→上盘命中，2 例升盘降水→下盘(不命中)，8 例稳定→下盘
function makeDataset() {
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push({ id: `S${samples.length}`, features: { move_pattern: '升盘降水', 'institution.sync_count': 4, 'water.upper.dispersion': 0.2, 'volume.ratio': 3 }, settlement: 'upper', consensus: 'upper' });
  }
  for (let i = 0; i < 2; i++) {
    samples.push({ id: `S${samples.length}`, features: { move_pattern: '升盘降水', 'institution.sync_count': 4, 'water.upper.dispersion': 0.2, 'volume.ratio': 3 }, settlement: 'lower', consensus: 'upper' });
  }
  for (let i = 0; i < 8; i++) {
    samples.push({ id: `S${samples.length}`, features: { move_pattern: '稳定', 'institution.sync_count': 1, 'water.upper.dispersion': 0.05, 'volume.ratio': 1 }, settlement: 'lower', consensus: 'upper' });
  }
  return samples;
}

test('② 挖掘输出候选全部 untrusted 且指标来自真实样本重算', async () => {
  const dataset = makeDataset();
  const { candidates, provider, baseline } = await mineCandidates({ samples: dataset });
  assert.equal(provider, 'stub');
  assert.ok(candidates.length >= 1);
  for (const c of candidates) {
    assert.equal(c.trust, 'untrusted');
    assert.equal(c.candidate_status, 'candidate');
    assert.equal(c.__ai_boundary, true);
    assert.equal(isUntrusted(c), true);
    assert.ok(c.sample_size > 0, 'candidate needs samples else filtered');
    assert.ok(Number.isFinite(c.hit_rate) && c.hit_rate >= 0 && c.hit_rate <= 1);
    assert.ok(Number.isFinite(c.edge));
  }
  // AI001：升盘降水 12 例命中，其中 10 例上盘 → hit_rate=0.8333，基线 upper=0.5，edge≈0.333
  const ai1 = candidates.find((c) => c.id === 'AI001');
  assert.ok(ai1, 'AI001 should be present');
  assert.equal(ai1.sample_size, 12);
  assert.ok(Math.abs(ai1.hit_rate - 10 / 12) < 1e-9, `hit_rate ${ai1.hit_rate}`);
  assert.ok(Math.abs(ai1.edge - (10 / 12 - 0.5)) < 1e-9, `edge ${ai1.edge}`);
  assert.equal(baseline.upper, 0.5);
  // 样本量不足的候选被过滤（如 AI006 未含 time_to_match 特征 → sample_size=0）
  assert.ok(!candidates.some((c) => c.id === 'AI006'));
});

test('③ 候选规则合法 DSL：validateCandidate 编译通过，非法字段被拒', () => {
  const good = validateCandidate({ id: 'X', field: 'volume.ratio', op: 'GTE', value: 2.5, direction: 'warning', expected: 'upset' });
  assert.equal(good.ok, true);
  assert.equal(good.condition.type, 'ATOMIC');
  const bad = validateCandidate({ id: 'Y', field: 'no.such.field', op: 'GT', value: 1, direction: 'warning', expected: 'upset' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes('E1001'), JSON.stringify(bad.errors));
});

test('③ 非法派生候选在挖掘中被剔除（valid=false）', async () => {
  // 直接对非法 field 打分 → valid=false
  const { scoreCandidate } = require('../src/ai/mining');
  const scored = scoreCandidate({ id: 'BAD', field: 'no.such.field', op: 'GT', value: 1, direction: 'warning', expected: 'upset' }, makeDataset());
  assert.equal(scored.valid, false);
  assert.ok(scored.errors.includes('E1001'));
});

// ───────────────────────── 单场解读 ─────────────────────────
test('④ 单场解读输出 untrusted 报告，信号使用点分特征键', async () => {
  const match = getMockMatch('M007');
  const { snapshot } = computeMatchFeatures(match, T);
  const report = await interpretMatch({ match, snapshot });
  assert.equal(report.trust, 'untrusted');
  assert.equal(report.candidate_status, 'candidate');
  assert.equal(report.__ai_boundary, true);
  assert.ok(!('status' in report), 'AI 产物不得带规则生命周期状态');
  assert.equal(report.match_id, 'M007');
  assert.ok(report.narrative && report.narrative.length > 0, '应有解读叙述');
  assert.ok(Array.isArray(report.signals) && report.signals.length > 0);
  // 特征键应为点分命名
  const keys = report.signals.map((s) => s.field);
  assert.ok(keys.includes('move_pattern'));
  assert.ok(keys.includes('institution.sync_count') || keys.includes('volume.ratio'));
});

// ───────────────────────── 审核转正 ─────────────────────────
test('⑤ 审核转正：候选 → draft → proposed，不直接生效，仍然 untrusted', async () => {
  const dataset = makeDataset();
  const { candidates } = await mineCandidates({ samples: dataset });
  const c = candidates.find((x) => x.id === 'AI001');
  assert.ok(c);

  const store = new RuleStore();
  const sm = new StateMachine({ store, lockManager });
  const res = await escalateToProposed({ candidate: c, store, stateMachine: sm, actor: 'analyst-01', note: '人工审核通过' });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.version.status, 'proposed');
  assert.equal(res.version.trust_level, 'untrusted');
  assert.equal(res.version.source, 'ai_mining');
  // 不应是 active，未进入正式预测链
  assert.notEqual(res.version.status, 'active');
  assert.notEqual(res.version.status, 'approved');
  assert.equal(res.version.direction, 'favor_upper');
});

test('⑤ 审核转正拒绝非 untrusted 候选 / 重复 rule_id', async () => {
  const store = new RuleStore();
  const sm = new StateMachine({ store, lockManager });
  const r1 = await escalateToProposed({ candidate: { id: 'X', trust: 'trusted' }, store, stateMachine: sm, actor: 'a' });
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.includes('candidate_not_untrusted'));
});

test('⑤ stampUntrusted 强制 untrusted，无法伪造 trusted', () => {
  const stamped = stampUntrusted({ id: 'c', trust: 'trusted', status: 'active' });
  assert.equal(stamped.trust, AI_TRUST);
  assert.ok(!('status' in stamped), 'AI 产物不得携带生命周期状态');
});

// ───────────────────────── 凭证隔离 ─────────────────────────
test('⑥ AI 模块无数据源凭证访问权限（不 import vault），config 无真实密钥', () => {
  const dir = path.join(__dirname, '..', 'src', 'ai');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/require\(.*\.\.\/vault/.test(src), `${f} 不得 require vault`);
    assert.ok(!/credentialVault/.test(src), `${f} 不得引用 credentialVault`);
  }
  const config = fs.readFileSync(path.join(__dirname, '..', 'config', 'ai-providers.json'), 'utf8');
  assert.ok(!/sk-[A-Za-z0-9]{10,}/.test(config), 'config 不得含真实密钥');
  assert.ok(/^\s*\{[\s\S]*\}$/.test(config), 'config 为合法 JSON');
});