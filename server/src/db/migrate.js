// ============================================================================
// 持久化存储层 · migrate —— SQL 迁移执行器
// 读取 server/migrations/*.sql（按版本号递增）并顺序执行，幂等可重复。
// G12 交付物：migrations/001_init.sql 落地架构设计基线的全部 qd_* 表。
// ============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

/**
 * 列出待执行的迁移文件（按文件名排序，仅匹配 NNN_name.sql）。
 * @param {string} [dir]
 * @returns {string[]}
 */
function listMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
}

/**
 * 顺序执行全部迁移（幂等，SQL 内部使用 IF NOT EXISTS）。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ dir?: string, logger?: object }} [opts]
 * @returns {string[]} 已执行的迁移文件名
 */
function runMigrations(db, { dir = MIGRATIONS_DIR, logger } = {}) {
  const files = listMigrations(dir);
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.exec(sql);
    if (logger) logger.info('migration_applied', { file });
  }
  return files;
}

module.exports = { runMigrations, listMigrations, MIGRATIONS_DIR };
