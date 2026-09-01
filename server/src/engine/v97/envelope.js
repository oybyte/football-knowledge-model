// ============================================================================
// V9.7 引擎 · envelope —— 字段信封（缺值语义的地基）
//
// V9.7 input_contract 硬性要求：缺值「对应原子标 insufficient_data，禁止静默跳过」。
// 因此字段一律不返回裸值，而是带 status 的信封：
//   ok                 有值，可直接参与求值
//   estimated          估算值（来源/方法/时点已记录），可参与求值但需留痕
//   insufficient_data  无值 → 依赖它的 atom 必须标 insufficient_data，不得当成「条件不满足」
//
// 关键区别：insufficient_data ≠ false。
//   当成 false → 规则静默不命中（V9.7 明令禁止，等于用缺失伪装成"没触发"）；
//   正确行为 → atom 无结论，规则整体不出 verdict。
// ============================================================================
'use strict';

const STATUS = Object.freeze({
  OK: 'ok',
  ESTIMATED: 'estimated',
  INSUFFICIENT: 'insufficient_data',
});

/**
 * 有值信封。
 * @param {*} value
 * @param {{source?:string, method?:string, computed_at?:string}} [meta]
 */
function ok(value, meta = {}) {
  return {
    value,
    status: STATUS.OK,
    source: meta.source || null,
    method: meta.method || null,
    computed_at: meta.computed_at || new Date().toISOString(),
  };
}

/**
 * 估算值信封（可参与求值，但必须记录来源与方法，供台账追溯）。
 * @param {*} value
 * @param {{source:string, method:string, note?:string}} meta
 */
function estimated(value, meta = {}) {
  return {
    value,
    status: STATUS.ESTIMATED,
    source: meta.source || null,
    method: meta.method || null,
    note: meta.note || null,
    computed_at: new Date().toISOString(),
  };
}

/**
 * 缺值信封。**注意：不是 false。**
 * @param {string} reason 人类可读的缺失原因（进审计/台账）
 * @param {{field?:string, source?:string}} [meta]
 */
function insufficient(reason, meta = {}) {
  return {
    value: null,
    status: STATUS.INSUFFICIENT,
    reason,
    field: meta.field || null,
    source: meta.source || null,
    computed_at: new Date().toISOString(),
  };
}

/** 信封是否可参与求值（ok 与 estimated 均可；insufficient 不可）。 */
function isUsable(env) {
  return !!env && env.status !== STATUS.INSUFFICIENT;
}

module.exports = { STATUS, ok, estimated, insufficient, isUsable };
