// ============================================================================
// HTTP 层 · handlers —— REST 端点（对齐原型 api-client http 契约）
// 全部由真实后端模块实现（数据接入 / 特征 / 预测链 / 规则存储 / 回测 / AI 引擎）。
// 响应：成功 { status, data }；失败 { status, error }（由 dispatcher 包成统一壳）。
// ============================================================================
'use strict';

const { loadMockMatches, getMockMatch } = require('../data/mock');
const { loadManualOdds, syncSportterySchedule, syncSportteryOdds, mergeMatchSources, querySources } = require('../data');
const { loadManualOddsFromDb } = require('../db/g12/manual_reconcile');
const { computeMatchFeatures } = require('../features');
const { predict } = require('../engine');
const { evaluateMatch } = require('../engine/v97/run');
const { listFields, getField } = require('../engine/v97/fields');
const { runBacktest, THRESHOLDS } = require('../backtest');
const { mineCandidates, escalateToProposed } = require('../ai');
const { buildSamples, buildEvidence } = require('./samples');
const { MemoryCacheAdapter } = require('../cache/adapter');
// P0①：V9.7 真规则结果 → 融合层（让预测链从空转变真链）
const { fuseV97Decision } = require('../fusion/v97_input');
// P0②：预测发布 / 幂等赛果回填（落库 + 审计）
const { PredictionPublisher } = require('../publish');
const { SqliteAuditAdapter } = require('../publish/db_audit_adapter');
// P1：S25 转正试点（V9.7 规则回测认证 → trusted，规则自我生长第一个闭环）
const { promoteV97RuleToValidated } = require('../promote');
const { loadV97Rules } = require('../rules/v97loader');

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

// ───────────────────────── 官方锚源选择（赛程 或 赔率） ─────────────────────────
// 数据分层原则：体彩官方数据仅作「锚」定位场次（联赛/主客队/开赛时间/业务日），
// 详细盘赔来自本地人工目录（provisional）。默认锚源 = 官方赛程
// （env:ODDS_SPORTTERY_SCHEDULE_BASE，basic 无盘口快照）。
// 官方赛程接口不可达/未配置时，可设 OE_SPORTTERY_ANCHOR=odds 改用官方赔率端点
// （webapi.sporttery.cn getMatchCalculatorV1，自带赛程骨架 + businessDate，trusted）作锚源。
// 两者均为官方 trusted 数据；锚源经响应 meta.anchor_source 诚实上报，绝不伪造。
const ANCHOR_SCHEDULE = 'schedule';
const ANCHOR_ODDS = 'odds';

function anchorSource() {
  return process.env.OE_SPORTTERY_ANCHOR === ANCHOR_ODDS ? ANCHOR_ODDS : ANCHOR_SCHEDULE;
}

