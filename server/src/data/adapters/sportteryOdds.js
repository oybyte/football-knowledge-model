// ============================================================================
// 数据接入层 · 远程源适配器 —— 竞彩官方赔率（直连 webapi.sporttery.cn）
// 直接拉取中国体彩官方竞彩足球赔率接口，无需配置第三方端点。
// 提供：胜平负、让球胜平负、比分、总进球、半全场 五种玩法实时赔率。
// 返回 MatchSchema 格式（含官方匹配元信息 + 赔率快照），trusted 级别。
// 状态：ok（正常拉取）| degraded（拉取失败）
// ============================================================================
'use strict';

const { getSource } = require('../sources/registry');
const { validateMatch, ERROR_CODES } = require('../schema');
const { normalizeTeamName, parseMatchTime } = require('../normalize');

const SOURCE_ID = 'src_odds_sporttery';
const UPSTREAM =
  'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=hhad,had,crs,ttg,hafu&channel=c';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const STATUS = Object.freeze({ OK: 'ok', DEGRADED: 'degraded' });

/** 竞彩赔率池枚举。 */
const POOLS = Object.freeze(['had', 'hhad', 'crs', 'ttg', 'hafu']);

/** 池 → 中文名。 */
const POOL_ZH = Object.freeze({
  had: '胜平负', hhad: '让球胜平负', crs: '比分', ttg: '总进球', hafu: '半全场',
});

/** 竞彩 matchStatus 枚举 → 内部 status。 */
function mapStatus(s) {
  const raw = String(s == null ? '' : s).toLowerCase().trim();
  if (['scheduled', 'selling', 'presale', 'pre'].some((k) => raw.indexOf(k) >= 0)) return 'scheduled';
  if (['live', 'playing', 'immediate'].some((k) => raw.indexOf(k) >= 0)) return 'live';
  if (['finished', 'played', 'ended', 'complete'].some((k) => raw.indexOf(k) >= 0)) return 'finished';
  if (['cancel', 'abolish', 'abandoned'].some((k) => raw.indexOf(k) >= 0)) return 'cancelled';
  return raw === '' ? 'scheduled' : null;
}

/** 解码胜负平结果码 → { key, labelZh }。 */
function decodeOutcome(pool, code) {
  if (pool === 'had' || pool === 'hhad') {
    if (code === 'h') return { key: 'home', labelZh: '主胜' };
    if (code === 'd') return { key: 'draw', labelZh: '平' };
    if (code === 'a') return { key: 'away', labelZh: '主负' };
  }
  if (pool === 'crs') {
    const m = String(code).match(/^s(\d+)s(\d+)$/);
    if (m) return { key: `${m[1]}:${m[2]}`, labelZh: `${m[1]}:${m[2]}` };
    if (code === 's1sh') return { key: 'home_other', labelZh: '胜其它' };
    if (code === 's1sd') return { key: 'draw_other', labelZh: '平其它' };
    if (code === 's1sa') return { key: 'away_other', labelZh: '负其它' };
  }
  if (pool === 'ttg') {
    if (code === 's7') return { key: '7plus', labelZh: '7+' };
    const m = String(code).match(/^s(\d+)$/);
    if (m) return { key: `g${m[1]}`, labelZh: m[1] };
  }
  if (pool === 'hafu') {
    const map = { hh: '胜/胜', hd: '胜/平', ha: '胜/负', dh: '平/胜', dd: '平/平', da: '平/负', ah: '负/胜', ad: '负/平', aa: '负/负' };
    if (map[code]) return { key: code, labelZh: map[code] };
  }
  return { key: code, labelZh: code };
}

/** 涨跌趋势。 */
function toTrend(flag) {
  if (flag === '1') return 'up';
  if (flag === '-1') return 'down';
  return 'flat';
}

