// ============================================================================
// G12 派生层 · manual_reconcile —— 扫盘即写入 DB（磁盘 盘口数据.md 为真相源）
// 职责：
//   1. reconcileManualOddsToDb：把磁盘扫描得到的 parsed match 落库为「整场版本」。
//      · 版本粒度 = 整份盘口数据.md 的 sha256（match.content_hash 已带）。
//      · 幂等：version_id = hmv_<content_hash>；相同内容 INSERT OR IGNORE 跳过。
//      · 内容变化 = 新版本，并把上一代（active 且未 superseded）的 superseded_by
//        标记为新版本（仅改指针，不改旧版本内容，保留 append-only 精神）。
//      · 快照以 version_id 关联写入 qd_hist_match_snapshot（解耦 qd_matches）。
//      · 每次扫盘写一条 qd_hist_scan_runs（可观测）。
//   2. loadManualOddsFromDb：读 DB 当前（active 且未 superseded）版本 + 快照，
//      忠实重建 match 对象（含 snapshots），供 mergeMatchSources 直接复用。
// 本层为派生只读物化视图：DB 不负责产生数据，只镜像磁盘；磁盘改了才产生新版本。
// ============================================================================
'use strict';

const crypto = require('node:crypto');
const { scanManualOddsRoot } = require('../../data/manual');
const { withTransaction } = require('../connection');
const { defaultLogger } = require('../../lib/logger');

