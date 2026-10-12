// ============================================================================
// 数据接入层 · 双源合并 —— 竞彩官方赛程 ∪ 本地人工盘赔 → 统一「真实比赛池」
// 背景：两条真实数据线的关键不同——
//   · 竞彩赛程 src_schedule_sporttery：trusted 元信息（数字 match_id / 官方队名 / 开赛时间），basic 无盘口快照
//   · 本地人工盘赔 src_manual_odds：provisional 盘口快照（让球/欧赔/大小球/必发）+ 赛果，语义 match_id
// 合并语义（诚实，绝无假数据）：
//   · 以人工盘赔为预测主体（推理链需要盘口快照）
//   · 用竞彩官方元信息补齐 match_id / 联赛 / 队名 / 开赛时间 / 状态（aligned 场）
//   · 语义键 = 联赛+主队+客队（各自经 normalizeTeamName）；命中即升级元信息
//   · 时间防线：合并后官方 match_time 必须 ≥ 每份人工快照 received_at（防赛后数据被当作赛前可得）；
//     违例场次标记 conflicts，绝不入预测池
//   · 未命中赛程的人工场次照常入池（manual_only，无官方 match_id，诚实保留 provisional 身份）
// 每次调用均为两个已同步结果（syncSportterySchedule / loadManualOdds）的纯函数合并，无副作用。
// ============================================================================
'use strict';

const { validateMatch } = require('./schema');
const { normalizeTeamName, normalizeLeague } = require('./normalize');

/** 语义对齐键：联赛|主队|客队（各自归一化；联赛别名收敛统一官方全称/人工简称）。 */
function matchKey(m) {
  return [
    normalizeLeague(String(m && m.league != null ? m.league : '')),
    normalizeTeamName(String(m && m.home_team != null ? m.home_team : '')),
    normalizeTeamName(String(m && m.away_team != null ? m.away_team : '')),
  ].join('|');
}

/**
 * 期号锚定复合键 = 业务日 + 序号（如 `261012#002`）。
 *
 * **必须带业务日**：竞彩序号只在**同一业务日内**唯一——「周一002」每个周一都会重现。
 * 2026-10-12 实测：只按「周X+序号」匹配时，09-08 赫塔菲、09-14 图尔库、09-28 韩国
 * 等**不同业务日**的历史场次全部错锚到当天在售的「周一002」（亚特兰大 vs 威尼斯），
 * 造成 7 组 / 13 条重复池条目，并把别场的赛果挂到本场（张冠李戴）。
 *
 * 任一侧缺业务日或缺序号 → 返回 null，该场**不做确定性锚定**，诚实回退语义键。
 * @param {?string} dateCompact 业务日（人工 match_num_date / 官方 serial_date），YYMMDD 或 YYYYMMDD
 * @param {?string} matchNumStr 序号串（如「周一002」）
 * @returns {?string}
 */
function periodKey(dateCompact, matchNumStr) {
  const d = String(dateCompact == null ? '' : dateCompact).replace(/[-/]/g, '').trim();
  if (!/^\d{6}$|^\d{8}$/.test(d)) return null;
  const m = String(matchNumStr == null ? '' : matchNumStr).trim().match(/(\d{1,4})$/);
  if (!m) return null;
  return `${d.slice(-6)}#${m[1].padStart(3, '0')}`;
}

/**
 * 合并竞彩赛程元信息到人工盘赔场次。
 * @param {Object} [opts]
 * @param {Object} [opts.schedule]  syncSportterySchedule 结果（matches 为无快照元信息）
 * @param {Object} [opts.manual]    loadManualOdds 结果（matches 为带盘口快照场次）
 * @returns {{
 *   ok: boolean,
 *   pool: Object[],                      // 合法统一场次（validateMatch 通过）
 *   dismissed: Object[],                 // 时间防线违例 / 校验失败场次（含原因）
 *   meta: { schedule_total, manual_total, aligned, manual_only, conflicts, pool_size },
 * }}
 */
