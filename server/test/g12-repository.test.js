// ============================================================================
// G12 数据访问层 · repository 测试
// 覆盖：类型化插入/读取/计数、必要列校验、不可变护栏（应用层 + DB 触发器）、
// INSERT OR IGNORE 幂等、外键约束、listBy 检索。
// ============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDb } = require('../src/db');
const { G12ValidationError, G12ImmutableError } = require('../src/db/g12/repository');

function withDb(fn) {
  const db = createDb({ path: ':memory:' });
  try { return fn(db); } finally { db.close(); }
}

const RULE_V = {
  version_id: 'R001#1', rule_id: 'R001', version: 1, category: 'odds_change',
  condition: 'handicap.change < -0.25', conclusion: '主队水位显著下降', direction: 'favor_upper',
  base_confidence: 0.72, priority: 50, trust_level: 'trusted',
  valid_from: '2026-01-01T00:00:00Z', valid_to: null, status: 'active',
  created_at: '2026-01-01T00:00:00Z', created_by: 'admin',
  evidence_refs: [], evidence_count: 0,
};

test('G12 仓库：类型化插入/读取/计数 + 幂等 INSERT OR IGNORE', () => {
  withDb(({ qd }) => {
    const r1 = qd.data_sources.insert({
      source_id: 'src_x', source_name: 'X源', source_type: 'odds', trust_level: 'trusted',
      status: 'active', config_ref: null, quality_metrics: { missing_rate: 0 },
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    assert.equal(r1.inserted, true);
    assert.equal(qd.data_sources.count(), 1);
    const got = qd.data_sources.get('src_x');
    assert.equal(got.source_name, 'X源');
    // JSON 列序列化存取
    assert.deepEqual(JSON.parse(got.quality_metrics), { missing_rate: 0 });

    // 幂等：同 PK 再插 → 不新增
    const r2 = qd.data_sources.insert({
      source_id: 'src_x', source_name: 'X源', source_type: 'odds', trust_level: 'trusted',
      status: 'active', quality_metrics: {}, created_at: 'x', updated_at: 'x',
    });
    assert.equal(r2.inserted, false);
    assert.equal(qd.data_sources.count(), 1);
  });
});

test('G12 仓库：缺必要列 → G12ValidationError（诚实失败，不捏造）', () => {
  withDb(({ qd }) => {
    assert.throws(() => qd.matches.insert({ match_id: 'M1' }), G12ValidationError);
    assert.throws(() => qd.audit_log.insert({ event_id: 'e1' }), G12ValidationError);
    assert.throws(() => qd.predictions.insert({ prediction_id: 'p1' }), G12ValidationError);
  });
});

test('G12 仓库：不可变表应用层 update/delete/patch 抛 G12ImmutableError，DB 触发器兜底', () => {
  withDb(({ qd, db }) => {
    const ins = qd.rule_versions.insert(RULE_V);
    if (!ins.inserted) {
      assert.fail(`rule_versions.insert 预期成功 inserted=true，实际=${JSON.stringify(ins)}`);
    }
    for (const op of ['update', 'delete', 'patch']) {
      assert.throws(() => qd.rule_versions[op](), (e) => e instanceof G12ImmutableError && e.code === 'IMMUTABLE');
    }
    // DB 触发器直接拒绝裸 UPDATE
    assert.throws(
      () => db.exec(`UPDATE qd_rule_versions SET status='superseded' WHERE version_id='R001#1'`),
      /immutable_violation/,
    );
  });
});

test('G12 仓库：外键约束（foreign_keys=ON）拒绝悬空引用', () => {
  withDb(({ qd }) => {
    // odds 引用不存在的 match 与 source → FK 违例
    assert.throws(
      () => qd.odds_snapshots.insert({
        snapshot_id: 's1', match_id: 'NOEXIST', institution: 'macau', market: 'handicap',
        observed_at: '2026-01-01T00:00:00Z', received_at: '2026-01-01T00:00:01Z',
        data: {}, trust_level: 'trusted', source_id: 'src_nope',
      }),
      /FOREIGN KEY constraint failed/,
    );
  });
});

test('G12 仓库：listBy 按 FK/列检索', () => {
  withDb(({ qd, db }) => {
    qd.matches.insert({
      match_id: 'M1', league: '日职联', home_team: '甲', away_team: '乙',
      match_time: '2026-08-14T18:00:00+08:00', status: 'scheduled',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    qd.matches.insert({
      match_id: 'M2', league: '芬超', home_team: '丙', away_team: '丁',
      match_time: '2026-08-14T23:00:00+08:00', status: 'scheduled',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    const rows = qd.matches.listBy('league', '日职联');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].match_id, 'M1');
  });
});