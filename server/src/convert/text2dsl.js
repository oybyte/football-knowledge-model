// ============================================================================
// 文字规则 → DSL · text2dsl —— 转换 + 编译校验 + 入库脚本
// 阶段 2.1：文字规则 → RuleVersion（status=draft，trust_level=untrusted，
//           created_by='convert:text2dsl:phase2.1'）。
// 硬约束：入库前每条 DSL 条件必须通过 DslEngine.compile（编译期 8 项校验）。
// 产出格式：RuleVersion，可经 RuleStore.insert 直接入库。
// ============================================================================
'use strict';

const { DslEngine } = require('../dsl');
const { RuleStore } = require('../rules');
const { listCatalog } = require('./catalog');
const { defaultLogger } = require('../lib/logger');

const BASE_TIME = '2026-08-24T00:00:00+08:00';
const MIGRATOR = 'convert:text2dsl:phase2.1';
const SOURCE = 'text_rule';

/**
 * 单条文字规则 → RuleVersion（draft / untrusted）。
 * @param {Object} entry catalog 条目
 * @returns {Object} RuleVersion
 */
function buildRuleVersion(entry) {
  return {
    version_id: `${entry.id}#1`,
    rule_id: entry.id,
    version: 1,
    category: entry.category,
    league_scope: [],
    team_scope: [],
    condition: entry.condition,
    conclusion: entry.conclusion,
    direction: entry.direction,
    base_confidence: Number.isFinite(entry.base_confidence) ? entry.base_confidence : 0.5,
    priority: entry.priority ?? 50,
    trust_level: 'untrusted', // AI/文字批量转换 → untrusted，需人工审核转正
    valid_from: BASE_TIME,
    valid_to: null,
    evidence_refs: [],
    evidence_count: 0,
    status: 'draft', // 入库即 draft，纳入状态机
    previous_version_id: null,
    created_at: BASE_TIME,
    created_by: MIGRATOR,
    approved_at: null,
    approved_by: null,
    approval_note: null,
    superseded_at: null,
    deprecated_at: null,
    source: SOURCE,
    original_text: entry.original,
  };
}

/**
 * 全量编译校验：每条 DSL 条件必须通过 DslEngine.compile。
 * @returns {Object[]} [{ id, ok, errors }]
 */
function compileAll() {
  return listCatalog().map((e) => {
    const res = DslEngine.compile(e.condition);
    return { id: e.id, status: e.category, direction: e.direction, ok: res.ok, errors: res.errors };
  });
}

/**
 * 入库脚本：编译通过 → RuleStore.insert。
 * @param {Object} options
 * @param {RuleStore} [options.store] 注入 store（默认新建，避免污染单例）
 * @param {Function} [options.logger]
 * @returns {{ total:number, inserted:number, skipped:number, verdicts:Object[], versions:Object[] }}
 */
function ingest({ store = new RuleStore(), logger = defaultLogger } = {}) {
  const checklist = compileAll();
  const total = checklist.length;
  const inserted = [];
  const skipped = [];

  for (let i = 0; i < total; i++) {
    const c = checklist[i];
    if (!c.ok) {
      skipped.push({ id: c.id, reason: 'compile_failed', errors: c.errors });
      logger.warn('text2dsl_compile_skipped', { rule_id: c.id, errors: c.errors.map((x) => x.code) });
      continue;
    }
    const version = buildRuleVersion(listCatalog()[i]);
    const res = store.insert(version);
    if (res.ok) {
      inserted.push(version);
    } else {
      skipped.push({ id: c.id, reason: 'insert_failed', errors: res.errors });
      logger.warn('text2dsl_insert_skipped', { rule_id: c.id, errors: res.errors });
    }
  }

  logger.info('text2dsl_ingested', { total, inserted: inserted.length, skipped: skipped.length });
  return { total, inserted: inserted.length, skipped: skipped.length, verdicts: checklist, versions: inserted };
}

module.exports = {
  buildRuleVersion,
  compileAll,
  ingest,
  BASE_TIME,
  MIGRATOR,
};