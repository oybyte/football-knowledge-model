// ============================================================================
// 数据适配层 (Source Adapter) —— 中国体育彩票 · 竞彩足球
// 真实环境：调用后端 API（/api/sources/sporttery-odds）-> 内部 Match 结构
// 已接入真实数据开发：首页赛事列表仅来自后端真实竞彩，无 Mock 兜底
// 注意：本层与 data.js(盘口快照) 解耦，是「真实接口」的唯一接入缝
// ============================================================================

const LOTTERY_API = "";  // 不再使用；数据经由后端 /api/sources/sporttery-odds 获取
const LOTTERY_KEY = "";

// 池名 → 玩法映射
const POOL_TO_BETTYPE = {
  "胜平负":     { key: "hh",   label: "胜平负" },
  "让球胜平负": { key: "hhad", label: "让球胜平负" },
  "比分":       { key: "score", label: "比分" },
  "总进球":     { key: "ttg",  label: "进球数" },
  "半全场":     { key: "hafu", label: "半全场" },
};

/** 从竞彩官方赔率数据项 → 内部 LOTTERY_MATCHES 格式 */
function bjDateStr(t) {
  var dt = new Date(t.getTime() + 8 * 3600000);
  return dt.getUTCFullYear() + '-' + dt.getUTCMonth() + '-' + dt.getUTCDate();
}

/** 根据北京时间 ISO 字符串计算日期分组 */
function computeDateGroup(isoStr) {
  var d = new Date(isoStr);
  var now = new Date();
  var kd = bjDateStr(d);
  var td = bjDateStr(now);
  var tm = bjDateStr(new Date(now.getTime() + 86400000));
  if (kd === td) return "today";
  if (kd === tm) return "tomorrow";
  if (d.getTime() > now.getTime()) return "later";
  return "past";
}

