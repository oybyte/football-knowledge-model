// ============================================================================
// 回测层 · v97_real —— 真实回测（V9.7 真规则 × DB 历史真实场次）
//
// 定位：替代「假数据门禁」的第一步——在真实历史盘赔 + 真实赛果上，
// 给出每规则的【可求值覆盖 + 命中事件台账】，供分析师核验后作转正前置。
//
// 口径（诚实，绝不虚报命中率）：
//   · 覆盖统计 = 规则在 161 场历史上的 hit / miss / insufficient_data 分布；
//   · 事件台账   = 每次 hit 的场次（含 赛果 actual_result / 总进球 total_goals），
//     供人工核验——多数规则 effects 不含「方向结论」，正确性不能自动判定；
//   · S25 探针   = 仅当规则 effects 自带结果倾向语义（如 S25「略看小球/大球」）时，
//     对照总进球 vs 大小球盘口中线给出倾向命中统计（语义来自规则正文，方法留痕）。
// ============================================================================
'use strict';

const { adaptMatch } = require('../features/adapt');
const { runRule } = require('../engine/v97/run');
const { collectOverUnderRows, pickAnyReference } = require('../engine/v97/fields');
const { parseDepth } = require('../engine/v97/handicap');

/** 规则 effects 中携带的结果倾向 → (维度, lean)。lean: 'over'|'under'|null。 */
function probeRule(ruleId) {
  // S25 系列：total_goals_signal「赔付放开=略看小球 / …大球」→ under/over
  if (ruleId === 'S25') {
    return (dims) => {
      const vals = (dims.total_goals_signal || []).join('、');
      if (/小球/.test(vals)) return { lean: 'under', note: 'effects 含「小球」语义' };
      if (/大球/.test(vals)) return { lean: 'over', note: 'effects 含「大球」语义' };
      return { lean: null, note: '无明确大小球倾向' };
    };
  }
  return null; // 其余规则：effects 无自动可判方向，仅台账
}

/** 参考机构大小球盘中线。 */
function ouLineMid(markets) {
  const rows = collectOverUnderRows(markets);
  if (!rows.length) return null;
  const ref = pickAnyReference(rows, 'over_odds');
  return ref ? parseDepth(ref.line).depth : null;
}

/**
 * 真实回测：单规则 × 历史场次。
 * @param {Object} rule RuleVersion（含 v97）或 registry 原始规则
 * @param {Array<Object>} matches DB 历史 MatchSchema（带 actual_result / meta.total_goals）
 * @returns {Object}
 */
function backtestRule(rule, matches) {
  const id = rule.rule_id || rule.id;
  const probe = probeRule(id);
  const tally = { hit: 0, miss: 0, insuff: 0 };
  const ledger = [];       // hit 事件台账
  const probeEvents = [];  // 可自动判向的事件（仅探针规则）

  for (const m of matches) {
    const t = m.match_time;
    if (!t) continue;
    const { markets } = adaptMatch(m, t);
    const res = runRule(rule, { markets, match: m, t });
    tally[res.status === 'insufficient_data' ? 'insuff' : res.status]++;
    if (res.status !== 'hit') continue;

    const entry = {
      match_id: m.match_id,
      league: m.league,
      home_team: m.home_team,
      away_team: m.away_team,
      match_time: m.match_time,
      actual_result: m.actual_result || null,
      total_goals: m.meta && m.meta.total_goals != null ? m.meta.total_goals : null,
      dimensions: res.dimensions,
      effects: res.effects,
    };
    ledger.push(entry);

    if (probe) {
      const p = probe(res.dimensions);
      const line = ouLineMid(markets);
      if (p.lean && entry.total_goals != null && line != null) {
        const ok = p.lean === 'over' ? entry.total_goals > line
          : entry.total_goals < line;
        probeEvents.push({ ...entry, lean: p.lean, line_mid: line, probe_hit: ok });
      }
    }
  }

  const out = { rule_id: id, tally, ledger_count: ledger.length, ledger: ledger.slice(0, 50) };
  if (probe && probeEvents.length) {
    const hits = probeEvents.filter((e) => e.probe_hit).length;
    out.probe = {
      total: probeEvents.length,
      hits,
      hit_rate: +(hits / probeEvents.length).toFixed(4),
      push_count: probeEvents.filter((e) => e.total_goals === e.line_mid).length,
      note: 'S25 结果倾向对照实际总进球 vs 大小球盘口中线（探针口径，非正式命中率）',
      events: probeEvents.slice(0, 30),
    };
  }
  return out;
}

/**
 * 批量真实回测：全部可求值规则 × 历史场次。
 * @param {Array<Object>} rules
 * @param {Array<Object>} matches
 */
function backtestRules(rules, matches) {
  const results = [];
  for (const rule of rules) {
    const r = backtestRule(rule, matches);
    // 只保留「有求值价值」的规则（hit+miss>0）
    if (r.tally.hit + r.tally.miss > 0) results.push(r);
  }
  return results.sort((a, b) => (b.tally.hit + b.tally.miss) - (a.tally.hit + a.tally.miss));
}

module.exports = { backtestRule, backtestRules, probeRule, ouLineMid };
