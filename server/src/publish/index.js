// ============================================================================
// 预测发布/结果回填 · 入口 —— 整合 schema/store/idempotency/audit/evidence/backfill/publisher
// ============================================================================
'use strict';

const { PredictionStore } = require('./store');
const { IdempotencyGuard } = require('./idempotency');
const { AuditLog } = require('./audit');
const { lockEvidence } = require('./evidence');
const { backfillResult } = require('./backfill');
const { PredictionPublisher } = require('./publisher');
const schema = require('./schema');

module.exports = {
  PredictionPublisher,
  PredictionStore,
  IdempotencyGuard,
  AuditLog,
  lockEvidence,
  backfillResult,
  ...schema,
};