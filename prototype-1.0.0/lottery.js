// ============================================================================
// 数据适配层 (Source Adapter) —— 中国体育彩票 · 竞彩足球
// 真实环境：调用竞彩开放接口 -> normalizeLotteryRaw() -> 内部 Match 结构
// 原型阶段：以本地 MATCHES 模拟竞彩赛事列表（含玩法 / 截止 / 销售状态）
// 注意：本层与 data.js(盘口快照) 解耦，是「真实接口」的唯一接入缝
// ============================================================================

const LOTTERY_API = "https://api.sporttery.cn/football/jczq"; // 占位：真实竞彩接口地址
const LOTTERY_KEY = "";                                        // 占位：接口密钥（设置页配置）

// 由一场内部 Match 推导竞彩「可投玩法」
function lotteryBetTypes(m) {
  const list = [];
  if (m.onex && m.onex.length)      list.push({ key: "hh",   label: "胜平负",     data: true });
  if (m.handicap && m.handicap.length) list.push({ key: "hhad", label: "让球胜平负", data: true });
  if (m.totals && m.totals.length)  list.push({ key: "ttg",  label: "进球数",     data: true });
  if (m.betfair)                    list.push({ key: "bf",   label: "资金面",     data: true });
  list.push({ key: "hafu",  label: "半全场", data: false }); // 竞彩标准玩法（原型无数据）
  list.push({ key: "score", label: "比分",   data: false }); // 竞彩标准玩法（原型无数据）
  return list;
}

function toLotteryMatch(m, group, deadline) {
  return {
    id: m.id,
    real: !!m.real,
    league: m.league,
    home: m.home, away: m.away,
    neutral: !!m.neutral,
    kickoff: m.kickoff,
    deadline: deadline,
    dateGroup: group,
    serial: "JC" + m.id.slice(1).padStart(3, "0"),
    betTypes: lotteryBetTypes(m),
    salesOpen: group !== "past"
  };
}

const LOTTERY_GROUPS = [
  { id: "today",   label: "今日" },
  { id: "tomorrow", label: "明日" },
  { id: "later",   label: "后续" },
  { id: "past",    label: "往期" }
];

const LOTTERY_MATCHES = [
  toLotteryMatch(MATCHES.find(m => m.id === "M007"), "today",    "08-14 17:30"),
  toLotteryMatch(MATCHES.find(m => m.id === "M008"), "today",    "08-14 22:30"),
  toLotteryMatch(MATCHES.find(m => m.id === "M001"), "tomorrow", "08-16 18:30"),
  toLotteryMatch(MATCHES.find(m => m.id === "M002"), "tomorrow", "08-16 21:00"),
  toLotteryMatch(MATCHES.find(m => m.id === "M003"), "tomorrow", "08-16 22:00"),
  toLotteryMatch(MATCHES.find(m => m.id === "M004"), "later",    "08-17 20:30"),
  toLotteryMatch(MATCHES.find(m => m.id === "M005"), "later",    "08-17 23:30"),
  toLotteryMatch(MATCHES.find(m => m.id === "M006"), "later",    "08-18 19:00")
];

// 真实接口归一化（文档化 seam）：将竞彩原始 JSON 映射为内部 Match 结构
// raw: { id, league, home, away, neutral, kickoff, deadline,
//        handicap:[{name,initial:{h,hw,aw},current:{h,hw,aw}}], onex, totals, betfair }
function normalizeLotteryRaw(raw) { return raw; }

// 模拟异步拉取（真实环境替换为 fetch(LOTTERY_API, {headers:{key:LOTTERY_KEY}})）
function fetchLotteryMatches() {
  return new Promise(resolve => setTimeout(() => resolve(LOTTERY_MATCHES), 120));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LOTTERY_MATCHES, fetchLotteryMatches, normalizeLotteryRaw, LOTTERY_API, LOTTERY_GROUPS };
}
