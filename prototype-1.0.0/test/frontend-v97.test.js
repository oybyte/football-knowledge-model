// ============================================================================
// 前端契约 · v97 块贯通测试
// 启动真实后端（真实 DB + 人工盘赔源），在 VM 中加载 api-client http 适配器，
// 验证 getMergedAnalysis 返回数据携带 v97 块（88 条规则三态求值台账 + 字段信封），
// 即「前端 API 层 → 合并分析 → v97 真规则求值」链路贯通，供 UI 渲染消费。
//
// 不硬编码「当日场次 ID」：合并池成员随每日录入 / 锚定状态变化，写死 ID 会让测试
// 在每个非当日环境里假失败。改为从池内动态选取首场 + 扫描取样取证命中的规则。
// 运行：node prototype-1.0.0/test/frontend-v97.test.js
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createService } = require('../../server/src');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'api-client', 'api-client.js'), 'utf8');

// 扫描取样上限：命中取证通常前 2~3 场即达；上限兼顾「池内确有命中」与运行时长。
const SCAN_LIMIT = 60;

function fakeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

async function boot() {
  const dbPath = path.join(__dirname, '..', '..', 'server', 'data', 'odds-edge.db');
  process.env.OE_SPORTTERY_ANCHOR = process.env.OE_SPORTTERY_ANCHOR || 'odds';
  process.env.OE_MANUAL_ODDS_ROOT =
    process.env.OE_MANUAL_ODDS_ROOT || 'F:/ocr_python_data/FootballScreenshotOcr/output';
  const service = await createService({ dbPath, http: { port: 0 } });
  await new Promise((r) => service.server.once('listening', r));
  return service;
}

test('frontend http 适配器：getMergedAnalysis 携带 v97 块（动态选取池内场次）', { timeout: 120000 }, async () => {
  const service = await boot();
  try {
    const port = service.server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const sandbox = {
      localStorage: fakeStorage({ oe_api_mode_v2: 'real', oe_api_base: base }),
      fetch: global.fetch,
      console,
      Promise,
    };
    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox);
    const api = sandbox.__ApiClient.getApi();
    assert.equal(api.name, 'http');

    // ── ① 动态取合并池：不硬编码「今天的某一场」 ──
    const poolRes = await api.getMergedPool();
    assert.equal(poolRes.ok, true, '合并池请求应成功');
    const pool = (poolRes.data && poolRes.data.pool) || [];
    assert.ok(pool.length > 0, '合并池应有场次（人工盘赔源 + 当日官方赛程）');

    // ── ② 链路贯通：对池内首场取合并分析，断言 v97 块结构契约 ──
    const firstId = pool[0].match_id;
    const r = await api.getMergedAnalysis(firstId);
    assert.equal(r.ok, true, '池内场次的合并分析请求应成功（不应 404）');
    assert.equal(r.data.match_id, firstId, '响应应回带请求的场次标识');
    assert.ok(r.data.anchor_source, '应上报锚定来源（trusted 锚 / 降级态）');
    // merged = 官方赛程锚定成功标志，取决于当日体彩在售窗口。只断言类型契约与一致性，
    // 不断言恒 true——否则测试会随每日开售状态失效（旧版硬编码场次即因此假失败）。
    assert.equal(typeof r.data.merged, 'boolean', 'merged 应为布尔标志');
    if (r.data.merged) {
      assert.equal(r.data.anchor_source, 'odds', '锚定成功时 anchor_source 应为 odds');
    }

    assert.ok(r.data.v97, '响应应携带 v97 块');
    assert.equal(r.data.v97.rule_count, 88, '88 条规则全部求值');
    assert.equal(r.data.v97.rules.length, 88, 'v97.rules 应为 88 条求值台账');
    assert.ok(Array.isArray(r.data.v97.fields) && r.data.v97.fields.length >= 12, '字段信封 ≥12');
    assert.ok(
      r.data.v97.rules.every((x) => x && typeof x.rule_id === 'string' && typeof x.status === 'string'),
      '每条规则应带 rule_id 与 status（三态求值台账，无未求值占位）'
    );

    // ── ③ 规则真能命中：池内扫描取样，不绑定单场 ──
    let e14 = null;
    let s25 = null;
    let scanned = 0;
    const limit = Math.min(SCAN_LIMIT, pool.length);
    for (let i = 0; i < limit && (!e14 || !s25); i++) {
      const id = pool[i].match_id;
      const rr = id === firstId ? r : await api.getMergedAnalysis(id);
      scanned++;
      if (!rr.ok || !rr.data.v97) continue;
      const hits = new Map(
        rr.data.v97.rules.filter((x) => x.status === 'hit').map((x) => [x.rule_id, x])
      );
      if (!e14 && hits.has('E14')) e14 = { id, rule: hits.get('E14') };
      if (!s25 && hits.has('S25')) s25 = { id, rule: hits.get('S25') };
    }
    assert.ok(e14, `池内前 ${scanned} 场应有 E14（共振前置）命中——无命中说明 v97 求值链异常`);
    assert.ok(s25, `池内前 ${scanned} 场应有 S25（总进球信号）命中——无命中说明 v97 求值链异常`);
    assert.ok(
      s25.rule.dimensions && s25.rule.dimensions.total_goals_signal,
      'S25 应输出 total_goals_signal 维度'
    );

    console.log(
      `[frontend-v97] 池内 ${pool.length} 场 · 采样 ${scanned} 场 · E14@${e14.id} · ` +
        `S25@${s25.id}(tg=${s25.rule.dimensions.total_goals_signal}) · 首场 merged=${r.data.merged}`
    );
  } finally {
    await new Promise((r) => service.server.close(r));
    service.close();
  }
});
