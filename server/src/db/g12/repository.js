// ============================================================================
// G12 数据访问层 · repository —— 12 张 qd_* 表的类型化写读 + 不可变护栏
// 对齐 migrations/001_init.sql 精确列定义。数据库约束（NOT NULL / CHECK / FK /
// 不可变触发器）已在 DDL，本层提供应用侧：列名收缩、必填校验、JSON 字段序列化、
// append-only 守卫（update/delete/patch 抛错），DB 触发器兜底。
// ============================================================================
'use strict';

/** 不可变（append-only）实体：由 001_init.sql 触发器在 DB 层强制，应用侧同步守卫。 */
const IMMUTABLE_TABLES = new Set(['qd_rule_versions', 'qd_evidence_snapshots', 'qd_audit_log']);

/** G12 实体的列定义（列名顺序即 INSERT 列序；required = NOT NULL 且无 DB 默认）。 */
const ENTITIES = Object.freeze({
  qd_data_sources: {
    pk: 'source_id',
    columns: ['source_id', 'source_name', 'source_type', 'trust_level', 'status', 'config_ref', 'quality_metrics', 'created_at', 'updated_at'],
    required: ['source_id', 'source_name', 'source_type', 'trust_level', 'status', 'quality_metrics', 'created_at', 'updated_at'],
    json: ['quality_metrics'],
  },
  qd_matches: {
    pk: 'match_id',
    columns: ['match_id', 'league', 'home_team', 'away_team', 'match_time', 'status', 'actual_result', 'home_score', 'away_score', 'created_at', 'updated_at'],
    required: ['match_id', 'league', 'home_team', 'away_team', 'match_time', 'status', 'created_at', 'updated_at'],
    json: [],
  },
  qd_rule_versions: {
    pk: 'version_id',
    columns: ['version_id', 'rule_id', 'version', 'category', 'league_scope', 'team_scope', 'condition', 'conclusion', 'direction', 'base_confidence', 'priority', 'trust_level', 'valid_from', 'valid_to', 'evidence_refs', 'evidence_count', 'status', 'previous_version_id', 'created_at', 'created_by', 'approved_at', 'approved_by', 'approval_note', 'superseded_at', 'deprecated_at'],
    required: ['version_id', 'rule_id', 'version', 'category', 'condition', 'conclusion', 'direction', 'base_confidence', 'priority', 'trust_level', 'valid_from', 'status', 'created_at', 'created_by'],
    json: ['league_scope', 'team_scope', 'evidence_refs'],
    defaults: { league_scope: '[]', team_scope: '[]', evidence_refs: '[]', evidence_count: 0 },
  },
  qd_odds_snapshots: {
    pk: 'snapshot_id',
    columns: ['snapshot_id', 'match_id', 'institution', 'market', 'observed_at', 'received_at', 'data', 'trust_level', 'source_id'],
    required: ['snapshot_id', 'match_id', 'institution', 'market', 'observed_at', 'received_at', 'data', 'trust_level', 'source_id'],
    json: ['data'],
  },
  qd_match_features: {
    pk: 'feature_id',
    columns: ['feature_id', 'match_id', 'computed_at', 'features', 'feature_version', 'created_at'],
    required: ['feature_id', 'match_id', 'computed_at', 'features', 'feature_version', 'created_at'],
    json: ['features'],
  },
  qd_audit_log: {
    pk: 'event_id',
    columns: ['event_id', 'event_type', 'timestamp', 'actor', 'target_id', 'details', 'prev_state', 'new_state'],
    required: ['event_id', 'event_type', 'timestamp', 'actor', 'target_id', 'details'],
    json: ['details', 'prev_state', 'new_state'],
  },
  qd_analysis_commands: {
    pk: 'command_id',
    columns: ['command_id', 'match_id', 'status', 'idempotency_key', 'requested_at', 'requested_by', 'completed_at', 'result_ref', 'error'],
    required: ['command_id', 'match_id', 'status', 'idempotency_key', 'requested_at', 'requested_by'],
    json: [],
  },
  qd_predictions: {
    pk: 'prediction_id',
    columns: ['prediction_id', 'match_id', 'command_id', 'final_direction', 'final_confidence', 'weights', 'reasoning_chain', 'audit_trail_id', 'created_at', 'created_by'],
    required: ['prediction_id', 'match_id', 'final_direction', 'final_confidence', 'weights', 'reasoning_chain', 'audit_trail_id', 'created_at', 'created_by'],
    json: ['weights', 'reasoning_chain'],
  },
  qd_evidence_snapshots: {
    pk: 'evidence_id',
    columns: ['evidence_id', 'rule_version_id', 'match_id', 'observed_at', 'received_at', 'match_time', 'trigger_data', 'trigger_conditions', 'actual_result', 'prediction_correct', 'trust_level', 'statistics_eligible', 'eligible_checks', 'immutable', 'locked_at', 'created_at'],
    required: ['evidence_id', 'rule_version_id', 'match_id', 'observed_at', 'received_at', 'match_time', 'trigger_data', 'trigger_conditions', 'trust_level', 'eligible_checks', 'locked_at', 'created_at'],
    json: ['trigger_data', 'trigger_conditions', 'eligible_checks'],
    defaults: { statistics_eligible: 0, immutable: 1 },
  },
  qd_backtest_jobs: {
    pk: 'job_id',
    columns: ['job_id', 'rule_version_id', 'date_range', 'status', 'metrics', 'report_ref', 'created_at', 'created_by', 'completed_at'],
    required: ['job_id', 'rule_version_id', 'date_range', 'status', 'created_at', 'created_by'],
    json: ['metrics'],
  },
  qd_ai_candidates: {
    pk: 'candidate_id',
    columns: ['candidate_id', 'source', 'provider', 'content', 'trust_level', 'status', 'review_note', 'converted_rule_version_id', 'created_at', 'reviewed_at', 'reviewed_by'],
    required: ['candidate_id', 'source', 'content', 'status', 'created_at'],
    json: ['content', 'review_note'],
    defaults: { trust_level: 'untrusted' },
  },
  qd_field_registry: {
    pk: 'field_id',
    columns: ['field_id', 'field_name', 'data_type', 'unit', 'family', 'description', 'source_expression', 'version'],
    required: ['field_id', 'field_name', 'data_type', 'family', 'description', 'version'],
    json: [],
  },
  // ── 002 派生版：本地人工盘赔「整场版本化」物化层（磁盘为真相源，DB 为派生）──
  qd_hist_match_version: {
    pk: 'version_id',
    columns: ['version_id', 'match_id', 'content_hash', 'md_path', 'league', 'home_team', 'away_team', 'neutral', 'match_time', 'match_status', 'actual_result', 'home_score', 'away_score', 'observed_at', 'received_at', 'snapshot_count', 'status_flag', 'prev_version_id', 'superseded_by', 'match_payload', 'created_at'],
    required: ['version_id', 'match_id', 'content_hash', 'league', 'home_team', 'away_team', 'match_time', 'match_payload', 'created_at'],
    json: ['match_payload'],
    defaults: { neutral: 0, match_status: 'scheduled', snapshot_count: 0, status_flag: 'active' },
  },
  qd_hist_match_snapshot: {
    pk: 'snapshot_id',
    columns: ['snapshot_id', 'version_id', 'institution', 'market', 'observed_at', 'received_at', 'data', 'trust_level', 'source_id'],
    required: ['snapshot_id', 'version_id', 'institution', 'market', 'observed_at', 'received_at', 'data', 'trust_level', 'source_id'],
    json: ['data'],
    defaults: { trust_level: 'provisional', source_id: 'src_manual_odds' },
  },
  qd_hist_scan_runs: {
    pk: 'run_id',
    columns: ['run_id', 'started_at', 'finished_at', 'status', 'files_seen', 'files_ok', 'files_rejected', 'imported', 'skipped', 'superseded', 'note', 'created_at'],
    required: ['run_id', 'started_at', 'finished_at', 'status', 'created_at'],
    json: [],
    defaults: { files_seen: 0, files_ok: 0, files_rejected: 0, imported: 0, skipped: 0, superseded: 0 },
  },
});

