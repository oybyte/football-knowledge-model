// ============================================================================
// 人工盘赔「数据目录绑定」（004 可变配置）· HTTP 端到端验收
// 覆盖：统一目录 / 场次目录 双层模型；单场目录与上层根目录自动识别；
//       设置 → 立即重扫落库；换源刷新（新版本 supersede 旧版本）；移除；
//       错误路径（目录不存在 / 无 md / 缺绑定键 / 非法官方 id）；append-only 审计。
// 隔离：:memory: DB + 随机端口 + 临时目录，不绑定真实端口、不污染真实数据。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createService } = require('../src/index');
const { createHttpServer } = require('../src/http');
const { loadManualOddsFromDb } = require('../src/db/g12/manual_reconcile');

const MD_NAME = '盘口数据.md';

/** 构造一份最小合法 md。`extra` 用于制造内容差异（触发新版本）。 */
function mdText({ teams = '亚特兰大 vs 威尼斯', extra = '' } = {}) {
  return `# 盘口截图数据

## 比赛基础信息

- 赛事：意甲
- 比赛：${teams}
- 开赛时间：12-31 20:00
- 体彩期号：261231-002
- 数据来源：盘口截图提取

## 让球盘数据

（主水 / 盘口 / 客水）
| 机构 | 初盘 | 即盘 |
|---|---|---|
| 澳* | 0.94 / 0 / 0.84 | 0.82 / 0 / 0.96 |
${extra}`;
}

/** 建一个「单场目录」（目录自身含 盘口数据.md）。 */
function makeSingleMatchDir(root, name, opts) {
  const d = path.join(root, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, MD_NAME), mdText(opts), 'utf8');
  return d;
}

/** 建一个「上层根目录」（子目录各含 盘口数据.md）。 */
function makeRootDir(root, name, subNames) {
  const d = path.join(root, name);
  fs.mkdirSync(d, { recursive: true });
  for (const s of subNames) makeSingleMatchDir(d, s, { teams: `${s}甲 vs ${s}乙` });
  return d;
}

function request(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: p,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* 非 JSON */ }
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function withServer(fn) {
  const svc = await createService({ dbPath: ':memory:' });
  const server = createHttpServer(svc);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    await fn(port, svc);
  } finally {
    await new Promise((r) => server.close(r));
    svc.close();
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oe-dirs-'));

// 隔离宿主 .env：清掉 env 兜底根，确保「DB 绑定」是唯一根来源（否则会去扫真实盘赔目录）。
const ENV_ROOT_SAVED = process.env.OE_MANUAL_ODDS_ROOT;
delete process.env.OE_MANUAL_ODDS_ROOT;

// ───────────────────────── ① 初始态 ─────────────────────────
test('① 未配置任何绑定 → unified.dir_path 为 null、matches 为空（诚实空态）', async () => {
  await withServer(async (port) => {
    const r = await request(port, 'GET', '/api/sources/manual-odds/dirs');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.unified.dir_path, null);
    assert.equal(r.body.data.unified.origin, null);
    assert.deepEqual(r.body.data.matches, []);
  });
});

