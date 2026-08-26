// ============================================================================
// G12 数据访问层 · backfill —— 从运行时表迁移回填到 G12 qd_* 表
// 把已运行持久化层（rule_store / prediction_store / audit_store 及外部 match/
// data_source/field 源）的存量数据，按 G12 约束幂等回填到 qd_* 表。
// 原则：
//   1. 事务内执行，任一步失败整体回滚；
//   2. 全程 INSERT OR IGNORE（按 PK 幂等），重复执行不产生重复行；
//   3. FK 依赖序：data_sources → matches → audit_log → rule_versions → predictions；
//   4. 语义不对齐不强行对应（如 qd_evidence_snapshots 是『规则回测证据』，运行时
//      evidences 是『预测结果证据』，不回填拼凑；由上层以 lockRuleEvidence 等正式写入）。
// ============================================================================
'use strict';

const { listSources } = require('../../data/sources/registry');
const { withTransaction } = require('../connection');
const { defaultLogger } = require('../../lib/logger');

/** 广播/可获得的比赛归一化：接受 {match_id|id, ...} → G12 qd_matches 行。 */
function toG12Match(m, now) {
  const base = m && m.match_id ? m : m && m.id ? { ...m, match_id: m.id } : m;
  return {
    match_id: base.match_id,
    league: base.league ?? '未知联赛',
    home_team: base.home_team ?? base.home ?? '待定',
    away_team: base.away_team ?? base.away ?? '待定',
    match_time: base.match_time ?? base.kickoff,
    status: base.status ?? (base.kickoff && Date.parse(base.kickoff) <= Date.now() ? 'finished' : 'scheduled'),
    actual_result: base.actual_result ?? null,
    home_score: base.home_score ?? null,
    away_score: base.away_score ?? null,
    created_at: base.created_at ?? now,
    updated_at: base.updated_at ?? now,
  };
}

/** RuleVersion → qd_rule_versions。 */
function toG12RuleVersion(v) {
  return {
    version_id: v.version_id,
    rule_id: v.rule_id,
    version: v.version,
    category: v.category,
    league_scope: v.league_scope || [],
    team_scope: v.team_scope || [],
    condition: v.condition,
    conclusion: v.conclusion,
    direction: v.direction,
    base_confidence: v.base_confidence,
    priority: v.priority,
    trust_level: v.trust_level,
    valid_from: v.valid_from,
    valid_to: v.valid_to || null,
    evidence_refs: v.evidence_refs || [],
    evidence_count: v.evidence_count || 0,
    status: v.status,
    previous_version_id: v.previous_version_id || null,
    created_at: v.created_at,
    created_by: v.created_by,
    approved_at: v.approved_at || null,
    approved_by: v.approved_by || null,
    approval_note: v.approval_note || null,
    superseded_at: v.superseded_at || null,
    deprecated_at: v.deprecated_at || null,
  };
}

/** SqliteAuditStore 行（G3 日志）→ qd_audit_log。 */
function toG12Audit(row, seq) {
  const payload = (row && row.payload) || {};
  return {
    event_id: `aud_${row.seq != null ? row.seq : seq}`,
    event_type: row.message || 'log',
    timestamp: row.ts || row.timestamp || new Date().toISOString(),
    actor: row.service || 'system',
    target_id: row.trace_id || '',
    details: payload,
    prev_state: row.prev_state || null,
    new_state: row.new_state || null,
  };
}

/** 规范化 G12 字段注册表种子（family 对齐设计文档 §3/§6 分组）。 */
function g12Family(field) {
  if (field.startsWith('institution.sync') || field.startsWith('consensus')) return 'resonance';
  if (field.startsWith('kelly') || field.startsWith('volume') || field.startsWith('odds.volatility') || field.startsWith('betfair')) return 'anomaly';
  if (field.startsWith('match.')) return 'cross_section';
  return 'temporal';
}