/** 不可变违规（应用层守卫；DB 触发器兜底）。 */
class G12ImmutableError extends Error {
  constructor(table, op) {
    super(`immutable_violation: ${op} not allowed on ${table}`);
    this.name = 'G12ImmutableError';
    this.code = 'IMMUTABLE';
  }
}

/** 必填或缺列错误。 */
class G12ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'G12ValidationError';
    this.code = 'E_G12_VALIDATION';
  }
}

/**
 * 收缩记录为规范列对象：只保留 table 定义列，JSON 列序列化，缺失的可选列置 null。
 * 对必填缺失抛错（诚实失败，绝不用占位值掩盖数据缺口）。
 * @param {Object} def ENTITIES[table]
 * @param {Object} record
 */
function normalizeRecord(def, record) {
  if (!record || typeof record !== 'object') throw new G12ValidationError('record_required');
  const out = {};
  for (const col of def.columns) {
    if (def.json.includes(col)) {
      const v = record[col];
      out[col] = v == null ? null : JSON.stringify(v);
      continue;
    }
    out[col] = record[col] == null ? null : record[col];
  }
  for (const col of def.required) {
    if (out[col] == null) throw new G12ValidationError(`missing_required:${col}`);
  }
  // 对「NOT NULL + DEFAULT」列回填 DB 默认值（显式 null 会被 SQLite 判为 NOT NULL 违例，
  // 使 INSERT OR IGNORE 静默吞掉整行；此处填默认避免）
  if (def.defaults) {
    for (const [col, dv] of Object.entries(def.defaults)) {
      if (out[col] == null && !def.required.includes(col)) out[col] = dv;
    }
  }
  return out;
}

