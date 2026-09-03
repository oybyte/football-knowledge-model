// ============================================================================
// V9.7 引擎垂直切片 · 真实数据验证
// 用法：node server/scripts/v97-slice-run.js
//
// 用「真实 V9.7 registry 的 88 条规则」跑「真实 161 场人工盘赔（DB 派生层）」，
// 验证端到端链路：盘口快照 → 字段信封 → atom 求值 → effects → 维度。
//
// 目的不是产出业务结论（当前仅 5 个字段、2 条规则可求值），而是验证架构可行，
// 并量化「字段覆盖率 → 规则点亮率」，为后续按频次铺开 149 个字段提供依据。
// ============================================================================
'use strict';

const path = require('node:path');
const { createDb } = require('../src/db');
const { loadManualOddsFromDb } = require('../src/db/g12/manual_reconcile');
const { loadV97Rules } = require('../src/rules/v97loader');
const { adaptMatch } = require('../src/features/adapt');
const { runRule } = require('../src/engine/v97/run');
const { getField, listFields } = require('../src/engine/v97/fields');
const { collectHandicapRows, toResolved, pickReference } = require('../src/engine/v97/fields');
const { defaultLogger } = require('../src/lib/logger');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'odds-edge.db');
const TARGET_RULES = ['R13', 'R01'];

function pct(n, d) {
  return d ? ((n / d) * 100).toFixed(1) + '%' : '0%';
}

function main() {
  const dbPath = process.env.OE_DB_PATH || DEFAULT_DB_PATH;
  const persistence = createDb({ path: dbPath, logger: defaultLogger });

  try {
    // ── 1. 载入真规则 ──
    const reg = loadV97Rules();
    console.log(`\n[规则] registry=${reg.registry_version} 共 ${reg.count} 条，门禁通过`);
    const rules = reg.rules.filter((r) => TARGET_RULES.includes(r.rule_id || r.id));
    console.log(`[切片] 目标规则: ${rules.map((r) => r.rule_id || r.id).join(', ')}`);

    // ── 2. 载入真实比赛 ──
    const manual = loadManualOddsFromDb(persistence.qd);
    if (!manual || !manual.matches || !manual.matches.length) {
      console.error('[错误] DB 中无人工盘赔数据，请先启动服务触发 reconcile 或跑 npm run backfill:manual');
      process.exitCode = 1;
      return;
    }
    const matches = manual.matches;
    console.log(`[数据] DB 载入 ${matches.length} 场（来源 ${manual.source_id}）\n`);

    // ── 3. 字段覆盖率 ──
    console.log('=== 字段覆盖率（真实数据上各字段能否取值）===');
    const fieldOk = {};
    for (const f of listFields()) fieldOk[f] = 0;
    let usable = 0;

    const ctxs = [];
    for (const m of matches) {
      const t = m.match_time;
      if (!t) continue;
      const { markets } = adaptMatch(m, t);
      const ctx = { markets, match: m, t };
      ctxs.push(ctx);
      let anyHandicap = false;
      for (const f of listFields()) {
        const env = getField(f, ctx);
        if (env.status !== 'insufficient_data') fieldOk[f]++;
      }
      if (toResolved(collectHandicapRows(markets)).length) { anyHandicap = true; usable++; }
      ctx._anyHandicap = anyHandicap;
    }
    console.log(`  可用比赛(有可解析让球盘) = ${usable} / ${ctxs.length}`);
    for (const f of listFields()) {
      console.log(`  ${f.padEnd(22)} ${String(fieldOk[f]).padStart(4)} / ${ctxs.length}  (${pct(fieldOk[f], ctxs.length)})`);
    }

    // ── 4. 规则求值 ──
    for (const rule of rules) {
      const id = rule.rule_id || rule.id;
      const tally = { hit: 0, miss: 0, insufficient_data: 0 };
      const missingCounter = {};
      const hits = [];

      for (const ctx of ctxs) {
        const res = runRule(rule, ctx);
        tally[res.status] = (tally[res.status] || 0) + 1;
        for (const f of res.missing) missingCounter[f] = (missingCounter[f] || 0) + 1;
        if (res.status === 'hit') {
          const ref = pickReference(toResolved(collectHandicapRows(ctx.markets)));
          hits.push({
            match: `${ctx.match.home_team} vs ${ctx.match.away_team}`,
            league: ctx.match.league,
            line: ref ? ref.line : null,
            upper: ref ? (ref.upper === 'home' ? '主队' : '客队') : null,
            water: ref ? ref.upperWater : null,
            dims: res.dimensions,
          });
        }
      }

      console.log(`\n=== 规则 ${id} · ${rule.name || ''} ===`);
      console.log(`  hit=${tally.hit}  miss=${tally.miss}  insufficient_data=${tally.insufficient_data}  (共 ${ctxs.length} 场)`);
      if (Object.keys(missingCounter).length) {
        console.log('  缺失字段分布: ' + Object.entries(missingCounter).map(([k, v]) => `${k}=${v}`).join(', '));
      }
      if (hits.length) {
        console.log(`  命中样例（前 10 / 共 ${hits.length}）:`);
        for (const h of hits.slice(0, 10)) {
          console.log(`    ${String(h.league).padEnd(10)} ${String(h.match).padEnd(34)} line=${String(h.line).padEnd(7)} 上盘=${h.upper} 水位=${h.water} → ${JSON.stringify(h.dims)}`);
        }
      }
    }

    console.log('\n[结论] 切片链路跑通：字段信封 → atom 三态求值 → effects 维度 全链路可用。');
    console.log('       未实现的 203 个字段一律 insufficient_data，规则因此「不出结论」而非乱判（决策 c 生效）。');
  } catch (e) {
    console.error('[失败]', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    persistence.close();
  }
}

main();
