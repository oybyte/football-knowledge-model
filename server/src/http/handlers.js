// ============================================================================
// HTTP 层 · handlers —— REST 端点（对齐原型 api-client http 契约）
// 全部由真实后端模块实现（数据接入 / 特征 / 预测链 / 规则存储 / 回测 / AI 引擎）。
// 响应：成功 { status, data }；失败 { status, error }（由 dispatcher 包成统一壳）。
// ============================================================================
'use strict';

const { loadMockMatches, getMockMatch } = require('../data/mock');
const { loadManualOdds, syncSportterySchedule, syncSportteryOdds, mergeMatchSources, querySources } = require('../data');
const { loadManualOddsFromDb } = require('../db/g12/manualReconcile');
const { computeMatchFeatures } = require('../features');
const { predict } = require('../engine');
const { runBacktest, THRESHOLDS } = require('../backtest');
const { mineCandidates, escalateToProposed } = require('../ai');
const { buildSamples, buildEvidence } = require('./samples');
const { MemoryCacheAdapter } = require('../cache/adapter');

const BACKTEST_RANGE = { from: '2026-08-01T00:00:00+08:00', to: '2026-08-20T00:00:00+08:00' };

/** AI 候选注册表：GET /api/ai/candidates 产出后按 id 暂存，供 review 引用。 */
const candidateRegistry = new Map();

function ok(data) { return { status: 200, data }; }
function fail(status, error) { return { status, error }; }

// ───────────────────────── 体彩官方数据「当天缓存」 ─────────────────────────
// 中国体彩官网为公益网站，使用公开数据的同时必须控制请求频率：
//   · 官方赛程/赔率同步结果按「北京时间当天」缓存，跨天自动失效；
//   · 自动请求每天最多直连官方一次，其余全部命中缓存；
//   · ?refresh=1 仅由用户手动刷新触发，跳过缓存强制直连官方并更新缓存。
const DAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const dayCaches = new WeakMap();

function dayCacheOf(service) {
  let cache = dayCaches.get(service);
  if (!cache) {
    cache = new MemoryCacheAdapter({ defaultTtlMs: DAY_CACHE_TTL_MS });
    dayCaches.set(service, cache);
  }
  return cache;
}

/** 北京时间当天日期串 YYYY-MM-DD（缓存键的日期维度，跨天自动 miss）。 */
function bjDay() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

