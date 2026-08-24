// ============================================================================
// 检索 Worker · 入口 —— 整合 retrieval / conflict / arbitrate / worker
// 对外暴露 RetrievalWorker + 冲突/仲裁工具。
// ============================================================================
'use strict';

const { retrieveHits } = require('./retrieval');
const { CONFLICT_DIRECTIONS, detectConflicts, isConflicting } = require('./conflict');
const { arbitrate, computeScore, REVIEW_DIFF } = require('./arbitrate');
const { RetrievalWorker } = require('./worker');

module.exports = {
  RetrievalWorker,
  retrieveHits,
  detectConflicts,
  isConflicting,
  CONFLICT_DIRECTIONS,
  arbitrate,
  computeScore,
  REVIEW_DIFF,
};