// ============================================================================
// V9.7 引擎 · fields —— 字段适配器（A 类：由盘口快照机械推导）
//
// 契约：
//  - 每个字段返回「信封」而非裸值（见 envelope.js），缺值一律 insufficient_data。
//  - 只依赖 adaptMatch 产出的 markets 结构，不直接读库，便于测试与复用。
//  - 取数口径：优先即盘(current)，缺失回退初盘(initial)，并在 method 中留痕。
//
// 已实现字段（覆盖 R13 / R01，及第二批：线/水位变动、比赛类型、机构共振）：
//   handicap_depth_band  盘口深度档位（浅盘/中盘/深盘，规范字面量）
//   handicap_depth       盘口深度数值（供中文盘口名的 lte/gte 比较）
//   water_level          上盘（让球方）水位
//   core_bookmaker_count 可用核心机构数
//   kelly_range          上盘凯利极差（多家机构派生）
//   initial_line         初盘让球深度（参考机构初盘）
//   line_change          让球盘线变化（升盘/退盘/横盘，初盘→即盘）
//   line_change_magnitude 让球盘线变化幅度（|即盘-初盘|）
//   over_water_move      大球水位变化（升水/降水/横水）
//   total_goals_line_move 总进球盘线变化（升盘/降盘/横盘）
//   competition_type     比赛类型（联赛/杯赛/友谊赛/欧战/季后赛，联赛名启发式，估算）
//   bookmakers_resonant_count 机构共振数（当前同深度机构数，静态近似）
// ============================================================================
'use strict';

const { ok, estimated, insufficient } = require('./envelope');
const { resolveHandicap, depthBand, isSaneWater, deriveKelly, parseDepth } = require('./handicap');

/** 参考机构优先级（澳门为亚盘主流参考；缺失时回退多数机构共识）。 */
const REFERENCE_INSTITUTIONS = ['macau', '澳*', '澳门'];

const SOURCE = 'src_manual_odds';

/**
 * 收集某时刻可用的让球盘机构行。
 * @param {Object} markets adaptMatch 产出
 * @param {'current'|'initial'} [prefer]
 * @returns {Array<{institution:string, timing:string, line:*, home_water:number, away_water:number}>}
 */
function collectHandicapRows(markets, prefer = 'current') {
  const h = (markets && markets.handicap) || {};
  const out = [];
  for (const [institution, rec] of Object.entries(h)) {
    const snap = rec && (rec[prefer] || rec.initial || rec.current);
    if (!snap) continue;
    out.push({
      institution,
      timing: rec[prefer] ? prefer : (rec.initial ? 'initial' : 'current'),
      line: snap.line,
      home_water: snap.home_water,
      away_water: snap.away_water,
    });
  }
  return out;
}

/** 解析为可用的盘口结构（带上盘判定）。 */
function toResolved(rows) {
  return rows
    .map((r) => ({ ...r, ...resolveHandicap(r) }))
    .filter((r) => r.depth != null && r.upper != null && isSaneWater(r.upperWater));
}

/**
 * 选定参考机构：优先澳门，否则取盘口深度中位数所在机构（多数共识）。
 * @param {Array} resolved
 */
function pickReference(resolved) {
  if (!resolved.length) return null;
  for (const pref of REFERENCE_INSTITUTIONS) {
    const hit = resolved.find((r) => r.institution === pref);
    if (hit) return hit;
  }
  const sorted = [...resolved].sort((a, b) => a.depth - b.depth);
  return sorted[Math.floor(sorted.length / 2)] || null;
}

/** 机构初/即盘成对收集（两者皆有才算；initial/current 均已 resolve 并过滤无效水位）。 */
function collectHandicapPairs(markets) {
  const h = (markets && markets.handicap) || {};
  const out = [];
  for (const [institution, rec] of Object.entries(h)) {
    if (!rec || !rec.initial || !rec.current) continue;
    const i = toResolved([{ institution, timing: 'initial', ...rec.initial }])[0];
    const c = toResolved([{ institution, timing: 'current', ...rec.current }])[0];
    if (i && c) out.push({ institution, initial: i, current: c });
  }
  return out;
}

