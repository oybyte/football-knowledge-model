-- ============================================================================
-- 004_manual_odds_dirs.sql · 人工盘赔「数据目录绑定」可变配置表
--
-- 目的：把人工盘赔的扫描根从「只能靠 env:OE_MANUAL_ODDS_ROOT」升级为可运行时指定，
--       并支持**按场次单独指定目录**（统一目录扫不到时补数据 / 对已有场次换源刷新）。
--
-- 语义：
--   · scope='unified'：统一目录（至多一行）。存在即覆盖 env:OE_MANUAL_ODDS_ROOT；
--     删除该行 = 回退 env 值（.env 永不失效的兜底）。
--   · scope='match'  ：场次目录绑定。match_key_kind='official' 时 match_key 为官方
--     数字 match_id（如 2041922）；='manual' 时为人工侧 match_id（联赛_主队_vs_客队）。
--   · 冲突优先级：match 绑定 > unified；同优先级取 created_at 更新者，其余记 shadowed 不入库。
--
-- 本表是**可变配置**（允许 UPDATE），刻意不设不可变触发器（对照 001 的 6 个 append-only 触发器）。
-- 审计另行写入 audit_logs / qd_audit_log（append-only），配置表本身不承担审计职责。
--
-- 幂等：全为 IF NOT EXISTS DDL，**无任何 DML** —— runMigrations 每次启动都会重跑全部迁移，
--       带 DML 会导致反复清库（参见 003 的教训）。故本文件不得包含 INSERT/UPDATE/DELETE。
-- ============================================================================

CREATE TABLE IF NOT EXISTS qd_manual_odds_dirs (
  binding_id      TEXT PRIMARY KEY,                -- 'unified' 或 'mod_<sha256(scope|match_key) 前12位>'
  scope           TEXT NOT NULL CHECK (scope IN ('unified','match')),
  match_key       TEXT,                            -- scope='match' 时必填（应用层校验）
  match_key_kind  TEXT CHECK (match_key_kind IN ('official','manual')),
  dir_path        TEXT NOT NULL,                   -- 目录绝对路径（单场目录或上层根目录，扫描时自动识别）
  label           TEXT,                            -- 可选备注（便于人肉识别）
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_scanned_at TEXT,                            -- 最近一次扫描时间
  last_result     TEXT,                            -- JSON { ok, admitted, rejected, reason, matches[] }
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- 统一目录至多一行：部分唯一索引在 SQLite 可用（WHERE 子句限定作用域）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_manual_dirs_unified
  ON qd_manual_odds_dirs(scope) WHERE scope = 'unified';

CREATE INDEX IF NOT EXISTS idx_manual_dirs_scope ON qd_manual_odds_dirs(scope, status);
CREATE INDEX IF NOT EXISTS idx_manual_dirs_match ON qd_manual_odds_dirs(match_key);
