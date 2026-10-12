// ============================================================================
// G12 · manual_dirs —— 人工盘赔「数据目录绑定」可变配置读写（004 迁移表）
//
// 为什么用 raw SQL 而非仓储层：repository 对所有非不可变表也把 update/delete/patch
// 一律置为抛错（`update_unsupported`，见 repository.js:219-222），且 insert 是
// INSERT OR IGNORE（同 id 重复设置会静默保留旧值）。本表需要真正的 upsert 与指针更新，
// 故沿用 manual_reconcile.js:96-99 的既有做法：直接 prepare raw SQL。
//
// 职责边界：本表只记录「去哪扫盘」，**不存盘口数据**——真相源始终是磁盘的 盘口数据.md。
// 审计不落在本表（本表可变），另行写 audit_logs / qd_audit_log（append-only）。
// ============================================================================
'use strict';

const crypto = require('node:crypto');

/** 统一目录的固定绑定 id（唯一索引约束至多一行）。 */
const UNIFIED_ID = 'unified';

function nowIso() { return new Date().toISOString(); }

/**
 * 确定性绑定 id：同一 (scope, match_key) 重复设置即同一行 —— 天然 upsert，无需查重。
 * @param {'unified'|'match'} scope
 * @param {?string} matchKey
 * @returns {string}
 */
function makeBindingId(scope, matchKey) {
  if (scope === 'unified') return UNIFIED_ID;
  const h = crypto.createHash('sha256').update(`${scope}|${matchKey || ''}`).digest('hex').slice(0, 12);
  return `mod_${h}`;
}

/** 全部绑定（unified 优先靠前，其余按创建序）。 */
function listDirs(db) {
  return db.prepare('SELECT * FROM qd_manual_odds_dirs ORDER BY scope, created_at').all();
}

/** 单条绑定；不存在返回 null（不抛错，供调用方诚实判定）。 */
function getDir(db, bindingId) {
  return db.prepare('SELECT * FROM qd_manual_odds_dirs WHERE binding_id = ?').get(bindingId) || null;
}

/**
 * 新增或更新一条绑定（upsert）：重复设置同一 (scope, match_key) 覆盖 dir_path 并复位为 active。
 * @returns {{ binding_id: string, created: boolean }}
 */
function upsertDir(db, { scope, matchKey = null, matchKeyKind = null, dirPath, label = null }) {
  const bindingId = makeBindingId(scope, matchKey);
  const at = nowIso();
  if (getDir(db, bindingId)) {
    db.prepare(
      `UPDATE qd_manual_odds_dirs
          SET dir_path = ?, label = ?, match_key_kind = ?, status = 'active', updated_at = ?
        WHERE binding_id = ?`
    ).run(dirPath, label, matchKeyKind, at, bindingId);
    return { binding_id: bindingId, created: false };
  }
  db.prepare(
    `INSERT INTO qd_manual_odds_dirs
       (binding_id, scope, match_key, match_key_kind, dir_path, label, status, last_scanned_at, last_result, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?)`
  ).run(bindingId, scope, matchKey, matchKeyKind, dirPath, label, at, at);
  return { binding_id: bindingId, created: true };
}

/** 移除绑定（unified 被移除即回退 env 兜底值，不是「无目录」）。 */
function removeDir(db, bindingId) {
  const r = db.prepare('DELETE FROM qd_manual_odds_dirs WHERE binding_id = ?').run(bindingId);
  return { removed: r.changes === 1 };
}