/** 欧赔（胜平负）机构行收集。 */
function collectEuropeanRows(markets, prefer = 'current') {
  const e = (markets && markets.european) || {};
  const out = [];
  for (const [institution, rec] of Object.entries(e)) {
    const snap = rec && (rec[prefer] || rec.initial || rec.current);
    if (!snap) continue;
    out.push({
      institution,
      timing: rec[prefer] ? prefer : (rec.initial ? 'initial' : 'current'),
      home_odds: snap.home_odds,
      draw_odds: snap.draw_odds,
      away_odds: snap.away_odds,
    });
  }
  return out.filter((r) => [r.home_odds, r.draw_odds, r.away_odds].every((o) => typeof o === 'number' && Number.isFinite(o) && o > 1));
}

/** 大小球机构行收集（线可解析 + 两侧水位合理）。 */
function collectOverUnderRows(markets, prefer = 'current') {
  const ou = (markets && markets.over_under) || {};
  const out = [];
  for (const [institution, rec] of Object.entries(ou)) {
    const snap = rec && (rec[prefer] || rec.initial || rec.current);
    if (!snap) continue;
    out.push({
      institution,
      timing: rec[prefer] ? prefer : (rec.initial ? 'initial' : 'current'),
      line: snap.line,
      over_odds: snap.over_odds,
      under_odds: snap.under_odds,
    });
  }
  return out.filter((r) => isSaneWater(r.over_odds) && isSaneWater(r.under_odds) && parseDepth(r.line).depth != null);
}

/** 大小球机构初/即成对收集。 */
function collectOverUnderPairs(markets) {
  const ou = (markets && markets.over_under) || {};
  const out = [];
  for (const [institution, rec] of Object.entries(ou)) {
    if (!rec || !rec.initial || !rec.current) continue;
    const i = collectOverUnderRows({ over_under: { [institution]: rec } }, 'initial')[0];
    const c = collectOverUnderRows({ over_under: { [institution]: rec } }, 'current')[0];
    if (i && c) out.push({ institution, initial: i, current: c });
  }
  return out;
}

/** 通用参考机构挑选：优先澳门，否则按数值键中位数。 */
function pickAnyReference(rows, numKey) {
  if (!rows.length) return null;
  for (const pref of REFERENCE_INSTITUTIONS) {
    const hit = rows.find((r) => r.institution === pref);
    if (hit) return hit;
  }
  const sorted = [...rows].sort((a, b) => ((a[numKey] ?? 0) - (b[numKey] ?? 0)));
  return sorted[Math.floor(sorted.length / 2)] || null;
}

/**
 * 联赛名 → 粗粒度比赛类型（保守启发式，仅输出有把握的类别）。
 * @param {string} league
 * @returns {'联赛'|'杯赛'|'友谊赛'|'欧战'|'季后赛'|null}
 */
function classifyCompetitionType(league) {
  const s = String(league || '');
  if (/友谊|热身|邀请赛/.test(s)) return '友谊赛';
  if (/杯/.test(s)) return '杯赛';
  if (/欧冠|欧联|欧协|欧洲冠军|欧罗巴|欧会/.test(s)) return '欧战';
  if (/季后赛/.test(s)) return '季后赛';
  if (/联|超|甲|乙|丙|职业/.test(s)) return '联赛';
  return null;
}