/** 官方锚数据当天缓存同步：按锚源走对应端点（赔率源自带赛程骨架，可作锚）。 */
function syncAnchorCached(service, force) {
  return anchorSource() === ANCHOR_ODDS
    ? cachedOfficialSync(service, 'sporttery_odds:' + bjDay(), () => syncSportteryOdds(), force)
    : syncScheduleCached(service, force);
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
  const analysis = buildAnalysis(service, match, computeV97Block(match, service.rules.getActiveRules()));
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

/** 共享分析核心：MatchSchema → 特征快照 → 规则检索/融合 → 推理链。
 *  @param {Object} [v97] 已算好的 V9.7 块；传入则同步产出 fusion（P0①：真规则→融合层）。 */
function buildAnalysis(service, match, v97 = null) {
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

  // P0①：把 V9.7 真规则结果接入融合层 → 真实的方向/置信度决策（不再依赖旧 DSL 空转）。
  let fusion = null;
  if (v97) {
    try {
      const fused = fuseV97Decision({ match_id: match.match_id, v97, rules: service.rules.getActiveRules() });
      fusion = {
        decision: fused.decision,
        note: fused.note,
        dimensions: fused.dimensions,
        total_goals_direction: fused.total_goals_direction,
        rule_output: fused.rule_output,
      };
    } catch (e) {
      fusion = { error: String((e && e.message) || e) };
    }
  }

  return { match_id: match.match_id, at, features: feat.snapshot.features, hits, reasoning, prediction, arbitration, fusion, feat_errors: [] };
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
  // V9.7 真实回测（DB 历史真实场次 × 真规则）：可求值覆盖 + 命中台账 + 探针（S25 大小球倾向）。
  // 替代假数据门禁的第一步——真实数字，命中率仅在有语义探针时给出，绝不虚报。
  let v97Real = null;
  try {
    const manual = loadManualOddsFromDb(service.qd);
    if (manual && manual.matches && manual.matches.length && rule.v97) {
      const { backtestRule } = require('../backtest/v97_real');
      const real = backtestRule(rule, manual.matches);
      v97Real = {
        covered: real.tally.hit + real.tally.miss,
        tally: real.tally,
        ledger_count: real.ledger_count,
        ledger_sample: real.ledger.slice(0, 10).map((e) => ({
          match_id: e.match_id, league: e.league, home_team: e.home_team, away_team: e.away_team,
          actual_result: e.actual_result, total_goals: e.total_goals, dimensions: e.dimensions,
        })),
        probe: real.probe
          ? {
              total: real.probe.total,
              hits: real.probe.hits,
              hit_rate: real.probe.hit_rate,
              note: real.probe.note,
            }
          : null,
      };
    }
  } catch (e) {
    v97Real = { error: String((e && e.message) || e) };
  }
  return ok({
    rule_id: params.id,
    job_id: job.job_id,
    adjudication: job.adjudication,
    sample_size: job.metrics ? job.metrics.sample_size : 0,
    metrics: job.metrics,
    thresholds: THRESHOLDS,
    synthetic: true, // 旧 DSL 合成门禁仍为占位；真实数字见 v97_real
    v97_real: v97Real,
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
    const { value: schedule } = await syncAnchorCached(service, wantRefresh(params));
    // 合并池优先读 DB（派生层，扫盘即写入）；DB 为空时回退磁盘扫描（兼容首次启动/重置）。
    const manual = loadManualOddsFromDb(service.qd)
      || loadManualOdds({ env: process.env, actor: { id: 'http:worker', role: 'ingest' } });
    const merged = mergeMatchSources({ schedule, manual });
    return ok({
      status: merged.ok ? 'ok' : 'degraded',
      anchor_source: anchorSource(),
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
    const { value: schedule } = await syncAnchorCached(service, false);
    const manual = loadManualOddsFromDb(service.qd)
      || loadManualOdds({ env: process.env, actor: { id: 'http:worker', role: 'ingest' } });
    const merged = mergeMatchSources({ schedule, manual });
    const id = decodeURIComponent(params.id || '');
    const match = (merged.pool || []).find((m) => m.match_id === id);
    if (!match) return fail(404, 'match_not_found_in_merged_pool');

    // V9.7 真规则求值（与旧 DSL 推理链并存；响应新增 v97 块供前端消费）。
    const v97res = evaluateMatch(match, service.rules.getActiveRules(), match.match_time);
    const v97 = {
      rule_count: v97res.results.length,
      filtered_out: v97res.filtered_out,
      rules: v97res.results.map((r) => ({
        rule_id: r.rule_id,
        status: r.status,
        dimensions: r.dimensions,
        effects: r.effects,
        missing: r.missing,
        no_atoms: r.no_atoms,
      })),
      fields: listFields().map((f) => ({ field: f, status: getField(f, v97res.ctx).status })),
    };

    const mergedFlag = !!(match.meta && match.meta.merged);
    const analysis = buildAnalysis(service, match, v97);
    return ok({
      ...analysis,
      source: 'src_merged_pool',
      anchor_source: anchorSource(),
      merged: mergedFlag,
      schedule_match_id: (match.meta && match.meta.schedule_match_id) || null,
      snapshots: (match.snapshots || []).length,
      trust_level: (match.snapshots[0] && match.snapshots[0].trust_level) || 'provisional',
      v97,
    });
  } catch (e) {
    return fail(500, 'merged_analysis_error');
  }
}

// ───────────────────────── P0② 预测发布 / 幂等赛果回填 ─────────────────────────
// 让「预测 → 融合 → 落库 → 赛果回填」真正闭环：V9.7 真规则经融合层产出方向，
// 保存为不可变预测记录（DB 持久化）；赛后一键回填赛果并判定命中（once-only + 时间安全）。

/** 惰性构造 PredictionPublisher（DB 持久化存储 + DB 审计适配器，跨重启存活）。 */
function getPublisher(service) {
  if (!service._predictionPublisher) {
    service._predictionPublisher = new PredictionPublisher({
      store: service.predictionStore,
      audit: new SqliteAuditAdapter(service.auditStore),
    });
  }
  return service._predictionPublisher;
}

/** 解析一场合并池（或纯人工盘赔）的真实比赛，供发布/回填复用。 */
async function resolveAnalysisMatch(service, id) {
  const { value: schedule } = await syncAnchorCached(service, false);
  const manual = loadManualOddsFromDb(service.qd)
    || loadManualOdds({ env: process.env, actor: { id: 'http:worker', role: 'ingest' } });
  const merged = mergeMatchSources({ schedule, manual });
  let match = (merged.pool || []).find((m) => m.match_id === id);
  if (!match && manual && manual.matches) {
    match = manual.matches.find((m) => m.match_id === id) || null;
  }
  return match || null;
}

/** 计算 V9.7 求值块（与 getMergedAnalysis 同构，供发布端点复用）。 */
function computeV97Block(match, rules) {
  const v97res = evaluateMatch(match, rules, match.match_time);
  return {
    rule_count: v97res.results.length,
    filtered_out: v97res.filtered_out,
    rules: v97res.results.map((r) => ({
      rule_id: r.rule_id,
      status: r.status,
      dimensions: r.dimensions,
      effects: r.effects,
      missing: r.missing,
      no_atoms: r.no_atoms,
    })),
    fields: listFields().map((f) => ({ field: f, status: getField(f, v97res.ctx).status })),
  };
}

/** 预测记录 → 视图（含回填结果，若有）。 */
function toPredView(p) {
  const r = p.result || null;
  return {
    prediction_id: p.prediction_id,
    match_id: p.match_id,
    final_direction: p.final_direction,
    total_goals_direction: p.total_goals_direction || null,
    final_confidence: p.final_confidence,
    created_at: p.created_at,
    audit_trail_id: p.audit_trail_id,
    meta: p.meta || null,
    result: r
      ? {
          match_result: r.match_result,
          total_goals_result: r.total_goals_result || null,
          outcome: r.outcome,
          prediction_correct: r.prediction_correct,
          total_goals_correct: r.total_goals_correct != null ? r.total_goals_correct : null,
          verifiable: r.verifiable,
          total_goals_verifiable: r.total_goals_verifiable || false,
          known_at: r.known_at,
          backfilled_at: r.backfilled_at,
        }
      : null,
  };
}

/** 从 DB 比赛实际比分 + 让球盘口自动推导赛果（让球盘 upper/lower/draw + 总进球 over/under）。 */
function deriveMatchResult(service, match_id) {
  try {
    const manual = loadManualOddsFromDb(service.qd);
    const match = manual && manual.matches && manual.matches.find((m) => m.match_id === match_id);
    if (!match) return null;
    const score = (match.actual_result || '').toString().trim();
    const m = score.match(/(\d+)\s*[-:]\s*(\d+)/);
    if (!m) return null;
    const home = Number(m[1]);
    const away = Number(m[2]);
    const outcome = home > away ? 'home_win' : home < away ? 'away_win' : 'draw';

    // 让球盘方向（upper/lower/draw）
    const hhad = (match.snapshots || []).find((s) => s.data && s.data.poolNameZh === '让球胜平负');
    if (!hhad || hhad.data.goalLine == null) return null; // 无让球盘口则无法判定让球方向
    const line = Number(hhad.data.goalLine);
    const adjusted = home - away + line; // 主队让球：line<0；受让：line>0
    const match_result = adjusted > 0 ? 'upper' : adjusted < 0 ? 'lower' : 'draw';

    // 总进球方向（over/under）：实际总进球 vs 大小球盘口中线
    let total_goals_result = null;
    const tg = match.meta && match.meta.total_goals != null ? Number(match.meta.total_goals) : (home + away);
    if (tg != null && !Number.isNaN(tg)) {
      const { adaptMatch } = require('../features/adapt');
      const { collectOverUnderRows, pickAnyReference } = require('../engine/v97/fields');
      const { parseDepth } = require('../engine/v97/handicap');
      const { markets } = adaptMatch(match, match.match_time);
      const rows = collectOverUnderRows(markets);
      if (rows.length) {
        const ref = pickAnyReference(rows, 'over_odds');
        const mid = parseDepth(ref.line).depth;
        if (mid != null) total_goals_result = tg > mid ? 'over' : tg < mid ? 'under' : null;
      }
    }

    return { match_result, outcome, total_goals_result, observed_at: null, received_at: null };
  } catch (e) {
    return null;
  }
}

// ───────────────────────── POST /api/predictions ─────────────────────────
// 复算 V9.7→融合决策并落库；无方向型维度命中（方向弃判）则 422 拒绝发布。
async function savePrediction(service, params, body) {
  const match_id = (body && body.match_id) || params.id || null;
  if (!match_id) return fail(400, 'match_id_required');
  const match = await resolveAnalysisMatch(service, match_id);
  if (!match) return fail(404, 'match_not_found_in_merged_pool');

  const rules = service.rules.getActiveRules();
  const v97 = computeV97Block(match, rules);
  const fused = fuseV97Decision({ match_id, v97, rules });
  const tgDir = fused.total_goals_direction || null;
  // 双轴：让球方向 或 总进球方向 任一可判即允许发布；两者皆无可判方向则拒绝。
  if (!fused.rule_output || (!fused.decision.final_direction && !tgDir)) {
    return fail(422, 'no_verifiable_direction'); // 融合层无任一可判方向维度命中 → 不发布
  }

  const decision = {
    prediction_id: fused.decision.prediction_id,
    match_id,
    final_direction: fused.decision.final_direction,
    total_goals_direction: tgDir,
    final_confidence: fused.decision.final_confidence,
    weights: fused.decision.weights,
    reasoning_chain: fused.decision.reasoning_chain,
    audit_trail_id: fused.decision.audit_trail_id,
    created_by: 'http:predict',
    meta: {
      dimensions: fused.dimensions,
      hit_rule_ids: fused.rule_output.evidence.hit_rule_ids,
      field_coverage: fused.rule_output.evidence.field_coverage,
      trust_note: fused.rule_output.evidence.trust_note,
    },
  };

  const publisher = getPublisher(service);
  const idemKey = (body && body.idempotency_key) || `pred:${match_id}`;
  const res = publisher.publish({ decision, idempotency_key: idemKey, created_by: 'http:predict' });
  return ok({
    prediction_id: res.prediction.prediction_id,
    match_id,
    final_direction: res.prediction.final_direction,
    total_goals_direction: res.prediction.total_goals_direction,
    final_confidence: res.prediction.final_confidence,
    audit_trail_id: res.prediction.audit_trail_id,
    duplicate: !!res.duplicate,
    note: fused.note,
  });
}

// ───────────────────────── GET /api/predictions ─────────────────────────
function listPredictions(service) {
  const publisher = getPublisher(service);
  const list = publisher
    .listPredictions()
    .map((p) => publisher.predictionWithResult(p.prediction_id))
    .filter(Boolean);
  return ok(list.map(toPredView).sort((a, b) => String(a.created_at) < String(b.created_at) ? 1 : -1));
}

// ───────────────────────── GET /api/predictions/:id ─────────────────────────
function getPrediction(service, params) {
  const publisher = getPublisher(service);
  const p = publisher.predictionWithResult(params.id);
  if (!p) return fail(404, 'prediction_not_found');
  return ok(toPredView(p));
}

// ───────────────────────── POST /api/predictions/:id/result ─────────────────────────
// 幂等回填：缺省自动从 DB 比赛实际比分 + 让球盘口推导赛果；once-only 重复回填返回既有。
async function backfillPrediction(service, params, body) {
  const publisher = getPublisher(service);
  const pred = publisher.getPrediction(params.id);
  if (!pred) return fail(404, 'prediction_not_found');

  const bodyResult = body && body.result;
  const known_at = (body && body.known_at) || new Date().toISOString();
  let derived = bodyResult && bodyResult.match_result ? bodyResult : deriveMatchResult(service, pred.match_id);
  if (!derived || !derived.match_result) return fail(422, 'cannot_derive_result');
  // 合并总进球结果：显式传入优先，否则用推导值
  const result = {
    match_result: derived.match_result,
    outcome: derived.outcome || null,
    total_goals_result: (bodyResult && bodyResult.total_goals_result) || derived.total_goals_result || null,
  };

  try {
    const r = publisher.backfill({
      prediction_id: params.id,
      result,
      known_at,
      actor: 'http:backfill',
    });
    return ok({ prediction_id: params.id, duplicate: false, result: r.result, evidence: r.evidence });
  } catch (e) {
    if (e && e.name === 'AlreadyBackfilledError') {
      const existing = publisher.predictionWithResult(params.id);
      return ok({ prediction_id: params.id, duplicate: true, result: existing.result });
    }
    if (e && e.name === 'PublishError') return fail(422, e.code || 'publish_error');
    return fail(500, 'backfill_error');
  }
}

// ───────────────────────── POST /api/rules/:id/promote ─────────────────────────
// P1：S25 转正试点端点。在真实历史（DB 派生层）上跑规则 → 构建 total_goals 轴 eligible
// 证据 → computeMetrics 6 项门禁；达标则沿 active→validated→approved→active re-certify 为
// trusted，终态仍是 active（仍在引擎内、信任升级）。门禁未过则诚实返回失败报告，不伪造。
async function promoteRuleHandler(service, params, body) {
  const rule_id = params.id;
  const versions = service.rules.getRuleVersions(rule_id);
  if (!versions.length) return fail(404, 'rule_not_found');

  let rule = null;
  try {
    rule = loadV97Rules().rules.find((x) => (x.rule_id || x.id) === rule_id) || null;
  } catch (e) { rule = null; }
  const manual = loadManualOddsFromDb(service.qd);
  const matches = manual ? manual.matches : [];
  const approver = (body && body.approver) || 'http:promote';

  const res = promoteV97RuleToValidated({
    rule_id,
    store: service.rules.store,
    stateMachine: service.rules.stateMachine,
    matches,
    rule,
    approver,
    note: (body && body.note) || null,
  });

  if (res.pass === false) {
    // 回测门禁未过（诚实，不伪造转正）
    return ok({ promoted: false, gate_passed: false, report: res.report, failure_report: res.failure_report });
  }
  if (!res.ok) {
    return fail(422, (res.errors && res.errors.join(',')) || 'promote_transition_failed');
  }
  return ok({
    promoted: true,
    gate_passed: true,
    rule_id,
    status: res.promoted.status,
    trust_level: res.promoted.trust_level,
    evidence_count: res.evidence_count,
    report: res.report,
  });
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
  anchorSource, // 导出锚源选择函数，供测试与可观测审计
  // P0②：预测发布 / 幂等赛果回填
  savePrediction,
  listPredictions,
  getPrediction,
  backfillPrediction,
  // P1：S25 转正试点端点
  promoteRule: promoteRuleHandler,
  candidateRegistry,
};
