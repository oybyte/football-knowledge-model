// ============================================================================
// 数据层 (Data Layer) —— 与特征层/规则层严格解耦，便于后期整体迁入正式工程
// 字段约定：让球盘使用 h(盘口数值) / hw(主队水位) / aw(客队水位)
//   quarter 盘口如 0.5/1 以中线 0.75 表示；0.5 直写 0.5
// ============================================================================

const MATCHES = [
  // ============================== 真实比赛 ==============================
  {
    id: "M007",
    real: true,
    league: "未显示",
    home: "东京绿茵",
    away: "柏太阳神",
    neutral: true,
    kickoff: "08-14 18:00",
    // 让球盘（主水 / 盘口 / 客水）
    handicap: [
      { name: "澳*",     initial: { h: -0.5, hw: 1.00, aw: 0.84 }, current: { h: -0.5, hw: 1.02, aw: 0.82 }, kelly: null, volume: null, volumeBaseline: null },
      { name: "36*",     initial: { h: -0.5, hw: 0.98, aw: 0.83 }, current: { h: -0.5, hw: 1.00, aw: 0.80 }, kelly: null, volume: null, volumeBaseline: null },
      { name: "威*",     initial: { h: -0.5, hw: 0.95, aw: 0.75 }, current: { h: -0.5, hw: 0.85, aw: 0.85 }, kelly: null, volume: null, volumeBaseline: null },
      { name: "Interwet*", initial: { h: -0.5, hw: 0.95, aw: 0.75 }, current: { h: -0.5, hw: 0.85, aw: 0.85 }, kelly: null, volume: null, volumeBaseline: null }
    ],
    // 1X2 欧指（主胜 / 平局 / 客胜）+ 凯利（真实凯利来自欧指，非让球盘）
    onex: [
      { name: "澳*",     initial: { h: 3.90, d: 3.22, a: 1.84 }, current: { h: 4.00, d: 3.20, a: 1.82 }, kelly: { h: 0.86, d: 0.90, a: 0.92 } },
      { name: "威*",     initial: { h: 4.40, d: 3.25, a: 1.80 }, current: { h: 4.20, d: 3.20, a: 1.85 }, kelly: { h: 0.91, d: 0.90, a: 0.93 } },
      { name: "立*",     initial: { h: 3.70, d: 3.10, a: 1.91 }, current: { h: 4.20, d: 3.10, a: 1.80 }, kelly: { h: 0.91, d: 0.87, a: 0.91 } },
      { name: "Interwet*", initial: { h: 4.60, d: 3.45, a: 1.75 }, current: { h: 4.20, d: 3.35, a: 1.90 }, kelly: { h: 0.91, d: 0.94, a: 0.96 } },
      { name: "Betfai*", initial: { h: 4.70, d: 3.15, a: 1.86 }, current: { h: 4.90, d: 3.55, a: 1.91 }, kelly: { h: 0.98, d: 0.99, a: 0.96 } },
      { name: "36*",     initial: { h: null, d: null, a: null }, current: { h: 4.50, d: 3.50, a: 1.80 }, kelly: { h: 0.97, d: 0.98, a: 0.91 } }
    ],
    // 大小球（大球 / 盘口 / 小球）
    totals: [
      { name: "澳*",     initial: { line: "2-2.5", over: 1.00, under: 0.80 }, current: { line: "2-2.5", over: 1.00, under: 0.80 } },
      { name: "36*",     initial: { line: "2-2.5", over: 1.00, under: 0.80 }, current: { line: "2-2.5", over: 1.03, under: 0.78 } },
      { name: "立*",     initial: { line: "2.5",   over: 1.30, under: 0.55 }, current: { line: "2.5",   over: 1.25, under: 0.57 } },
      { name: "威*",     initial: { line: "2.5",   over: 1.20, under: 0.60 }, current: { line: "2.5",   over: 1.25, under: 0.60 } },
      { name: "Interwet*", initial: { line: "2.5",   over: 1.20, under: 0.60 }, current: { line: "2.5",   over: 1.20, under: 0.60 } }
    ],
    // 必发交易盈亏
    betfair: {
      turnover: 19836,
      rows: [
        { result: "胜", odds: 4.5,  volume: 1456, pnl: 13284,  heat: -66 },
        { result: "平", odds: 3.5,  volume: 11662, pnl: -20981, heat: 110 },
        { result: "负", odds: 2.04, volume: 6718, pnl: 6131,   heat: -33 }
      ]
    },
    // 澳门让球详细变化（时间轴）
    macauHandicapHistory: [
      { time: "08-14 17:37", hw: 1.02, h: -0.5, aw: 0.82 },
      { time: "08-14 14:43", hw: 0.96, h: -0.5, aw: 0.88 },
      { time: "08-14 14:09", hw: 0.84, h: -0.5, aw: 1.00 },
      { time: "08-14 13:44", hw: 0.88, h: -0.5, aw: 0.96 },
      { time: "08-13 05:09", hw: 0.92, h: -0.5, aw: 0.92 },
      { time: "08-10 20:48", hw: 1.00, h: -0.5, aw: 0.84 }
    ],
    // 澳门 1X2 详细变化（时间轴）
    macauOnexHistory: [
      { time: "08-14 17:37", h: 4.00, d: 3.20, a: 1.82, kh: 0.86, kd: 0.90, ka: 0.92 },
      { time: "08-14 14:43", h: 3.90, d: 3.10, a: 1.88, kh: 0.84, kd: 0.87, ka: 0.95 },
      { time: "08-14 14:09", h: 3.48, d: 3.10, a: 2.00, kh: 0.75, kd: 0.87, ka: 1.01 },
      { time: "08-14 13:44", h: 3.60, d: 3.10, a: 1.96, kh: 0.78, kd: 0.87, ka: 0.99 },
      { time: "08-13 05:09", h: 3.75, d: 3.10, a: 1.92, kh: 0.81, kd: 0.87, ka: 0.97 },
      { time: "08-10 20:48", h: 3.90, d: 3.22, a: 1.84, kh: 0.84, kd: 0.90, ka: 0.93 }
    ]
  },

  {
    id: "M008",
    real: true,
    league: "未显示",
    home: "VPS瓦萨",
    away: "TPS土尔库",
    neutral: false,
    kickoff: "08-14 23:00",
    handicap: [
      { name: "澳*",     initial: { h: 0.75, hw: 0.83, aw: 0.95 }, current: { h: 0.75, hw: 0.94, aw: 0.84 }, kelly: null, volume: null, volumeBaseline: null },
      { name: "36*",     initial: { h: 0.75, hw: 0.88, aw: 0.93 }, current: { h: 0.75, hw: 0.98, aw: 0.83 }, kelly: null, volume: null, volumeBaseline: null },
      { name: "威*",     initial: { h: 0.75, hw: 0.82, aw: 0.80 }, current: { h: 0.75, hw: 0.85, aw: 0.81 }, kelly: null, volume: null, volumeBaseline: null },
      { name: "Interwet*", initial: { h: 0.5, hw: 0.70, aw: 1.05 }, current: { h: 0.5, hw: 0.70, aw: 1.05 }, kelly: null, volume: null, volumeBaseline: null }
    ],
    onex: [
      { name: "澳*",     initial: { h: 1.62, d: 3.71, a: 4.25 }, current: { h: 1.68, d: 3.71, a: 3.90 }, kelly: { h: 0.91, d: 0.93, a: 0.80 } },
      { name: "威*",     initial: { h: 1.67, d: 3.60, a: 4.50 }, current: { h: 1.73, d: 3.50, a: 4.50 }, kelly: { h: 0.94, d: 0.88, a: 0.92 } },
      { name: "立*",     initial: { h: 1.65, d: 3.60, a: 4.20 }, current: { h: 1.70, d: 3.50, a: 4.20 }, kelly: { h: 0.92, d: 0.88, a: 0.86 } },
      { name: "Interwet*", initial: { h: 1.73, d: 3.60, a: 4.60 }, current: { h: 1.75, d: 3.55, a: 4.50 }, kelly: { h: 0.95, d: 0.89, a: 0.92 } },
      { name: "Betfai*", initial: { h: 1.69, d: 3.45, a: 5.30 }, current: { h: 1.81, d: 3.90, a: 4.90 }, kelly: { h: 0.98, d: 0.98, a: 1.00 } },
      { name: "36*",     initial: { h: null, d: null, a: null }, current: { h: 1.70, d: 3.70, a: 4.33 }, kelly: { h: 0.92, d: 0.93, a: 0.89 } }
    ],
    totals: [
      { name: "澳*",     initial: { line: "2.5",   over: 0.76, under: 0.96 }, current: { line: "2.5-3", over: 0.90, under: 0.82 } },
      { name: "36*",     initial: { line: "2.5-3", over: 1.00, under: 0.80 }, current: { line: "2.5-3", over: 0.98, under: 0.83 } },
      { name: "立*",     initial: { line: "2.5",   over: 0.80, under: 0.95 }, current: { line: "2.5",   over: 0.75, under: 0.95 } },
      { name: "威*",     initial: { line: "2.5",   over: 0.80, under: 0.95 }, current: { line: "2.5",   over: 0.75, under: 0.95 } },
      { name: "Interwet*", initial: { line: "2.5",   over: 0.75, under: 0.95 }, current: { line: "2.5",   over: 0.75, under: 0.95 } }
    ],
    betfair: {
      turnover: 8118,
      rows: [
        { result: "胜", odds: 1.82, volume: 5763, pnl: -2371, heat: 30 },
        { result: "平", odds: 4.0,  volume: 676,  pnl: 5414,  heat: -67 },
        { result: "负", odds: 4.9,  volume: 1679, pnl: -109,  heat: 1 }
      ]
    },
    macauHandicapHistory: [
      { time: "08-14 14:18", hw: 0.94, h: 0.75, aw: 0.84 },
      { time: "08-11 20:32", hw: 0.83, h: 0.75, aw: 0.95 }
    ],
    macauOnexHistory: [
      { time: "08-14 14:18", h: 1.68, d: 3.71, a: 3.90, kh: 0.91, kd: 0.93, ka: 0.80 },
      { time: "08-11 20:32", h: 1.62, d: 3.71, a: 4.25, kh: 0.88, kd: 0.93, ka: 0.87 }
    ]
  },

  // ============================== MOCK 演示场（仅让球盘，覆盖各信号） ==============================
  {
    id: "M001", real: false, league: "英超", home: "曼城", away: "狼队", neutral: false, kickoff: "mock",
    handicap: [
      { name: "澳门",   initial: { h: -1.00, hw: 0.95, aw: 0.90 }, current: { h: -1.25, hw: 0.85, aw: 0.95 }, kelly: 0.99, volume: 1300, volumeBaseline: 600 },
      { name: "威廉",   initial: { h: -1.00, hw: 0.92, aw: 0.88 }, current: { h: -1.25, hw: 0.88, aw: 0.92 }, kelly: 1.00, volume: 1100, volumeBaseline: 550 },
      { name: "立博",   initial: { h: -0.75, hw: 0.90, aw: 0.86 }, current: { h: -1.00, hw: 0.84, aw: 0.90 }, kelly: 0.97, volume: 900,  volumeBaseline: 500 },
      { name: "皇冠",   initial: { h: -1.00, hw: 0.94, aw: 0.87 }, current: { h: -1.25, hw: 0.86, aw: 0.94 }, kelly: 1.01, volume: 1500, volumeBaseline: 700 },
      { name: "Bet365", initial: { h: -1.00, hw: 0.93, aw: 0.85 }, current: { h: -1.25, hw: 0.87, aw: 0.93 }, kelly: 0.98, volume: 1000, volumeBaseline: 520 }
    ]
  },
  {
    id: "M002", real: false, league: "意甲", home: "尤文", away: "萨索洛", neutral: false, kickoff: "mock",
    handicap: [
      { name: "澳门",   initial: { h: -0.75, hw: 0.90, aw: 0.92 }, current: { h: -0.50, hw: 0.98, aw: 0.84 }, kelly: 0.95, volume: 700, volumeBaseline: 600 },
      { name: "威廉",   initial: { h: -0.75, hw: 0.91, aw: 0.89 }, current: { h: -0.50, hw: 0.97, aw: 0.85 }, kelly: 0.96, volume: 680, volumeBaseline: 550 },
      { name: "立博",   initial: { h: -0.75, hw: 0.89, aw: 0.91 }, current: { h: -0.50, hw: 0.99, aw: 0.83 }, kelly: 0.94, volume: 650, volumeBaseline: 530 },
      { name: "皇冠",   initial: { h: -0.75, hw: 0.92, aw: 0.88 }, current: { h: -0.50, hw: 0.96, aw: 0.86 }, kelly: 0.97, volume: 720, volumeBaseline: 580 }
    ]
  },
  {
    id: "M003", real: false, league: "西甲", home: "皇马", away: "赫塔菲", neutral: false, kickoff: "mock",
    handicap: [
      { name: "澳门",   initial: { h: -1.50, hw: 0.90, aw: 0.92 }, current: { h: -1.50, hw: 0.90, aw: 0.92 }, kelly: 0.85, volume: 300, volumeBaseline: 600 },
      { name: "威廉",   initial: { h: -1.50, hw: 0.91, aw: 0.89 }, current: { h: -1.50, hw: 0.91, aw: 0.89 }, kelly: 0.86, volume: 280, volumeBaseline: 550 },
      { name: "立博",   initial: { h: -1.50, hw: 0.89, aw: 0.91 }, current: { h: -1.50, hw: 0.89, aw: 0.91 }, kelly: 0.84, volume: 260, volumeBaseline: 530 },
      { name: "皇冠",   initial: { h: -1.50, hw: 0.92, aw: 0.88 }, current: { h: -1.50, hw: 0.92, aw: 0.88 }, kelly: 0.87, volume: 320, volumeBaseline: 580 }
    ]
  },
  {
    id: "M004", real: false, league: "德甲", home: "拜仁", away: "奥格斯堡", neutral: false, kickoff: "mock",
    handicap: [
      { name: "澳门",   initial: { h: -1.75, hw: 0.82, aw: 0.90 }, current: { h: -1.75, hw: 0.86, aw: 0.88 }, kelly: 0.97, volume: 700, volumeBaseline: 600 },
      { name: "威廉",   initial: { h: -1.25, hw: 0.90, aw: 0.88 }, current: { h: -1.25, hw: 0.90, aw: 0.88 }, kelly: 0.95, volume: 600, volumeBaseline: 550 },
      { name: "立博",   initial: { h: -1.25, hw: 0.91, aw: 0.87 }, current: { h: -1.25, hw: 0.91, aw: 0.87 }, kelly: 0.96, volume: 580, volumeBaseline: 530 },
      { name: "皇冠",   initial: { h: -1.25, hw: 0.89, aw: 0.89 }, current: { h: -1.25, hw: 0.89, aw: 0.89 }, kelly: 0.94, volume: 650, volumeBaseline: 580 }
    ]
  },
  {
    id: "M005", real: false, league: "法甲", home: "巴黎", away: "兰斯", neutral: false, kickoff: "mock",
    handicap: [
      { name: "澳门",   initial: { h: -1.00, hw: 0.95, aw: 0.85 }, current: { h: -1.25, hw: 0.88, aw: 0.90 }, kelly: 0.99, volume: 1300, volumeBaseline: 600 },
      { name: "威廉",   initial: { h: -1.00, hw: 0.85, aw: 0.95 }, current: { h: -1.25, hw: 0.95, aw: 0.85 }, kelly: 0.97, volume: 1200, volumeBaseline: 550 },
      { name: "立博",   initial: { h: -1.00, hw: 0.84, aw: 0.96 }, current: { h: -1.25, hw: 0.96, aw: 0.84 }, kelly: 0.98, volume: 1100, volumeBaseline: 530 },
      { name: "皇冠",   initial: { h: -1.00, hw: 0.93, aw: 0.87 }, current: { h: -1.25, hw: 0.87, aw: 0.93 }, kelly: 1.00, volume: 1400, volumeBaseline: 580 }
    ]
  },
  {
    id: "M006", real: false, league: "荷甲", home: "阿贾克斯", away: "前进之鹰", neutral: false, kickoff: "mock",
    handicap: [
      { name: "澳门",   initial: { h: -1.50, hw: 0.90, aw: 0.92 }, current: { h: -1.75, hw: 0.83, aw: 0.95 }, kelly: 1.06, volume: 2600, volumeBaseline: 640 },
      { name: "威廉",   initial: { h: -1.50, hw: 0.91, aw: 0.89 }, current: { h: -1.75, hw: 0.84, aw: 0.94 }, kelly: 1.04, volume: 2400, volumeBaseline: 600 },
      { name: "立博",   initial: { h: -1.50, hw: 0.89, aw: 0.91 }, current: { h: -1.75, hw: 0.85, aw: 0.93 }, kelly: 1.05, volume: 2300, volumeBaseline: 580 },
      { name: "皇冠",   initial: { h: -1.50, hw: 0.92, aw: 0.88 }, current: { h: -1.75, hw: 0.83, aw: 0.95 }, kelly: 1.06, volume: 2600, volumeBaseline: 640 }
    ]
  }
];

if (typeof module !== "undefined") module.exports = { MATCHES };
