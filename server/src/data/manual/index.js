// ============================================================================
// 本地人工盘赔源 · 目录扫描与接入
// 根目录来源（优先级）：DB 绑定（qd_manual_odds_dirs，004 迁移）> env:OE_MANUAL_ODDS_ROOT。
// 每个扫描根支持两种形态，自动识别：
//   · 单场目录：该目录本身含 盘口数据.md
//   · 上层根目录：扫描其各子目录（放行 Windows junction）找 盘口数据.md
// 多根结果按 match_id 去重，优先级 match 绑定 > unified（更精确的意图表达优先）。
// 状态语义：not_configured（无任何根）| degraded（有根但全无 md / 全拒）| ok（≥1 场通过校验）。
// ============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { getSource } = require('../sources/registry');
const { CredentialVault } = require('../../vault/credential_vault');
const { recordAudit } = require('../../vault/audit');
const { validateMatch } = require('../schema');
const { parseOddsMd } = require('./odds_parser');

const SOURCE_ID = 'src_manual_odds';
const MD_FILENAME = '盘口数据.md';
const ACTOR_DEFAULT = { id: 'manual-odds:worker', role: 'ingest' };
const UNIFIED_ID = 'unified';

/**
 * 定位一个扫描根下的全部 盘口数据.md。
 * 自动识别两种形态：目录自身含 md（单场目录）→ 取该文件；
 * 否则按上层根处理，遍历子目录（含符号链接 / Windows junction）。
 * @param {string} dir
 * @returns {string[]} md 绝对路径列表
 */
function locateMdFiles(dir) {
  const direct = path.join(dir, MD_FILENAME);
  if (fs.existsSync(direct)) return [direct]; // 单场目录
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    // 目录；或符号链接/junction——Windows junction 在 Dirent 下是 lstat 语义（isSymbolicLink=true，
    // isDirectory=false），而聚合根正是用 junction 挂载场次目录，故须一并放行。
    // 目标不存在或其中无 md 时，下方的 existsSync 会自然过滤，不会误收。
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const md = path.join(dir, e.name, MD_FILENAME);
    if (fs.existsSync(md)) out.push(md);
  }
  return out;
}

/**
 * 多根扫描并接入本地人工盘赔源（纯函数式：根集合由调用方给出，本函数不读 env/DB）。
 * @param {Object} [opts]
 * @param {Array<{dir:string, scope?:string, match_key?:?string, binding_id?:?string}>} [opts.roots]
 * @param {Object} [opts.actor]
 * @param {number} [opts.year]
 * @returns {{ source_id:string, ok:boolean, status:string, reason?:string, matches?:Object[], meta?:Object }}
 */
