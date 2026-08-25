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

    listRules: function () {
      var R = global.RULES || [];
      return okBody(R.map(function (r) {
        return {
          id: r.id,
          conclusion: r.conclusion,
          category: r.category || 'odds_change',
          status: 'active',        // 原型规则已在用
          version: 1,
          trust_level: 'provisional',
          threshold: r.threshold,
        };
      }));
    },

    getRuleVersions: function (ruleId) {
      var R = global.RULES || [];
      var r = R.find(function (x) { return x.id === ruleId; });
      if (!r) return errBody('rule_not_found');
      return okBody([{
        version_id: r.id + '#1',
        rule_id: r.id,
        version: 1,
        status: 'active',
        trust_level: 'provisional',
        category: r.category || 'odds_change',
        conclusion: r.conclusion,
        condition_summary: 'prototype:' + r.id,
        created_at: '2026-08-14T00:00:00+08:00',
      }]);
    },

    getBacktest: function (ruleId) {
      var bt = global.__BACKTEST;
      if (!bt || typeof bt.makeMetrics !== 'function') return errBody('backtest_unavailable');
      var rep = bt.makeMetrics(ruleId);
      return okBody({
        rule_id: ruleId,
        admitted: rep.eligible,
        metrics: rep.metrics,
        thresholds: bt.THRESHOLDS,
        admission: rep.checks,
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
  };

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

    // 后端规则 → 视图契约 { id, conclusion, category, status, version, trust_level }
    function ruleView(r) {
      return {
        id: r.rule_id,
        conclusion: r.conclusion,
        category: r.category,
        status: r.status,
        version: r.version,
        trust_level: r.trust_level,
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
      getBacktest: function (id) {
        return req('GET', '/api/backtest/' + encodeURIComponent(id)).then(function (r) {
          if (!r.ok) return r;
          r.data = {
            rule_id: r.data.rule_id,
            admitted: r.data.sample_size,
            metrics: r.data.metrics,
            thresholds: r.data.thresholds,
            admission: { adjudication: r.data.adjudication, job_id: r.data.job_id },
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