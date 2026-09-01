// ============================================================================
// 规则存储服务 · v97loader —— V9.7 registry 适配器（真规则唯一来源）
//
// 职责：
//  1) 读取真实规则源 F:/ocr_python_data/doc/workbench/current/rule_registry.json
//     （不在本仓库内，可用 env OE_V97_REGISTRY_DIR 覆盖）。
//  2) 启动门禁：核对 rule_registry.json 与 _gate_index.json 的 registry_version
//     都为 EXPECTED_VERSION(V9.7)；不一致则抛错拦截启动（对齐 V9.7 AGENT.md 每场启动门禁）。
//  3) 将 88 条 V9.7 规则映射为 RuleVersion：
//       - 完整 V9.7 原生对象存入 payload 的 v97 字段（权威内容，引擎 Phase 2 消费）；
//       - 标量列（category/direction/condition/conclusion/...）作派生索引，便于现有
//         存储/查询/HTTP 层无需改造即可读取；真实方向语义在 payload.v97.effects。
//  4) 旁挂治理表（routing_table/input_contract/conflict_graph/decision_register 等）
//     于 loader 结果中，供 Phase 2 引擎直接消费，不入库（Phase 2 再决定落库形态）。
//
// 设计要点：
//  - rule_versions 是 registry(JSON) 的「派生缓存」，每启动由 seed 重灌（幂等）。
//  - DB 不可变触发器禁止运行时 DELETE/UPDATE；mock 清空由迁移 003 DROP+CREATE 完成。
//  - 本 loader 结果带进程内缓存，seed 多次调用只解析一次。
// ============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 代码门禁期望版本。registry 与 gate_index 必须一致且等于此值；
 * 版本不符（含未来 V9.8 未适配、或文件缺失/损坏）一律拦截启动。
 */
const EXPECTED_VERSION = 'V9.7';

/** 默认 registry 目录（用户正在使用的最新规则；不在本仓库内）。 */
const DEFAULT_REGISTRY_DIR = 'F:/ocr_python_data/doc/workbench/current';

