// ============================================================================
// 持久化存储层 · connection —— SQLite 连接工厂 + 事务助手
// 基于 node:sqlite（Node >=22.5 内置，无外部依赖）。
// WAL + 外键 + busy_timeout；withTransaction 提供 BEGIN/COMMIT/ROLLBACK。
// ============================================================================
'use strict';

const { DatabaseSync } = require('node:sqlite');

/**
 * 打开 SQLite 连接。
 * @param {Object} [opts]
 * @param {string} [opts.path] 数据库文件路径；默认 ':memory:'（测试用）
 * @returns {import('node:sqlite').DatabaseSync}
 */
function openDb({ path = ':memory:' } = {}) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/**
 * 在事务中执行 fn；抛错则回滚。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Function} fn () => T
 * @returns {T}
 */
function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, withTransaction };
