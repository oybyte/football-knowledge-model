// ============================================================================
// 数据接入层 · 远程源适配器 —— 竞彩官方赛程
// 目标：把竞彩官方赛程报文归一化为内部 MatchSchema 的「赛事元信息」。
// 「适配器骨架」语义：端点/凭证经 CredentialVault（ingest 角色）由环境注入；
// 未配置真实端点时返回 not_configured，绝不伪造数据；拉取失败返回 degraded。
// 说明：
//   - 报文字段映射为本适配器期望的「占位契约」（COMMON 竞彩赛程字段），
//     真实数据源接入时按实际响应字段微调 mapFixture 即可。
//   - 仅处理赛程与赛事元信息；盘口/赔率快照由后续赔率源适配器补充，
//     故本适配器的 MatchSchema 不携带 snapshots（basic 源允许空快照）。
// 状态枚举（sync 返回）：not_configured | degraded | ok
// ============================================================================
'use strict';

const { getSource } = require('../sources/registry');
const { CredentialVault } = require('../../vault/credentialVault');
const { recordAudit } = require('../../vault/audit');
const { validateMatch, ERROR_CODES } = require('../schema');
const { normalizeTeamName, parseMatchTime } = require('../normalize');

const SOURCE_ID = 'src_schedule_sporttery';

/** 状态语义：not_configured 表示端点未配置（诚实降级，绝无假数据）。 */
const STATUS = Object.freeze({
  NOT_CONFIGURED: 'not_configured',
  DEGRADED: 'degraded',
  OK: 'ok',
});

/**
 * 竞彩官方赛程报文 → 内部 MatchSchema 的赛事元信息（顶层字段，无盘口快照）。
 * @param {Object} raw 竞彩赛程报文（占位契约）
 * @param {string} nowIso 本次采集时间（作为 observed_at / received_at 基准）
 * @returns {{ ok: boolean, fixture?: Object, errors?: string[] }}
 */
function mapFixture(raw, nowIso) {
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['fixture_not_object'] };

  // 主客倒置：竞彩部分赛季以 default_home=1 表示客场在前（"主队"列实为客队）
  const reversed = String(raw.default_home ?? raw.is_reversed ?? '0') === '1';
  const homeRaw = reversed ? raw.awayTeamName || raw.away_team_name : raw.homeTeamName || raw.home_team_name;
  const awayRaw = reversed ? raw.homeTeamName || raw.home_team_name : raw.awayTeamName || raw.away_team_name;

  const league = normalizeTeamName(raw.competitionName || raw.comp_name);
  const home_team = normalizeTeamName(homeRaw);
  const away_team = normalizeTeamName(awayRaw);
  const match_time = parseMatchTime(raw.matchDate, raw.matchTime);

  if (!league || !home_team || !away_team || !match_time) {
    return { ok: false, errors: ['fixture_meta_incomplete'] };
  }
  const match_id = String(raw.matchId ?? raw.match_num ?? '').trim();
  if (!match_id) return { ok: false, errors: ['fixture_missing_id'] };
  if (!/^(scheduled|live|finished|cancelled)$/.test(raw.matchStatus || 'scheduled')) {
    return { ok: false, errors: ['fixture_invalid_status'] };
  }

  return {
    ok: true,
    fixture: {
      match_id,
      league,
      home_team,
      away_team,
      neutral: !!(raw.isNeutral ?? raw.neutral_flag ?? false),
      match_time,
      status: raw.matchStatus || 'scheduled',
      observed_at: nowIso,
      received_at: nowIso,
      snapshots: [], // basic 赛程源：盘口快照待赔率源补充
      actual_result: null,
      home_score: null,
      away_score: null,
      errors: [],
    },
  };
}

/**
 * 创建竞彩官方赛程源适配器实例。
 * @param {Object} [opts]
 * @param {Object} [opts.env]           环境变量表（默认 process.env）
 * @param {Function} [opts.fetchImpl]   fetch 实现（默认 global.fetch；可注入假实现做测试）
 * @param {Function} [opts.now]         时间函数（默认 Date.now）
 * @param {Object} [opts.actor]         凭证访问角色（默认 ingest）
 * @returns {{
 *   source_id: string,
 *   mapFixture: Function,
 *   sync: (opts?: {now?: Function}) => Promise<Object>,
 *   resolveEndpoint: Function,
 * }}
 */
