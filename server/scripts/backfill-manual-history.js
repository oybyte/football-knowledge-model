// ============================================================================
// 一次性 / 运维回填脚本 —— 把磁盘人工盘赔落库为整场版本
// 用法：node server/scripts/backfill-manual-history.js
// 说明：启动期已自动 reconcile；本脚本用于「DB 重置后补灌 / 手动重扫 / CI 校验」。
// 幂等：相同内容 INSERT OR IGNORE 跳过；内容变化产生新版本并标记旧版本 superseded。
// ============================================================================
'use strict';

const path = require('node:path');
const { createDb } = require('../src/db');
const { reconcileManualOddsToDb } = require('../src/db/g12/manualReconcile');
const { defaultLogger } = require('../src/lib/logger');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'odds-edge.db');

function main() {
  const dbPath = process.env.OE_DB_PATH || DEFAULT_DB_PATH;
  const logger = defaultLogger;
  logger.info('backfill_manual_start', { dbPath });

  // createDb 会先跑全部迁移（含 002_manual_odds_history.sql），再装配 store。
  const persistence = createDb({ path: dbPath, logger });
  try {
    const rec = reconcileManualOddsToDb({
      db: persistence.db, qd: persistence.qd, env: process.env,
      actor: { id: 'backfill:script', role: 'ingest' },
      year: new Date().getFullYear(), logger,
    });
    logger.info('backfill_manual_done', rec);
    const total = persistence.qd.qd_hist_match_version.count();
    const active = persistence.qd.qd_hist_match_version.all().filter((r) => r.status_flag === 'active' && !r.superseded_by).length;
    const snaps = persistence.qd.qd_hist_match_snapshot.count();
    console.log('回填完成：', JSON.stringify({ ...rec, db_versions_total: total, db_versions_active: active, db_snapshots: snaps }, null, 2));
    process.exitCode = rec.ok ? 0 : 1;
  } catch (e) {
    logger.error('backfill_manual_failed', { error: e.message, stack: e.stack });
    console.error('回填失败：', e.message);
    process.exitCode = 1;
  } finally {
    persistence.close();
  }
}

main();
