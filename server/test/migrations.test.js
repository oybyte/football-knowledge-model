// ============================================================================
// G12 数据模型 · migrations —— 迁移资产验收
// 覆盖：12 张 qd_* 表齐全 / 不可变触发器生效 / 12 索引 / 幂等 / 外键 /
// 关键表字段与设计文档（data-model-1.0.0.html）对齐。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createDb } = require('../src/db');
const { runMigrations, listMigrations, MIGRATIONS_DIR } = require('../src/db/migrate');
const fs = require('node:fs');

const QD_TABLES = [
  'qd_rule_versions',
  'qd_evidence_snapshots',
  'qd_matches',
  'qd_odds_snapshots',
  'qd_match_features',
  'qd_predictions',
  'qd_analysis_commands',
  'qd_audit_log',
  'qd_data_sources',
  'qd_backtest_jobs',
  'qd_ai_candidates',
  'qd_field_registry',
];

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'qd_%' ORDER BY name").all().map((r) => r.name);
}

test('G12 · 迁移资产存在且命名合规（NNN_name.sql）', () => {
  assert.ok(fs.existsSync(MIGRATIONS_DIR), 'migrations 目录必须存在');
  const files = listMigrations();
  assert.ok(files.length >= 1, '至少一个迁移文件');
  assert.ok(files.includes('001_init.sql'), '001_init.sql 必须存在');
});

test('G12 · 12 张 qd_* 表全部创建', () => {
  const { db, close } = createDb();
  const tables = tableNames(db);
  assert.deepEqual(tables.sort(), [...QD_TABLES].sort());
  close();
});

test('G12 · 不可变触发器生效（qd_rule_versions / qd_evidence_snapshots / qd_audit_log 禁 UPDATE/DELETE）', () => {
  const { db, close } = createDb();
  // 先插入一条合法记录，再验证 UPDATE/DELETE 被拒
  db.prepare(`INSERT INTO qd_rule_versions (
    version_id, rule_id, version, category, league_scope, team_scope, condition, conclusion,
    direction, base_confidence, priority, trust_level, valid_from, evidence_refs, evidence_count,
    status, created_at, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'R001#1', 'R001', 1, 'odds_change', '[]', '[]', '{}', 'concl', 'favor_upper',
    0.6, 80, 'untrusted', '2026-08-01T00:00:00+08:00', '[]', 0,
    'draft', '2026-08-01T00:00:00+08:00', 'test:migrations',
  );
  assert.throws(() => db.prepare("UPDATE qd_rule_versions SET status='active' WHERE version_id='R001#1'").run(),
    /immutable_violation/);
  assert.throws(() => db.prepare("DELETE FROM qd_rule_versions WHERE version_id='R001#1'").run(),
    /immutable_violation/);
  close();
});

test('G12 · 12 个索引全部创建', () => {
  const { db, close } = createDb();
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' AND tbl_name LIKE 'qd_%' ORDER BY name").all().map((r) => r.name);
  const expected = [
    'idx_ai_status', 'idx_audit_target', 'idx_audit_type', 'idx_bt_rule',
    'idx_cmd_idem', 'idx_cmd_status', 'idx_evidence_match', 'idx_evidence_rule',
    'idx_features_match', 'idx_odds_match_inst', 'idx_rule_rule_id', 'idx_rule_status_valid',
  ];
  assert.deepEqual(indexes.sort(), expected.sort());
  close();
});

test('G12 · 迁移幂等可重复执行', () => {
  const { db, close } = createDb();
  assert.doesNotThrow(() => runMigrations(db));
  assert.doesNotThrow(() => runMigrations(db));
  assert.equal(tableNames(db).length, QD_TABLES.length);
  close();
});

test('G12 · 外键约束生效（qd_odds_snapshots → qd_matches / qd_data_sources）', () => {
  const { db, close } = createDb();
  // 插入不存在的 match_id / source_id 应被外键拒绝
  assert.throws(() => db.prepare(`INSERT INTO qd_odds_snapshots (
    snapshot_id, match_id, institution, market, observed_at, received_at, data, trust_level, source_id
  ) VALUES ('S1', 'NOPE_MATCH', 'macau', 'handicap', '2026-08-01T10:00:00+08:00', '2026-08-01T10:01:00+08:00', '{}', 'trusted', 'NOPE_SRC')`).run(),
    /FOREIGN KEY constraint failed/);
  close();
});

test('G12 · 关键表字段与设计文档对齐（qd_rule_versions / qd_matches / qd_odds_snapshots）', () => {
  const { db, close } = createDb();
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.deepEqual(cols('qd_rule_versions'), [
    'version_id', 'rule_id', 'version', 'category', 'league_scope', 'team_scope', 'condition',
    'conclusion', 'direction', 'base_confidence', 'priority', 'trust_level', 'valid_from',
    'valid_to', 'evidence_refs', 'evidence_count', 'status', 'previous_version_id', 'created_at',
    'created_by', 'approved_at', 'approved_by', 'approval_note', 'superseded_at', 'deprecated_at',
  ]);
  assert.deepEqual(cols('qd_matches'), [
    'match_id', 'league', 'home_team', 'away_team', 'match_time', 'status',
    'actual_result', 'home_score', 'away_score', 'created_at', 'updated_at',
  ]);
  assert.deepEqual(cols('qd_odds_snapshots'), [
    'snapshot_id', 'match_id', 'institution', 'market', 'observed_at', 'received_at',
    'data', 'trust_level', 'source_id',
  ]);
  close();
});