// ───────────────────────── ② 错误路径（诚实失败，绝不静默） ─────────────────────────
test('② 设置目录的错误路径 → 400 且给出明确 error 码', async () => {
  await withServer(async (port) => {
    const bad = await request(port, 'POST', '/api/sources/manual-odds/dirs',
      { scope: 'unified', dir_path: path.join(tmpRoot, '__no_such_dir__') });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'dir_not_found');

    const emptyDir = path.join(tmpRoot, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const noMd = await request(port, 'POST', '/api/sources/manual-odds/dirs', { scope: 'unified', dir_path: emptyDir });
    assert.equal(noMd.status, 400);
    assert.equal(noMd.body.error, 'no_md_found');

    const noScope = await request(port, 'POST', '/api/sources/manual-odds/dirs', { dir_path: emptyDir });
    assert.equal(noScope.status, 400);
    assert.equal(noScope.body.error, 'invalid_scope');

    const dir = makeSingleMatchDir(tmpRoot, 'err-match');
    const noKey = await request(port, 'POST', '/api/sources/manual-odds/dirs',
      { scope: 'match', dir_path: dir, match_key_kind: 'official' });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.error, 'bind_key_required');

    const badKind = await request(port, 'POST', '/api/sources/manual-odds/dirs',
      { scope: 'match', dir_path: dir, match_key: '2041922', match_key_kind: 'whatever' });
    assert.equal(badKind.status, 400);
    assert.equal(badKind.body.error, 'invalid_match_key_kind');

    const badId = await request(port, 'POST', '/api/sources/manual-odds/dirs',
      { scope: 'match', dir_path: dir, match_key: '亚特兰大', match_key_kind: 'official' });
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error, 'invalid_official_match_id');
  });
});

// ───────────────────────── ③ 统一目录 ─────────────────────────
test('③ 设置统一目录 → origin=db，且该目录下全部场次入库', async () => {
  await withServer(async (port, svc) => {
    const rootDir = makeRootDir(tmpRoot, 'unified-root', ['m1', 'm2']);
    const r = await request(port, 'POST', '/api/sources/manual-odds/dirs', { scope: 'unified', dir_path: rootDir });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.created, true);
    assert.equal(r.body.data.binding_id, 'unified');
    assert.equal(r.body.data.scan.imported, 2, '上层根目录下 2 场应全部导入');

    const list = await request(port, 'GET', '/api/sources/manual-odds/dirs');
    assert.equal(list.body.data.unified.origin, 'db');
    assert.equal(list.body.data.unified.dir_path, rootDir);
    assert.equal(list.body.data.unified.last_result.admitted, 2, 'last_result 记录本次扫描结果');

    const manual = loadManualOddsFromDb(svc.qd);
    assert.equal(manual.matches.length, 2);
    // 来源可溯：每场都带 binding_scope=unified
    for (const m of manual.matches) assert.equal(m.meta.binding_scope, 'unified');
  });
});

// ───────────────────────── ④ 场次目录（单场目录自动识别） ─────────────────────────
test('④ 场次目录绑定单场目录 → 该场入库；重复设置同一绑定为 upsert（不新增行）', async () => {
  await withServer(async (port, svc) => {
    const dir = makeSingleMatchDir(tmpRoot, 'single-match');
    const r1 = await request(port, 'POST', '/api/sources/manual-odds/dirs',
      { scope: 'match', dir_path: dir, match_key: '2041922', match_key_kind: 'official', label: '亚特兰大场' });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.data.created, true);
    assert.equal(r1.body.data.scan.imported, 1);
    assert.match(r1.body.data.binding_id, /^mod_[0-9a-f]{12}$/);

    // 同 (scope, match_key) 再设一次 → 同一绑定行，created=false
    const r2 = await request(port, 'POST', '/api/sources/manual-odds/dirs',
      { scope: 'match', dir_path: dir, match_key: '2041922', match_key_kind: 'official' });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.data.created, false);
    assert.equal(r2.body.data.binding_id, r1.body.data.binding_id);

    const list = await request(port, 'GET', '/api/sources/manual-odds/dirs');
    assert.equal(list.body.data.matches.length, 1, 'upsert 不应产生第二行');
    assert.equal(list.body.data.matches[0].label, null, '第二次未传 label → 覆盖为 null');
    assert.equal(loadManualOddsFromDb(svc.qd).matches.length, 1);
  });
});