function mergeMatchSources({ schedule = {}, manual = {} } = {}) {
  const scheduleMatches = Array.isArray(schedule.matches) ? schedule.matches : [];
  const manualMatches = Array.isArray(manual.matches) ? manual.matches : [];

  // 索引赛程（同一语义键可能命中多场——取最近一场，防御噪声）
  const byKey = new Map();
  // 期号锚定索引：键 = 业务日#序号（见 periodKey）。官方侧需同时带 serial_date 与序号，
  // 缺任一项则不入索引——只按序号匹配会把不同业务日的历史场次错锚到当天在售场次上。
  const byMatchNum = new Map();
  for (const s of scheduleMatches) {
    const key = matchKey(s);
    const cur = byKey.get(key);
    if (!cur || Date.parse(s.match_time || 0) > Date.parse(cur.match_time || 0)) byKey.set(key, s);
    const pk = periodKey(s.meta && s.meta.match_num_date, s.meta && s.meta.match_num_str);
    if (pk) byMatchNum.set(pk, s);
  }

  const pool = [];
  const dismissed = [];
  const usedOfficialId = new Set(); // 同一官方场次只允许一个池条目（防重复锚定，见下）
  let aligned = 0;
  let manualOnly = 0;

  for (const m of manualMatches) {
    // 锚定优先级：期号+业务日（确定性）> 语义键（联赛+队名收敛）
    const pk = periodKey(m.meta && m.meta.match_num_date, m.meta && m.meta.match_num_str);
    let sched = null;
    let alignVia = null;
    if (pk && byMatchNum.has(pk)) {
      sched = byMatchNum.get(pk);
      alignVia = 'match_num';
    } else {
      sched = byKey.get(matchKey(m));
      alignVia = sched ? 'semantic_key' : null;
    }

    // 防御：多个池条目指向同一官方 match_id 会让「按 id 取数」产生歧义，
    // 也会让统计口径（pool_size）失真。后到者剔除并记录原因，绝不静默合并。
    if (sched && usedOfficialId.has(sched.match_id)) {
      dismissed.push({ match_id: sched.match_id, key: matchKey(m), reason: 'duplicate_official_anchor', manual_match_id: m.match_id, align_via: alignVia });
      continue;
    }

    // 合并：以人工快照为底，官方元信息覆盖同名顶层（保留人工快照与其 trust）
    let merged;
    let conflict = null;
    if (sched) {
      usedOfficialId.add(sched.match_id);
      merged = {
        ...m,
        match_id: sched.match_id,
        league: sched.league,
        home_team: sched.home_team,
        away_team: sched.away_team,
        neutral: sched.neutral,
        match_time: sched.match_time,
        status: sched.status,
        observed_at: m.observed_at,   // 真实盘口观察时点（早于开赛），不取赛程 now
        received_at: m.received_at,
        // 官方 meta 透传（business_date / match_num_str / 联赛代码 / 排名等），
        // 使「今日可买」批次分组与官方期号在合并后仍可溯；人工 meta 优先保留非重叠键。
        // manual_match_id 必留：顶层 match_id 已被官方数字 id 覆盖，不留此键则无法溯源到
        // 究竟是哪一场人工盘赔（排障与复盘都需要），source_dir/binding_id 由扫描层带入 meta。
        meta: { ...(m.meta || {}), ...(sched.meta || {}), merged: true, manual_match_id: m.match_id, schedule_match_id: sched.match_id, align_via: alignVia },
      };
      // 同步更新每份快照的 match_id，保持 快照.match_id === 顶层.match_id
      merged.snapshots = (m.snapshots || []).map((s) => ({ ...s, match_id: merged.match_id }));
      // 时间防线：官方 match_time 不得早于任何快照接收时点
      for (const s of merged.snapshots) {
        if (Date.parse(s.received_at) > Date.parse(merged.match_time)) { conflict = 'schedule_time_precedes_snapshot'; break; }
      }
    } else {
      merged = { ...m, meta: { ...(m.meta || {}), merged: false, manual_match_id: m.match_id } };
    }

    const { errors } = validateMatch(merged);
    if (conflict || errors.length) {
      dismissed.push({ match_id: merged.match_id, key: matchKey(m), reason: conflict || errors.join(',') });
      continue;
    }
    pool.push(merged);
    if (sched) aligned++; else manualOnly++;
  }

  return {
    ok: pool.length > 0,
    pool,
    dismissed,
    meta: {
      schedule_total: scheduleMatches.length,
      manual_total: manualMatches.length,
      aligned,
      manual_only: manualOnly,
      conflicts: dismissed.length,
      pool_size: pool.length,
    },
  };
}

module.exports = { mergeMatchSources, matchKey, periodKey };