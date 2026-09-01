-- ============================================================================
-- G12 派生层 · 002_manual_odds_history.sql
-- 本地人工盘赔「派生 + 版本化」物化落库层。
-- 真相源 = 磁盘 盘口数据.md；本层是由磁盘派生的只读（append-only）物化视图。
-- 设计要点（对齐 2026-09-01 用户拍板）：
--   · 整份 盘口数据.md 的 sha256 = 一场「整场版本」（content_hash UNIQUE）。
--   · 幂等重扫：相同内容 → INSERT OR IGNORE 跳过；内容变化 → 新版本（version_id=hmv_<hash>），
--     旧版本经 superseded_by 指针标记（仅改指针、不改版本内容，保留 append-only 精神）。
--   · 快照 qd_hist_match_snapshot 以 version_id 关联（解耦 qd_matches，纯派生层）。
--   · 赛果（actual_result/home_score/away_score）随版本一起冻结，回测可直接读。
--   · qd_hist_scan_runs 记录每次 reconcile 的可观测元数据（扫盘即写入）。
-- 命名用 qd_hist_* 前缀，避免与 001 的 qd_matches / qd_odds_snapshots / qd_predictions 冲突。
-- 幂等：全部 IF NOT EXISTS，可重复执行。
-- ============================================================================

-- 整场版本表（一场比赛的一版盘口数据；磁盘内容的不可变快照）
CREATE TABLE IF NOT EXISTS qd_hist_match_version (
  version_id      TEXT PRIMARY KEY,                                  -- hmv_<sha256(整份 md)>
  match_id        TEXT NOT NULL,
  content_hash    TEXT NOT NULL UNIQUE,                              -- sha256(整份盘口数据.md)
  md_path         TEXT,                                              -- 来源 md 绝对路径（可追溯真相源）
  league          TEXT NOT NULL,
  home_team       TEXT NOT NULL,
  away_team       TEXT NOT NULL,
  neutral         INTEGER NOT NULL DEFAULT 0,
  match_time      TEXT NOT NULL,
  match_status    TEXT NOT NULL DEFAULT 'scheduled',                 -- 比赛生命周期：scheduled/live/finished/cancelled
  actual_result   TEXT,                                              -- home_win/draw/away_win
  home_score      INTEGER,
  away_score      INTEGER,
  observed_at     TEXT,
  received_at     TEXT,
  snapshot_count  INTEGER NOT NULL DEFAULT 0,
  status_flag     TEXT NOT NULL DEFAULT 'active' CHECK (status_flag IN ('active','superseded')),  -- 版本生命周期
  prev_version_id TEXT,                                              -- 上一代版本（插入时已知，不改旧行）
  superseded_by   TEXT,                                              -- 被哪个新版本取代（指针，可事后标记）
  match_payload   TEXT NOT NULL,                                     -- 完整 MatchSchema（去快照）JSON，忠实重建用
  created_at      TEXT NOT NULL
);

-- 盘口快照表（按 version_id 关联；独立派生层）
CREATE TABLE IF NOT EXISTS qd_hist_match_snapshot (
  snapshot_id   TEXT PRIMARY KEY,
  version_id    TEXT NOT NULL,
  institution   TEXT NOT NULL,
  market        TEXT NOT NULL CHECK (market IN ('handicap','european','over_under','bf')),
  observed_at   TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  data          TEXT NOT NULL,                                       -- 快照 data JSON（line/water/odds 等）
  trust_level   TEXT NOT NULL DEFAULT 'provisional',
  source_id     TEXT NOT NULL DEFAULT 'src_manual_odds'
);

-- 扫盘运行表（每次 reconcile 一条；可观测「扫盘即写入」是否发生）
CREATE TABLE IF NOT EXISTS qd_hist_scan_runs (
  run_id         TEXT PRIMARY KEY,
  started_at     TEXT NOT NULL,
  finished_at    TEXT NOT NULL,
  status         TEXT NOT NULL,
  files_seen     INTEGER NOT NULL DEFAULT 0,
  files_ok       INTEGER NOT NULL DEFAULT 0,
  files_rejected INTEGER NOT NULL DEFAULT 0,
  imported       INTEGER NOT NULL DEFAULT 0,
  skipped        INTEGER NOT NULL DEFAULT 0,
  superseded     INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  created_at     TEXT NOT NULL
);

-- ─────────────────────────── 索引 ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_hist_version_match     ON qd_hist_match_version(match_id);
CREATE INDEX IF NOT EXISTS idx_hist_version_active    ON qd_hist_match_version(status_flag, superseded_by);
CREATE INDEX IF NOT EXISTS idx_hist_version_hash      ON qd_hist_match_version(content_hash);
CREATE INDEX IF NOT EXISTS idx_hist_snap_version      ON qd_hist_match_snapshot(version_id);
CREATE INDEX IF NOT EXISTS idx_hist_run_started      ON qd_hist_scan_runs(started_at);
