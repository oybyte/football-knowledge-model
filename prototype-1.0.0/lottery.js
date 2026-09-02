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
/** 合并池盘赔明细索引：合并键 → { mergedMatchId, snapshots, merged, provisional } */
var _cachedMergedMap = null;
/** 最近一次构建好的 lottery 列表（官方在售 或 人工盘赔回退），供同步渲染读取 */
var _cachedLottery = null;
/** 最近一次拉取是否为「人工盘赔回退模式」（官方在售为空 → 本地合并池诚实降级） */
var _manualOnly = false;

// ── 语义键（与后端 normalizeTeamName 对齐：折叠全角/不换行空格/多余空白）─────
function normName(s) {
  s = String(s == null ? "" : s);
  return s.replace(/[\u3000\u00a0]/g, " ").replace(/\s+/g, " ").trim();
}

// 联赛别名收敛：竞彩官方用全称（如「韩国职业联赛」），本地人工盘赔用简称（如「韩K联」）。
// 归一化到同一规范名，使双源语义键能对齐；已为规范名/缩写名的返回自身。
var LEAGUE_ALIAS = {
  "韩国职业联赛": "韩K联",
  "沙特职业联赛": "沙特联", "沙特阿拉伯职业联赛": "沙特联",
  "欧洲冠军联赛": "欧冠杯", "欧冠联赛": "欧冠杯",
  "欧罗巴联赛": "欧联杯", "欧洲联赛": "欧联杯",
  "西班牙甲级联赛": "西甲",
  "英格兰超级联赛": "英超",
  "英格兰冠军联赛": "英冠",
  "意大利甲级联赛": "意甲",
  "德国甲级联赛": "德甲", "德国乙级联赛": "德乙",
  "法国甲级联赛": "法甲", "法国乙级联赛": "法乙",
  "荷兰甲级联赛": "荷甲",
  "葡萄牙超级联赛": "葡超",
  "巴西甲组联赛": "巴甲", "巴西甲级联赛": "巴甲",
  "日本职业联赛": "日职联", "日本乙级联赛": "日职乙", "J2联": "日职乙",
  "日本联赛杯": "日联杯", "日联赛杯": "日联杯",
  "挪威超级联赛": "挪超",
  "瑞典超级联赛": "瑞典超",
  "芬兰超级联赛": "芬超",
  "英格兰社区盾": "社区盾", "社区盾杯": "社区盾",
  "英格兰联赛杯": "英联杯",
  "韩国足总杯": "韩国杯",
  "南美解放者杯": "解放者杯",
  "美国职业大联盟": "美职联"
};
function normLeague(s) {
  var n = normName(s);
  return LEAGUE_ALIAS[n] || n;
}
function mergedKeyOf(o) {
  return [normLeague(o.league), normName(o.home_team), normName(o.away_team)].join("|");
}
function lotteryMergedKey(m) {
  return [normLeague(m.league), normName(m.home), normName(m.away)].join("|");
}

/**
 * 拉取双源合并池（竞彩赛程 ∪ 本地人工盘赔），建立「语义键 → 盘赔明细」索引。
 * 合并池来自后端本地扫描 md，不直连官方，故每次加载均可调用（公益网站零压力）。
 */
function fetchMergedDetail(api) {
  function build(r) {
    _cachedMergedMap = {};
    if (r && r.ok && r.data && Array.isArray(r.data.pool)) {
      r.data.pool.forEach(function (p) {
        if (!p || !(p.snapshots > 0) || !p.league) return;
        var k = mergedKeyOf(p);
        _cachedMergedMap[k] = {
          mergedMatchId: p.match_id,
          snapshots: p.snapshots,
          merged: !!p.merged,
          provisional: true, // 人工盘赔诚实标记，绝不冒充官方
          hasManualOdds: true,
        };
      });
    }
    return _cachedMergedMap;
  }
  return Promise.resolve(api.getMergedPool())
    .then(build)
    ["catch"](function () { _cachedMergedMap = {}; return _cachedMergedMap; });
}

/** 把已缓存合并池的盘赔明细挂载到官方今日场次（双源关联）。 */
function enrichWithOdds(lotteryMatches) {
  if (_cachedMergedMap) {
    lotteryMatches.forEach(function (m) {
      var d = _cachedMergedMap[lotteryMergedKey(m)];
      if (d) m.oddsDetail = d;
    });
  }
  return lotteryMatches;
}

/** 官方在售列表（权威 序号/让球/业务日/全部今日场次）。 */
function fetchOfficialOdds(force, api) {
  if (api && typeof api.getSportteryOddsStatus === "function") {
    // mock 适配器返回普通对象、http 适配器返回 Promise，统一归一为 Promise
    return Promise.resolve(api.getSportteryOddsStatus(force ? { refresh: true } : undefined)).then(function (r) {
      if (r && r.ok && r.data && r.data.matches && r.data.matches.length) {
        _cachedRealMatches = r.data.matches;
        return r.data.matches.map(sportteryToLottery);
      }
      if (_cachedRealMatches && _cachedRealMatches.length) return _cachedRealMatches.map(sportteryToLottery);
      return [];
    })["catch"](function () {
      if (_cachedRealMatches && _cachedRealMatches.length) return _cachedRealMatches.map(sportteryToLottery);
      return [];
    });
  }
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
        if (_cachedRealMatches && _cachedRealMatches.length) return _cachedRealMatches.map(sportteryToLottery);
        return [];
      });
  }
  return Promise.resolve([]);
}