/** 由 DSL 字段注册项派生 G12 qd_field_registry 行。 */
function toG12Field(entries = {}, now) {
  const map = { number: 'number', integer: 'number', string: 'string', boolean: 'boolean' };
  return Object.entries(entries).map(([name, f], i) => ({
    field_id: `fd_${String(i + 1).padStart(3, '0')}`,
    field_name: name,
    data_type: map[f.type] || 'string',
    unit: f.unit || null,
    family: g12Family(name),
    description: `${name} 特征字段`,
    source_expression: null,
    version: '1.0.0',
  }));
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * 执行 G12 迁移回填（幂等，事务内）。运行时缺失的序列以序号补足，缺失值不捏造。
 * @param {Object} p
 * @param {import('node:sqlite').DatabaseSync} p.db
 * @param {Object} p.qd createG12Repository(db) 返回值
 * @param {Object} p.ruleStore 需有 listAll()（返回 RuleVersion[]）
 * @param {Object} p.predictionStore 需有 list()（返回 PredictionRecord[]）
 * @param {Object} p.auditStore 需有 listAll()（返回 G3 日志行[]）
 * @param {Object[]} [p.matches] 比赛源（match_id 优先，兼容 id）
 * @param {Object[]} [p.dataSources] 数据源（默认 src/data/sources/registry）
 * @param {Object[]} [p.fieldSeed] G12 字段注册表行
 * @param {import('../lib/logger').Logger} [p.logger]
 * @returns {Object} 本次实际新增的各类计数：{ data_sources, field_registry, matches, audit_log, rule_versions, predictions, predictions_skipped_no_match }
 */
function backfillG12({ db, qd, ruleStore, predictionStore, auditStore, matches = [], dataSources = listSources(), fieldSeed = null, logger = defaultLogger }) {
  if (!db || !qd) throw new Error('backfillG12: db & qd required');
  const now = nowIso();
  const seed = fieldSeed || toG12Field(require('../../dsl/registry').FIELD_REGISTRY, now);
  const counts = {
    data_sources: 0, field_registry: 0, matches: 0, audit_log: 0,
    rule_versions: 0, predictions: 0, predictions_skipped_no_match: 0,
  };

  withTransaction(db, () => {
    // 1) 支撑/元数据
    for (const ds of dataSources) {
      if (qd.data_sources.insert({
        source_id: ds.source_id, source_name: ds.source_name, source_type: ds.source_type,
        trust_level: ds.trust_level, status: ds.status, config_ref: ds.config_ref || null,
        quality_metrics: ds.quality_metrics, created_at: ds.created_at || now, updated_at: ds.updated_at || now,
      }).inserted) counts.data_sources += 1;
    }
    for (const f of seed) {
      if (qd.field_registry.insert({ ...f, version: f.version || '1.0.0' }).inserted) counts.field_registry += 1;
    }

    // 2) 比赛（供 predictions 外键）
    const matchIndex = new Set();
    for (const m of matches) {
      const row = toG12Match(m, now);
      if (qd.matches.insert(row).inserted) { counts.matches += 1; matchIndex.add(row.match_id); }
      else if (qd.matches.get(row.match_id)) matchIndex.add(row.match_id); // 已存在
    }

    // 3) 审计（G3 日志）→ qd_audit_log
    const audits = (auditStore && typeof auditStore.listAll === 'function') ? auditStore.listAll() : [];
    let seq = 0;
    for (const a of audits) {
      seq += 1;
      if (qd.audit_log.insert(toG12Audit(a, seq)).inserted) counts.audit_log += 1;
    }

    // 4) 规则版本
    const versions = (ruleStore && typeof ruleStore.listAll === 'function') ? ruleStore.listAll() : [];
    for (const v of versions) {
      if (qd.rule_versions.insert(toG12RuleVersion(v)).inserted) counts.rule_versions += 1;
    }

    // 5) 预测：仅回填已建 match 且有审计锚点的记录；缺失锚点补占位（不再捏造赛果信息）
    const preds = (predictionStore && typeof predictionStore.list === 'function') ? predictionStore.list() : [];
    for (const p of preds) {
      if (!matchIndex.has(p.match_id) && !qd.matches.get(p.match_id)) {
        counts.predictions_skipped_no_match += 1;
        continue;
      }
      // 审计锚点（qd_predictions.audit_trail_id NOT NULL FK）
      const auditId = p.audit_trail_id || `auto_pub_${p.prediction_id}`;
      if (!qd.audit_log.get(auditId)) {
        if (qd.audit_log.insert({
          event_id: auditId, event_type: 'prediction_published',
          timestamp: p.created_at || now, actor: p.created_by || 'publish:engine',
          target_id: p.prediction_id, details: { prediction_id: p.prediction_id },
          prev_state: null, new_state: null,
        }).inserted) counts.audit_log += 1;
      }
      // 分析命令锚点（FR 需先存在；qd_analysis_commands）
      let commandId = p.command_id || null;
      if (commandId && !qd.analysis_commands.get(commandId)) {
        qd.analysis_commands.insert({
          command_id: commandId, match_id: p.match_id, status: 'completed',
          idempotency_key: commandId, requested_at: p.created_at || now,
          requested_by: p.created_by || 'backfill', completed_at: p.created_at || now, result_ref: null, error: null,
        });
      }
      if (qd.predictions.insert({
        prediction_id: p.prediction_id, match_id: p.match_id, command_id: commandId,
        final_direction: p.final_direction, final_confidence: p.final_confidence,
        weights: p.weights || {}, reasoning_chain: p.reasoning_chain || [],
        audit_trail_id: auditId, created_at: p.created_at || now, created_by: p.created_by || 'backfill',
      }).inserted) counts.predictions += 1;
    }
  });

  logger.info('g12_backfill_done', { counts });
  return counts;
}

module.exports = { backfillG12, toG12Match, toG12RuleVersion, toG12Audit, toG12Field };