function create({
  env = process.env,
  fetchImpl = (typeof globalThis !== 'undefined' ? globalThis : global).fetch,
  now = Date.now,
  actor = { id: 'sporttery:worker', role: 'ingest' },
} = {}) {
  const source = getSource(SOURCE_ID);
  if (!source) throw new Error('registry_missing:' + SOURCE_ID);
  const vault = new CredentialVault({ env });
  const configRef = source.config_ref;

  const state = (partial) => Object.assign({ source_id: SOURCE_ID }, partial);

  /**
   * 解析真实端点：经 CredentialVault（data_source 域）读取，写审计。
   * 未配置 / 无权限 → 返回 null（上层据此走 not_configured，绝不回退假数据）。
   * 注意：CredentialVault.get() 在凭证缺失时抛 UnauthorizedVaultError，故用 try/catch。
   * @returns {?string}
   */
  function resolveEndpoint() {
    try {
      const raw = String(vault.get(actor, configRef) || '').trim();
      return raw || null;
    } catch (e) {
      if (e && e.code === 'VAULT_UNAUTHORIZED') return null;
      throw e;
    }
  }

  /** 拉取竞彩赛程响应的报文数组。 */
  async function fetchFixtures(endpoint) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch_not_available');
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res || !res.ok) throw new Error('schedule_http_' + (res && res.status || 'unknown'));
    const j = await res.json();
    if (j == null) return [];
    // 统一响应壳 { status, data } 或裸数组都接受
    return Array.isArray(j) ? j : (Array.isArray(j.data) ? j.data : (j.list || []));
  }

  /**
   * 执行一次赛程同步。
   * @param {Object} [opts]
   * @param {Function} [opts.now]
   * @returns {Promise<{ ok:boolean, source_id:string, status:string, reason?:string, message?:string, matches?:Object[], meta?:Object }>}
   */
  async function sync({ now: nowFn = now } = {}) {
    const nowIso = new Date(nowFn()).toISOString();
    const endpoint = resolveEndpoint();
    if (!endpoint) {
      recordAudit({
        event_type: 'source_not_configured',
        actor: `${actor.role}:${actor.id}`,
        target_id: SOURCE_ID,
        details: { config_ref: configRef },
      });
      return state({
        ok: false,
        status: STATUS.NOT_CONFIGURED,
        reason: 'SPORTTERY_SCHEDULE_UNCONFIGURED',
        message: '竞彩赛程真实端点未配置（env 经 CredentialVault 注入）；未接入真实数据',
        matches: [],
        meta: { admitted: 0, rejected: 0, total: 0 },
      });
    }

    let fixtures;
    try {
      fixtures = await fetchFixtures(endpoint);
    } catch (e) {
      recordAudit({
        event_type: 'source_fetch_failed',
        actor: `${actor.role}:${actor.id}`,
        target_id: SOURCE_ID,
        details: { reason: String((e && e.message) || e) },
      });
      return state({
        ok: false,
        status: STATUS.DEGRADED,
        reason: 'SCHEDULE_FETCH_FAILED',
        message: String((e && e.message) || e),
        matches: [],
        meta: { admitted: 0, rejected: 0, total: 0 },
      });
    }

    // 竞彩报文 → MatchSchema，仅赛程元信息（basic 源允许空快照）
    const matches = [];
    const rejected = [];
    for (const f of fixtures) {
      const mapped = mapFixture(f, nowIso);
      if (!mapped.ok) { rejected.push({ match_id: (f && f.matchId) || '?', errors: mapped.errors }); continue; }
      const { errors } = validateMatch(mapped.fixture);
      const fatal = (errors || []).filter((e) => e !== ERROR_CODES.EMPTY_SNAPSHOTS);
      if (fatal.length) { rejected.push({ match_id: mapped.fixture.match_id, errors: fatal }); continue; }
      matches.push(mapped.fixture);
    }

    recordAudit({
      event_type: 'schedule_synced',
      actor: `${actor.role}:${actor.id}`,
      target_id: SOURCE_ID,
      details: { endpoint: endpoint ? 'configured' : 'none', admitted: matches.length, rejected: rejected.length, total: fixtures.length },
    });

    return state({
      ok: matches.length > 0,
      status: matches.length > 0 ? STATUS.OK : STATUS.DEGRADED,
      reason: matches.length > 0 ? undefined : 'SCHEDULE_EMPTY_OR_REJECTED',
      matches,
      meta: { total: fixtures.length, admitted: matches.length, rejected: rejected.length },
    });
  }

  return { source_id: SOURCE_ID, mapFixture, resolveEndpoint, sync, configRef, source };
}

module.exports = { create, mapFixture, SOURCE_ID, STATUS };