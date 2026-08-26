// ============================================================================
// 持久化存储层 · schema —— DDL + 不可变触发器 + 迁移
// 表名对齐架构设计基线（qd_rule_versions / qd_predictions / qd_evidence_snapshots
// / qd_audit_log），语义平移到 SQLite。
// 不可变性在 DB 层强制：触发器禁止 UPDATE/DELETE（对齐实施计划 §1.3 验收）。
// 复杂嵌套字段以 payload_json 整存，标量列用于索引与查询。
// ============================================================================
'use strict';

const { runMigrations } = require('./migrate');

const DDL = `
CREATE TABLE IF NOT EXISTS rule_versions (
  version_id      TEXT PRIMARY KEY,
  rule_id         TEXT NOT NULL,
  version         INTEGER NOT NULL,
  status          TEXT NOT NULL,
  direction       TEXT,
  priority        INTEGER,
  base_confidence REAL,
  category        TEXT,
  trust_level     TEXT,
  valid_from      TEXT,
  valid_to        TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  payload_json    TEXT NOT NULL,
  UNIQUE(rule_id, version)
);
CREATE INDEX IF NOT EXISTS idx_rule_versions_rule   ON rule_versions(rule_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_rule_versions_status ON rule_versions(status);

CREATE TABLE IF NOT EXISTS predictions (
  prediction_id    TEXT PRIMARY KEY,
  match_id         TEXT NOT NULL,
  final_direction  TEXT,
  created_at       TEXT,
  payload_json     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);

CREATE TABLE IF NOT EXISTS backfill_results (
  prediction_id  TEXT PRIMARY KEY REFERENCES predictions(prediction_id),
  backfilled_at  TEXT NOT NULL,
  payload_json   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidences (
  evidence_id    TEXT PRIMARY KEY,
  prediction_id  TEXT,
  match_id       TEXT,
  frozen_at      TEXT,
  payload_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidences_prediction ON evidences(prediction_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  level        TEXT NOT NULL,
  service      TEXT,
  trace_id     TEXT,
  message      TEXT NOT NULL,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
`;

// 不可变护栏：所有业务表禁止 UPDATE/DELETE（审计表同样只增）。
const IMMUTABLE_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS trg_rule_versions_no_update BEFORE UPDATE ON rule_versions
BEGIN SELECT RAISE(ABORT, 'immutable_violation: UPDATE not allowed on rule_versions'); END;
CREATE TRIGGER IF NOT EXISTS trg_rule_versions_no_delete BEFORE DELETE ON rule_versions
BEGIN SELECT RAISE(ABORT, 'immutable_violation: DELETE not allowed on rule_versions'); END;

CREATE TRIGGER IF NOT EXISTS trg_predictions_no_update BEFORE UPDATE ON predictions
BEGIN SELECT RAISE(ABORT, 'immutable_violation: UPDATE not allowed on predictions'); END;
CREATE TRIGGER IF NOT EXISTS trg_predictions_no_delete BEFORE DELETE ON predictions
BEGIN SELECT RAISE(ABORT, 'immutable_violation: DELETE not allowed on predictions'); END;

CREATE TRIGGER IF NOT EXISTS trg_backfill_results_no_update BEFORE UPDATE ON backfill_results
BEGIN SELECT RAISE(ABORT, 'immutable_violation: UPDATE not allowed on backfill_results'); END;
CREATE TRIGGER IF NOT EXISTS trg_backfill_results_no_delete BEFORE DELETE ON backfill_results
BEGIN SELECT RAISE(ABORT, 'immutable_violation: DELETE not allowed on backfill_results'); END;

CREATE TRIGGER IF NOT EXISTS trg_evidences_no_update BEFORE UPDATE ON evidences
BEGIN SELECT RAISE(ABORT, 'immutable_violation: UPDATE not allowed on evidences'); END;
CREATE TRIGGER IF NOT EXISTS trg_evidences_no_delete BEFORE DELETE ON evidences
BEGIN SELECT RAISE(ABORT, 'immutable_violation: DELETE not allowed on evidences'); END;

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'immutable_violation: UPDATE not allowed on audit_logs'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'immutable_violation: DELETE not allowed on audit_logs'); END;
`;

/**
 * 建表 + 建不可变触发器 + 应用 G12 迁移（幂等，可重复执行）。
 * @param {import('node:sqlite').DatabaseSync} db
 */
function migrate(db) {
  db.exec(DDL);
  db.exec(IMMUTABLE_TRIGGERS);
  runMigrations(db);
}

module.exports = { migrate, DDL, IMMUTABLE_TRIGGERS };