/** 安全转数字赔率。 */
function toOdds(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 计算隐含概率、去水概率、公平赔率。 */
function deriveMarket(odds) {
  const implied = odds.map((o) => 1 / o);
  const overround = implied.reduce((a, b) => a + b, 0);
  const returnRate = 1 / overround;
  const margin = 1 - returnRate;
  const perOutcome = odds.map((o, i) => ({
    impliedProb: +(1 / o).toFixed(6),
    noVigProb: +((1 / o) / overround).toFixed(6),
    fairOdds: +(o * overround).toFixed(4),
  }));
  return { overround: +overround.toFixed(6), returnRate: +returnRate.toFixed(6), margin: +margin.toFixed(6), perOutcome };
}

/** 构建单个赔率池的归一化数据。 */
function buildPoolData(pool, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const codes = orderedOutcomeCodes(pool, raw);
  const outcomes = [];
  for (const code of codes) {
    const odds = toOdds(raw[code]);
    if (odds === null) continue;
    const { key, labelZh } = decodeOutcome(pool, code);
    outcomes.push({ code, key, labelZh, odds, trend: toTrend(raw[`${code}f`]) });
  }
  if (outcomes.length === 0) return null;
  const result = { poolNameZh: POOL_ZH[pool], outcomes };
  if (raw.goalLineValue !== undefined && raw.goalLineValue !== '' && raw.goalLineValue !== null) {
    const n = Number(raw.goalLineValue);
    if (Number.isFinite(n)) result.goalLine = n;
  }
  const d = deriveMarket(outcomes.map((o) => o.odds));
  result.overround = d.overround;
  result.returnRate = d.returnRate;
  result.margin = d.margin;
  outcomes.forEach((o, i) => {
    o.impliedProb = d.perOutcome[i].impliedProb;
    o.noVigProb = d.perOutcome[i].noVigProb;
    o.fairOdds = d.perOutcome[i].fairOdds;
  });
  return result;
}

/** 每个池的命中码顺序（用于构建 outcomes）。 */
function orderedOutcomeCodes(pool, raw) {
  if (pool === 'had' || pool === 'hhad') return ['h', 'd', 'a'];
  if (pool === 'crs') {
    // 比分：按 raw 中实际存在的码排序（sHHsMM 格式）
    const keys = Object.keys(raw).filter((k) => /^s\d+s\d+$/.test(k) || /^s1s[dhsa]$/.test(k));
    keys.sort();
    return keys;
  }
  if (pool === 'ttg') {
    const keys = [];
    for (let i = 0; i <= 6; i++) { keys.push(`s${i}`); }
    keys.push('s7');
    return keys.filter((k) => k in raw);
  }
  if (pool === 'hafu') {
    const codes = ['hh', 'hd', 'ha', 'dh', 'dd', 'da', 'ah', 'ad', 'aa'];
    return codes.filter((k) => k in raw);
  }
  return Object.keys(raw).filter((k) => !k.endsWith('f') && k !== 'goalLineValue' && k !== 'updateTime');
}

/**
 * 创建竞彩官方赔率源适配器实例。
 * @param {Object} [opts]
 * @param {Function} [opts.fetchImpl]   fetch 实现（默认 global.fetch；可注入假实现做测试）
 * @param {Function} [opts.now]         时间函数（默认 Date.now）
 * @returns {Object}
 */
function create({
  fetchImpl = (typeof globalThis !== 'undefined' ? globalThis : global).fetch,
  now = Date.now,
} = {}) {
  const source = getSource(SOURCE_ID);
  if (!source) throw new Error('registry_missing:' + SOURCE_ID);

  const state = (partial) => Object.assign({ source_id: SOURCE_ID }, partial);

  /**
   * 直接从官方端点拉取赔率数据。
   * 注：此端点无 geo-block，本地网络可直接访问。
   */
  async function fetchOdds() {
    if (typeof fetchImpl !== 'function') throw new Error('fetch_not_available');
    const res = await fetchImpl(UPSTREAM, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Referer: 'https://m.sporttery.cn/',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (!res || !res.ok) throw new Error('sporttery_odds_http_' + (res && res.status || 'unknown'));
    const j = await res.json();
    if (j == null || j.success === false) throw new Error('sporttery_odds_body_invalid');
    // 结构：{ value:{ matchInfoList:[{ subMatchList:[...] }] } }
    const v = j.value;
    if (!v || !Array.isArray(v.matchInfoList)) throw new Error('sporttery_odds_unexpected_structure');
    const out = [];
    for (const g of v.matchInfoList) {
      if (!g) continue;
      if (Array.isArray(g.subMatchList)) out.push(...g.subMatchList);
      else out.push(g);
    }
    return { items: out, updatedAt: v.lastUpdateTime || null };
  }

  /**
   * 单条竞彩场次 → MatchSchema（含赔率快照）。
   */
  function mapMatch(raw, nowIso) {
    if (!raw || typeof raw !== 'object') return { ok: false, errors: ['match_not_object'] };

    const league = normalizeTeamName(raw.leagueAllName || raw.leagueAbbName || '');
    const home_team = normalizeTeamName(raw.homeTeamAllName || raw.homeTeamAbbName || '');
    const away_team = normalizeTeamName(raw.awayTeamAllName || raw.awayTeamAbbName || '');
    const match_time = parseMatchTime(raw.matchDate, String(raw.matchTime || '').slice(0, 5));
    const status = mapStatus(raw.matchStatus);
    const match_id = String(raw.matchId || '').trim();

    if (!match_id) return { ok: false, errors: ['missing_match_id'] };
    if (status == null) return { ok: false, errors: ['invalid_status_' + raw.matchStatus] };
    if (!league || !home_team || !away_team || !match_time) {
      return { ok: false, errors: ['meta_incomplete'] };
    }

    // 为每个赔率池创建一份快照
    const snapshots = [];
    let seq = 0;
    for (const pool of POOLS) {
      const rawPool = raw[pool];
      if (!rawPool || typeof rawPool !== 'object') continue;
      const poolData = buildPoolData(pool, rawPool);
      if (!poolData) continue;
      seq++;
      snapshots.push({
        snapshot_id: `sporttery_${match_id}_${pool}`,
        match_id,
        institution: 'sporttery',
        market: pool === 'had' || pool === 'hhad' ? 'european' : 'over_under',
        source_id: SOURCE_ID,
        trust_level: 'trusted',
        observed_at: nowIso,
        received_at: nowIso,
        data: poolData,
      });
    }

    return {
      ok: true,
      match: {
        match_id,
        league,
        home_team,
        away_team,
        neutral: false,
        match_time,
        status,
        observed_at: nowIso,
        received_at: nowIso,
        snapshots,
        actual_result: null,
        home_score: null,
        away_score: null,
        meta: {
          source_kind: 'sporttery_odds',
          updated_at: nowIso,
          match_num_str: raw.matchNumStr || null,
          match_num_date: raw.matchNumDate || null,
          business_date: raw.businessDate || null, // 官方销售业务日：决定「今日/明日可买」批次
          league_code: raw.leagueCode || null,
          home_rank: raw.homeRank || null,
          away_rank: raw.awayRank || null,
          betting_single: raw.bettingSingle,
          betting_all_up: raw.bettingAllUp,
        },
        errors: [],
      },
    };
  }

  /**
   * 执行一次赔率同步。
   * @returns {Promise<{ ok:boolean, source_id:string, status:string, reason?:string, matches?:Object[], meta?:Object }>}
   */
  async function sync() {
    const nowIso = new Date(now()).toISOString();

    let result;
    try {
      result = await fetchOdds();
    } catch (e) {
      return state({
        ok: false,
        status: STATUS.DEGRADED,
        reason: 'ODDS_FETCH_FAILED',
        message: String((e && e.message) || e),
        matches: [],
        meta: { admitted: 0, rejected: 0, total: 0, updated_at: null },
      });
    }

    const matches = [];
    const rejected = [];
    for (const item of result.items) {
      const mapped = mapMatch(item, nowIso);
      if (!mapped.ok) { rejected.push({ match_id: String(item.matchId || '?'), errors: mapped.errors }); continue; }
      const { errors } = validateMatch(mapped.match);
      const fatal = (errors || []).filter((e) => e !== ERROR_CODES.EMPTY_SNAPSHOTS);
      if (fatal.length) { rejected.push({ match_id: mapped.match.match_id, errors: fatal }); continue; }
      if (mapped.match.snapshots.length === 0) { rejected.push({ match_id: mapped.match.match_id, errors: ['empty_snapshots'] }); continue; }
      matches.push(mapped.match);
    }

    return state({
      ok: matches.length > 0,
      status: matches.length > 0 ? STATUS.OK : STATUS.DEGRADED,
      reason: matches.length > 0 ? undefined : 'ALL_REJECTED',
      message: matches.length > 0 ? undefined : '所有场次均被拒绝（无有效赔率数据）',
      matches,
      meta: {
        total: result.items.length,
        admitted: matches.length,
        rejected: rejected.length,
        updated_at: result.updatedAt,
      },
    });
  }

  return { source_id: SOURCE_ID, sync, UPSTREAM };
}

module.exports = { create, SOURCE_ID, STATUS, mapStatus, buildPoolData, decodeOutcome };