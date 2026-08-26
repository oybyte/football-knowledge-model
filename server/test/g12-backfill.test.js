// ============================================================================
// G12 数据访问层 · 迁移回填测试
// 覆盖：从运行时 store 回填到 qd_* 表（FK 序 + 锚点补足）、幂等（重复执行 0 新增）、
// 语义不对齐不回填（缺 match 的预测被跳过）、事务原子性（中途抛错整体回滚）。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDb } = require('../src/db');
const { backfillG12 } = require('../src/db/g12/backfill');

const RULE_V = {
  version_id: 'R001#1', rule_id: 'R001', version: 1, category: 'odds_change',
  condition: 'handicap.change < -0.25', conclusion: '主队水位显著下降', direction: 'favor_upper',
  base_confidence: 0.72, priority: 50, trust_level: 'trusted',
  valid_from: '2026-01-01T00:00:00Z', valid_to: null, status: 'active',
  created_at: '2026-01-01T00:00:00Z', created_by: 'admin',
  evidence_refs: [], evidence_count: 0,
};

const MATCH = {
  match_id: 'M001', league: '日职联', home_team: '东京绿茵', away_team: '柏太阳神',
  match_time: '2026-08-14T18:00:00+08:00', status: 'finished',
};

/** 构造一块「已有存量」的 db：规则 + 审计 + 预测（含一个缺 match 的预测）。 */
function seededDb() {
  const db = createDb({ path: ':memory:' });
  db.ruleStore.insert(RULE_V);
  db.auditStore.append({ level: 'INFO', service: 'gateway', trace_id: 't1', message: 'auth_ok', token: 'x' });
  db.predictionStore.insert({
    prediction_id: 'pred_1', match_id: 'M001', command_id: 'cmd_1',
    final_direction: 'favor_upper', final_confidence: 0.7,
    weights: { ruleR001: 0.6 }, reasoning_chain: ['handicap.change= -0.3'],
    audit_trail_id: 'aud_hl', created_at: '2026-08-13T12:00:00Z', created_by: 'publish:engine',
  });
  // 缺 match 的预测：回填应跳过而非捏造
  db.predictionStore.insert({
    prediction_id: 'pred_orphan', match_id: 'NOEXIST', final_direction: 'favor_lower',
    final_confidence: 0.5, weights: {}, reasoning_chain: [], audit_trail_id: null,
    created_at: '2026-08-13T12:00:00Z', created_by: 'publish:engine',
  });
  return db;
}

test('G12 回填：FK 序迁移到 qd_* 表，缺赛果信息不捏造，缺 match 预测被跳过', () => {
  const db = seededDb();
  try {
    const counts = backfillG12({
      db: db.db, qd: db.qd, ruleStore: db.ruleStore,
      predictionStore: db.predictionStore, auditStore: db.auditStore,
      matches: [MATCH],
    });

    // 数据源 + 字段注册表种子
    assert.ok(counts.data_sources >= 12, `data_sources=${counts.data_sources} 应≥注册表 12`);
    assert.ok(counts.field_registry > 0, `field_registry=${counts.field_registry}`);
    // 1 场 + 1 规则 + 1 audit（存量）+ 1 audit 锚点补足 = 2
    assert.equal(counts.matches, 1);
    assert.equal(counts.rule_versions, 1);
    assert.equal(counts.audit_log, 2);
    // 1 条预测回填；缺 match 的 1 条被跳过
    assert.equal(counts.predictions, 1);
    assert.equal(counts.predictions_skipped_no_match, 1);

    // qd_* 表落库核对 + FK 完整性
    assert.equal(db.qd.matches.count(), 1);
    assert.equal(db.qd.rule_versions.count(), 1);
    assert.equal(db.qd.predictions.count(), 1);
    const pred = db.qd.predictions.get('pred_1');
    assert.equal(pred.match_id, 'M001');
    assert.equal(pred.audit_trail_id, 'aud_hl');
    // 已存在的审计锚点优先复用；缺失的补占位
    assert.ok(db.qd.audit_log.get('aud_hl'));
    assert.equal(pred.command_id, 'cmd_1');
    assert.ok(db.qd.analysis_commands.get('cmd_1'));
    assert.ok(db.qd.predictions.get('pred_orphan') === null, '缺 match 的预测不得回填');
  } finally {
    db.close();
  }
});

test('G12 回填：幂等——重复执行增量归零', () => {
  const db = seededDb();
  try {
    backfillG12({
      db: db.db, qd: db.qd, ruleStore: db.ruleStore,
      predictionStore: db.predictionStore, auditStore: db.auditStore,
      matches: [MATCH],
    });
    const before = {
      ds: db.qd.data_sources.count(), fr: db.qd.field_registry.count(),
      m: db.qd.matches.count(), a: db.qd.audit_log.count(),
      r: db.qd.rule_versions.count(), p: db.qd.predictions.count(),
    };
    const counts2 = backfillG12({
      db: db.db, qd: db.qd, ruleStore: db.ruleStore,
      predictionStore: db.predictionStore, auditStore: db.auditStore,
      matches: [MATCH],
    });
    assert.equal(counts2.data_sources + counts2.field_registry + counts2.matches + counts2.audit_log + counts2.rule_versions + counts2.predictions, 0);
    assert.equal(db.qd.data_sources.count(), before.ds);
    assert.equal(db.qd.field_registry.count(), before.fr);
    assert.equal(db.qd.matches.count(), before.m);
    assert.equal(db.qd.audit_log.count(), before.a);
    assert.equal(db.qd.rule_versions.count(), before.r);
    assert.equal(db.qd.predictions.count(), before.p);
  } finally {
    db.close();
  }
});

test('G12 回填：事务原子性——中途抛错整体回滚', () => {
  const db = createDb({ path: ':memory:' });
  try {
    db.ruleStore.insert(RULE_V);
    // 数据源缺 quality_metrics（QD 必要列）→ 插入在 data_sources 第 1 项即抛错
    assert.throws(
      () => backfillG12({
        db: db.db, qd: db.qd, ruleStore: db.ruleStore,
        predictionStore: db.predictionStore, auditStore: db.auditStore,
        matches: [MATCH],
        dataSources: [{ source_id: 'src_bad', source_name: '坏源', source_type: 'odds', trust_level: 'trusted', status: 'active' }],
      }),
      /missing_required:quality_metrics/,
    );
    assert.equal(db.qd.data_sources.count(), 0, '事务回滚：data_sources 不应部分写入');
    assert.equal(db.qd.matches.count(), 0, '事务回滚：matches 不应在失败后残留');
  } finally {
    db.close();
  }
});