/**
 * 把「双源合并池」单场（本地人工盘赔扫描 md 所得）映射为内部 lottery 场次格式。
 * 诚实降级：这些是本地人工盘赔池的历史/静态赛事，绝非官方在售，故
 *   - provisional=true（信任级 provisional，不冒充官方 trusted）
 *   - salesOpen=false（非官方在售，诚实标记停售）
 *   - dateGroup 按真实开赛时间归类（多为历史 → 往期），绝不伪造进「今日可买」
 * enrichWithOdds 会依据语义键自动挂上其盘赔明细（snapshots）。
 */
function mergedToLottery(raw) {
  if (!raw || !raw.league || !raw.match_time) return null;
  var group = computeDateGroup(raw.match_time); // 按真实开赛时间诚实分组
  var betTypes = [
    { key: "hafu", label: "半全场", data: false },
    { key: "score", label: "比分", data: false },
    { key: "ttg", label: "进球数", data: false },
  ];
  return {
    id: raw.match_id,
    real: true,
    provisional: true, // 本地人工盘赔，非官方在售
    manualPool: true,   // 首页可据以标注「人工盘赔池」
    league: raw.league || "",
    home: raw.home_team || "",
    away: raw.away_team || "",
    neutral: false,
    kickoff: fmtKickoff(raw.match_time),
    deadline: deadlineOf(raw.match_time),
    dateGroup: group,
    serial: "",          // 人工盘赔池无竞彩序号，留空避免伪造
    betTypes: betTypes,
    salesOpen: false,    // 非官方在售，诚实标记停售
  };
}

/**
 * 回退：当官方在售列表为空（未配置官方端点）→ 用本地合并池构建 lottery 场次。
 * 返回 Promise<Array>，映射失败时返回空数组（绝不编造官方在售数据）。
 */
function buildFromMergedPool(api) {
  if (!api || typeof api.getMergedPool !== "function") return Promise.resolve([]);
  return Promise.resolve(api.getMergedPool()).then(function (r) {
    if (r && r.ok && r.data && Array.isArray(r.data.pool) && r.data.pool.length) {
      return r.data.pool.map(mergedToLottery).filter(Boolean);
    }
    return [];
  })["catch"](function () { return []; });
}

/** 是否处于「人工盘赔回退模式」（官方在售为空，首页展示本地合并池）。 */
function isManualOnlyMode() { return _manualOnly; }

/**
 * 从后端 API 拉取真实竞彩数据（官方在售列表 + 合并池盘赔明细双源）。
 * 诚实降级：官方在售为空时回退到本地人工盘赔合并池，单一入口即可看到全部本地盘赔场次。
 * @param {boolean} force true=手动刷新（?refresh=1 直连官方）；false=自动（当天缓存，公益网站减负）
 */
function fetchRealMatches(force) {
  var api = (typeof window !== "undefined" && window.__ApiClient)
    ? window.__ApiClient.getApi()
    : null;
  return fetchOfficialOdds(force, api).then(function (lotteryMatches) {
    // 并行拉取合并池盘赔明细（本地扫描，不直连官方）
    var detail = api && typeof api.getMergedPool === "function"
      ? fetchMergedDetail(api)
      : Promise.resolve({});
    return detail.then(function () {
      // 官方在售列表为空（未配置官方端点）→ 诚实回退到本地人工盘赔合并池
      if (lotteryMatches && lotteryMatches.length) {
        _manualOnly = false;
        var official = enrichWithOdds(lotteryMatches);
        _cachedLottery = official;
        return official;
      }
      _manualOnly = true;
      return buildFromMergedPool(api).then(function (manual) {
        var built = enrichWithOdds(manual);
        _cachedLottery = built;
        return built;
      });
    });
  });
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
  if (_cachedLottery && _cachedLottery.length) return _cachedLottery;
  if (_cachedRealMatches && _cachedRealMatches.length) {
    return enrichWithOdds(_cachedRealMatches.map(sportteryToLottery));
  }
  return [];
}

/** 查询某官方场次是否已关联人工盘赔明细（含语义合并 id）。 */
function getOddsDetail(id) {
  if (typeof id === "undefined" || id === null) return null;
  var all = getCachedLotteryMatches();
  var m = null;
  for (var i = 0; i < all.length; i++) { if (String(all[i].id) === String(id)) { m = all[i]; break; } }
  return (m && m.oddsDetail) || null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getCachedLotteryMatches, fetchLotteryMatches, getOddsDetail, isManualOnlyMode, LOTTERY_API, LOTTERY_GROUPS, sportteryToLottery, mergedToLottery };
}
