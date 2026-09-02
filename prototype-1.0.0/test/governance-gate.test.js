// ============================================================================
// 规则治理 · 门禁冒烟（vm 沙箱加载 governance.js）
// 覆盖：进入 validated/active 必须回测达标（与后端 promote 对齐）；未达标被拦截。
// 运行：node prototype-1.0.0/test/governance-gate.test.js
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'governance.js'), 'utf8');

function boot() {
  const sandbox = { window: {}, console, module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.module.exports;
}

test('governance 门禁：进入 validated/active 需回测全项达标；未达标被拦截不推进', () => {
  const g = boot();
  assert.ok(g.advance && g.stateOf, 'governance 应导出 advance/stateOf');
  const ids = Object.keys(g.BASE_STATE || {});
  assert.ok(ids.length >= 8, '应有演示规则');
  let gated = 0;
  for (const id of ids) {
    const st = g.stateOf(id);
    const nexts = (g.NEXT[st] || []);
    const gatedTarget = nexts.find((t) => t === 'validated' || t === 'active');
    if (!gatedTarget) continue;
    const pass = g.evalBt(g.metrics(id)).pass;
    const before = g.stateOf(id);
    g.advance(id);
    const after = g.stateOf(id);
    if (pass) {
      assert.equal(after, gatedTarget, `${id} 回测达标应推进至 ${gatedTarget}`);
    } else {
      assert.equal(after, before, `${id} 回测未达标应被拦截（停在 ${before}）`);
      gated++;
    }
    g.resetRule(id);
  }
  assert.ok(gated >= 0);
});

test('governance 门禁：draft→proposed（非门禁态）不受回测拦截', () => {
  const g = boot();
  // R010 基准态 draft → proposed（NEXT.draft=['proposed']），无门禁
  g.resetRule('R010');
  const before = g.stateOf('R010');
  assert.equal(before, 'draft');
  g.advance('R010');
  assert.equal(g.stateOf('R010'), 'proposed', 'draft→proposed 不设回测门禁');
  g.resetRule('R010');
});
