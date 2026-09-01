// ============================================================================
// V9.7 引擎 · evaluate —— atom 求值（落实「禁止静默跳过」）
//
// 三态结果（不是布尔）：
//   hit                条件成立 → 应用 effects
//   miss               条件不成立 → 规则不适用（这是真实结论，不是缺失）
//   insufficient_data  字段缺失或算子未实现 → **无结论**
//
// 决策 (c) 的核心就在这里：字段缺失时返回 insufficient_data 而非 miss。
// 若返回 miss，规则会「看起来没命中」，等于用数据缺失伪装成规则未触发，
// 这正是 V9.7 input_contract 明令禁止的行为。
// ============================================================================
'use strict';

const { getField } = require('./fields');
const { isUsable } = require('./envelope');
const { evaluate: evalOp, UNKNOWN } = require('./ops');

const STATUS = Object.freeze({ HIT: 'hit', MISS: 'miss', INSUFFICIENT: 'insufficient_data' });

/**
 * 求单个 atom。
 * @param {Object} atom V9.7 atom 对象
 * @param {{markets:Object, match?:Object, t?:string}} ctx
 * @returns {{atom_id:string, action:string, status:string, effects:Array,
 *            missing:Array, unknown:Array, details:Array}}
 */
function evaluateAtom(atom, ctx) {
  const allOf = atom.all_of || [];
  const noneOf = atom.none_of || [];
  const required = atom.required_inputs || [];

  const details = [];
  const missing = [];
  const unknown = [];

  // ① required_inputs 缺失检查：声明了但取不到值 → 直接无结论
  for (const f of required) {
    const env = getField(f, ctx);
    if (!isUsable(env)) missing.push(f);
  }

  // ② all_of：全部成立才算成立
  let allOk = true;
  for (const c of allOf) {
    const env = getField(c.field, ctx);
    if (!isUsable(env)) {
      missing.push(c.field);
      details.push({ field: c.field, op: c.op, expected: c.value, actual: null, result: 'insufficient_data' });
      continue;
    }
    const r = evalOp(c.op, env.value, c.value);
    details.push({ field: c.field, op: c.op, expected: c.value, actual: env.value, result: r === UNKNOWN ? 'unknown' : r });
    if (r === UNKNOWN) unknown.push(c);
    else if (r !== true) allOk = false;
  }

  // ③ none_of：任一成立即否决
  let noneTriggered = false;
  for (const c of noneOf) {
    const env = getField(c.field, ctx);
    if (!isUsable(env)) {
      missing.push(c.field);
      details.push({ field: c.field, op: c.op, expected: c.value, actual: null, result: 'insufficient_data' });
      continue;
    }
    const r = evalOp(c.op, env.value, c.value);
    details.push({ field: c.field, op: c.op, expected: c.value, actual: env.value, result: r === UNKNOWN ? 'unknown' : r });
    if (r === UNKNOWN) unknown.push(c);
    else if (r === true) noneTriggered = true;
  }

  // ④ 判定：缺失/未知优先于命中（绝不静默降级为 miss）
  const hasNoCondition = allOf.length === 0 && noneOf.length === 0;
  let status;
  if (missing.length || unknown.length || hasNoCondition) status = STATUS.INSUFFICIENT;
  else status = allOk && !noneTriggered ? STATUS.HIT : STATUS.MISS;

  return {
    atom_id: atom.atom_id || null,
    action: atom.action || null,
    status,
    effects: status === STATUS.HIT ? (atom.effects || []) : [],
    missing: [...new Set(missing)],
    unknown: unknown.map((c) => `${c.field} ${c.op} ${JSON.stringify(c.value)}`),
    details,
  };
}

module.exports = { evaluateAtom, STATUS };
