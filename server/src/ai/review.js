// ============================================================================
// AI 引擎 · review —— 候选边框条转正（人工审核）
// 流程：AI 候选（untrusted，隔离区）→ 人工审核通过 → 构建 RuleVersion(draft)
//       → stateMachine.transition → proposed（进入生命周期，暂不生效）。
// 约束：仅接受仍带 __ai_boundary 的候选；审核后的规则 trust_level 仍为
//       untrusted，须经 2.2 回测验证后方可提升为 provisional/trusted。
// ============================================================================
'use strict';

const { validateCandidate, toCondition } = require('./schema');
const { isUntrusted } = require('./containment');
const { Logger } = require('../lib/logger');

const logger = new Logger({ service: 'ai-engine' });

/** 依据候选方向与结论文本生成 RuleVersion.conclusion。 */
function buildConclusion(candidate) {
  if (candidate && typeof candidate.conclusion === 'string' && candidate.conclusion) return candidate.conclusion;
  if (candidate && typeof candidate.rationale === 'string' && candidate.rationale) return candidate.rationale;
  const dir = candidate && candidate.direction ? candidate.direction : 'warning';
  const map = {
    favor_upper: 'AI挖掘候选：条件成立倾向上盘',
    favor_lower: 'AI挖掘候选：条件成立倾向下盘',
    follow: 'AI挖掘候选：跟随市场共识方向',
    warning: 'AI挖掘候选：条件成立提示风险',
  };
  return map[dir] || map.warning;
}

/**
 * 审核转正：候选 → insert(draft) → transition(proposed)。
 * @param {Object} options
 * @param {Object} candidate stomped AI 候选（trust=untrusted, __ai_boundary=true）
 * @param {import('../rules').StateMachine} options.stateMachine
 * @param {import('../rules').RuleStore} options.store
 * @param {string} [options.ruleId] 覆盖规则号（默认候选 id）
 * @param {string} options.actor 审核人
 * @param {string} [options.note]
 * @returns {Promise<{ ok:boolean, version?:Object, errors:string[] }>}
 */
async function escalateToProposed({ candidate, stateMachine, store, ruleId = null, actor, note = null } = {}) {
  if (!isUntrusted(candidate)) return { ok: false, errors: ['candidate_not_untrusted'] };
  if (!actor) return { ok: false, errors: ['actor_required'] };

  const validated = validateCandidate(candidate);
  if (!validated.ok) return { ok: false, errors: ['candidate_invalid_dsl', ...validated.errors] };

  const rid = ruleId || candidate.id;
  const stale = store.getByRuleId(rid);
  if (stale.length) return { ok: false, errors: [`rule_id_conflict:${rid}`] };

  const now = new Date().toISOString().slice(0, 19) + '+08:00';
  const version = {
    version_id: `${rid}#1`,
    rule_id: rid,
    version: 1,
    category: candidate.category || 'league_feature',
    league_scope: [],
    team_scope: [],
    condition: toCondition(candidate),
    conclusion: buildConclusion(candidate),
    direction: candidate.direction,
    base_confidence: Number.isFinite(candidate.confidence) ? Math.min(Math.max(candidate.confidence, 0), 1) : 0.5,
    priority: Number.isInteger(candidate.priority) ? candidate.priority : 50,
    trust_level: 'untrusted',
    valid_from: now,
    valid_to: null,
    evidence_refs: [],
    evidence_count: 0,
    status: 'draft',
    previous_version_id: null,
    created_at: now,
    created_by: `review:${actor}`,
    approved_at: null,
    approved_by: null,
    approval_note: note,
    superseded_at: null,
    deprecated_at: null,
    source: 'ai_mining',
  };

  const ins = store.insert(version);
  if (!ins.ok) return { ok: false, errors: ins.errors };

  const tr = stateMachine.transition(rid, 'proposed', {
    actor,
    note: note || `ai 候选审核转正:${candidate.id}`,
  });
  if (!tr.ok) {
    logger.warn('ai_review_transition_failed', { rule_id: rid, errors: tr.errors });
    return { ok: false, errors: tr.errors };
  }

  logger.info('ai_review_escalated', { rule_id: rid, actor, to: 'proposed' });
  return { ok: true, version: tr.version, errors: [] };
}

module.exports = { escalateToProposed, buildConclusion };