/**
 * 记录一次扫描结果（可观测：这次扫描扫到几个 md、接入几场、为何拒绝）。
 *
 * env 兜底根在用户未覆盖时**没有 DB 行**（`resolveRoots` 返回的是合成对象），单靠 UPDATE
 * 会命中 0 行、静默丢记录 → 前端永远显示「从未扫描」。故对 unified 先补一行**扫描痕迹行**：
 *   · `status='disabled'` 表示「本行不构成生效绑定，只是 env 兜底根的扫描痕迹」。
 *     `resolveRoots` 只认 `status='active'` 才算用户覆盖，故 `origin` 不会被误判为 'db'。
 *     （不能新造一个 status 取值：004 有 `CHECK (status IN ('active','disabled'))`，
 *      非法值会被 INSERT OR IGNORE 静默丢弃——这正是本实现踩过的坑。）
 *   · 已存在覆盖行（`status='active'`）时 `INSERT OR IGNORE` 为 no-op，只更新元信息、不动 status。
 *   · 004 的 `uniq_manual_dirs_unified`（scope='unified' 唯一）保证至多一行，二者共用同一行。
 * @param {Object} db
 * @param {string} bindingId
 * @param {Object} result 扫描结果摘要
 * @param {{scope?:string, dirPath?:string}} [opts] unified 根需传 scope='unified' 与本次实际扫描目录
 */
function recordScan(db, bindingId, result, opts = {}) {
  const at = nowIso();
  const dirPath = opts.dirPath == null ? null : String(opts.dirPath);
  if (opts.scope === 'unified') {
    db.prepare(
      `INSERT OR IGNORE INTO qd_manual_odds_dirs
         (binding_id, scope, match_key, match_key_kind, dir_path, label, status,
          last_scanned_at, last_result, created_at, updated_at)
       VALUES (?, 'unified', NULL, NULL, ?, NULL, 'disabled', NULL, NULL, ?, ?)`
    ).run(bindingId, dirPath, at, at);
  }
  // dir_path 用 COALESCE 只在本次确有目录时覆盖：env 根换值后痕迹行随之刷新，
  // 而覆盖行本就等于其扫描目录，写入为等值 no-op。
  db.prepare(
    `UPDATE qd_manual_odds_dirs
        SET dir_path = COALESCE(?, dir_path), last_scanned_at = ?, last_result = ?, updated_at = ?
      WHERE binding_id = ?`
  ).run(dirPath, at, JSON.stringify(result), at, bindingId);
}

/**
 * 汇总扫描根集合：DB 绑定 ∪ env 兜底。与配置表同层，避免 data 层反向依赖 db 层。
 * 语义：
 *   · unified 行存在 → 用其 dir_path；否则用 env.OE_MANUAL_ODDS_ROOT（合成 binding_id='unified'）。
 *     两者皆无 → 该根不产出（调用方据此得到 not_configured 诚实态）。
 *   · 追加全部 scope='match' 且 active 的绑定。
 *   · 同一目录只扫一次；重复时保留优先级更高者（match 绑定 > unified）。
 * @param {{ db?: Object, env?: Object }} [opts]
 * @returns {Array<{dir:string, scope:string, match_key?:?string, match_key_kind?:?string, binding_id:string, origin?:string}>}
 */
function resolveRoots({ db, env = process.env } = {}) {
  let rows = [];
  if (db) {
    try { rows = listDirs(db); } catch { rows = []; } // 表不存在（迁移未跑）→ 退回 env，不致命
  }
  const unifiedRow = rows.find((r) => r.scope === 'unified' && r.status === 'active');
  const envRoot = String((env && env.OE_MANUAL_ODDS_ROOT) || '').trim();
  const unifiedDir = (unifiedRow && unifiedRow.dir_path) || envRoot;

  const matchRoots = rows
    .filter((r) => r.scope === 'match' && r.status === 'active' && r.dir_path)
    .map((r) => ({ dir: r.dir_path, scope: 'match', match_key: r.match_key, match_key_kind: r.match_key_kind, binding_id: r.binding_id }));
  const unifiedRoots = unifiedDir
    ? [{ dir: unifiedDir, scope: 'unified', binding_id: UNIFIED_ID, origin: unifiedRow ? 'db' : 'env' }]
    : [];

  // match 绑定优先保留（更精确的意图表达）
  const seen = new Set();
  const out = [];
  for (const r of [...matchRoots, ...unifiedRoots]) {
    if (seen.has(r.dir)) continue;
    seen.add(r.dir);
    out.push(r);
  }
  return out;
}

module.exports = { UNIFIED_ID, makeBindingId, listDirs, getDir, upsertDir, removeDir, recordScan, resolveRoots, nowIso };
