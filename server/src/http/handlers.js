// ============================================================================
// HTTP 层 · handlers —— 7 个 REST 端点（对齐原型 api-client http 契约）
// 全部由真实后端模块实现（数据接入 / 特征 / 预测链 / 规则存储 / 回测 / AI 引擎）。
// 响应：成功 { status, data }；失败 { status, error }（由 dispatcher 包成统一壳）。
// ============================================================================
'use strict';

const { loadMockMatches, getMockMatch } = require('../data/mock');
const { computeMatchFeatures } = require('../features');
const { predict } = require('../engine');
const { runBacktest, THRESHOLDS } = require('../backtest');
const { mineCandidates, escalateToProposed } = require('../ai');
const { buildSamples, buildEvidence } = require('./samples');

const BACKTEST_RANGE = { from: '2026-08-01T00:00:00+08:00', to: '2026-08-20T00:00:00+08:00' };

/** AI 候选注册表：GET /api/ai/candidates 产出后按 id 暂存，供 review 引用。 */
const candidateRegistry = new Map();

function ok(data) { return { status: 200, data }; }
function fail(status, error) { return { status, error }; }

// ───────────────────────── GET /api/matches ─────────────────────────
function listMatches() {
  const matches = loadMockMatches().map((m) => ({
    match_id: m.match_id,
    league: m.league,
    home_team: m.home_team,
    away_team: m.away_team,
    kickoff: m.match_time,
  }));
  return ok(matches);
}

// ───────────────────────── GET /api/analysis/:id ─────────────────────────
function getAnalysis(service, params) {
  const match = getMockMatch(params.id);
  if (!match) return fail(404, 'match_not_found');

  const at = match.match_time; // 赛前分析锚点（数据须早于开赛）
  const feat = computeMatchFeatures(match, at);
  if (!feat.ok) return fail(422, feat.errors.join(', '));

  const result = predict({
    match: match.match_id,
    featureSnapshot: feat.snapshot.features, // predict 契约：扁平特征对象
    at,
    getActiveRules: () => service.rules.getActiveRules(),
  });

  const hits = result.retrieval.hits.map((h) => ({
    rule_id: h.rule.rule_id,
    version_id: h.rule.version_id,
    direction: h.direction,
    confidence: h.confidence,
    exact: !!h.match.exact,
  }));
  const reasoning = hits.map((h) => ({
    rule_id: h.rule_id,
    hit: true,
    dir: h.direction,
    note: `条件满足，纳入推理链（conf=${h.confidence}）`,
  }));
  const prediction = result.prediction
    ? {
        prediction_id: result.prediction.prediction_id,
        final_direction: result.prediction.final_direction,
        final_confidence: result.prediction.final_confidence,
        created_at: result.prediction.created_at,
      }
    : null;
  const arbitration = {
    direction: result.retrieval.arbitration.direction,
    confidence: result.retrieval.arbitration.confidence,
    dominant_rule_version_id: result.retrieval.arbitration.dominant_rule_version_id,
    manual_review_required: result.retrieval.arbitration.manual_review_required,
    review_note: result.retrieval.arbitration.review_note,
  };

  return ok({ match_id: match.match_id, at, hits, reasoning, prediction, arbitration });
}

// ───────────────────────── GET /api/rules ─────────────────────────
function listRules(service) {
  const rules = service.rules.getActiveRules().map((v) => ({
    rule_id: v.rule_id,
    version_id: v.version_id,
    version: v.version,
    status: v.status,
    category: v.category,
    direction: v.direction,
    base_confidence: v.base_confidence,
    priority: v.priority,
    trust_level: v.trust_level,
    conclusion: v.conclusion,
  }));
  return ok(rules);
}

// ───────────────────────── GET /api/rules/:id/versions ─────────────────────────
function getRuleVersions(service, params) {
  const versions = service.rules.getRuleVersions(params.id);
  if (!versions.length) return fail(404, 'rule_not_found');
  return ok(versions);
}

// ───────────────────────── GET /api/backtest/:id ─────────────────────────
function getBacktest(service, params) {
  const versions = service.rules.getRuleVersions(params.id);
  if (!versions.length) return fail(404, 'rule_not_found');
  const rule = versions[0];
  const job = runBacktest({
    rule_version_id: rule.version_id,
    date_range: BACKTEST_RANGE,
    evidences: buildEvidence(rule),
    rule,
    actor: 'api:backtest',
  });
  return ok({
    rule_id: params.id,
    job_id: job.job_id,
    adjudication: job.adjudication,
    sample_size: job.metrics ? job.metrics.sample_size : 0,
    metrics: job.metrics,
    thresholds: THRESHOLDS,
    synthetic: true,
  });
}

// ───────────────────────── GET /api/ai/candidates ─────────────────────────
async function listAiCandidates() {
  const samples = buildSamples();
  const { candidates, provider, degraded, baseline } = await mineCandidates({ samples });
  for (const c of candidates) candidateRegistry.set(c.id, c);
  return ok({ candidates, provider, degraded, baseline, sample_count: samples.length, synthetic: true });
}

// ───────────────────────── POST /api/ai/candidates/:id/review ─────────────────────────
async function reviewAiCandidate(service, params, body) {
  const candidate = candidateRegistry.get(params.id);
  if (!candidate) return fail(404, 'candidate_not_found');
  const verdict = body && body.verdict;

  if (verdict === 'approve') {
    const res = await escalateToProposed({
      candidate,
      stateMachine: service.rules.stateMachine,
      store: service.rules.store,
      actor: 'api:reviewer',
      note: 'HTTP 审核转正',
    });
    if (!res.ok) return fail(422, res.errors.join(', '));
    return ok({ rule_id: res.version.rule_id, version_id: res.version.version_id, status: res.version.status });
  }
  if (verdict === 'reject') {
    candidateRegistry.delete(params.id);
    return ok({ rule_id: params.id, status: 'rejected' });
  }
  return fail(400, 'invalid_verdict');
}

module.exports = {
  listMatches,
  getAnalysis,
  listRules,
  getRuleVersions,
  getBacktest,
  listAiCandidates,
  reviewAiCandidate,
  candidateRegistry,
};
