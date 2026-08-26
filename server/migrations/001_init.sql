-- ============================================================================
-- G12 数据模型定义 · 001_init.sql
-- 对齐 docs/design/data-model-1.0.0/data-model-1.0.0.html（架构评审 P0 缺口 G12）。
-- 设计文档为 PostgreSQL 语义（jsonb / timestamptz / now()），本文件为 SQLite 方言：
--   jsonb        → TEXT（存 JSON 字符串）
--   timestamptz  → TEXT（ISO 8601，由应用层写入）
--   numeric(4,3) → REAL
--   boolean      → INTEGER（0/1）
-- 幂等：全部使用 IF NOT EXISTS，可重复执行。
-- 不可变：qd_rule_versions / qd_evidence_snapshots / qd_audit_log 三张表
--         以触发器在 DB 层强制 append-only（对齐设计文档 §5）。
-- ============================================================================

-- ─────────────────────────── 支撑表（先建，供外键引用） ───────────────────────────

-- 4.1 数据源注册表（G2 数据治理）
CREATE TABLE IF NOT EXISTS qd_data_sources (
  source_id        TEXT PRIMARY KEY,
  source_name      TEXT NOT NULL,
  source_type      TEXT NOT NULL CHECK (source_type IN ('odds','result','basic','mock')),
  trust_level      TEXT NOT NULL CHECK (trust_level IN ('trusted','provisional','untrusted')),
  status           TEXT NOT NULL CHECK (status IN ('active','inactive','degraded')),
  config_ref       TEXT,
  quality_metrics  TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- 3.3 比赛表
CREATE TABLE IF NOT EXISTS qd_matches (
  match_id       TEXT PRIMARY KEY,
  league         TEXT NOT NULL,
  home_team      TEXT NOT NULL,
  away_team      TEXT NOT NULL,
  match_time     TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('scheduled','live','finished','cancelled')),
  actual_result  TEXT CHECK (actual_result IN ('home_win','draw','away_win')),
  home_score     INTEGER,
  away_score     INTEGER,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- 3.1 规则版本表（append-only）
CREATE TABLE IF NOT EXISTS qd_rule_versions (
  version_id          TEXT PRIMARY KEY,
  rule_id             TEXT NOT NULL,
  version             INTEGER NOT NULL,
  category            TEXT NOT NULL CHECK (category IN ('odds_change','institution_diff','sensitivity','league_feature')),
  league_scope        TEXT NOT NULL DEFAULT '[]',
  team_scope          TEXT NOT NULL DEFAULT '[]',
  condition           TEXT NOT NULL,
  conclusion          TEXT NOT NULL,
  direction           TEXT NOT NULL,
  base_confidence     REAL NOT NULL CHECK (base_confidence BETWEEN 0 AND 1),
  priority            INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 100),
  trust_level         TEXT NOT NULL CHECK (trust_level IN ('trusted','provisional','untrusted')),
  valid_from          TEXT NOT NULL,
  valid_to            TEXT,
  evidence_refs       TEXT NOT NULL DEFAULT '[]',
  evidence_count      INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL CHECK (status IN ('draft','proposed','experiment','validated','approved','active','superseded','deprecated')),
  previous_version_id TEXT,
  created_at          TEXT NOT NULL,
  created_by          TEXT NOT NULL,
  approved_at         TEXT,
  approved_by         TEXT,
  approval_note       TEXT,
  superseded_at       TEXT,
  deprecated_at       TEXT,
  UNIQUE (rule_id, version)
);

-- ─────────────────────────── 核心表 ───────────────────────────

-- 3.4 盘口赔率快照表
CREATE TABLE IF NOT EXISTS qd_odds_snapshots (
  snapshot_id  TEXT PRIMARY KEY,
  match_id     TEXT NOT NULL REFERENCES qd_matches(match_id),
  institution  TEXT NOT NULL,
  market       TEXT NOT NULL CHECK (market IN ('handicap','european','over_under','bf')),
  observed_at  TEXT NOT NULL,
  received_at  TEXT NOT NULL,
  data         TEXT NOT NULL,
  trust_level  TEXT NOT NULL CHECK (trust_level IN ('trusted','provisional','untrusted')),
  source_id    TEXT NOT NULL REFERENCES qd_data_sources(source_id),
  CHECK (received_at >= observed_at)
);

