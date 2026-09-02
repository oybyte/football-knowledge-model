// ============================================================================
// 规则存储服务 · stateMachine —— 状态转换 + 前置条件 + 审计写入
// 对齐 G12 §3.6 callout：状态转换 = INSERT 新版本（version+1），旧版本不变。
// 非法转换抛 IllegalTransitionError，前置条件不满足抛 PreconditionError。
// ============================================================================
'use strict';

const {
  isLegalTransition,
  checkPrecondition,
  validateRuleVersion,
  RULE_STATUSES,
} = require('./schema');
const { recordAudit } = require('../vault/audit');
const { defaultLogger } = require('../lib/logger');

class IllegalTransitionError extends Error {
  constructor(from, to) {
    super(`illegal_transition: ${from} → ${to}`);
    this.code = 'ILLEGAL_TRANSITION';
    this.from = from;
    this.to = to;
  }
}

class PreconditionError extends Error {
  constructor(reason) {
    super(`precondition_failed: ${reason}`);
    this.code = 'PRECONDITION';
    this.reason = reason;
  }
}

/**
 * 状态转换器。
 */
class StateMachine {
  constructor({ store, lockManager, logger = defaultLogger } = {}) {
    this.store = store;
    this.lockManager = lockManager;
    this.logger = logger;
  }

  /**
   * 执行状态转换。
   * @param {string} ruleId
   * @param {string} toStatus
   * @param {Object} options
   * @param {string} options.actor 操作者
   * @param {string} [options.note] 备注
   * @param {Object} [options.overrides] 覆盖字段（如 approved_by, valid_from）
   * @param {string} [options.successorId] 后继版本 ID（supersede 用）
   * @returns {{ ok: boolean, version?: Object, errors: string[] }}
   */
  transition(ruleId, toStatus, { actor, note, overrides = {}, successorId } = {}) {
    if (!RULE_STATUSES.includes(toStatus)) {
      return { ok: false, errors: ['invalid_status'] };
    }

    const versions = this.store.getByRuleId(ruleId);
    if (!versions.length) {
      return { ok: false, errors: ['rule_not_found'] };
    }
    const current = versions[0]; // 最高版本

    if (current.status === toStatus) {
      return { ok: false, errors: ['already_in_status'] };
    }

    if (!isLegalTransition(current.status, toStatus)) {
      this.logger.warn('illegal_transition_attempted', { rule_id: ruleId, from: current.status, to: toStatus, actor });
      recordAudit({
        event_type: 'rule_status_transition_rejected',
        actor,
        target_id: current.version_id,
        details: { rule_id: ruleId, from: current.status, to: toStatus, reason: 'illegal' },
      });
      return { ok: false, errors: [`illegal_transition:${current.status}→${toStatus}`] };
    }

    const preCtx = { ...current, ...overrides, successor_version_id: successorId };
    const pre = checkPrecondition(preCtx, toStatus);
    if (!pre.ok) {
      this.logger.warn('precondition_failed', { rule_id: ruleId, reason: pre.reason, actor });
      recordAudit({
        event_type: 'rule_status_transition_rejected',
        actor,
        target_id: current.version_id,
        details: { rule_id: ruleId, from: current.status, to: toStatus, reason: pre.reason },
      });
      return { ok: false, errors: [`precondition:${pre.reason}`] };
    }

    // 并发锁
    const lockHolder = `sm:${actor}:${Date.now()}`;
    const release = this.lockManager.acquire(ruleId, lockHolder);
    if (!release) {
      return { ok: false, errors: ['lock_busy'] };
    }

    try {
      const newVersionId = `${ruleId}#${current.version + 1}`;
      const now = new Date().toISOString();

      const newVersion = {
        ...current,
        version_id: newVersionId,
        version: current.version + 1,
        status: toStatus,
        previous_version_id: current.version_id,
        ...overrides,
      };

      // 终态/审批时间戳
      if (toStatus === 'approved') {
        newVersion.approved_at = now;
        if (!newVersion.approved_by) newVersion.approved_by = actor;
      }
      if (toStatus === 'superseded') newVersion.superseded_at = now;
      if (toStatus === 'deprecated') newVersion.deprecated_at = now;

      // 审计字段不被覆盖
      delete newVersion.successor_version_id;

      const { ok, errors } = this.store.insert(newVersion);
      if (!ok) {
        this.logger.error('rule_insert_failed', { version_id: newVersionId, errors });
        return { ok: false, errors };
      }

      recordAudit({
        event_type: 'rule_status_transitioned',
        actor,
        target_id: newVersionId,
        details: {
          rule_id: ruleId,
          version_id: newVersionId,
          from_status: current.status,
          to_status: toStatus,
          note: note || null,
        },
      });

      this.logger.info('rule_transitioned', {
        rule_id: ruleId,
        from: current.status,
        to: toStatus,
        version: newVersion.version,
        actor,
      });

      return { ok: true, version: newVersion, errors: [] };
    } finally {
      release();
    }
  }
}

module.exports = { StateMachine, IllegalTransitionError, PreconditionError };