/** @returns {string} registry 目录（env 优先） */
function resolveRegistryDir() {
  return process.env.OE_V97_REGISTRY_DIR || DEFAULT_REGISTRY_DIR;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * 派生粗粒度 orientation（标量 direction 列仅作索引）。
 * 真实方向语义在 payload.v97.effects，由 Phase 2 引擎解析。
 * @param {Object} rule V9.7 规则对象
 * @returns {'rule'|'execution'|'signal'}
 */
function deriveDirection(rule) {
  if (rule.type === 'S') return 'signal';
  if (rule.type === 'E') return 'execution';
  return 'rule'; // type R
}

/**
 * 派生 base_confidence（V9.7 无单值；Phase 2 由 edge/ROI 重算）。
 * 含硬性门禁/阈值/否决类 effect 的规则略高，其余取保守默认。
 * @param {Object} rule
 * @returns {number}
 */
function deriveConfidence(rule) {
  let c = 0.6;
  const blob = JSON.stringify(rule).slice(0, 4000);
  if (/强制|必须|门禁|gate|veto|一票否决|硬性/.test(blob)) c = 0.7;
  return c;
}

/**
 * 派生 priority（precedence_class 中文 → 数值）。
 * @param {Object} rule
 * @returns {number}
 */
function derivePriority(rule) {
  const pc = rule.precedence_class || '';
  if (/强制|必须|最高|顶级/.test(pc)) return 90;
  if (/优先|前置|强|排序链/.test(pc)) return 70;
  if (rule.type === 'E') return 60; // 执行规范次之
  return 50;
}

/** 规则摘要（首页/列表可读结论）。 */
function summarize(rule) {
  const acts = (rule.atoms || []).map((a) => a.action).filter(Boolean);
  const head = acts[0] || rule.name;
  return `${rule.name}｜${head}`;
}

/**
 * 单条 V9.7 规则 → RuleVersion。
 * @param {Object} rule V9.7 原生规则
 * @param {string} registryVersion
 * @param {string} [generated] registry 生成时间
 * @returns {Object} RuleVersion（payload 含完整 v97）
 */
function toVersion(rule, registryVersion, generated) {
  const validFrom = generated || new Date().toISOString();
  return {
    version_id: `${rule.id}#1`,
    rule_id: rule.id,
    version: 1,
    category: rule.category, // V9.7 中文分类（已加入 schema 枚举）
    rule_type: rule.type, // R / E / S，便于查询与 DoD 校验
    direction: deriveDirection(rule), // 粗粒度角色标签
    // condition 仅作占位（非 DSL 树）；DSL 引擎对无 type 的节点会优雅 skip，Phase 1 不触发误判。
    condition: {
      kind: 'v97_atoms',
      atom_count: (rule.atoms || []).length,
      summary: summarize(rule),
    },
    conclusion: summarize(rule),
    base_confidence: deriveConfidence(rule),
    priority: derivePriority(rule),
    trust_level: 'provisional', // 未回测验证，统一 provisional
    valid_from: validFrom,
    valid_to: null,
    evidence_refs: [],
    evidence_count: 0,
    status: 'active', // V9.7 为当前在用规则集
    previous_version_id: null,
    created_at: validFrom,
    created_by: 'v97loader:V9.7',
    approved_at: null,
    approved_by: null,
    approval_note: null,
    superseded_at: null,
    deprecated_at: null,
    source: 'v97_registry',
    // —— V9.7 原生完整对象（权威内容，引擎 Phase 2 消费）——
    v97: rule,
    registry_version: registryVersion,
  };
}

/**
 * 启动门禁：校验 registry_version 与 _gate_index.json 一致且等于期望版本。
 * @param {Object} registry
 * @param {Object|null} gateIndex
 */
function assertGate(registry, gateIndex) {
  const rv = registry && registry.registry_version;
  const gv = gateIndex && gateIndex.registry_version;
  if (rv !== EXPECTED_VERSION) {
    throw new Error(
      `v97_gate_failed: rule_registry.json registry_version="${rv}" != expected "${EXPECTED_VERSION}". 启动被拦截。`,
    );
  }
  if (gateIndex && gv !== EXPECTED_VERSION) {
    throw new Error(
      `v97_gate_failed: _gate_index.json registry_version="${gv}" != expected "${EXPECTED_VERSION}". 启动被拦截。`,
    );
  }
}

/**
 * 载入 V9.7 真规则（带进程内缓存）。
 * @param {{ force?: boolean }} [opts]
 * @returns {{
 *   registry_version: string, generated: string, count: number, rules: Object[],
 *   routing_table: Array, input_contract: Object, decision_register: Array,
 *   conflict_graph: Object, coverage_matrix: Array, weight_adjustment_policy: Object,
 *   statistics_eligibility: Object, field_glossary: Array
 * }}
 */
function loadV97Rules({ force = false } = {}) {
  if (_cache && !force) return _cache;

  const dir = resolveRegistryDir();
  const registryPath = path.join(dir, 'rule_registry.json');
  const gatePath = path.join(dir, '_gate_index.json');

  if (!fs.existsSync(registryPath)) {
    throw new Error(
      `v97_registry_not_found: ${registryPath}（设置 OE_V97_REGISTRY_DIR 指向 V9.7 规则目录）`,
    );
  }

  const registry = readJson(registryPath);
  const gateIndex = fs.existsSync(gatePath) ? readJson(gatePath) : null;
  assertGate(registry, gateIndex);

  const rules = (registry.rules || []).map((r) => toVersion(r, registry.registry_version, registry.generated));

  const result = {
    registry_version: registry.registry_version,
    generated: registry.generated || new Date().toISOString(),
    count: rules.length,
    rules,
    // 旁挂治理表（Phase 2 引擎消费，当前不入库）
    routing_table: registry.routing_table || [],
    input_contract: registry.input_contract || {},
    decision_register: registry.decision_register || [],
    conflict_graph: registry.conflict_graph || {},
    coverage_matrix: registry.coverage_matrix || [],
    weight_adjustment_policy: registry.weight_adjustment_policy || {},
    statistics_eligibility: registry.statistics_eligibility || {},
    field_glossary: registry.field_glossary || [],
  };

  _cache = result;
  return result;
}

/** 仅执行门禁校验（不返回规则），供启动自检复用。 */
function checkGate() {
  const dir = resolveRegistryDir();
  const registryPath = path.join(dir, 'rule_registry.json');
  const gatePath = path.join(dir, '_gate_index.json');
  if (!fs.existsSync(registryPath)) {
    throw new Error(`v97_registry_not_found: ${registryPath}`);
  }
  const registry = readJson(registryPath);
  const gateIndex = fs.existsSync(gatePath) ? readJson(gatePath) : null;
  assertGate(registry, gateIndex);
  return { registry_version: registry.registry_version };
}

let _cache = null;

module.exports = {
  loadV97Rules,
  checkGate,
  assertGate,
  deriveDirection,
  deriveConfidence,
  derivePriority,
  DEFAULT_REGISTRY_DIR,
  EXPECTED_VERSION,
};
