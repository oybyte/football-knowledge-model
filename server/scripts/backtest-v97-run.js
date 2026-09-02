// ============================================================================
// V9.7 真实回测运行器（脚本）
// 用法：node server/scripts/backtest-v97-run.js [规则ID...]（缺省 = 全部可求值规则）
// 数据源：DB 派生层真实历史（149 场带赛果） + V9.7 真规则。
// 产出：每规则 覆盖统计 + 命中事件台账；S25 附大小球倾向探针。
// ============================================================================
'use strict';

const path = require('node:path');
const { createDb } = require('../src/db');
const { loadManualOddsFromDb } = require('../src/db/g12/manual_reconcile');
const { loadV97Rules } = require('../src/rules/v97loader');
const { backtestRule, backtestRules } = require('../src/backtest/v97_real');

const TARGETS = process.argv.slice(2);

function main() {
  const dbPath = process.env.OE_DB_PATH || path.join(__dirname, '..', 'data', 'odds-edge.db');
  const persistence = createDb({ path: dbPath, logger: { info() {}, warn() {}, error() {} } });
  try {
    const reg = loadV97Rules();
    const manual = loadManualOddsFromDb(persistence.qd);
    if (!manual || !manual.matches || !manual.matches.length) {
      console.error('DB 无人工盘赔数据（先启动服务触发 reconcile 或 npm run backfill:manual）');
      process.exitCode = 1;
      return;
    }
    const matches = manual.matches;
    const withResult = matches.filter((m) => m.actual_result).length;
    console.log(`[数据] ${matches.length} 场（${withResult} 场带赛果）| 规则 ${reg.count}`);

    let rules = reg.rules;
    if (TARGETS.length) {
      rules = rules.filter((r) => TARGETS.includes(r.rule_id || r.id));
      console.log(`[目标] ${rules.map((r) => r.rule_id || r.id).join(', ')}`);
    }
    const results = backtestRules(rules, matches);
    console.log('\n=== 真实回测结果（按可求值场次排序）===');
    for (const r of results) {
      const { hit, miss, insuff } = r.tally;
      console.log(`\n${r.rule_id}  可求值=${hit + miss}/${matches.length}  hit=${hit} miss=${miss} insuff=${insuff}`);
      if (r.probe) {
        console.log(`  [探针 S25] ${r.probe.total} 场可判向 · 倾向命中 ${r.probe.hits}/${r.probe.total} = ${(r.probe.hit_rate * 100).toFixed(1)}%（口径：${r.probe.note}）`);
        for (const e of r.probe.events.slice(0, 10)) {
          console.log(`    - ${e.league} ${e.home_team} vs ${e.away_team} | 总进球=${e.total_goals} vs 线${e.line_mid} | lean=${e.lean} ${e.probe_hit ? '✓' : '×'} | ${e.actual_result}`);
        }
      } else {
        const n = Math.min(r.ledger.length, 6);
        for (const e of r.ledger.slice(0, n)) {
          console.log(`    - ${e.league} ${e.home_team} vs ${e.away_team} | ${e.actual_result} | ${JSON.stringify(e.dimensions)}`);
        }
        if (r.ledger_count > n) console.log(`    … 共 ${r.ledger_count} 条命中，详见台账`);
      }
    }
    if (!results.length) console.log('（无可求值规则）');
  } finally {
    persistence.close();
  }
}

main();
