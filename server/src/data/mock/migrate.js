// ============================================================================
// 数据接入层 · mock 数据源 —— 原型 data.js 迁移（1.1 设计文档 §6）
// 迁移动作：real 布尔 → 数据源 trust_level；kickoff → match_time；
//           initial/current → 两份不同 observed_at 的快照；补三时间戳。
// 演示场（M001–M006）统一归 src_mock_demo（untrusted），明确"模拟"标记。
// ============================================================================
'use strict';

const { getSourceByInstitution, getSource } = require('../sources/registry');
const { normalizeInstitution, normalizeLine, normalizeWater } = require('../normalize');

/** 原型场次基准时间（演示用，统一到 2026-08-14 前后） */
const BASE = '2026-08-14T';

/**
 * 生成一份快照。
 * @param {Object} p
 * @param {string} p.matchId
 * @param {string} p.institution 归一化机构键
 * @param {string} p.market
 * @param {string} p.observedAt
 * @param {string} p.receivedAt
 * @param {Object} p.data
 * @param {string} p.sourceId
 * @param {string} p.trustLevel
 * @returns {import('../schema').OddsSnapshot}
 */
function snap({ matchId, institution, market, observedAt, receivedAt, data, sourceId, trustLevel }) {
  return {
    snapshot_id: `${matchId}_${institution}_${market}_${observedAt.replace(/[-:TZ]/g, '').slice(0, 12)}`,
    match_id: matchId,
    institution,
    market,
    source_id: sourceId,
    trust_level: trustLevel,
    observed_at: observedAt,
    received_at: receivedAt,
    data,
  };
}

/**
 * 把原型一场比赛迁移为 MatchSchema。
 * @param {Object} raw 原型 match 对象
 * @param {string} [matchTimeOverride] 覆盖开赛时间（演示场用）
 * @returns {import('../schema').MatchSchema}
 */
function migrateMatch(raw, matchTimeOverride) {
  const matchId = raw.id;
  const matchTime = matchTimeOverride || raw.kickoff;
  const isMock = raw.real === false;
  const mockSource = getSource('src_mock_demo');

  const snapshots = [];
  const mkSnap = (institution, market, observedAt, receivedAt, data) => {
    const src = isMock
      ? mockSource
      : getSourceByInstitution(institution) || mockSource;
    snapshots.push(snap({
      matchId,
      institution,
      market,
      observedAt,
      receivedAt,
      data,
      sourceId: src.source_id,
      trustLevel: src.trust_level,
    }));
  };

  // ── 让球盘：initial（早时点）与 current（晚时点）各成一份快照 ──
  if (Array.isArray(raw.handicap)) {
    for (const b of raw.handicap) {
      const inst = normalizeInstitution(b.name);
      if (!inst) continue;
      const src = isMock ? mockSource : getSourceByInstitution(inst) || mockSource;
      if (b.initial) {
        mkSnap(inst, 'handicap', `${BASE}12:00:00+08:00`, `${BASE}12:00:30+08:00`, {
          line: normalizeLine(b.initial.h),
          home_water: normalizeWater(b.initial.hw),
          away_water: normalizeWater(b.initial.aw),
        });
      }
      if (b.current) {
        mkSnap(inst, 'handicap', `${BASE}17:30:00+08:00`, `${BASE}17:30:30+08:00`, {
          line: normalizeLine(b.current.h),
          home_water: normalizeWater(b.current.hw),
          away_water: normalizeWater(b.current.aw),
        });
      }
    }
  }

  // ── 欧指 1X2：initial / current 拆分，kelly 并入 ──
  if (Array.isArray(raw.onex)) {
    for (const o of raw.onex) {
      const inst = normalizeInstitution(o.name);
      if (!inst) continue;
      const src = isMock ? mockSource : getSourceByInstitution(inst) || mockSource;
      const k = o.kelly || {};
      if (o.initial && o.initial.h != null) {
        mkSnap(inst, 'european', `${BASE}12:00:00+08:00`, `${BASE}12:00:30+08:00`, {
          home_odds: o.initial.h, draw_odds: o.initial.d, away_odds: o.initial.a,
          kelly_home: k.h, kelly_draw: k.d, kelly_away: k.a,
        });
      }
      if (o.current && o.current.h != null) {
        mkSnap(inst, 'european', `${BASE}17:30:00+08:00`, `${BASE}17:30:30+08:00`, {
          home_odds: o.current.h, draw_odds: o.current.d, away_odds: o.current.a,
          kelly_home: k.h, kelly_draw: k.d, kelly_away: k.a,
        });
      }
    }
  }

  // ── 大小球：initial / current 拆分 ──
  if (Array.isArray(raw.totals)) {
    for (const t of raw.totals) {
      const inst = normalizeInstitution(t.name);
      if (!inst) continue;
      const src = isMock ? mockSource : getSourceByInstitution(inst) || mockSource;
      if (t.initial) {
        mkSnap(inst, 'over_under', `${BASE}12:00:00+08:00`, `${BASE}12:00:30+08:00`, {
          line: normalizeLine(t.initial.line),
          over_odds: normalizeWater(t.initial.over),
          under_odds: normalizeWater(t.initial.under),
        });
      }
      if (t.current) {
        mkSnap(inst, 'over_under', `${BASE}17:30:00+08:00`, `${BASE}17:30:30+08:00`, {
          line: normalizeLine(t.current.line),
          over_odds: normalizeWater(t.current.over),
          under_odds: normalizeWater(t.current.under),
        });
      }
    }
  }

  // ── 必发资金面 ──
  if (raw.betfair) {
    const inst = 'betfair';
    const src = isMock ? mockSource : getSourceByInstitution(inst) || mockSource;
    mkSnap(inst, 'bf', `${BASE}17:30:00+08:00`, `${BASE}17:30:30+08:00`, {
      turnover: raw.betfair.turnover,
      rows: raw.betfair.rows,
    });
  }

  return {
    match_id: matchId,
    league: raw.league,
    home_team: raw.home,
    away_team: raw.away,
    neutral: !!raw.neutral,
    match_time: matchTime,
    status: 'scheduled',
    observed_at: `${BASE}12:00:00+08:00`,
    received_at: `${BASE}17:30:30+08:00`,
    snapshots,
    actual_result: null,
    home_score: null,
    away_score: null,
    errors: [],
  };
}

module.exports = { migrateMatch, snap };