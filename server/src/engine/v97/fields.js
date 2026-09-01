// ============================================================================
// V9.7 引擎 · fields —— 字段适配器（A 类：由盘口快照机械推导）
//
// 契约：
//  - 每个字段返回「信封」而非裸值（见 envelope.js），缺值一律 insufficient_data。
//  - 只依赖 adaptMatch 产出的 markets 结构，不直接读库，便于测试与复用。
//  - 取数口径：优先即盘(current)，缺失回退初盘(initial)，并在 method 中留痕。
//
// 已实现字段（覆盖 R13 / R01）：
//   handicap_depth_band  盘口深度档位（浅盘/中盘/深盘，规范字面量）
//   handicap_depth       盘口深度数值（供中文盘口名的 lte/gte 比较）
//   water_level          上盘（让球方）水位
//   core_bookmaker_count 可用核心机构数
//   kelly_range          上盘凯利极差（多家机构派生）
// ============================================================================
'use strict';

const { ok, estimated, insufficient } = require('./envelope');
const { resolveHandicap, depthBand, isSaneWater, deriveKelly } = require('./handicap');

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

module.exports = { FIELD_ADAPTERS, listFields, getField, collectHandicapRows, toResolved, pickReference };