function nowIso() { return new Date().toISOString(); }
function genRunId() { return `hsr_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }

/**
 * 从 DB 读取当前生效的人工盘赔比赛（重建为 parseOddsMd 同构的 match 对象）。
 * @param {Object} qd createG12Repository(db) 返回值
 * @returns {?Object} 同 loadManualOdds 返回结构；DB 无数据返回 null（调用方回退磁盘）
 */
function loadManualOddsFromDb(qd) {
  if (!qd || !qd.qd_hist_match_version) return null;
  const rows = qd.qd_hist_match_version.all();
  const current = rows.filter((r) => r.status_flag === 'active' && !r.superseded_by);
  if (current.length === 0) return null;

  const matches = [];
  for (const v of current) {
    const snapRows = qd.qd_hist_match_snapshot.listBy('version_id', v.version_id);
    let m;
    try { m = JSON.parse(v.match_payload); } catch { continue; } // 损坏行跳过，诚实
    m.snapshots = snapRows.map((s) => ({
      snapshot_id: s.snapshot_id,
      match_id: v.match_id,
      institution: s.institution,
      market: s.market,
      source_id: s.source_id,
      trust_level: s.trust_level,
      observed_at: s.observed_at,
      received_at: s.received_at,
      data: (() => { try { return JSON.parse(s.data); } catch { return {}; } })(),
    }));
    matches.push(m);
  }

  return {
    source_id: 'src_manual_odds',
    ok: matches.length > 0,
    status: matches.length ? 'ok' : 'degraded',
    reason: undefined,
    matches,
    meta: { total: current.length, admitted: matches.length, rejected: 0, from_db: true },
  };
}

/**
 * 把磁盘扫描结果落库为整场版本（幂等，事务内；扫盘即写入）。
 * @param {Object} p
 * @param {import('node:sqlite').DatabaseSync} p.db
 * @param {Object} p.qd createG12Repository(db) 返回值
 * @param {Object} [p.env]
 * @param {Object} [p.actor]
 * @param {number} [p.year]
 * @param {import('../../lib/logger').Logger} [p.logger]
 * @returns {{ ok:boolean, status:string, reason?:string, imported:number, skipped:number, superseded:number, snapshotCount:number }}
 */
function reconcileManualOddsToDb({ db, qd, env = process.env, actor, year, logger = defaultLogger }) {
  const startedAt = nowIso();
  const scan = scanManualOddsRoot({ env, actor: actor || { id: 'reconcile:worker', role: 'ingest' }, year });
  const matches = scan.matches || [];
  const filesSeen = (scan.meta && scan.meta.total) || 0;
  const filesRejected = (scan.meta && scan.meta.rejected) || 0;

  let imported = 0, skipped = 0, superseded = 0, snapshotCount = 0;

  if (matches.length === 0) {
    const runId = genRunId();
    qd.qd_hist_scan_runs.insert({
      run_id: runId, started_at: startedAt, finished_at: nowIso(),
      status: scan.status || 'empty', files_seen: filesSeen, files_ok: 0, files_rejected: filesRejected,
      imported: 0, skipped: 0, superseded: 0,
      note: scan.reason || 'no_admitted_matches', created_at: nowIso(),
    });
    return { ok: false, status: scan.status || 'empty', reason: scan.reason, imported: 0, skipped: 0, superseded: 0, snapshotCount: 0 };
  }

  // 直接改指针（仅 superseded_by），绕开 store 的 update 守卫；本表为派生表，非 G12 不可变表。
  const markSuperseded = db.prepare(
    'UPDATE qd_hist_match_version SET superseded_by = ?, status_flag = ? WHERE version_id = ? AND status_flag = ?'
  );

  withTransaction(db, () => {
    for (const m of matches) {
      const contentHash = m.content_hash;
      if (!contentHash) continue; // 无指纹无法版本化，诚实跳过（不该发生，scan 已带）
      const versionId = `hmv_${contentHash}`;

      // 幂等：同内容已存在 → 跳过
      if (qd.qd_hist_match_version.get(versionId)) { skipped += 1; continue; }

      // 找当前生效（active 且未 superseded）的同一 match_id 版本作为上一代
      const prevRows = qd.qd_hist_match_version
        .listBy('match_id', m.match_id)
        .filter((r) => r.status_flag === 'active' && !r.superseded_by);
      const prevVersionId = prevRows.length ? prevRows[0].version_id : null;

      const { snapshots, errors, ...rest } = m;
      delete rest.errors; // 清理解析器附带的错误占位字段
      const snapRows = Array.isArray(snapshots) ? snapshots : [];

      qd.qd_hist_match_version.insert({
        version_id: versionId,
        match_id: m.match_id,
        content_hash: contentHash,
        md_path: m.md_path || null,
        league: m.league,
        home_team: m.home_team,
        away_team: m.away_team,
        neutral: m.neutral ? 1 : 0,
        match_time: m.match_time,
        match_status: m.status || 'scheduled',
        actual_result: m.actual_result || null,
        home_score: m.home_score == null ? null : m.home_score,
        away_score: m.away_score == null ? null : m.away_score,
        observed_at: m.observed_at || null,
        received_at: m.received_at || null,
        snapshot_count: snapRows.length,
        status_flag: 'active',
        prev_version_id: prevVersionId,
        superseded_by: null,
        match_payload: rest, // 对象即可；repository 的 json 列会负责单次 JSON 序列化（避免双重编码）
        created_at: nowIso(),
      });

      for (const s of snapRows) {
        qd.qd_hist_match_snapshot.insert({
          // snapshot_id 在 parseOddsMd 内按场重置（manual_1_...），非全局唯一；
          // 以 version_id 前缀保证整库唯一，避免 INSERT OR IGNORE 误吞不同场的同名快照。
          snapshot_id: `${versionId}__${s.snapshot_id}`,
          version_id: versionId,
          institution: s.institution,
          market: s.market,
          observed_at: s.observed_at,
          received_at: s.received_at,
          data: s.data,
          trust_level: s.trust_level || 'provisional',
          source_id: s.source_id || 'src_manual_odds',
        });
        snapshotCount += 1;
      }

      // 标记上一代为被取代（仅改指针，不碰旧版本内容）
      if (prevVersionId) {
        markSuperseded.run(versionId, 'superseded', prevVersionId, 'active');
        superseded += 1;
      }
      imported += 1;
    }
  });

  qd.qd_hist_scan_runs.insert({
    run_id: genRunId(), started_at: startedAt, finished_at: nowIso(),
    status: 'ok', files_seen: filesSeen, files_ok: matches.length, files_rejected: filesRejected,
    imported, skipped, superseded, note: null, created_at: nowIso(),
  });

  logger.info('manual_odds_reconcile_done', { imported, skipped, superseded, snapshotCount });
  return { ok: true, status: 'ok', imported, skipped, superseded, snapshotCount };
}

module.exports = { reconcileManualOddsToDb, loadManualOddsFromDb };
