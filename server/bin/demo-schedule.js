// ============================================================================
// 真实赛程源适配器 · 效果演示 —— node server/bin/demo-schedule.js
// 只读演示：不写库、不污染正式链路，逐态打印适配器输出。
//   ① not_configured  真实环境（未配置端点）—— 诚实降级，零假数据
//   ② degraded        端点已配置但拉取失败
//   ③ ok              注入假 fetch 演示「竞彩赛程 → 赛事元信息」归一化结果
// 真实端点接线：配置环境变量 ODDS_SPORTTERY_SCHEDULE_BASE 后，
//              适配器会经 CredentialVault（ingest 角色）读取真实端点并拉取。
// ============================================================================
'use strict';

const { syncSportterySchedule } = require('../src/data');

const RAW_FIXTURE = {
  matchId: 'str-1001',
  competitionName: '英超',
  homeTeamName: '曼城',
  awayTeamName: '狼队',
  matchDate: '20260814',
  matchTime: '1830',
  matchStatus: 'scheduled',
  isNeutral: false,
};

function line(t) { console.log('\n── ' + t + ' ──'); }

(async () => {
  // ① not_configured：当前真实环境没有端点，必须诚实返回，不能伪造
  line('① 状态 not_configured（当前真实环境：未配置端点）');
  const nc = await syncSportterySchedule({ env: process.env });
  console.log('  status =', nc.status, '| reason =', nc.reason);
  console.log('  matches =', nc.matches.length, '（零假数据）');
  console.log('  message =', nc.message);

  // ② degraded：端点已配置，但 fetch 失败
  line('② 状态 degraded（端点已配置，但拉取失败）');
  const dg = await syncSportterySchedule({
    env: { ODDS_SPORTTERY_SCHEDULE_BASE: 'https://example.invalid/fixtures' },
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  console.log('  status =', dg.status, '| reason =', dg.reason, '| matches =', dg.matches.length);

  // ③ ok：注入假 fetch，演示竞彩赛程报文 → 赛事元信息的归一化产物
  line('③ 状态 ok（注入假 fetch，演示归一化产物）');
  const ok = await syncSportterySchedule({
    env: { ODDS_SPORTTERY_SCHEDULE_BASE: 'https://example.invalid/fixtures' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', data: [RAW_FIXTURE] }) }),
    now: () => Date.parse('2026-08-14T10:00:00Z'),
  });
  console.log('  status =', ok.status, '| meta =', JSON.stringify(ok.meta));
  console.log('  normalized fixture =', JSON.stringify(ok.matches[0], null, 2));

  console.log('\n演示完成。真实端点接线：注入 ODDS_SPORTTERY_SCHEDULE_BASE 后，状态将由 not_configured → ok。');
})();