function scanManualOddsSources({ roots, actor = ACTOR_DEFAULT, year } = {}) {
  const source = getSource(SOURCE_ID);
  const list = (Array.isArray(roots) ? roots : []).filter((r) => r && r.dir);

  if (list.length === 0) {
    recordAudit({ event_type: 'source_not_configured', actor: `${actor.role}:${actor.id}`, target_id: SOURCE_ID, details: { reason: 'no_roots' } });
    return {
      source_id: SOURCE_ID, ok: false, status: 'not_configured', reason: 'MANUAL_ODDS_ROOT_UNCONFIGURED',
      matches: [], meta: { total: 0, admitted: 0, rejected: 0, roots: [] },
    };
  }

  // 冲突优先级：match 绑定（更精确）先于 unified；同优先级保持调用方给定顺序
  const ordered = [...list].sort((a, b) => (a.scope === 'match' ? 0 : 1) - (b.scope === 'match' ? 0 : 1));

  const matches = [];
  const rejected = [];
  const shadowed = [];
  const byMatchId = new Map(); // match_id → { dir, scope }
  const rootResults = [];
  let mdTotal = 0;

  for (const r of ordered) {
    let mdFiles = [];
    try { mdFiles = locateMdFiles(r.dir); } catch { mdFiles = []; }
    mdTotal += mdFiles.length;
    const rejectedHere = [];
    let admittedHere = 0;

    for (const md of mdFiles) {
      let text;
      try { text = fs.readFileSync(md, 'utf8'); } catch { rejectedHere.push({ md, errors: ['read_failed'] }); continue; }
      // 真相源指纹：整份盘口数据.md 的 sha256（供派生层整场版本化 + 幂等重扫）。
      const contentHash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
      const parsed = parseOddsMd(text, { year, source: { source_id: SOURCE_ID, trust_level: source.trust_level } });
      if (!parsed.ok) { rejectedHere.push({ md, errors: parsed.errors }); continue; }
      const { errors } = validateMatch(parsed.match);
      if (errors.length) { rejectedHere.push({ md, errors }); continue; }

      // 把真相源指纹、来源路径与「来自哪个绑定」带回 match，供派生层版本化与可观测。
      parsed.match.content_hash = contentHash;
      parsed.match.md_path = md;
      parsed.match.meta = {
        ...(parsed.match.meta || {}),
        source_dir: r.dir,
        binding_id: r.binding_id || null,
        binding_scope: r.scope || null,
      };

      // 同 match_id 去重：先到者（match 绑定，或同优先级靠前者）胜出，其余记 shadowed 不入池。
      const dup = byMatchId.get(parsed.match.match_id);
      if (dup) {
        shadowed.push({ match_id: parsed.match.match_id, dir: r.dir, binding_scope: r.scope || null, md_path: md, shadowed_by: dup.dir });
        continue;
      }
      byMatchId.set(parsed.match.match_id, { dir: r.dir, scope: r.scope || null });
      matches.push(parsed.match);
      admittedHere += 1;
    }

    rejected.push(...rejectedHere);
    rootResults.push({
      dir: r.dir,
      scope: r.scope || null,
      match_key: r.match_key || null,
      binding_id: r.binding_id || null,
      md_files: mdFiles.length,
      admitted: admittedHere,
      rejected: rejectedHere.length,
      ok: mdFiles.length > 0,
    });
  }

  const noMdAtAll = mdTotal === 0;
  if (noMdAtAll) {
    recordAudit({ event_type: 'source_fetch_failed', actor: `${actor.role}:${actor.id}`, target_id: SOURCE_ID, details: { reason: 'no_md_in_any_root', roots: ordered.map((r) => r.dir) } });
  } else {
    recordAudit({
      event_type: 'manual_odds_synced',
      actor: `${actor.role}:${actor.id}`,
      target_id: SOURCE_ID,
      details: { roots: ordered.length, total: mdTotal, admitted: matches.length, rejected: rejected.length, shadowed: shadowed.length },
    });
  }

  return {
    source_id: SOURCE_ID,
    ok: matches.length > 0,
    status: matches.length > 0 ? 'ok' : 'degraded',
    reason: matches.length > 0 ? undefined : (noMdAtAll ? 'MANUAL_ODDS_ROOT_MISSING' : 'ALL_MD_REJECTED'),
    matches,
    meta: { total: mdTotal, admitted: matches.length, rejected: rejected.length, rejected_detail: rejected, shadowed, roots: rootResults },
  };
}

/**
 * 单根扫描（兼容入口，根取自 env:OE_MANUAL_ODDS_ROOT）。
 * 未配置 → not_configured（诚实，零数据）。
 * @param {Object} [opts]
 * @param {Object} [opts.env]
 * @param {Object} [opts.actor]
 * @param {number} [opts.year]
 */
function scanManualOddsRoot({ env = process.env, actor = ACTOR_DEFAULT, year } = {}) {
  const source = getSource(SOURCE_ID);
  const vault = new CredentialVault({ env });

  let root;
  try {
    root = String(vault.get(actor, source.config_ref) || '').trim();
  } catch (e) {
    if (e && e.code === 'VAULT_UNAUTHORIZED') {
      recordAudit({ event_type: 'source_not_configured', actor: `${actor.role}:${actor.id}`, target_id: SOURCE_ID, details: { config_ref: source.config_ref } });
      return { source_id: SOURCE_ID, ok: false, status: 'not_configured', reason: 'MANUAL_ODDS_ROOT_UNCONFIGURED', matches: [], meta: { total: 0, admitted: 0, rejected: 0, roots: [] } };
    }
    throw e;
  }
  if (!root) {
    recordAudit({ event_type: 'source_not_configured', actor: `${actor.role}:${actor.id}`, target_id: SOURCE_ID, details: { config_ref: source.config_ref } });
    return { source_id: SOURCE_ID, ok: false, status: 'not_configured', reason: 'MANUAL_ODDS_ROOT_UNCONFIGURED', matches: [], meta: { total: 0, admitted: 0, rejected: 0, roots: [] } };
  }

  return scanManualOddsSources({ roots: [{ dir: root, scope: 'unified', binding_id: UNIFIED_ID }], actor, year });
}

module.exports = { scanManualOddsRoot, scanManualOddsSources, locateMdFiles, SOURCE_ID, UNIFIED_ID };
