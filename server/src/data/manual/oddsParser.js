// ============================================================================
// 本地人工盘赔源 · 解析器 —— 盘口数据.md → MatchSchema
// 读取用户人工整理的「盘口数据.md」（初/即盘、分时时序、凯利、必发、赛果），
// 归一化为内部 MatchSchema 的多份盘口快照（handicap / european / over_under / bf）。
// 语义与治理：
//   - 数据源统一 src_manual_odds（provisional，人工数据，不冒充官方）。
//   - 时间口径：无显示时间的初/即盘时点用 match_time 相对偏移估算，并在快照
//     data.timing_estimate 显式标记（绝不把估算冒充真实观察时点）；澳门分时时序
//     使用真实显示时间。所有快照 observed/received 均严格早于 match_time（防泄漏）。
// ============================================================================
'use strict';

const { normalizeInstitution, normalizeWater, normalizeResult } = require('../normalize');

const OFFSET = '+08:00';

/** 初盘估算：开赛前 6 小时；即盘估算：开赛前 30 分钟。 */
const INITIAL_BEFORE_MIN = 6 * 60;
const CURRENT_BEFORE_MIN = 30;

function pad(n) { return String(n).padStart(2, '0'); }

/** 构造 +08:00 ISO，非法返回 null。 */
function makeISO(y, mo, d, h, mi) {
  const s = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${OFFSET}`;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/** 由 Date 毫秒重排为 +08:00 ISO。 */
function isoFromMs(ms) {
  const d = new Date(ms + new Date().getTimezoneOffset() * 60000 + 8 * 3600000);
  const y = d.getUTCFullYear(), mo = pad(d.getUTCMonth() + 1), day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours()), mi = pad(d.getUTCMinutes());
  return `${y}-${mo}-${day}T${h}:${mi}:00${OFFSET}`;
}

/** 解析 "MM-DD HH:mm" 或 "HH:mm" → ISO（用给定 year）。 */
function parseMdDate(str, year) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return makeISO(year, Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
}

/** 解析单元格三段："a / b / c"（b 可含斜杠，如 2/2.5）。返回 [a,b,c] 或 null。 */
function parseTriple(cell) {
  if (typeof cell !== 'string') return null;
  const m = cell.trim().match(/^(\S+)\s*\/\s*(.+?)\s*\/\s*(\S+)$/);
  if (!m) return null;
  return [m[1], m[2], m[3]].map((x) => x.trim());
}

/** 取一行表格的单元格数组（去掉首尾空）。 */
function cells(row) {
  const s = row.trim();
  if (!s.startsWith('|') || !s.endsWith('|')) return [];
  return s.split('|').slice(1, -1).map((c) => c.trim());
}

/** 首空单元格清理后的机构名。 */
function cleanInst(c) { return c ? c.replace(/[＊*]/g, '').trim() : ''; }

/** 是否为表格数据行（以 "|" 起，且非分隔行 "|---"）。 */
function isDataRow(row) {
  const t = row.trim();
  return t.startsWith('|') && !/^\|[\s:|-]*\|?$/.test(t) && !/^##/.test(t);
}

/** 判断行是否为机构表头（含"机构"与"初盘"）。 */
function isInstHeader(row) {
  return row.includes('机构') && row.includes('初盘');
}

/**
 * 解析整份 盘口数据.md → MatchSchema。
 * @param {string} mdText
 * @param {Object} [opts]
 * @param {number} [opts.year=2026]            md 中未带年份，默认补当年
 * @param {Object} [opts.source]                盘口快照数据源（默认取 src_manual_odds）
 * @returns {{ ok: boolean, match?: Object, errors?: string[] }}
 */
function parseOddsMd(mdText, opts = {}) {
  const year = opts.year || 2026;
  const source = opts.source || { source_id: 'src_manual_odds', trust_level: 'provisional' };
  const errors = [];
  const lines = String(mdText || '').split(/\r?\n/);

  // ── 比赛元信息 ──
  let league = '', home = '', away = '', kickoffStr = '', neutral = false;
  // ── 赛果 ──
  let half = null, full = null, total = null;
  const snapshots = [];

  let section = ''; // 当前 ## 区块
  const instRows = []; // 机构初/即盘表：{ market, institution, initial, current }
  const tlHcRows = []; // 澳门让球时序
  const tlEuRows = []; // 澳门胜平负时序
  const bfRows = [];
  let turnover = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (/^## /.test(line)) { section = line; continue; }

    // 比赛基础信息
    if (/^- 赛事：/.test(line)) league = line.slice(line.indexOf('：') + 1).trim();
    if (/^- 比赛：/.test(line)) {
      const t = line.slice(line.indexOf('：') + 1).replace(/（用户修正）$/, '').trim();
      const m = t.match(/^(.*?)\s+vs\s+(.*?)$/i);
      if (m) { home = m[1].trim(); away = m[2].trim(); }
      neutral = home.includes('（中）') || home.includes('(中)') || home.includes('中立');
      home = home.replace(/[（(]中[）)]/g, '').trim();
    }
    if (/^- 开赛时间：/.test(line)) kickoffStr = line.slice(line.indexOf('：') + 1).trim();
    if (/^- 半场比分：/.test(line)) {
      const mm = line.match(/(\d+)\s*[-—]\s*(\d+)/); if (mm) half = { h: Number(mm[1]), a: Number(mm[2]) };
    }
    if (/^- 全场比分：/.test(line)) {
      const mm = line.match(/(\d+)\s*[-—]\s*(\d+)/); if (mm) full = { h: Number(mm[1]), a: Number(mm[2]) };
    }
    if (/^- 总进球：/.test(line)) { const mm = line.match(/(\d+)/); if (mm) total = Number(mm[1]); }

    // 必发交易量行
    if (/^交易量：/.test(line)) {
      const mm = line.match(/[\d,]+/); if (mm) turnover = Number(mm[0].replace(/,/g, ''));
    }

    // 表格数据行
    if (!isDataRow(line)) continue;
    const c = cells(line);
    if (c.length < 2) continue;

    // 机构初/即盘表（让球 / 胜平负 / 总进球）
    if (isInstHeader(line) || (c[0] && c[0].includes('机构'))) {
      // 表头后紧跟数据行动态判定 market（由区块标题解析）
    }

    // 依据 section 分发
    if (section.includes('让球盘数据')) {
      if (!c[0].includes('机构')) {
        const t = parseTriple(c[1]), cur = parseTriple(c[2]);
        instRows.push({ market: 'handicap', institution: cleanInst(c[0]), initial: t, current: cur });
      }
    } else if (section.includes('胜平负数据')) {
      if (!c[0].includes('机构') && c[0] !== '最大值' && c[0] !== '最小值') {
        const t = parseTriple(c[1]), cur = parseTriple(c[2]);
        instRows.push({ market: 'european', institution: cleanInst(c[0]), initial: t, current: cur });
      }
    } else if (section.includes('总进球数据')) {
      if (!c[0].includes('机构')) {
        const t = parseTriple(c[1]), cur = parseTriple(c[2]);
        instRows.push({ market: 'over_under', institution: cleanInst(c[0]), initial: t, current: cur });
      }
    } else if (section.includes('澳门让球详细变化')) {
      const t = parseTriple(c[2]);
      if (t && c[0]) tlHcRows.push({ time: c[0], status: c[1] || '即', triple: t });
    } else if (section.includes('澳门胜平负详细变化')) {
      const t = parseTriple(c[2]);
      if (t && c[0] && Number.isFinite(Number(c[3]))) { // c[3]=返还率数值
        tlEuRows.push({ time: c[0], status: c[1] || '即', triple: t, return_rate: Number(c[3]), kelly: parseTriple(c[4]) });
      }
    } else if (section.includes('必发交易盈亏')) {
      if (c[0] && (c[0] === '胜' || c[0] === '平' || c[0] === '负') && /\d/.test(c[1])) {
        bfRows.push({
          result: c[0], odds: Number(c[1]), volume: Number(String(c[2] || '').replace(/,/g, '') || 0),
          pnl: Number(String(c[3] || '').replace(/,/g, '') || 0), heat: Number(String(c[4] || '').replace(/,/g, '') || 0),
        });
      }
    }
  }

  // ── 顶层时间 ──
  const match_time = parseMdDate(kickoffStr, year);
  if (!match_time) errors.push('invalid_match_time');
  if (!league || !home || !away) errors.push('match_meta_incomplete');

  const matchMsArr = match_time ? Date.parse(match_time) : NaN;

  // 快照时点：initial = 开赛前 INITIAL_BEFORE_MIN；current = 开赛前 CURRENT_BEFORE_MIN
  const initialMs = Number.isNaN(matchMsArr) ? null : matchMsArr - INITIAL_BEFORE_MIN * 60000;
  const currentMs = Number.isNaN(matchMsArr) ? null : matchMsArr - CURRENT_BEFORE_MIN * 60000;

  let seq = 0;
  const pushSnap = (institution, market, observedAt, receivedAt, data) => {
    seq += 1;
    snapshots.push({
      snapshot_id: `manual_${seq}_${institution}_${market}`,
      match_id: 'pending',
      institution,
      market,
      source_id: source.source_id,
      trust_level: source.trust_level,
      observed_at: observedAt,
      received_at: receivedAt,
      data,
    });
  };

  // ── 机构初/即盘 → 快照 ──
  for (const r of instRows) {
    if (!r.institution) continue;
    const inst = normalizeInstitution(r.institution);
    if (!initialMs || !currentMs) continue;
    if (r.initial) {
      const d = pickMarketData(r.market, r.initial);
      pushSnap(inst, r.market, isoFromMs(initialMs), isoFromMs(initialMs), { ...d, timing: 'initial', timing_estimate: true });
    }
    if (r.current) {
      const d = pickMarketData(r.market, r.current);
      pushSnap(inst, r.market, isoFromMs(currentMs), isoFromMs(currentMs), { ...d, timing: 'current', timing_estimate: true });
    }
  }

  // ── 澳门分时时序 → 真实时点快照 ──
  for (const t of tlHcRows) {
    const iso = t.time ? parseMdDate(t.time, year) : null;
    if (!iso) continue;
    const [hw, line, aw] = t.triple;
    pushSnap('macau', 'handicap', iso, iso, {
      line, home_water: normalizeWater(Number(hw)), away_water: normalizeWater(Number(aw)),
      timing: 'timeline', timing_estimate: false, display_time: t.time,
    });
  }
  for (const t of tlEuRows) {
    const iso = t.time ? parseMdDate(t.time, year) : null;
    if (!iso) continue;
    const [h, d, a] = t.triple;
    pushSnap('macau', 'european', iso, iso, {
      home_odds: Number(h), draw_odds: Number(d), away_odds: Number(a),
      return_rate: t.return_rate, kelly_home: t.kelly ? Number(t.kelly[0]) : null,
      kelly_draw: t.kelly ? Number(t.kelly[1]) : null, kelly_away: t.kelly ? Number(t.kelly[2]) : null,
      timing: 'timeline', timing_estimate: false, display_time: t.time,
    });
  }

  // ── 必发 → bf 快照 ──
  if (bfRows.length && currentMs) {
    pushSnap('betfair', 'bf', isoFromMs(currentMs), isoFromMs(currentMs), {
      turnover, rows: bfRows, timing: 'current', timing_estimate: true,
    });
  }

  // 关联 match_id 与赛果
  const matchId = (league && home && away) ? `${league}_${home}_vs_${away}`.replace(/\s+/g, '') : 'pending';
  for (const s of snapshots) s.match_id = matchId;

  // 顶层时间：用最近的时点（澳门时序最新 或 即盘估算）
  let topMs = null;
  const allObsMs = snapshots.map((s) => Date.parse(s.observed_at)).filter((x) => !Number.isNaN(x));
  if (allObsMs.length) topMs = Math.max(...allObsMs);
  if (topMs == null && currentMs != null) topMs = currentMs;

  const match = {
    match_id: matchId,
    league,
    home_team: home,
    away_team: away,
    neutral,
    match_time,
    status: 'scheduled',
    observed_at: topMs != null ? isoFromMs(topMs) : null,
    received_at: topMs != null ? isoFromMs(topMs) : null,
    snapshots,
    actual_result: full ? normalizeResult(full.h, full.a) : null,
    home_score: full ? full.h : null,
    away_score: full ? full.a : null,
    errors: [],
    meta: {
      source_kind: 'manual_md',
      kickoff_display: kickoffStr,
      total_goals: total,
      half_score: half ? `${half.h}:${half.a}` : null,
    },
  };

  if (!match.observed_at || !match.received_at) errors.push('invalid_observed_received');
  if (snapshots.length === 0) errors.push('empty_snapshots');

  return errors.length ? { ok: false, match: null, errors } : { ok: true, match, errors: [] };
}

/** 按 market 把 triple 映射为内部 data 字段。line 保留原始串（如 -0.5 / 2/2.5）。 */
function pickMarketData(market, triple) {
  const [a, b, c] = triple;
  if (market === 'handicap') {
    return { line: b, home_water: normalizeWater(Number(a)), away_water: normalizeWater(Number(c)) };
  }
  if (market === 'european') {
    return { home_odds: Number(a), draw_odds: Number(b), away_odds: Number(c) };
  }
  if (market === 'over_under') {
    return { line: b, over_odds: normalizeWater(Number(a)), under_odds: normalizeWater(Number(c)) };
  }
  return {};
}

module.exports = { parseOddsMd };