// ───────────────────────── ⑤ 换源刷新：新版本 supersede 旧版本 ─────────────────────────
test('⑤ 对已有场次重新指定目录 → 内容变化产生新版本并 supersede 旧版本', async () => {
  await withServer(async (port, svc) => {
    const dirA = makeSingleMatchDir(tmpRoot, 'refresh-a');
    await request(port, 'POST', '/api/sources/manual-odds/dirs',
      { scope: 'match', dir_path: dirA, match_key: '2041922', match_key_kind: 'official' });
    const v1 = svc.qd.qd_hist_match_version.all().filter((r) => r.status_flag === 'active');
    assert.equal(v1.length, 1);
    const hash1 = v1[0].content_hash;

    // 换到另一个目录：内容不同 → 新版本 + 旧版本被 supersede
    const dirB = makeSingleMatchDir(tmpRoot, 'refresh-b', { extra: '<!-- 追加：换源刷新 -->' });
    const r = await request(port, 'POST', '/api/sources/manual-odds/dirs',
      { scope: 'match', dir_path: dirB, match_key: '2041922', match_key_kind: 'official' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.scan.imported, 1, '新内容 → 导入新版本');
    assert.equal(r.body.data.scan.superseded, 1, '上一代被 supersede');

    const rows = svc.qd.qd_hist_match_version.all();
    assert.equal(rows.length, 2, 'append-only：旧版本保留，不删除');
    const active = rows.filter((x) => x.status_flag === 'active' && !x.superseded_by);
    assert.equal(active.length, 1, '同一时刻仅一个 active 版本');
    assert.notEqual(active[0].content_hash, hash1);
    // 读侧只返回当前生效版本
    assert.equal(loadManualOddsFromDb(svc.qd).matches.length, 1);
  });
});

// ───────────────────────── ⑥ 移除绑定 ─────────────────────────
test('⑥ 移除绑定 → 绑定消失且列表不再包含它；不存在的绑定返回 404', async () => {
  await withServer(async (port) => {
    const dir = makeSingleMatchDir(tmpRoot, 'to-remove');
    const set = await request(port, 'POST', '/api/sources/manual-odds/dirs',
      { scope: 'match', dir_path: dir, match_key: '2041922', match_key_kind: 'official' });
    const id = set.body.data.binding_id;

    const del = await request(port, 'POST', `/api/sources/manual-odds/dirs/${id}/remove`, {});
    assert.equal(del.status, 200);
    assert.equal(del.body.data.removed, true);

    const list = await request(port, 'GET', '/api/sources/manual-odds/dirs');
    assert.equal(list.body.data.matches.length, 0);

    const again = await request(port, 'POST', `/api/sources/manual-odds/dirs/${id}/remove`, {});
    assert.equal(again.status, 404);
    assert.equal(again.body.error, 'binding_not_found');
  });
});

// ───────────────────────── ⑦ 审计（append-only） ─────────────────────────
test('⑦ 目录绑定变更写入 append-only 审计', async () => {
  await withServer(async (port, svc) => {
    const dir = makeSingleMatchDir(tmpRoot, 'audited');
    const set = await request(port, 'POST', '/api/sources/manual-odds/dirs',
      { scope: 'match', dir_path: dir, match_key: '2041922', match_key_kind: 'official' });
    await request(port, 'POST', `/api/sources/manual-odds/dirs/${set.body.data.binding_id}/remove`, {});

    const entries = svc.auditStore.listAll();
    const added = entries.filter((e) => e.message === 'manual_odds_dir_added');
    const removed = entries.filter((e) => e.message === 'manual_odds_dir_removed');
    assert.equal(added.length, 1);
    assert.equal(removed.length, 1);
    assert.equal(added[0].service, 'ingest');
    assert.equal(added[0].scope, 'match');
    assert.equal(added[0].match_key, '2041922');
    assert.equal(added[0].new_state.dir_path, dir);
    assert.equal(removed[0].prev_state.dir_path, dir);
  });
});

test.after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  if (ENV_ROOT_SAVED !== undefined) process.env.OE_MANUAL_ODDS_ROOT = ENV_ROOT_SAVED;
});