-- 3.5 特征表
CREATE TABLE IF NOT EXISTS qd_match_features (
  feature_id       TEXT PRIMARY KEY,
  match_id         TEXT NOT NULL REFERENCES qd_matches(match_id),
  computed_at      TEXT NOT NULL,
  features         TEXT NOT NULL,
  feature_version  TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

-- 3.8 审计日志表（append-only）
CREATE TABLE IF NOT EXISTS qd_audit_log (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  timestamp   TEXT NOT NULL,
  actor       TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  details     TEXT NOT NULL,
  prev_state  TEXT,
  new_state   TEXT
);

-- 3.7 分析命令表（幂等键 + 状态 + 结果关联）
CREATE TABLE IF NOT EXISTS qd_analysis_commands (
  command_id       TEXT PRIMARY KEY,
  match_id         TEXT NOT NULL REFERENCES qd_matches(match_id),
  status           TEXT NOT NULL CHECK (status IN ('pending','processing','completed','failed')),
  idempotency_key  TEXT NOT NULL UNIQUE,
  requested_at     TEXT NOT NULL,
  requested_by     TEXT NOT NULL,
  completed_at     TEXT,
  result_ref       TEXT REFERENCES qd_predictions(prediction_id),
  error            TEXT
);

-- 3.6 预测表（融合输出）
CREATE TABLE IF NOT EXISTS qd_predictions (
  prediction_id     TEXT PRIMARY KEY,
  match_id          TEXT NOT NULL REFERENCES qd_matches(match_id),
  command_id        TEXT REFERENCES qd_analysis_commands(command_id),
  final_direction   TEXT NOT NULL,
  final_confidence  REAL NOT NULL CHECK (final_confidence BETWEEN 0 AND 1),
  weights           TEXT NOT NULL,
  reasoning_chain   TEXT NOT NULL,
  audit_trail_id    TEXT NOT NULL REFERENCES qd_audit_log(event_id),
  created_at        TEXT NOT NULL,
  created_by        TEXT NOT NULL
);

-- 3.2 证据快照表（append-only，三时间戳非空）
CREATE TABLE IF NOT EXISTS qd_evidence_snapshots (
  evidence_id          TEXT PRIMARY KEY,
  rule_version_id      TEXT NOT NULL REFERENCES qd_rule_versions(version_id),
  match_id             TEXT NOT NULL REFERENCES qd_matches(match_id),
  observed_at          TEXT NOT NULL,
  received_at          TEXT NOT NULL,
  match_time           TEXT NOT NULL,
  trigger_data         TEXT NOT NULL,
  trigger_conditions   TEXT NOT NULL,
  actual_result        TEXT,
  prediction_correct   INTEGER,
  trust_level          TEXT NOT NULL,
  statistics_eligible  INTEGER NOT NULL DEFAULT 0,
  eligible_checks      TEXT NOT NULL,
  immutable            INTEGER NOT NULL DEFAULT 1,
  locked_at            TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  CHECK (received_at >= observed_at)
);

-- 4.2 回测作业表
CREATE TABLE IF NOT EXISTS qd_backtest_jobs (
  job_id            TEXT PRIMARY KEY,
  rule_version_id   TEXT NOT NULL REFERENCES qd_rule_versions(version_id),
  date_range        TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  metrics           TEXT,
  report_ref        TEXT,
  created_at        TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  completed_at      TEXT
);

-- 4.3 AI 候选规则表（untrusted + 审核转正关联）
CREATE TABLE IF NOT EXISTS qd_ai_candidates (
  candidate_id              TEXT PRIMARY KEY,
  source                    TEXT NOT NULL CHECK (source IN ('ai_mining','ai_interpretation','manual')),
  provider                  TEXT,
  content                   TEXT NOT NULL,
  trust_level               TEXT NOT NULL DEFAULT 'untrusted',
  status                    TEXT NOT NULL CHECK (status IN ('pending_review','approved','rejected')),
  review_note               TEXT,
  converted_rule_version_id TEXT REFERENCES qd_rule_versions(version_id),
  created_at                TEXT NOT NULL,
  reviewed_at               TEXT,
  reviewed_by               TEXT
);

-- 4.4 字段注册表（元数据，DSL 引擎与特征工程契约）
CREATE TABLE IF NOT EXISTS qd_field_registry (
  field_id           TEXT PRIMARY KEY,
  field_name         TEXT NOT NULL,
  data_type          TEXT NOT NULL CHECK (data_type IN ('number','string','boolean','duration')),
  unit               TEXT,
  family             TEXT NOT NULL CHECK (family IN ('cross_section','temporal','resonance','anomaly')),
  description        TEXT NOT NULL,
  source_expression  TEXT,
  version            TEXT NOT NULL
);

-- ─────────────────────────── 不可变触发器（append-only，对齐设计文档 §5） ───────────────────────────

CREATE TRIGGER IF NOT EXISTS trg_qd_rule_versions_no_update BEFORE UPDATE ON qd_rule_versions
BEGIN SELECT RAISE(ABORT, 'immutable_violation: UPDATE not allowed on qd_rule_versions'); END;
CREATE TRIGGER IF NOT EXISTS trg_qd_rule_versions_no_delete BEFORE DELETE ON qd_rule_versions
BEGIN SELECT RAISE(ABORT, 'immutable_violation: DELETE not allowed on qd_rule_versions'); END;

CREATE TRIGGER IF NOT EXISTS trg_qd_evidence_snapshots_no_update BEFORE UPDATE ON qd_evidence_snapshots
BEGIN SELECT RAISE(ABORT, 'immutable_violation: UPDATE not allowed on qd_evidence_snapshots'); END;
CREATE TRIGGER IF NOT EXISTS trg_qd_evidence_snapshots_no_delete BEFORE DELETE ON qd_evidence_snapshots
BEGIN SELECT RAISE(ABORT, 'immutable_violation: DELETE not allowed on qd_evidence_snapshots'); END;

CREATE TRIGGER IF NOT EXISTS trg_qd_audit_log_no_update BEFORE UPDATE ON qd_audit_log
BEGIN SELECT RAISE(ABORT, 'immutable_violation: UPDATE not allowed on qd_audit_log'); END;
CREATE TRIGGER IF NOT EXISTS trg_qd_audit_log_no_delete BEFORE DELETE ON qd_audit_log
BEGIN SELECT RAISE(ABORT, 'immutable_violation: DELETE not allowed on qd_audit_log'); END;

-- ─────────────────────────── 索引（对齐设计文档 §6） ───────────────────────────

CREATE INDEX IF NOT EXISTS idx_rule_status_valid ON qd_rule_versions(status, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_rule_rule_id      ON qd_rule_versions(rule_id, version);
CREATE INDEX IF NOT EXISTS idx_evidence_rule     ON qd_evidence_snapshots(rule_version_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_evidence_match    ON qd_evidence_snapshots(match_id);
CREATE INDEX IF NOT EXISTS idx_odds_match_inst   ON qd_odds_snapshots(match_id, institution, observed_at);
CREATE INDEX IF NOT EXISTS idx_features_match    ON qd_match_features(match_id, computed_at);
CREATE INDEX IF NOT EXISTS idx_cmd_idem          ON qd_analysis_commands(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_cmd_status        ON qd_analysis_commands(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_audit_target      ON qd_audit_log(target_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_type        ON qd_audit_log(event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_ai_status         ON qd_ai_candidates(status, created_at);
CREATE INDEX IF NOT EXISTS idx_bt_rule           ON qd_backtest_jobs(rule_version_id, status);