// ── 竞彩可买批次分组（今日可买 / 明日可买 / 往期）─────────────────────
// 参考体彩归类：按「销售业务日」判定，而非简单按开赛时刻。
// 同一业务日的场次即使明日凌晨才开赛（如今晚 22/23 点截止）仍属「今日可买」。
// 业务日来源优先级：官方 businessDate > 期号 matchNumDate（两者一致时冗余兜底）。
// 两者均缺失（如历史 Mock）则回退按开赛时间。
function bjCompact(offsetDays) {
  var d = new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
function normalizeSerialDate(d) {
  if (d == null) return null;
  var s = String(d).replace(/\D/g, "");
  if (s.length === 8) return +s;
  if (s.length === 6) return +("20" + s); // 竞彩期号 YYMMDD（如 260825）→ YYYYMMDD
  return null;
}
function computeBuyGroup(serialDate, kickoffIso) {
  var sd = normalizeSerialDate(serialDate);
  if (sd != null) {
    var td = bjCompact(0), tm = bjCompact(1);
    if (sd === td) return "today";
    if (sd === tm) return "tomorrow";
    return sd < td ? "past" : "today";
  }
  var g = computeDateGroup(kickoffIso);
  return g === "later" ? "today" : g;
}

/** 格式化 ISO 为 MM-DD HH:mm（北京时间） */
function fmtKickoff(isoStr) {
  var d = new Date(new Date(isoStr).getTime() + 8 * 3600000);
  var p = function (n) { return String(n).padStart(2, "0"); };
  return p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
}

/** 截止时间 = 开赛前 30 分钟（北京时间） */
function deadlineOf(isoStr) {
  var d = new Date(new Date(isoStr).getTime() + 8 * 3600000 - 30 * 60000);
  var p = function (n) { return String(n).padStart(2, "0"); };
  return p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
}

/** 从竞彩官方赔率数据项 → 内部 LOTTERY_MATCHES 格式 */
function sportteryToLottery(raw) {
  var group = computeBuyGroup(raw.business_date || raw.serial_date, raw.match_time);
  var pools = raw.pools || [];
  var betTypes = pools.map(function (p) {
    var bt = POOL_TO_BETTYPE[p];
    return bt ? { key: bt.key, label: bt.label, data: true } : { key: p, label: p, data: false };
  });
  // 补全标准玩法
  var has = {};
  betTypes.forEach(function (b) { has[b.key] = true; });
  if (!has.hafu) betTypes.push({ key: "hafu", label: "半全场", data: false });
  if (!has.score) betTypes.push({ key: "score", label: "比分", data: false });
  // 有详细赔率数据时标记
  var hasOdds = raw.poolData && raw.poolData.length > 0 &&
    raw.poolData.some(function (p) { return p.odds && p.odds.length > 0; });
  if (hasOdds) {
    betTypes.forEach(function (b) { b.data = true; });
  }
  // 让球胜平负挂上具体让球数（如 -1 主让一球）
  if (raw.handicap_line != null) {
    betTypes.forEach(function (b) { if (b.key === "hhad") b.handicap = raw.handicap_line; });
  }

  return {
    id: raw.match_id,
    real: true,
    league: raw.league || "",
    home: raw.home_team || "",
    away: raw.away_team || "",
    neutral: false,
    kickoff: fmtKickoff(raw.match_time),
    deadline: deadlineOf(raw.match_time),
    dateGroup: group,
    serial: (function () {
      if (raw.serial == null) return "JC" + raw.match_id;
      var m = String(raw.serial).match(/\d+$/); // 竞彩序号如「周二001」→ 提取 001
      return m ? m[0].padStart(3, "0") : String(raw.serial);
    })(),
    betTypes: betTypes,
    salesOpen: group !== "past" && raw.status !== "finished" && raw.status !== "canceled",
  };
}

const LOTTERY_GROUPS = [
  { id: "today",   label: "今日可买" },
  { id: "tomorrow", label: "明日可买" },
  { id: "past",    label: "往期" }
];

/** 缓存最新一次拉取的真实比赛 */
var _cachedRealMatches = null;

/**
 * 从后端 API 拉取真实竞彩数据。
 * @param {boolean} force true=手动刷新（?refresh=1 直连官方）；false=自动（当天缓存，公益网站减负）
 */
function fetchRealMatches(force) {
  // 优先通过 api-client 获取
  var api = (typeof window !== "undefined" && window.__ApiClient)
    ? window.__ApiClient.getApi()
    : null;
  if (api && typeof api.getSportteryOddsStatus === "function") {
    // mock 适配器返回普通对象、http 适配器返回 Promise，统一归一为 Promise
    return Promise.resolve(api.getSportteryOddsStatus(force ? { refresh: true } : undefined)).then(function (r) {
      if (r && r.ok && r.data && r.data.matches && r.data.matches.length) {
        _cachedRealMatches = r.data.matches;
        return r.data.matches.map(sportteryToLottery);
      }
      // 使用缓存
      if (_cachedRealMatches && _cachedRealMatches.length) {
        return _cachedRealMatches.map(sportteryToLottery);
      }
      return [];
    })["catch"](function () {
      // API 失败，用缓存
      if (_cachedRealMatches && _cachedRealMatches.length) {
        return _cachedRealMatches.map(sportteryToLottery);
      }
      return [];
    });
  }
  // 尝试直接 fetch
  if (typeof fetch !== "undefined") {
    return fetch("http://localhost:3000/api/sources/sporttery-odds" + (force ? "?refresh=1" : ""))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.status === "ok" && j.data && j.data.matches) {
          _cachedRealMatches = j.data.matches;
          return j.data.matches.map(sportteryToLottery);
        }
        return [];
      })["catch"](function () {
        if (_cachedRealMatches && _cachedRealMatches.length) {
          return _cachedRealMatches.map(sportteryToLottery);
        }
        return [];
      });
  }
  return Promise.resolve([]);
}

/**
 * 异步拉取真实竞彩数据。
 * @param {boolean} force true=手动刷新（直连官方）；false=自动（当天缓存，每天最多自动一次）
 */
function fetchLotteryMatches(force) {
  return fetchRealMatches(force);
}

// 同步获取当前缓存的真实比赛列表（用于渲染兜底，避免异步闪烁）
function getCachedLotteryMatches() {
  if (_cachedRealMatches && _cachedRealMatches.length) {
    return _cachedRealMatches.map(sportteryToLottery);
  }
  return [];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getCachedLotteryMatches, fetchLotteryMatches, LOTTERY_API, LOTTERY_GROUPS, sportteryToLottery };
}
