// ============================================================================
// S25 转正试点脚本 —— 规则自我生长第一个完整闭环（回测 → 门禁 → 治理转正 → 入引擎）
//
// 用法：node server/scripts/s25-promote.js
// 数据源：DB 派生层真实历史（161 场带赛果） + V9.7 真规则（S25）。
// 过程：加载 S25 → 真实历史跑回测构建 total_goals 轴 eligible 证据 →
//       computeMetrics(axis=total_goals, S25 门禁) → 达标则 re-certify 为 trusted。
// 输出：指标、门禁明细、转正结论（诚实：门禁未过则给出失败报告，不伪造）。
// ============================================================================
'use strict';

const path = require('node:path');
const { createDb } = require('../src/db');
const { loadManualOddsFromDb } = require('../src/db/g12/manual_reconcile');
const { loadV97Rules } = require('../src/rules/v97loader');
const { RuleStore, StateMachine, lockManager } = require('../src/rules');
const { promoteV97RuleToValidated, S25_GATE } = require('../src/promote');

const RULE_ID = process.argv[2] || 'S25';

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
    const rule = reg.rules.find((r) => (r.rule_id || r.id) === RULE_ID);
    if (!rule) {
      console.error(`规则 ${RULE_ID} 不在 V9.7 registry 中`);
      process.exitCode = 1;
      return;
    }

    // 用真实规则集初始化治理存储（仅 S25 走转正；其余保持 active+provisional 现状）
    const store = new RuleStore();
    const sm = new StateMachine({ store, lockManager });
    for (const v of reg.rules) store.insert(v);

    const versionsBefore = store.getByRuleId(RULE_ID);
    const before = versionsBefore[0];
    console.log(`\n=== S25 转正试点（${RULE_ID}）===`);
    console.log(`[规则] ${rule.name || RULE_ID} | 起始状态=${before.status} | trust=${before.trust_level}`);
    console.log(`[数据] ${manual.matches.length} 场历史（${manual.matches.filter((m) => m.actual_result).length} 场带赛果）`);

    const res = promoteV97RuleToValidated({
      rule_id: RULE_ID,
      store,
      stateMachine: sm,
      matches: manual.matches,
      rule,
      approver: 'script:s25-pilot',
    });

    if (res.pass === false) {
      const r = res.report;
      console.log('\n[结果] 门禁未过 → 不转正（诚实报告）');
      console.log(`  样本=${r.sample_size} 方向=${r.direction_count} 命中=${r.hit_count} 命中率=${(r.hit_rate * 100).toFixed(1)}%`);
      console.log(`  edge/roi=${r.roi.toFixed(4)} 最大回撤=${r.max_drawdown.toFixed(4)} 时间稳定=${r.time_stability.toFixed(4)} 联赛覆盖=${r.league_coverage}`);
      console.log('  门禁：', JSON.stringify(r.passes));
      return;
    }
    if (!res.ok) {
      console.error('\n[结果] 治理转换失败：', res.errors, res.failure_report && res.failure_report.stopped_at);
      process.exitCode = 1;
      return;
    }

    const r = res.report;
    console.log('\n[结果] 门禁通过 → 已 re-certify 为 trusted');
    console.log(`  ${RULE_ID} 终态：status=${res.promoted.status} trust=${res.promoted.trust_level} evidence_count=${res.promoted.evidence_count} validated_by=${res.promoted.validated_by}`);
    console.log(`  样本=${r.sample_size} 命中=${r.hit_count} 命中率=${(r.hit_rate * 100).toFixed(1)}%（硬门禁≥${(S25_GATE.hit_rate * 100).toFixed(0)}%）`);
    console.log(`  edge/roi=${r.roi.toFixed(4)}（硬门禁≥${S25_GATE.roi}）`);
    console.log(`  参考指标（不阻断）：最大回撤=${r.max_drawdown.toFixed(4)} 时间稳定=${r.time_stability.toFixed(4)} 联赛覆盖=${r.league_coverage}`);
    console.log('  门禁明细：', JSON.stringify(r.passes), '| 硬门禁键：', JSON.stringify(r.gated_keys));
    console.log('\n[闭环] 该规则已升级为 trusted，后续经 /api/rules/:id/promote 或本脚本可复跑；引擎消费仍按 active 规则集，无需改动。');
  } finally {
    persistence.close();
  }
}

main();