/** 距北京时间当天 24:00 的毫秒数（下限 60s，避免整点边界抖动）。 */
function msUntilBjMidnight() {
  const now = Date.now();
  const nextBjMidnight = Math.ceil((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  return Math.max(nextBjMidnight - now, 60 * 1000);
}

function wantRefresh(params) {
  return !!(params && params.query && String(params.query.refresh) === '1');
}

/**
 * 当天缓存的官方数据同步：未强制且命中缓存 → 直接返回；否则直连官方并写缓存。
 * @returns {Promise<{ value: object, cached: boolean }>}
 */
async function cachedOfficialSync(service, key, fetcher, force) {
  const cache = dayCacheOf(service);
  if (!force) {
    const hit = await cache.get(key);
    if (hit !== undefined) return { value: hit, cached: true };
  }
  const value = await fetcher();
  await cache.set(key, value, msUntilBjMidnight());
  return { value, cached: false };
}

/** 竞彩官方赛程同步（当天缓存）。 */
function syncScheduleCached(service, force) {
  return cachedOfficialSync(service, 'sporttery_schedule:' + bjDay(), () => syncSportterySchedule({ env: process.env }), force);
}

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
  const analysis = buildAnalysis(service, match);
  return ok({ ...analysis, source: 'mock' });
}

// ───────────────────────── GET /api/manual-odds/analysis/:id ─────────────────────────
// 盘口数据.md → MatchSchema → 特征 → 推理链 端到端（真实本地人工盘赔源）。
// 每次按当前 env 扫描定位场次，全部盘赔快照均早于开赛，且防泄漏。
function getManualAnalysis(service, params) {
  const res = loadManualOdds({ env: process.env, actor: { id: 'http:worker', role: 'ingest' } });
  if (res.status === 'not_configured') return fail(503, 'manual_odds_not_configured');
  const id = decodeURIComponent(params.id || ''); // match_id 含中文，需解码
  const match = (res.matches || []).find((m) => m.match_id === id);
  if (!match) return fail(404, 'match_not_found_in_manual_source');
  const analysis = buildAnalysis(service, match);
  const snapShots = match.snapshots || [];
  return ok({
    ...analysis,
    source: 'src_manual_odds',
    trust_level: (snapShots[0] && snapShots[0].trust_level) || 'provisional',
    snapshots: snapShots.length,
    neutral: match.neutral,
    strategy_meta: match.meta,
  });
}

/** 共享分析核心：MatchSchema → 特征快照 → 规则检索/融合 → 推理链。 */
function buildAnalysis(service, match) {
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

  return { match_id: match.match_id, at, features: feat.snapshot.features, hits, reasoning, prediction, arbitration, feat_errors: [] };
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

// ───────────────────────── GET /api/sources/schedule ─────────────────────────
// 竞彩官方赛程源同步（真实端点注入 env:ODDS_SPORTTERY_SCHEDULE_BASE）。
// 当天缓存：自动请求每天最多直连官方一次；?refresh=1 手动强制刷新。
async function getScheduleStatus(service, params) {
  try {
    const force = wantRefresh(params);
    const { value: res, cached } = await syncScheduleCached(service, force);
    const meta = res.meta || { total: 0, admitted: 0, rejected: 0 };
    return ok({
      source_id: res.source_id,
      status: res.status,
      reason: res.reason,
      message: res.message,
      meta,
      cached,
      cache_day: bjDay(),
      matches: (res.matches || []).map((m) => ({
        match_id: m.match_id,
        league: m.league,
        home_team: m.home_team,
        away_team: m.away_team,
        match_time: m.match_time,
        status: m.status,
      })),
    });
  } catch (e) {
    return fail(500, 'schedule_sync_error');
  }
}

// ───────────────────────── GET /api/sources/sporttery-odds ─────────────────────────
// 竞彩官方赔率源同步（直连 webapi.sporttery.cn，无需配置端点）。
// 当天缓存（公益网站减负）：自动请求每天最多直连官方一次；?refresh=1 手动强制刷新。
async function getSportteryOddsStatus(service, params) {
  try {
    const force = wantRefresh(params);
    const { value: res, cached } = await cachedOfficialSync(
      service,
      'sporttery_odds:' + bjDay(),
      () => syncSportteryOdds(),
      force,
    );
    const meta = res.meta || { total: 0, admitted: 0, rejected: 0 };
    return ok({
      source_id: res.source_id,
      status: res.status,
      reason: res.reason,
      message: res.message,
      meta,
      cached,
      cache_day: bjDay(),
      matches: (res.matches || []).map((m) => {
        const hhad = (m.snapshots || []).find((s) => s.data && s.data.poolNameZh === '让球胜平负');
        return {
          match_id: m.match_id,
          league: m.league,
          home_team: m.home_team,
          away_team: m.away_team,
          match_time: m.match_time,
          status: m.status,
          pool_count: m.snapshots.length,
          pools: m.snapshots.map((s) => s.data.poolNameZh || s.market),
          serial: (m.meta && m.meta.match_num_str) || null,   // 竞彩场次序号（含星期，如 周二001）
          serial_date: (m.meta && m.meta.match_num_date) || null, // 竞彩期号日期（如 260825）
          business_date: (m.meta && m.meta.business_date) || null, // 官方业务日（如 2026-08-25），决定可买批次
          handicap_line: hhad && hhad.data.goalLine != null ? hhad.data.goalLine : null,
        };
      }),
    });
  } catch (e) {
    return fail(500, 'sporttery_odds_sync_error');
  }
}

// ───────────────────────── GET /api/sources/manual-odds ─────────────────────────
// 本地人工盘赔源实时状态：根目录经 env:OE_MANUAL_ODDS_ROOT 动态配置，
// 每次请求按当前环境扫描 → 前端「数据接入」视图实时可观测。
function getManualOddsStatus() {
  const src = querySources('src_manual_odds');
  const res = loadManualOdds({ env: process.env, actor: { id: 'http:worker', role: 'ingest' } });
  return ok({
    source_id: res.source_id,
    name: (src && src.source_name) || '本地人工盘赔',
    trust_level: (src && src.trust_level) || 'provisional',
    status: res.status,
    reason: res.reason || null,
    meta: res.meta,
    matches: (res.matches || []).map((m) => ({
      match_id: m.match_id,
      league: m.league,
      home_team: m.home_team,
      away_team: m.away_team,
      match_time: m.match_time,
      snapshots: m.snapshots.length,
      actual_result: m.actual_result,
    })),
  });
}

// ───────────────────────── GET /api/sources/merged ─────────────────────────
// 双源合并「真实比赛池」：竞彩官方赛程（trusted 元信息）∪ 本地人工盘赔（provisional 盘口快照）。
// 语义键对齐；官方 match_time 早于盘口快照接收的场次被时间防线剔除（conflicts）。
// 官方赛程走当天缓存（公益网站减负）；?refresh=1 手动强制刷新赛程。
async function getMergedPool(service, params) {
  try {
    const { value: schedule } = await syncScheduleCached(service, wantRefresh(params));
    // 合并池优先读 DB（派生层，扫盘即写入）；DB 为空时回退磁盘扫描（兼容首次启动/重置）。
    const manual = loadManualOddsFromDb(service.qd)
      || loadManualOdds({ env: process.env, actor: { id: 'http:worker', role: 'ingest' } });
    const merged = mergeMatchSources({ schedule, manual });
    return ok({
      status: merged.ok ? 'ok' : 'degraded',
      meta: merged.meta,
      pool: merged.pool.map((m) => ({
        match_id: m.match_id,
        league: m.league,
        home_team: m.home_team,
        away_team: m.away_team,
        match_time: m.match_time,
        status: m.status,
        merged: !!(m.meta && m.meta.merged),
        snapshots: m.snapshots.length,
        actual_result: m.actual_result,
      })),
      dismissed: merged.dismissed,
    });
  } catch (e) {
    return fail(500, 'merged_pool_error');
  }
}

// ───────────────────────── GET /api/merged/analysis/:id ─────────────────────────
// 在合并后的「真实比赛池」上跑推理链：盘口快照 → 特征 → 规则检索/融合 → 方向仲裁。
// 仅接受合并池内场次（aligned 或 manual_only 均可）；未命中 → 404。
// 官方赛程走当天缓存（公益网站减负）。
async function getMergedAnalysis(service, params) {
  try {
    const { value: schedule } = await syncScheduleCached(service, false);
    const manual = loadManualOddsFromDb(service.qd)
      || loadManualOdds({ env: process.env, actor: { id: 'http:worker', role: 'ingest' } });
    const merged = mergeMatchSources({ schedule, manual });
    const id = decodeURIComponent(params.id || '');
    const match = (merged.pool || []).find((m) => m.match_id === id);
    if (!match) return fail(404, 'match_not_found_in_merged_pool');
    const analysis = buildAnalysis(service, match);
    const mergedFlag = !!(match.meta && match.meta.merged);
    return ok({
      ...analysis,
      source: 'src_merged_pool',
      merged: mergedFlag,
      schedule_match_id: (match.meta && match.meta.schedule_match_id) || null,
      snapshots: (match.snapshots || []).length,
      trust_level: (match.snapshots[0] && match.snapshots[0].trust_level) || 'provisional',
    });
  } catch (e) {
    return fail(500, 'merged_analysis_error');
  }
}

module.exports = {
  listMatches,
  getAnalysis,
  getManualAnalysis,
  getScheduleStatus,
  listRules,
  getRuleVersions,
  getBacktest,
  listAiCandidates,
  reviewAiCandidate,
  getScheduleStatus,
  getSportteryOddsStatus,
  getManualOddsStatus,
  getMergedPool,
  getMergedAnalysis,
  candidateRegistry,
};
