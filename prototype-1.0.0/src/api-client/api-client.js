// ============================================================================
// 原型-后端集成 · api-client —— 前后端契约客户端
// 阶段 2.5。职责：
//   1) API 客户端层：封装 比赛 / 特征 / 分析 / 规则 / 回测 / AI 候选 六类能力。
//   2) 双适配器：http（fetch 后端 REST，默认）+ mock（离线降级，不用于首页数据）。
//   3) 模式开关：localStorage 持久化（oe_api_mode_v2），默认真实（后端 API），可切离线 Mock。
// 使用（浏览器）：window.__ApiClient.getApi().listRules()  等。
// 纯脚本、无 DOM 依赖（DOM 注入均在 init() 中集中、且存在性守卫）。
// ============================================================================
(function (global) {
  'use strict';

  var MODE_KEY = 'oe_api_mode_v2'; // v2：已切真实数据开发，键迭代使旧的 mock 持久化失效
  var DEFAULT_BASE = 'http://localhost:3000'; // 后端服务地址（对齐 server OE_PORT 默认 3000）
  var DEFAULT_MODE = 'real'; // 默认真实数据（后端 API）；mock 仅作离线降级

  // ───────────────────────── 工具 ─────────────────────────
  function storageGet(key, dflt) {
    try {
      if (typeof global.localStorage !== 'undefined') {
        var v = global.localStorage.getItem(key);
        return v == null ? dflt : v;
      }
    } catch (e) { /* 忽略隐私模式 */ }
    return dflt;
  }
  function storageSet(key, val) {
    try {
      if (typeof global.localStorage !== 'undefined') global.localStorage.setItem(key, val);
    } catch (e) { /* 忽略 */ }
  }

  // ── 体彩官方数据「当天缓存」（公益网站减负）─────────────────────────
  // 中国体彩官网为公益网站：自动获取每天最多一次，跨天自动失效；
  // 仅 opts.refresh（用户手动刷新）才发起新请求并更新缓存。
  function bjDayKey() {
    var d = new Date(Date.now() + 8 * 3600000);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  function dayCacheRead(key) {
    var raw = storageGet(key + ':' + bjDayKey(), null);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function dayCacheWrite(key, data) {
    storageSet(key + ':' + bjDayKey(), JSON.stringify(data));
  }

  // ───────────────────────── 契约基元 ─────────────────────────
  /** 统一响应壳：{ ok, data?, error? } */
  function okBody(data) { return { ok: true, data: data }; }
  function errBody(error) { return { ok: false, error: error }; }

  // ───────────────────────── Mock 适配器 ─────────────────────────
  // 读原型全局数据（data.js / laws.js / dsl.js / ai.js / backtest.js），保证离线自洽。
  var mock = {
    name: 'mock',

    listMatches: function () {
      var M = global.MATCHES || [];
      return okBody(M.map(function (m) {
        return { match_id: m.id, league: m.league, home_team: m.home, away_team: m.away, kickoff: m.kickoff };
      }));
    },

    getAnalysis: function (matchId) {
      var M = global.MATCHES || [];
      var m = M.find(function (x) { return String(x.id) === String(matchId); });
      if (!m) return errBody('match_not_found');
      var dsl = global.__DSL;
      var hits = [];
      var reasoning = [];
      if (dsl && typeof dsl.analyze === 'function') {
        var A = dsl.analyze(m);
        hits = (A && A.list || []).map(function (x) {
          return { rule_id: x.id, hit: !!x.hit, dir: x.dir };
        });
        reasoning = hits.map(function (h) {
          return { rule_id: h.rule_id, hit: h.hit, dir: h.dir, note: h.hit ? '条件满足，纳入推理链' : '未命中' };
        });
      }
      return okBody({ match_id: matchId, hits: hits, reasoning: reasoning });
    },

    // 单场特征快照（mock）：复用原型 features.js 的 computeFeatures（已为族嵌套结构），
    // 与 http 适配器归一化后的 shape 完全一致 → 视图代码不区分模式。
    getFeature: function (matchId) {
      var M = global.MATCHES || [];
      var m = M.find(function (x) { return String(x.id) === String(matchId); });
      if (!m) return errBody('match_not_found');
      var f = (typeof global.computeFeatures === 'function') ? global.computeFeatures(m) : {};
      return okBody({
        match_id: m.id,
        league: m.league,
        home_team: m.home,
        away_team: m.away,
        match_time: m.kickoff || null,
        merged: false,
        trust_level: 'provisional',
        computed_at: null,
        feature_version: 'mock',
        features: f,
        meta: { snapshot_count: (m.snapshots || []).length, filtered_out: 0, sources: ['mock'] },
        mode: 'mock',
      });
    },

    listRules: function () {
      var R = global.RULES || [];
      return okBody(R.map(function (r) {
        return {
          id: r.id,
          version_id: r.id + '#1',
          name: r.name || null,
          conclusion: r.conclusion || r.name || '',
          category: r.category || r.family || 'unknown',
          rule_type: null,
          status: 'active',        // 原型规则已在用
          version: 1,
          trust_level: 'provisional',
          priority: null,
          base_confidence: null,
          // 原型规则用数值 direction（1/-1/0）表示方向，归一化成词（仅 mock 沙盒语义）
          declared_direction: (typeof r.direction === 'number')
            ? (r.direction > 0 ? '上盘' : (r.direction < 0 ? '下盘' : '风险'))
            : null,
          evidence_count: null,
          valid_from: null,
          valid_to: null,
        };
      }));
    },

    // 版本链（mock）：与 http 瘦视图保持同形，多一列 condition_summary 供沙盒说明。
    getRuleVersions: function (ruleId) {
      var R = global.RULES || [];
      var r = R.find(function (x) { return x.id === ruleId; });
      if (!r) return errBody('rule_not_found');
      return okBody([{
        version_id: r.id + '#1',
        rule_id: r.id,
        version: 1,
        status: 'active',
        category: r.category || r.family || 'unknown',
        rule_type: null,
        name: r.name || null,
        trust_level: 'provisional',
        conclusion: r.conclusion || r.name || '',
        declared_direction: (typeof r.direction === 'number')
          ? (r.direction > 0 ? '上盘' : (r.direction < 0 ? '下盘' : '风险'))
          : null,
        base_confidence: null,
        priority: null,
        evidence_count: null,
        valid_from: null,
        valid_to: null,
        previous_version_id: null,
        condition_summary: 'prototype:' + r.id,
        created_at: '2026-08-14T00:00:00+08:00',
      }]);
    },

    // 回测（mock）：与 http 适配器**同形**归一化契约。mock 沙盒无 V9.7 真实台账 → v97_real 恒 null。
    getBacktest: function (ruleId) {
      var bt = global.__BACKTEST;
      if (!bt || typeof bt.makeMetrics !== 'function') return errBody('backtest_unavailable');
      var rep = bt.makeMetrics(ruleId);
      var ev = (typeof bt.evalBt === 'function') ? bt.evalBt(rep) : { adjudication: null };
      var eligible = rep.eligible != null ? rep.eligible : 0;
      return okBody({
        rule_id: ruleId,
        rule_name: null,
        rule_version: 1,
        job_id: 'job_' + ruleId,
        adjudication: ev.adjudication || null,
        sample_size: eligible,
        metrics: {
          sample_size: eligible,
          direction_count: rep.direction != null ? rep.direction : null,
          hit_count: rep.hitCount != null ? rep.hitCount : null,
          hit_rate: rep.hitRate != null ? rep.hitRate : null,
          roi: rep.roi != null ? rep.roi : null,
          max_drawdown: rep.maxDD != null ? rep.maxDD : null,
          time_stability: rep.timeStab != null ? rep.timeStab : null,
          league_coverage: rep.league != null ? rep.league : null,
          leagues: rep.leagueNames || [],
        },
        // 阈值为后端同形扁平数值表（{hit_rate:0.55,…}）；原型沙盒是 {op,value} 富形状 → 取 value 归一化
        thresholds: (function (t) {
          var out = {};
          var src = t || {};
          for (var k in src) {
            if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
            var v = src[k];
            out[k] = (typeof v === 'number') ? v : (v && v.value != null ? v.value : null);
          }
          return out;
        })(bt.THRESHOLDS),
        date_range: null,
        synthetic: false,
        v97_real: null,
        admission_detail: rep.failDist || null, // mock 沙盒有逐项失败分布；后端当前为 null
        untrusted_count: rep.untrusted != null ? rep.untrusted : null,
        mode: 'mock',
      });
    },

    listAiCandidates: function () {
      var C = global.AI_C || [];
      return okBody(C.map(function (c) {
        return { id: c.id, pattern: c.pattern, source: c.source, status: c.status, trust: 'untrusted' };
      }));
    },

    reviewAiCandidate: function (candidateId, verdict) {
      var w = global;
      if (verdict === 'approve' && typeof w.__aiAdopt === 'function') return okBody(w.__aiAdopt(candidateId) || { id: candidateId, verdict: 'approve' });
      if (verdict === 'reject' && typeof w.__aiReject === 'function') return okBody(w.__aiReject(candidateId) || { id: candidateId, verdict: 'reject' });
      return errBody('handler_missing');
    },

    getManualOddsStatus: function () {
      // Mock 占位：真实本地人工盘赔源仅在 http 适配（后端扫描）下可观测。
      return okBody({
        source_id: 'src_manual_odds',
        name: '本地人工盘赔',
        trust_level: 'provisional',
        status: 'mock_placeholder',
        reason: 'mock 模式不扫描本地目录，切到后端 API 可实时观测',
        meta: { total: 0, admitted: 0, rejected: 0 },
        matches: [],
      });
    },

    // 人工盘赔目录绑定（统一目录 / 场次目录）——Mock 仅占位，真实读写需后端 API。
    listManualOddsDirs: function () {
      return okBody({ unified: { binding_id: 'unified', dir_path: null, origin: null, env_fallback: null, overridden: false, last_scanned_at: null, last_result: null }, matches: [] });
    },
    setManualOddsDir: function () {
      return errBody('mock_mode_readonly');
    },
    removeManualOddsDir: function () {
      return errBody('mock_mode_readonly');
    },

    getSportteryOddsStatus: function () {
      // Mock 占位：竞彩官方赔率仅在 http 适配（后端直连 sporttery.cn）下可观测。
      return okBody({
        source_id: 'src_odds_sporttery',
        name: '竞彩官方赔率',
        trust_level: 'trusted',
        status: 'mock_placeholder',
        reason: 'mock 模式不直连 webapi.sporttery.cn，切到后端 API 可实时观测',
        meta: { total: 0, admitted: 0, rejected: 0 },
        matches: [],
      });
    },

    getScheduleStatus: function () {
      // Mock 占位：竞彩官方赛程仅在 http 适配（后端经 env 端点）下可观测。
      return okBody({
        source_id: 'src_schedule_sporttery',
        status: 'mock_placeholder',
        reason: 'mock 模式不拉取竞彩赛程，切到后端 API 可实时观测',
        meta: { total: 0, admitted: 0, rejected: 0 },
        matches: [],
      });
    },

    getManualAnalysis: function (matchId) {
      // Mock 占位：真实盘口数据→特征→推理链仅在 http 适配（后端扫描 md）下可用。
      return okBody({
        source: 'mock_placeholder',
        match_id: matchId,
        reasoning: [],
        arbitration: { direction: 'undecidable', manual_review_required: true },
        feat_errors: [],
      });
    },

    getMergedPool: function () {
      // Mock 占位：双源合并（竞彩赛程 ∪ 本地盘赔）仅在 http 适配下可观测。
      return okBody({
        source: 'mock_placeholder',
        status: 'degraded',
        reason: 'mock 模式不合并真实源，切到后端 API 可实时观测',
        meta: { schedule_total: 0, manual_total: 0, aligned: 0, manual_only: 0, conflicts: 0, pool_size: 0 },
        pool: [],
        dismissed: [],
      });
    },

    getMergedAnalysis: function (matchId) {
      return okBody({
        source: 'mock_placeholder',
        match_id: matchId,
        reasoning: [],
        arbitration: { direction: 'undecidable', manual_review_required: true },
        feat_errors: [],
      });
    },

    // P0② 预测台账（mock 兜底：localStorage 自洽，真实语义以后端为准）
    savePrediction: function (matchId, opts) {
      var list = mockPredictionLedger();
      var id = 'pred_mock_' + matchId + '_' + Date.now();
      list.push({ prediction_id: id, match_id: matchId, final_direction: 'favor_upper', total_goals_direction: null, final_confidence: 0.6, created_at: new Date().toISOString(), result: null, meta: null });
      storageSet('oe_mock_predictions', JSON.stringify(list));
      return okBody({ prediction_id: id, match_id: matchId, final_direction: 'favor_upper', total_goals_direction: null, final_confidence: 0.6, duplicate: false, note: 'mock' });
    },
    listPredictions: function () {
      return okBody(mockPredictionLedger());
    },
    getPrediction: function (id) {
      var list = mockPredictionLedger();
      var p = list.find(function (x) { return x.prediction_id === id; });
      return p ? okBody(p) : errBody('prediction_not_found');
    },
    backfillPrediction: function (id, result) {
      var list = mockPredictionLedger();
      var p = list.find(function (x) { return x.prediction_id === id; });
      if (!p) return errBody('prediction_not_found');
      p.result = { match_result: (result && result.match_result) || 'upper', prediction_correct: true, verifiable: true, known_at: new Date().toISOString(), backfilled_at: new Date().toISOString() };
      storageSet('oe_mock_predictions', JSON.stringify(list));
      return okBody({ prediction_id: id, duplicate: false, result: p.result });
    },
  };

  function mockPredictionLedger() {
    try {
      var raw = storageGet('oe_mock_predictions', '[]');
      return JSON.parse(raw) || [];
    } catch (e) { return []; }
  }

  // ───────────────────────── HTTP 适配器 ─────────────────────────
  // fetch 后端 REST；所有请求统一 { baseUrl + path }，响应壳 { ok, data?, error? }。
  // 契约归一化：把后端字段映射为视图消费的 mock 契约形状（mock 与真实模式不改视图代码）。
  function http(baseUrl) {
    function req(method, path, body) {
      if (typeof global.fetch !== 'function') {
        return Promise.reject(errBody('fetch_unavailable'));
      }
      return global.fetch(baseUrl + path, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      }).then(function (res) {
        return res.json().then(function (j) {
          if (!res.ok) return errBody(j && j.error || ('http_' + res.status));
          return okBody(j && j.data !== undefined ? j.data : j);
        });
      });
    }

    // 后端规则 → 视图契约 { id, name, conclusion, category, rule_type, declared_direction, ... }
    // 注：declared_direction 是规则 v97.effects 声明的**语义文本**（如「诱小→防大」），
    // 不是本场求值出的上盘/下盘；展示层须原样呈现并注明「声明语义」。
    function ruleView(r) {
      return {
        id: r.rule_id,
        version_id: r.version_id,
        name: r.name || null,
        conclusion: r.conclusion,
        category: r.category,
        rule_type: r.rule_type || null,
        status: r.status,
        version: r.version,
        trust_level: r.trust_level,
        priority: r.priority != null ? r.priority : null,
        base_confidence: r.base_confidence != null ? r.base_confidence : null,
        declared_direction: r.declared_direction || null,
        evidence_count: r.evidence_count != null ? r.evidence_count : null,
        valid_from: r.valid_from || null,
        valid_to: r.valid_to || null,
      };
    }
    // 后端 AI 候选 → 视图契约 { id, pattern, source, status, trust }
    function candidateView(c) {
      return {
        id: c.id,
        pattern: c.rationale || c.field || '',
        source: c.candidate_source || 'ai',
        status: c.candidate_status || 'candidate',
        trust: c.trust || 'untrusted',
      };
    }
    // 后端推理链 → 视图契约 { rule_id, hit, dir, note }
    function reasoningView(h) {
      return { rule_id: h.rule_id, hit: !!h.hit, dir: h.dir, note: h.note || '' };
    }

    // ── 特征契约归一化：后端点分扁平键 → 前端六族嵌套键 ──
    // 后端 features 为注册表点分命名（institution.diff_max），前端特征页按族渲染（cross.handicap_dispersion）。
    // 映射按「同一语义」逐项对齐；未列出的后端键不进入族结构（前端也不消费）。
    var FLAT_TO_FAMILY = {
      'institution.diff_max': ['cross', 'handicap_dispersion'],
      'water.upper.dispersion': ['cross', 'home_water_dispersion'],
      'water.lower.dispersion': ['cross', 'away_water_dispersion'],
      'handicap.change': ['temp', 'handicap_movement'],
      'water.upper.change': ['temp', 'home_water_movement'],
      'water.lower.change': ['temp', 'away_water_movement'],
      'move_pattern': ['temp', 'move_pattern'],
      'stability_flag': ['temp', 'stability_flag'],
      'water.upper.drop_count': ['temp', 'home_water_drop_count'],
      'water.upper.rise_count': ['temp', 'home_water_rise_count'],
      'institution.sync_count': ['reso', 'sync_handicap_count'],
      'consensus_direction': ['reso', 'consensus_direction'],
      'kelly_index.max': ['anom', 'maxKelly'],
      'kelly_index.min': ['anom', 'minKelly'],
      'kelly_index.divergence': ['anom', 'kelly_divergence'],
      'volume.ratio': ['anom', 'volume_anomaly'],
      'kelly_index.home_max': ['onex', 'kelly_home_max'],
      'betfair.turnover': ['betfair', 'turnover'],
      'betfair.heat': ['betfair', 'heat_max'],
      'betfair.dominant_ratio': ['betfair', 'dominant_ratio'],
    };
    /** 扁平特征 → 族嵌套；后端未产出的字段保持「键不存在」（前端据此标注未产出，不补零）。 */
    function toFamilyShape(flat) {
      var out = { cross: {}, temp: {}, reso: {}, anom: {}, onex: {}, betfair: {} };
      var src = flat || {};
      for (var k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        var m = FLAT_TO_FAMILY[k];
        if (m) out[m[0]][m[1]] = src[k];
      }
      return out;
    }

    return {
      name: 'http',
      listMatches: function () { return req('GET', '/api/matches'); },
      getAnalysis: function (id) {
        return req('GET', '/api/analysis/' + encodeURIComponent(id)).then(function (r) {
          if (!r.ok) return r;
          r.data.reasoning = (r.data.reasoning || []).map(reasoningView);
          return r;
        });
      },
      listRules: function () {
        return req('GET', '/api/rules').then(function (r) {
          if (!r.ok) return r;
          r.data = (r.data || []).map(ruleView);
          return r;
        });
      },
      getRuleVersions: function (id) { return req('GET', '/api/rules/' + encodeURIComponent(id) + '/versions'); },
      // 单场特征快照：归一化为族嵌套 shape（视图只认族结构，mock/http 同形）。
      getFeature: function (id) {
        return req('GET', '/api/features/' + encodeURIComponent(id)).then(function (r) {
          if (!r.ok) return r;
          r.data.features = toFamilyShape(r.data.features);
          r.data.mode = 'http';
          return r;
        });
      },
      // 回测：统一为归一化契约。真实数字在 v97_real（旧 DSL 门禁 synthetic=true 仅为占位）。
      getBacktest: function (id) {
        return req('GET', '/api/backtest/' + encodeURIComponent(id)).then(function (r) {
          if (!r.ok) return r;
          var d = r.data || {};
          r.data = {
            rule_id: d.rule_id,
            rule_name: d.rule_name || null,
            rule_version: d.rule_version != null ? d.rule_version : null,
            job_id: d.job_id,
            adjudication: d.adjudication,
            sample_size: d.sample_size != null ? d.sample_size : 0,
            metrics: d.metrics || null,
            thresholds: d.thresholds || null,
            date_range: d.date_range || null,
            synthetic: !!d.synthetic,
            v97_real: d.v97_real || null,
            admission_detail: d.admission_detail || null,
            untrusted_count: d.untrusted_count != null ? d.untrusted_count : null,
            mode: 'http',
          };
          return r;
        });
      },
      listAiCandidates: function () {
        return req('GET', '/api/ai/candidates').then(function (r) {
          if (!r.ok) return r;
          r.data = (r.data && r.data.candidates || []).map(candidateView);
          return r;
        });
      },
      reviewAiCandidate: function (id, verdict) { return req('POST', '/api/ai/candidates/' + encodeURIComponent(id) + '/review', { verdict: verdict }); },
      getManualOddsStatus: function () {
        return req('GET', '/api/sources/manual-odds').then(function (r) {
          if (!r.ok) return r;
          r.data.mode = 'http';
          return r;
        });
      },

      // 人工盘赔目录绑定：统一目录（scope=unified）+ 场次目录（scope=match）。
      // 写操作在后端做路径/绑定键校验与重扫，前端只透传与展示错误码。
      listManualOddsDirs: function () {
        return req('GET', '/api/sources/manual-odds/dirs');
      },
      setManualOddsDir: function (payload) {
        var p = payload || {};
        return req('POST', '/api/sources/manual-odds/dirs', {
          scope: p.scope,
          dir_path: p.dir_path,
          match_key: p.match_key == null ? null : p.match_key,
          match_key_kind: p.match_key_kind == null ? null : p.match_key_kind,
          label: p.label == null ? null : p.label,
        });
      },
      removeManualOddsDir: function (bindingId) {
        return req('POST', '/api/sources/manual-odds/dirs/' + encodeURIComponent(bindingId) + '/remove', {});
      },

      getSportteryOddsStatus: function (opts) {
        var force = !!(opts && opts.refresh);
        // 当天缓存命中 → 不发请求（公益网站减负，自动获取每天最多一次）
        // 缓存键带结构版本（:2），旧结构缺 serial/business_date/handicap 时自动失效重拉。
        if (!force) {
          var cached = dayCacheRead('oe:sporttery-odds:2');
          if (cached) { cached.cached = 'local'; cached.mode = 'http'; return Promise.resolve(okBody(cached)); }
        }
        return req('GET', '/api/sources/sporttery-odds' + (force ? '?refresh=1' : '')).then(function (r) {
          if (!r.ok) return r;
          r.data.mode = 'http';
          dayCacheWrite('oe:sporttery-odds:2', r.data);
          return r;
        });
      },

      getScheduleStatus: function (opts) {
        var force = !!(opts && opts.refresh);
        if (!force) {
          var cached = dayCacheRead('oe:sporttery-schedule');
          if (cached) { cached.cached = 'local'; cached.mode = 'http'; return Promise.resolve(okBody(cached)); }
        }
        return req('GET', '/api/sources/schedule' + (force ? '?refresh=1' : '')).then(function (r) {
          if (!r.ok) return r;
          r.data.mode = 'http';
          dayCacheWrite('oe:sporttery-schedule', r.data);
          return r;
        });
      },

      getManualAnalysis: function (matchId) {
        return req('GET', '/api/manual-odds/analysis/' + encodeURIComponent(matchId)).then(function (r) {
          if (!r.ok) return r;
          r.data.mode = 'http';
          return r;
        });
      },

      getMergedPool: function () {
        return req('GET', '/api/sources/merged').then(function (r) {
          if (!r.ok) return r;
          r.data.mode = 'http';
          return r;
        });
      },

      getMergedAnalysis: function (matchId) {
        return req('GET', '/api/merged/analysis/' + encodeURIComponent(matchId)).then(function (r) {
          if (!r.ok) return r;
          r.data.reasoning = (r.data.reasoning || []).map(reasoningView);
          r.data.mode = 'http';
          return r;
        });
      },

      // ── P0② 预测台账：发布 / 列表 / 单条 / 幂等赛果回填 ──
      savePrediction: function (matchId, opts) {
        return req('POST', '/api/predictions', {
          match_id: matchId,
          idempotency_key: (opts && opts.idempotency_key) || ('pred:' + matchId),
        });
      },
      listPredictions: function () {
        return req('GET', '/api/predictions');
      },
      getPrediction: function (id) {
        return req('GET', '/api/predictions/' + encodeURIComponent(id));
      },
      backfillPrediction: function (id, result) {
        return req('POST', '/api/predictions/' + encodeURIComponent(id) + '/result', { result: result || null });
      },
    };
  }

  // ───────────────────────── 模式开关 ─────────────────────────
  function getMode() { return storageGet(MODE_KEY, DEFAULT_MODE); }
  function setMode(mode) {
    var m = mode === 'real' || mode === 'http' ? 'real' : 'mock';
    storageSet(MODE_KEY, m);
    if (typeof global.document !== 'undefined') {
      global.document.documentElement.setAttribute('data-mode', m);
    }
    return m;
  }
  function getBaseUrl() {
    return storageGet('oe_api_base', DEFAULT_BASE) || DEFAULT_BASE;
  }
  function setBaseUrl(url) { storageSet('oe_api_base', url); return url; }

  /** 返回当前模式的活动适配器。 */
  function getApi() {
    return getMode() === 'real' ? http(getBaseUrl()) : mock;
  }

  /** 状态快照（供 UI/调试）。 */
  function getStatus() {
    return {
      mode: getMode(),
      baseUrl: getBaseUrl(),
      adapter: getMode() === 'real' ? 'http' : 'mock',
      capability: mock.name + ' / http',
    };
  }

  // ───────────────────────── DOM 集成（守护式） ─────────────────────────
  // 注入顶部模式徽章 + 切换控件；节点/父容器不存在时静默跳过。
  function initStatusBadge() {
    if (typeof global.document === 'undefined') return;
    var d = global.document;
    var host = d.querySelector('.sf-hint');
    var dataMode = storageGet(MODE_KEY, DEFAULT_MODE);
    d.documentElement.setAttribute('data-mode', dataMode);
    if (!host) return;

    // 幂等：render() 每次进入 api 页都会调 init()，徽章已存在时仅同步模式文案
    var existing = d.getElementById('api-mode-badge');
    if (existing) {
      var modeEl = existing.querySelector('.amb-mode');
      if (modeEl) modeEl.textContent = dataMode === 'real' ? '后端API' : 'mock数据';
      return;
    }

    var el = d.createElement('div');
    el.id = 'api-mode-badge';
    el.className = 'api-mode-badge';
    el.title = '后端集成 · 点击切换 mock/real 数据源（localStorage: oe_api_mode）';
    el.innerHTML =
      '<span class="amb-dot"></span>' +
      '<span class="amb-mode">' + (dataMode === 'real' ? '后端API' : 'mock数据') + '</span>' +
      '<span class="amb-toggle">⇄</span>';
    el.addEventListener('click', function () {
      var next = setMode(getMode() === 'real' ? 'mock' : 'real');
      var m = el.querySelector('.amb-mode');
      if (m) m.textContent = next === 'real' ? '后端API' : 'mock数据';
      notifyStatus(next);
    });
    host.appendChild(el);
  }

  function notifyStatus(mode) {
    if (typeof global.document === 'undefined') return;
    if (typeof global.toast === 'function') global.toast('数据源已切换：' + (mode === 'real' ? '后端 API' : 'Mock 数据'));
  }

  function init() {
    setMode(getMode()); // 应用持久化模式到 document
    initStatusBadge();
    return getStatus();
  }

  var ApiClient = {
    MODE_KEY: MODE_KEY,
    DEFAULT_BASE: DEFAULT_BASE,
    mock: mock,
    http: http,
    getMode: getMode, setMode: setMode,
    getBaseUrl: getBaseUrl, setBaseUrl: setBaseUrl,
    getApi: getApi, getStatus: getStatus,
    init: init,
  };

  global.__ApiClient = ApiClient;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));