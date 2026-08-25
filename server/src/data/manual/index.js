// ============================================================================
// 本地人工盘赔源 · 目录扫描与接入
// 根目录由环境变量注入（CredentialVault / env:OE_MANUAL_ODDS_ROOT）动态配置，
// 因此后续迁移目录只需改配置，无需改代码。
// 遍历根目录下各「比赛子目录」，定位 盘口数据.md → parseOddsMd → validateMatch。
// 状态语义：not_configured（未配置根目录）| degraded（配置了但目录缺失/全拒）
//           | ok（≥1 场通过校验）。
// ============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { getSource } = require('../sources/registry');
const { CredentialVault } = require('../../vault/credentialVault');
const { recordAudit } = require('../../vault/audit');
const { validateMatch } = require('../schema');
const { parseOddsMd } = require('./oddsParser');

const SOURCE_ID = 'src_manual_odds';
const MD_FILENAME = '盘口数据.md';
const ACTOR_DEFAULT = { id: 'manual-odds:worker', role: 'ingest' };

/**
 * 定位根目录下某场比赛目录中的 盘口数据.md。
 * @param {string} root
 * @returns {string[]} md 绝对路径列表
 */
function locateMdFiles(root) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const md = path.join(root, e.name, MD_FILENAME);
    if (fs.existsSync(md)) out.push(md);
  }
  return out;
}

/**
 * 扫描并接入本地人工盘赔源。
 * @param {Object} [opts]
 * @param {Object} [opts.env]
 * @param {Object} [opts.actor]
 * @param {number} [opts.year]
 * @returns {{ source_id:string, ok:boolean, status:string, reason?:string, matches?:Object[], meta?:Object }}
 */
function scanManualOddsRoot({ env = process.env, actor = ACTOR_DEFAULT, year } = {}) {
  const source = getSource(SOURCE_ID);
  const vault = new CredentialVault({ env });

  // 根目录经 CredentialVault（data_source 域）读取：未配置 → not_configured（诚实）
  let root;
  try {
    root = String(vault.get(actor, source.config_ref) || '').trim();
  } catch (e) {
    if (e && e.code === 'VAULT_UNAUTHORIZED') {
      recordAudit({ event_type: 'source_not_configured', actor: `${actor.role}:${actor.id}`, target_id: SOURCE_ID, details: { config_ref: source.config_ref } });
      return { source_id: SOURCE_ID, ok: false, status: 'not_configured', reason: 'MANUAL_ODDS_ROOT_UNCONFIGURED', matches: [], meta: { total: 0, admitted: 0, rejected: 0 } };
    }
    throw e;
  }
  if (!root) {
    recordAudit({ event_type: 'source_not_configured', actor: `${actor.role}:${actor.id}`, target_id: SOURCE_ID, details: { config_ref: source.config_ref } });
    return { source_id: SOURCE_ID, ok: false, status: 'not_configured', reason: 'MANUAL_ODDS_ROOT_UNCONFIGURED', matches: [], meta: { total: 0, admitted: 0, rejected: 0 } };
  }

  let mdFiles;
  try { mdFiles = locateMdFiles(root); }
  catch { mdFiles = []; }
  if (mdFiles.length === 0 || !fs.existsSync(root)) {
    recordAudit({ event_type: 'source_fetch_failed', actor: `${actor.role}:${actor.id}`, target_id: SOURCE_ID, details: { reason: 'root_missing_or_no_md', root } });
    return { source_id: SOURCE_ID, ok: false, status: 'degraded', reason: 'MANUAL_ODDS_ROOT_MISSING', matches: [], meta: { total: 0, admitted: 0, rejected: 0 } };
  }

  const matches = [];
  const rejected = [];
  for (const md of mdFiles) {
    let text;
    try { text = fs.readFileSync(md, 'utf8'); } catch (e) { rejected.push({ md, errors: ['read_failed'] }); continue; }
    const parsed = parseOddsMd(text, { year, source: { source_id: SOURCE_ID, trust_level: source.trust_level } });
    if (!parsed.ok) { rejected.push({ md, errors: parsed.errors }); continue; }
    const { errors } = validateMatch(parsed.match);
    if (errors.length) { rejected.push({ md, errors }); continue; }
    matches.push(parsed.match);
  }

  recordAudit({
    event_type: 'manual_odds_synced',
    actor: `${actor.role}:${actor.id}`,
    target_id: SOURCE_ID,
    details: { root: 'configured', total: mdFiles.length, admitted: matches.length, rejected: rejected.length },
  });

  return {
    source_id: SOURCE_ID,
    ok: matches.length > 0,
    status: matches.length > 0 ? 'ok' : 'degraded',
    reason: matches.length > 0 ? undefined : 'ALL_MD_REJECTED',
    matches,
    meta: { total: mdFiles.length, admitted: matches.length, rejected: rejected.length, rejected_detail: rejected },
  };
}

module.exports = { scanManualOddsRoot, locateMdFiles, SOURCE_ID };