const FIELD_ADAPTERS = {
  /**
   * 盘口深度档位。规范字面量：浅盘 / 中盘 / 深盘。
   * 别名由 ops.eq 侧规范化（注册表另有「深盘(≥半一)」等写法）。
   */
  handicap_depth_band(ctx) {
    const rows = toResolved(collectHandicapRows(ctx.markets));
    if (!rows.length) {
      return insufficient('无可用让球盘快照（缺 line 或水位越界）', { field: 'handicap_depth_band', source: SOURCE });
    }
    const ref = pickReference(rows);
    const band = depthBand(ref.depth);
    if (!band) {
      return insufficient(`盘口深度无法分档: depth=${ref.depth}`, { field: 'handicap_depth_band', source: SOURCE });
    }
    return ok(band, {
      source: SOURCE,
      method: `参考机构=${ref.institution}(${ref.timing}) |line|=${ref.depth}${ref.isDual ? '(双盘口中位)' : ''} → 分档`,
    });
  },

  /** 盘口深度数值（|line|），供中文盘口名 lte/gte 比较。 */
  handicap_depth(ctx) {
    const rows = toResolved(collectHandicapRows(ctx.markets));
    if (!rows.length) {
      return insufficient('无可用让球盘快照（缺 line 或水位越界）', { field: 'handicap_depth', source: SOURCE });
    }
    const ref = pickReference(rows);
    return ok(ref.depth, {
      source: SOURCE,
      method: `参考机构=${ref.institution}(${ref.timing}) |line|`,
    });
  },

  /** 上盘（让球方）水位。让球方由 line 符号判定，非固定主队。 */
  water_level(ctx) {
    const rows = toResolved(collectHandicapRows(ctx.markets));
    if (!rows.length) {
      return insufficient('无可用让球盘快照（缺 line 或水位越界）', { field: 'water_level', source: SOURCE });
    }
    const ref = pickReference(rows);
    const env = ok(ref.upperWater, {
      source: SOURCE,
      method: `参考机构=${ref.institution}(${ref.timing}) 上盘=${ref.upper === 'home' ? '主队' : '客队'}水位`,
    });
    // 双盘口取中位属估算，诚实标注
    return ref.isDual ? estimated(env.value, { source: SOURCE, method: env.method, note: '双盘口取中位值' }) : env;
  },

  /** 可用核心机构数（让球盘）。 */
  core_bookmaker_count(ctx) {
    const rows = toResolved(collectHandicapRows(ctx.markets));
    if (!rows.length) {
      return insufficient('无可用让球盘机构数据', { field: 'core_bookmaker_count', source: SOURCE });
    }
    return ok(rows.length, { source: SOURCE, method: '统计可用让球盘机构数（line+水位均有效）' });
  },

  /**
   * 上盘凯利极差。源数据无让球盘凯利字段，按 V9.7 口径由多家机构水位派生。
   * 不足 2 家机构时无法衡量「分歧」，标 insufficient_data（不猜 0）。
   */
  kelly_range(ctx) {
    const rows = toResolved(collectHandicapRows(ctx.markets));
    if (rows.length < 2) {
      return insufficient(`可用机构不足 2 家（当前 ${rows.length} 家），无法计算凯利极差`, {
        field: 'kelly_range',
        source: SOURCE,
      });
    }
    const { range, avgProbHome, n } = deriveKelly(rows);
    if (range == null) {
      return insufficient('凯利派生失败（上盘方向缺失）', { field: 'kelly_range', source: SOURCE });
    }
    return estimated(range, {
      source: SOURCE,
      method: `凯利=水位×全市场平均概率(去抽水归一, avgP_home=${(avgProbHome || 0).toFixed(4)}); 取 ${n} 家机构上盘凯利极差`,
      note: '源数据无让球盘凯利字段，本值为派生估算',
    });
  },

  /** 初盘让球深度（|line| 数值，参考机构初盘）。 */
  initial_line(ctx) {
    const rows = toResolved(collectHandicapRows(ctx.markets, 'initial'));
    if (!rows.length) {
      return insufficient('无初盘让球盘快照（缺 line 或水位越界）', { field: 'initial_line', source: SOURCE });
    }
    const ref = pickReference(rows);
    return ok(ref.depth, {
      source: SOURCE,
      method: `参考机构=${ref.institution}(初盘) |line|=${ref.depth}${ref.isDual ? '(双盘口中位)' : ''}`,
    });
  },

  /** 让球盘线变化（初盘→即盘，参考机构）：升盘 / 退盘 / 横盘。退盘=盘口变浅。 */
  line_change(ctx) {
    const pairs = collectHandicapPairs(ctx.markets);
    if (!pairs.length) {
      return insufficient('缺少同机构初盘+即盘让球盘快照', { field: 'line_change', source: SOURCE });
    }
    const ref = pickReference(pairs.map((p) => p.current));
    const pair = pairs.find((p) => p.institution === ref.institution);
    const d = ref.depth - pair.initial.depth;
    return ok(d > 0.05 ? '升盘' : d < -0.05 ? '退盘' : '横盘', {
      source: SOURCE,
      method: `参考机构=${ref.institution} 初盘${pair.initial.depth} → 即盘${ref.depth}`,
    });
  },

  /** 让球盘线变化幅度（|即盘-初盘|，参考机构）。 */
  line_change_magnitude(ctx) {
    const pairs = collectHandicapPairs(ctx.markets);
    if (!pairs.length) {
      return insufficient('缺少同机构初盘+即盘让球盘快照', { field: 'line_change_magnitude', source: SOURCE });
    }
    const ref = pickReference(pairs.map((p) => p.current));
    const pair = pairs.find((p) => p.institution === ref.institution);
    return ok(+(Math.abs(ref.depth - pair.initial.depth)).toFixed(2), {
      source: SOURCE,
      method: `参考机构=${ref.institution} |即盘-初盘|`,
    });
  },

  /** 大球水位变化（初盘→即盘，参考机构）：升水 / 降水 / 横水。 */
  over_water_move(ctx) {
    const pairs = collectOverUnderPairs(ctx.markets);
    if (!pairs.length) {
      return insufficient('缺少同机构初盘+即盘大小球快照', { field: 'over_water_move', source: SOURCE });
    }
    const ref = pickAnyReference(pairs.map((p) => p.current), 'over_odds');
    const pair = pairs.find((p) => p.institution === ref.institution);
    const d = ref.over_odds - pair.initial.over_odds;
    return ok(d > 0.01 ? '升水' : d < -0.01 ? '降水' : '横水', {
      source: SOURCE,
      method: `参考机构=${ref.institution} 大球水位 初盘${pair.initial.over_odds} → 即盘${ref.over_odds}`,
    });
  },

  /** 总进球盘线变化（初盘→即盘，参考机构）：升盘 / 降盘 / 横盘。 */
  total_goals_line_move(ctx) {
    const pairs = collectOverUnderPairs(ctx.markets);
    if (!pairs.length) {
      return insufficient('缺少同机构初盘+即盘大小球快照', { field: 'total_goals_line_move', source: SOURCE });
    }
    const ref = pickAnyReference(pairs.map((p) => p.current), 'over_odds');
    const pair = pairs.find((p) => p.institution === ref.institution);
    const c = parseDepth(ref.line).depth;
    const i = parseDepth(pair.initial.line).depth;
    const d = c - i;
    return ok(d > 0.05 ? '升盘' : d < -0.05 ? '降盘' : '横盘', {
      source: SOURCE,
      method: `参考机构=${ref.institution} 大小球线 初盘${pair.initial.line} → 即盘${ref.line}`,
    });
  },

  /** 比赛类型（联赛名启发式，粗粒度）：联赛 / 杯赛 / 友谊赛 / 欧战 / 季后赛。 */
  competition_type(ctx) {
    const league = ctx.match && ctx.match.league;
    if (!league) {
      return insufficient('缺少联赛字段', { field: 'competition_type', source: SOURCE });
    }
    const t = classifyCompetitionType(league);
    if (!t) {
      return insufficient(`联赛名「${league}」无法判定比赛类型`, { field: 'competition_type', source: SOURCE });
    }
    return estimated(t, {
      source: SOURCE,
      method: `联赛名「${league}」启发式分类`,
      note: '粗粒度分类（联赛/杯赛/友谊赛/欧战/季后赛）；细粒度如两回合/单场决胜不在本字段表达',
    });
  },

  /** 机构共振数（当前让球盘同深度机构数，静态共识近似）。 */
  bookmakers_resonant_count(ctx) {
    const rows = toResolved(collectHandicapRows(ctx.markets));
    if (!rows.length) {
      return insufficient('无让球盘机构数据', { field: 'bookmakers_resonant_count', source: SOURCE });
    }
    const ref = pickReference(rows);
    const n = rows.filter((r) => Math.abs(r.depth - ref.depth) < 1e-9).length;
    return estimated(n, {
      source: SOURCE,
      method: `参考机构=${ref.institution}(depth=${ref.depth})，同深度机构数`,
      note: '静态同深度共识近似，未含变动方向（R05 运动共振语义后续补充）',
    });
  },
};

/** 已实现字段清单。 */
function listFields() {
  return Object.keys(FIELD_ADAPTERS);
}

/**
 * 取单个字段（带进程内缓存，同一 ctx 内多 atom 复用）。
 * @param {string} name
 * @param {{markets:Object, match?:Object, t?:string}} ctx
 */
function getField(name, ctx) {
  if (!FIELD_ADAPTERS[name]) {
    return insufficient(`字段「${name}」尚未实现（V9.7 引擎逐步覆盖中）`, { field: name });
  }
  if (!ctx || !ctx.markets) {
    return insufficient('缺少 markets 上下文', { field: name });
  }
  if (!ctx._cache) ctx._cache = {};
  if (!(name in ctx._cache)) ctx._cache[name] = FIELD_ADAPTERS[name](ctx);
  return ctx._cache[name];
}

module.exports = {
  FIELD_ADAPTERS,
  listFields,
  getField,
  collectHandicapRows,
  toResolved,
  pickReference,
  collectHandicapPairs,
  collectEuropeanRows,
  collectOverUnderRows,
  collectOverUnderPairs,
  pickAnyReference,
  classifyCompetitionType,
};
