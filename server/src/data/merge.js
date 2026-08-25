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
const { normalizeTeamName } = require('./normalize');

/** 语义对齐键：联赛|主队|客队（各自归一化）。 */
function matchKey(m) {
  return [
    normalizeTeamName(String(m && m.league != null ? m.league : '')),
    normalizeTeamName(String(m && m.home_team != null ? m.home_team : '')),
    normalizeTeamName(String(m && m.away_team != null ? m.away_team : '')),
  ].join('|');
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
  for (const s of scheduleMatches) {
    const key = matchKey(s);
    const cur = byKey.get(key);
    if (!cur || Date.parse(s.match_time || 0) > Date.parse(cur.match_time || 0)) byKey.set(key, s);
  }

  const pool = [];
  const dismissed = [];
  let aligned = 0;
  let manualOnly = 0;

  for (const m of manualMatches) {
    const sched = byKey.get(matchKey(m));

    // 合并：以人工快照为底，官方元信息覆盖同名顶层（保留人工快照与其 trust）
    let merged;
    let conflict = null;
    if (sched) {
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
        meta: { ...(m.meta || {}), merged: true, schedule_match_id: sched.match_id },
      };
      // 同步更新每份快照的 match_id，保持 快照.match_id === 顶层.match_id
      merged.snapshots = (m.snapshots || []).map((s) => ({ ...s, match_id: merged.match_id }));
      // 时间防线：官方 match_time 不得早于任何快照接收时点
      for (const s of merged.snapshots) {
        if (Date.parse(s.received_at) > Date.parse(merged.match_time)) { conflict = 'schedule_time_precedes_snapshot'; break; }
      }
    } else {
      merged = { ...m, meta: { ...(m.meta || {}), merged: false } };
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

module.exports = { mergeMatchSources, matchKey };