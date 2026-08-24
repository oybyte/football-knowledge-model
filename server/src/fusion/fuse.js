// ============================================================================
// 融合决策层 · 融合算法 —— 隔离 + 动态权重 + 方向仲裁 + 置信度合成
// 仅 trusted 且通过 gateCheck 的路参与合成；untrusted 路记录 excluded。
// 规则置信度经 ConfidenceProvider（G19）优先 backtest、fallback base。
// ============================================================================
'use strict';

const { resolveTrust, gateCheck } = require('./containment');
const { computeBasisWeights, STREAMS } = require('./weights');

const STREAMS_SET = new Set(STREAMS);
const ORIENTED = ['favor_upper', 'favor_lower'];

/**
 * 融合三路合成（产出中间结果，决策冻结在 decision.js）。
 * @param {Object} p
 * @param {Object|null} p.rule_output DSL RuleMatch（真实）
 * @param {Object|null} p.model_output 统计模型（骨架版 placeholder）
 * @param {Object|null} p.anomaly_output 异常检测（骨架版 placeholder）
 * @param {Object} [p.context]
 * @param {import('./confidence').ConfidenceProvider} [p.context.provider] G19 置信度
 * @returns {Object} fuseresult（含 active / weights / excluded / chain / final_*）
 */
function fuse({ rule_output = null, model_output = null, anomaly_output = null, context = {} } = {}) {
  const inputs = {
    rule: rule_output,
    model: model_output,
    anomaly: anomaly_output,
  };

  // 1) 解析信任 2) G19 置信度（rule 流）
  const resolved = {};
  for (const s of STREAMS) {
    const raw = inputs[s];
    const trust = resolveTrust(s, raw);
    let confidence = raw && typeof raw.confidence === 'number' ? raw.confidence : null;
    if (s === 'rule' && raw && context.provider) {
      const r = context.provider.resolve({
        rule_version_id: raw.version_id || context.rule_version_id,
        fallback: raw.confidence ?? context.rule_base_confidence ?? 0.5,
      });
      confidence = r.confidence;
    }
    const direction = raw ? raw.direction : null;
    const gated = gateCheck({ direction, confidence });
    resolved[s] = {
      raw,
      trust,
      direction,
      confidence,
      gated,
    };
  }

  // 3) 标称权重 + 有效权重（untrusted/未过 gate 归零）
  const basis = computeBasisWeights({
    rule_output,
    model_output,
    anomaly_output,
  });
  const effectiveRaw = {};
  const activeStreams = [];
  for (const s of STREAMS) {
    const r = resolved[s];
    const active = r.trust === 'trusted' && r.gated.allowed && r.confidence !== null;
    effectiveRaw[s] = active ? basis[s] : 0;
    if (active) activeStreams.push(s);
  }
  const effSum = activeStreams.reduce((a, s) => a + effectiveRaw[s], 0);
  const effective = {};
  for (const s of STREAMS) effective[s] = effSum > 0 ? effectiveRaw[s] / effSum : 0;

  // 4) 方向仲裁（仅对参与合成的方向计分）
  const scores = { favor_upper: 0, favor_lower: 0 };
  for (const s of activeStreams) {
    const r = resolved[s];
    if (r.direction !== null && ORIENTED.includes(r.direction)) {
      scores[r.direction] += effective[s] * r.confidence;
    }
  }
  const hasOriented = activeStreams.some(
    (s) => ORIENTED.includes(resolved[s].direction),
  );
  let final_direction = null;
  if (hasOriented) {
    let winnerScore = -Infinity;
    for (const d of ORIENTED) {
      if (scores[d] > winnerScore + 1e-9) {
        winnerScore = scores[d];
        final_direction = d;
      }
    }
  }

  // 5) 置信度合成
  let final_confidence = 0;
  if (activeStreams.length && effSum > 0) {
    let num = 0;
    for (const s of activeStreams) num += effective[s] * resolved[s].confidence;
    final_confidence = Math.min(1, Math.max(0, num));
  }

  // 6) 推理链 + excluded
  const excluded = STREAMS.filter(
    (s) => (inputs[s] != null) && (resolved[s].trust !== 'trusted' || !resolved[s].gated.allowed),
  );
  const chain = STREAMS.map((s, idx) => {
    const r = resolved[s];
    const included = activeStreams.includes(s);
    return {
      step: idx + 1,
      source: r.raw && s === 'rule' && r.raw.version_id ? `rule:${r.raw.version_id}` : s,
      direction: r.raw ? r.direction : null,
      confidence: r.raw ? r.confidence : null,
      weight: r.raw ? Math.round(effective[s] * 1e6) / 1e6 : 0,
      trust: r.trust,
      included,
    };
  });

  final_confidence = Math.round(final_confidence * 1e3) / 1e3;

  return {
    streams: resolved,
    activeStreams,
    basis,
    weights: effective,
    excluded,
    chain,
    final_direction,
    final_confidence,
  };
}

module.exports = { fuse };