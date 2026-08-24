// ============================================================================
// 数据接入层 · mock 数据源 —— 原型 data.js 的迁移实例（1.1 设计文档 §6.2）
// 本文件是「模拟数据源」的唯一事实来源：所有场次经 migrateMatch 规约为 MatchSchema。
// 明确标注：M001–M006 为演示场（untrusted），M007/M008 为真实赛程（trusted/provisional）。
// ============================================================================
'use strict';

const { migrateMatch } = require('./migrate');

// ── 原型 data.js 内嵌数据（仅迁移所需字段；完整盘口结构见 prototype-1.0.0/data.js）──
const RAW_MATCHES = [
  // ============ 真实赛程 ============
  {
    id: 'M007', real: true, league: '日职联', home: '东京绿茵', away: '柏太阳神', neutral: true, kickoff: '2026-08-14T18:00:00+08:00',
    handicap: [
      { name: '澳*', initial: { h: -0.5, hw: 1.00, aw: 0.84 }, current: { h: -0.5, hw: 1.02, aw: 0.82 } },
      { name: '36*', initial: { h: -0.5, hw: 0.98, aw: 0.83 }, current: { h: -0.5, hw: 1.00, aw: 0.80 } },
      { name: '威*', initial: { h: -0.5, hw: 0.95, aw: 0.75 }, current: { h: -0.5, hw: 0.85, aw: 0.85 } },
      { name: 'Interwet*', initial: { h: -0.5, hw: 0.95, aw: 0.75 }, current: { h: -0.5, hw: 0.85, aw: 0.85 } },
    ],
    onex: [
      { name: '澳*', initial: { h: 3.90, d: 3.22, a: 1.84 }, current: { h: 4.00, d: 3.20, a: 1.82 }, kelly: { h: 0.86, d: 0.90, a: 0.92 } },
      { name: '威*', initial: { h: 4.40, d: 3.25, a: 1.80 }, current: { h: 4.20, d: 3.20, a: 1.85 }, kelly: { h: 0.91, d: 0.90, a: 0.93 } },
      { name: '立*', initial: { h: 3.70, d: 3.10, a: 1.91 }, current: { h: 4.20, d: 3.10, a: 1.80 }, kelly: { h: 0.91, d: 0.87, a: 0.91 } },
      { name: 'Interwet*', initial: { h: 4.60, d: 3.45, a: 1.75 }, current: { h: 4.20, d: 3.35, a: 1.90 }, kelly: { h: 0.91, d: 0.94, a: 0.96 } },
      { name: 'Betfai*', initial: { h: 4.70, d: 3.15, a: 1.86 }, current: { h: 4.90, d: 3.55, a: 1.91 }, kelly: { h: 0.98, d: 0.99, a: 0.96 } },
      { name: '36*', initial: { h: null, d: null, a: null }, current: { h: 4.50, d: 3.50, a: 1.80 }, kelly: { h: 0.97, d: 0.98, a: 0.91 } },
    ],
    totals: [
      { name: '澳*', initial: { line: '2-2.5', over: 1.00, under: 0.80 }, current: { line: '2-2.5', over: 1.00, under: 0.80 } },
      { name: '36*', initial: { line: '2-2.5', over: 1.00, under: 0.80 }, current: { line: '2-2.5', over: 1.03, under: 0.78 } },
      { name: '立*', initial: { line: '2.5', over: 1.30, under: 0.55 }, current: { line: '2.5', over: 1.25, under: 0.57 } },
      { name: '威*', initial: { line: '2.5', over: 1.20, under: 0.60 }, current: { line: '2.5', over: 1.25, under: 0.60 } },
      { name: 'Interwet*', initial: { line: '2.5', over: 1.20, under: 0.60 }, current: { line: '2.5', over: 1.20, under: 0.60 } },
    ],
    betfair: {
      turnover: 19836,
      rows: [
        { result: '胜', odds: 4.5, volume: 1456, pnl: 13284, heat: -66 },
        { result: '平', odds: 3.5, volume: 11662, pnl: -20981, heat: 110 },
        { result: '负', odds: 2.04, volume: 6718, pnl: 6131, heat: -33 },
      ],
    },
  },
  {
    id: 'M008', real: true, league: '芬超', home: 'VPS瓦萨', away: 'TPS土尔库', neutral: false, kickoff: '2026-08-14T23:00:00+08:00',
    handicap: [
      { name: '澳*', initial: { h: 0.75, hw: 0.83, aw: 0.95 }, current: { h: 0.75, hw: 0.94, aw: 0.84 } },
      { name: '36*', initial: { h: 0.75, hw: 0.88, aw: 0.93 }, current: { h: 0.75, hw: 0.98, aw: 0.83 } },
      { name: '威*', initial: { h: 0.75, hw: 0.82, aw: 0.80 }, current: { h: 0.75, hw: 0.85, aw: 0.81 } },
      { name: 'Interwet*', initial: { h: 0.5, hw: 0.70, aw: 1.05 }, current: { h: 0.5, hw: 0.70, aw: 1.05 } },
    ],
    onex: [
      { name: '澳*', initial: { h: 1.62, d: 3.71, a: 4.25 }, current: { h: 1.68, d: 3.71, a: 3.90 }, kelly: { h: 0.91, d: 0.93, a: 0.80 } },
      { name: '威*', initial: { h: 1.67, d: 3.60, a: 4.50 }, current: { h: 1.73, d: 3.50, a: 4.50 }, kelly: { h: 0.94, d: 0.88, a: 0.92 } },
      { name: '立*', initial: { h: 1.65, d: 3.60, a: 4.20 }, current: { h: 1.70, d: 3.50, a: 4.20 }, kelly: { h: 0.92, d: 0.88, a: 0.86 } },
      { name: 'Interwet*', initial: { h: 1.73, d: 3.60, a: 4.60 }, current: { h: 1.75, d: 3.55, a: 4.50 }, kelly: { h: 0.95, d: 0.89, a: 0.92 } },
      { name: 'Betfai*', initial: { h: 1.69, d: 3.45, a: 5.30 }, current: { h: 1.81, d: 3.90, a: 4.90 }, kelly: { h: 0.98, d: 0.98, a: 1.00 } },
      { name: '36*', initial: { h: null, d: null, a: null }, current: { h: 1.70, d: 3.70, a: 4.33 }, kelly: { h: 0.92, d: 0.93, a: 0.89 } },
    ],
    totals: [
      { name: '澳*', initial: { line: '2.5', over: 0.76, under: 0.96 }, current: { line: '2.5-3', over: 0.90, under: 0.82 } },
      { name: '36*', initial: { line: '2.5-3', over: 1.00, under: 0.80 }, current: { line: '2.5-3', over: 0.98, under: 0.83 } },
      { name: '立*', initial: { line: '2.5', over: 0.80, under: 0.95 }, current: { line: '2.5', over: 0.75, under: 0.95 } },
      { name: '威*', initial: { line: '2.5', over: 0.80, under: 0.95 }, current: { line: '2.5', over: 0.75, under: 0.95 } },
      { name: 'Interwet*', initial: { line: '2.5', over: 0.75, under: 0.95 }, current: { line: '2.5', over: 0.75, under: 0.95 } },
    ],
    betfair: {
      turnover: 8118,
      rows: [
        { result: '胜', odds: 1.82, volume: 5763, pnl: -2371, heat: 30 },
        { result: '平', odds: 4.0, volume: 676, pnl: 5414, heat: -67 },
        { result: '负', odds: 4.9, volume: 1679, pnl: -109, heat: 1 },
      ],
    },
  },

  // ============ 演示场（仅让球盘，覆盖各信号）============
  { id: 'M001', real: false, league: '英超', home: '曼城', away: '狼队', neutral: false, kickoff: '2026-08-16T18:30:00+08:00', handicap: [
    { name: '澳门', initial: { h: -1.00, hw: 0.95, aw: 0.90 }, current: { h: -1.25, hw: 0.85, aw: 0.95 } },
    { name: '威廉', initial: { h: -1.00, hw: 0.92, aw: 0.88 }, current: { h: -1.25, hw: 0.88, aw: 0.92 } },
    { name: '立博', initial: { h: -0.75, hw: 0.90, aw: 0.86 }, current: { h: -1.00, hw: 0.84, aw: 0.90 } },
    { name: '皇冠', initial: { h: -1.00, hw: 0.94, aw: 0.87 }, current: { h: -1.25, hw: 0.86, aw: 0.94 } },
    { name: 'Bet365', initial: { h: -1.00, hw: 0.93, aw: 0.85 }, current: { h: -1.25, hw: 0.87, aw: 0.93 } },
  ] },
  { id: 'M002', real: false, league: '意甲', home: '尤文', away: '萨索洛', neutral: false, kickoff: '2026-08-16T21:00:00+08:00', handicap: [
    { name: '澳门', initial: { h: -0.75, hw: 0.90, aw: 0.92 }, current: { h: -0.50, hw: 0.98, aw: 0.84 } },
    { name: '威廉', initial: { h: -0.75, hw: 0.91, aw: 0.89 }, current: { h: -0.50, hw: 0.97, aw: 0.85 } },
    { name: '立博', initial: { h: -0.75, hw: 0.89, aw: 0.91 }, current: { h: -0.50, hw: 0.99, aw: 0.83 } },
    { name: '皇冠', initial: { h: -0.75, hw: 0.92, aw: 0.88 }, current: { h: -0.50, hw: 0.96, aw: 0.86 } },
  ] },
  { id: 'M003', real: false, league: '西甲', home: '皇马', away: '赫塔菲', neutral: false, kickoff: '2026-08-16T22:00:00+08:00', handicap: [
    { name: '澳门', initial: { h: -1.50, hw: 0.90, aw: 0.92 }, current: { h: -1.50, hw: 0.90, aw: 0.92 } },
    { name: '威廉', initial: { h: -1.50, hw: 0.91, aw: 0.89 }, current: { h: -1.50, hw: 0.91, aw: 0.89 } },
    { name: '立博', initial: { h: -1.50, hw: 0.89, aw: 0.91 }, current: { h: -1.50, hw: 0.89, aw: 0.91 } },
    { name: '皇冠', initial: { h: -1.50, hw: 0.92, aw: 0.88 }, current: { h: -1.50, hw: 0.92, aw: 0.88 } },
  ] },
  { id: 'M004', real: false, league: '德甲', home: '拜仁', away: '奥格斯堡', neutral: false, kickoff: '2026-08-17T20:30:00+08:00', handicap: [
    { name: '澳门', initial: { h: -1.75, hw: 0.82, aw: 0.90 }, current: { h: -1.75, hw: 0.86, aw: 0.88 } },
    { name: '威廉', initial: { h: -1.25, hw: 0.90, aw: 0.88 }, current: { h: -1.25, hw: 0.90, aw: 0.88 } },
    { name: '立博', initial: { h: -1.25, hw: 0.91, aw: 0.87 }, current: { h: -1.25, hw: 0.91, aw: 0.87 } },
    { name: '皇冠', initial: { h: -1.25, hw: 0.89, aw: 0.89 }, current: { h: -1.25, hw: 0.89, aw: 0.89 } },
  ] },
  { id: 'M005', real: false, league: '法甲', home: '巴黎', away: '兰斯', neutral: false, kickoff: '2026-08-17T23:30:00+08:00', handicap: [
    { name: '澳门', initial: { h: -1.00, hw: 0.95, aw: 0.85 }, current: { h: -1.25, hw: 0.88, aw: 0.90 } },
    { name: '威廉', initial: { h: -1.00, hw: 0.85, aw: 0.95 }, current: { h: -1.25, hw: 0.95, aw: 0.85 } },
    { name: '立博', initial: { h: -1.00, hw: 0.84, aw: 0.96 }, current: { h: -1.25, hw: 0.96, aw: 0.84 } },
    { name: '皇冠', initial: { h: -1.00, hw: 0.93, aw: 0.87 }, current: { h: -1.25, hw: 0.87, aw: 0.93 } },
  ] },
  { id: 'M006', real: false, league: '荷甲', home: '阿贾克斯', away: '前进之鹰', neutral: false, kickoff: '2026-08-18T19:00:00+08:00', handicap: [
    { name: '澳门', initial: { h: -1.50, hw: 0.90, aw: 0.92 }, current: { h: -1.75, hw: 0.83, aw: 0.95 } },
    { name: '威廉', initial: { h: -1.50, hw: 0.91, aw: 0.89 }, current: { h: -1.75, hw: 0.84, aw: 0.94 } },
    { name: '立博', initial: { h: -1.50, hw: 0.89, aw: 0.91 }, current: { h: -1.75, hw: 0.85, aw: 0.93 } },
    { name: '皇冠', initial: { h: -1.50, hw: 0.92, aw: 0.88 }, current: { h: -1.75, hw: 0.83, aw: 0.95 } },
  ] },
];

/** @returns {import('../schema').MatchSchema[]} 迁移后的全部 mock 比赛 */
function loadMockMatches() {
  return RAW_MATCHES.map((raw) => migrateMatch(raw));
}

/** @param {string} matchId @returns {?import('../schema').MatchSchema} */
function getMockMatch(matchId) {
  return loadMockMatches().find((m) => m.match_id === matchId) || null;
}

module.exports = { RAW_MATCHES, loadMockMatches, getMockMatch };