/**
 * 为单个实体构建类型化 store。
 */
function createStore(db, table, def) {
  const placeholders = def.columns.map(() => '?').join(', ');
  const cols = def.columns.join(', ');
  const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols}) VALUES (${placeholders})`);
  const get = db.prepare(`SELECT * FROM ${table} WHERE ${def.pk} = ?`);
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`);
  const list = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`);
  const byField = new Map();
  const immutable = IMMUTABLE_TABLES.has(table);

  const store = {
    table,
    immutable,
    /** @param {Object} record @returns {{ ok: boolean, inserted: boolean, reason?: string }} */
    insert(record) {
      const norm = normalizeRecord(def, record);
      const r = insert.run(...def.columns.map((c) => norm[c]));
      return { ok: true, inserted: r.changes === 1, changes: r.changes };
    },
    /** @param {string} id @returns {?Object} 原样游标行 */
    get(id) {
      const row = get.get(id);
      return row ? row : null;
    },
    /** @returns {number} */
    count() {
      return count.get().n;
    },
    /** @returns {Object[]} */
    all() {
      return list.all();
    },
    /** 按唯一/FK 列检索（惰性预备）。字段仅在 def.columns 或主键内。 */
    listBy(field, value) {
      if (field !== def.pk && !def.columns.includes(field)) {
        throw new G12ValidationError(`unknown_field:${table}:${field}`);
      }
      if (!byField.has(field)) byField.set(field, db.prepare(`SELECT * FROM ${table} WHERE ${field} = ?`));
      return byField.get(field).all(value);
    },
  };

  if (immutable) {
    store.update = () => { throw new G12ImmutableError(table, 'UPDATE'); };
    store.delete = () => { throw new G12ImmutableError(table, 'DELETE'); };
    store.patch = () => { throw new G12ImmutableError(table, 'PATCH'); };
  } else {
    store.update = () => { throw new G12ValidationError(`update_unsupported:${table}`); };
    store.delete = () => { throw new G12ValidationError(`delete_unsupported:${table}`); };
    store.patch = () => { throw new G12ValidationError(`patch_unsupported:${table}`); };
  }

  return store;
}

/**
 * 创建 G12 数据访问层。
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Record<string, ReturnType<typeof createStore>> & {
 *   tables: string[], immutableTables: string[], entities: typeof ENTITIES,
 * }}
 */
function createG12Repository(db) {
  const qd = { tables: Object.keys(ENTITIES), immutableTables: [...IMMUTABLE_TABLES], entities: ENTITIES };
  for (const table of Object.keys(ENTITIES)) {
    const short = table.replace('qd_', '');
    const store = createStore(db, table, ENTITIES[table]);
    qd[short] = store;      // qd.data_sources…
    qd[table] = store;      // qd.qd_data_sources…（与表名一致）
  }
  return qd;
}

module.exports = { createG12Repository, ENTITIES, G12ImmutableError, G12ValidationError, IMMUTABLE_TABLES };