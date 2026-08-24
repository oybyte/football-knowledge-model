// ============================================================================
// AI 引擎 · mining —— 规则挖掘
// 输入：历史数据样本（含特征快照 + 结算方向 + 赛前共识方向）+ 特征工程(Build 由调用方)。
// 输出：候选规则（样本量 / 命中率 / edge），一律 untrusted。
// 信任构造：LLM 只「提议」条件（field/op/value/direction），指标一律由引擎基于
//          真实数据集确定性重算，不采信模型自报数字，杜绝污染与幻觉。
// Direction → expected 映射：
//   favor_upper→'upper'  favor_lower→'lower'  follow→'consensus'  warning→'upset'
// 命中率（候选）基于条件命中的样本；基线为该类型在全集上的基础率；edge=命中率−基线。
// ============================================================================
'use strict';

const { DslEngine } = require('../dsl');
const { applyOperator } = require('../dsl/operators');
const { FIELD_REGISTRY } = require('../dsl/registry');
const { validateCandidate, toCondition } = require('./schema');
const { chat } = require('./providers');
const { stampUntrusted } = require('./containment');
const { Logger } = require('../lib/logger');

const logger = new Logger({ service: 'ai-engine' });

/** 默认候选篮（离线/兜底提案；引擎重算指标）。 */
const DEFAULT_PROPOSALS = Object.freeze([
  { id: 'AI001', field: 'move_pattern', op: 'EQ', value: '升盘降水', direction: 'favor_upper', expected: 'upper', rationale: '升盘降水代表资金压向主队，偏上盘' },
  { id: 'AI002', field: 'volume.ratio', op: 'GTE', value: 2.5, direction: 'warning', expected: 'upset', rationale: '量比放大暗示非公开信息，易出冷门' },
  { id: 'AI003', field: 'institution.sync_count', op: 'GTE', value: 3, direction: 'follow', expected: 'consensus', rationale: '多家同向调盘，跟随共识' },
  { id: 'AI004', field: 'water.upper.dispersion', op: 'GTE', value: 0.15, direction: 'warning', expected: 'upset', rationale: '机构主水离散度高，定价分歧' },
  { id: 'AI005', field: 'kelly_index.max', op: 'GTE', value: 1.05, direction: 'warning', expected: 'upset', rationale: '凯利超买，易反转' },
  { id: 'AI006', field: 'time_to_match', op: 'LTE', value: 180, direction: 'warning', expected: 'upset', rationale: '临场剧烈波动，方向未定型' },
]);

/** 正确性判定（样本给定 settlement/consensus）。 */
function isCorrect(sample, expected) {
  switch (expected) {
    case 'upper': return sample.settlement === 'upper';
    case 'lower': return sample.settlement === 'lower';
    case 'consensus': return sample.settlement === sample.consensus;
    case 'upset': return sample.settlement !== sample.consensus;
    default: return false;
  }
}

/** 全集基线（按 expected 类型的基础率）。 */
function baselineRate(samples, expected) {
  const n = samples.length;
  if (!n) return 0;
  return samples.filter((s) => isCorrect(s, expected)).length / n;
}

/**
 * 对单个候选：基于真实样本重算指标。
 * @returns {Object|null} 指标附加后的候选（样本量不足返回 null）
 */
function scoreCandidate(proposal, samples, minSamples = 5) {
  const validated = validateCandidate(proposal);
  if (!validated.ok) {
    logger.warn('ai_mining_candidate_invalid', { id: proposal.id, errors: validated.errors });
    return { ...proposal, valid: false, errors: validated.errors, sample_size: 0, hit_rate: 0, edge: 0 };
  }
  if (!proposal.expected) proposal.expected = deriveExpected(proposal.direction);

  // 条件命中样本
  const meta = DslEngine.registry.FIELD_REGISTRY[proposal.field];
  const type = (meta && meta.type) || (DslEngine.registry.FIELD_REGISTRY[proposal.field] || {}).type;
  const hits = samples.filter((s) => {
    const actual = s.features[proposal.field];
    return actual !== undefined && actual !== null && applyOperator(type, proposal.op, actual, proposal.value);
  });
  const sampleSize = hits.length;
  if (sampleSize < minSamples) {
    return { ...proposal, valid: true, sample_size: 0, hit_rate: 0, edge: 0, insufficient: true };
  }
  const correct = hits.filter((s) => isCorrect(s, proposal.expected)).length;
  const hitRate = correct / sampleSize;
  const base = baselineRate(samples, proposal.expected);
  return { ...proposal, valid: true, condition: toCondition(proposal), sample_size: sampleSize, hit_rate: hitRate, edge: hitRate - base };
}

const deriveExpected = (direction) => (
  direction === 'favor_upper' ? 'upper'
    : direction === 'favor_lower' ? 'lower'
      : direction === 'follow' ? 'consensus' : 'upset'
);

/** 解析 provider 文本 → 候选数组（容忍 top-level 数组 / {candidates:[...]}）。 */
function parseCandidates(text) {
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : (Array.isArray(data.candidates) ? data.candidates : []);
}

/**
 * 规则挖掘入口。
 * @param {Object} options
 * @param {Object[]} options.samples 历史样本 [{ id, features, settlement, consensus }]
 * @param {Object} [options.providerCfg]
 * @param {Object} [options.env]
 * @param {number} [options.minSamples] 最小样本量门限
 * @param {Object[]} [options.proposals] 自定义候选提案（默认 DEFAULT_PROPOSALS）
 * @returns {Promise<{ candidates:Object[], provider:string, degraded:boolean, baseline:Object }>}
 */
async function mineCandidates({ samples, providerCfg = null, env = process.env, minSamples = 5, proposals = null } = {}) {
  const list = Array.isArray(samples) ? samples : [];
  const base = {
    n: list.length,
    upper: baselineRate(list, 'upper'),
    lower: baselineRate(list, 'lower'),
    follow: baselineRate(list, 'consensus'),
    upset: baselineRate(list, 'upset'),
  };

  const prompt = {
    kind: 'mine',
    instruction: 'Propose candidate handicap rules as JSON array of {id, field, op, value, direction, expected, rationale}. Use registry fields.',
    summary: { total: list.length, baseline: base, features_present: list.length ? Object.keys(list[0].features || {}) : [] },
  };

  const seed = { kind: 'mine', candidates: (proposals || DEFAULT_PROPOSALS).map((p) => ({ ...p })) };

  const { text, provider, degraded } = await chat.call(null, {
    system: '你是足球盘口规则挖掘助手。只输出 JSON。',
    user: JSON.stringify(prompt),
    seed,
    config: providerCfg,
    env,
  });

  let proposed;
  try {
    proposed = parseCandidates(text);
  } catch (e) {
    proposed = [];
    logger.warn('ai_mining_parse_failed', { error: e.message });
  }
  if (!proposed.length) proposed = (proposals || DEFAULT_PROPOSALS).map((p) => ({ ...p }));

  const candidates = proposed
    .map((p) => scoreCandidate(p, list, minSamples))
    .filter((c) => c && c.sample_size > 0)
    .filter((c) => c.valid !== false)
    .sort((a, b) => b.edge - a.edge)
    .map((c) => stampUntrusted({ ...c, candidate_source: provider }));

  logger.info('ai_mining_done', { provider, candidates: candidates.length, degraded });
  return { candidates, provider, degraded, baseline: base };
}

// 供测试/复用
module.exports = { mineCandidates, scoreCandidate, baselineRate, DEFAULT_PROPOSALS, deriveExpected, parseCandidates };