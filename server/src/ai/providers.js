// ============================================================================
// AI 引擎 · providers —— 多模型适配层
// 配置驱动（server/config/ai-providers.json）：切换模型/凭证不改业务代码。
//   · api_key 一律经环境变量注入（api_key_env → process.env），不接触数据凭证仓。
//   · 路由：默认走 default 配置的 provider；按序尝试 enabled 的 provider。
//   · 降级：primary 失败 → 逐个尝试剩余 enabled ✓ → 全失败回退 stub（离线确定性）。
//   · 重试：单 provider 内尝试 retries 次。
// chat() 返回 Promise<string>；面向网络的 provider 使用全局 fetch（Node>=22）。
// ============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Logger } = require('../lib/logger');

const logger = new Logger({ service: 'ai-engine' });

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'ai-providers.json');

/**
 * 加载 provider 配置。
 * @returns {{ default:string, providers:Object[] }}
 */
function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

/** 解析 provider 对应的环境变量中的 API Key（不存在/为空 → null）。 */
function resolveApiKey(provider) {
  if (!provider.api_key_env) return null;
  const v = process.env[provider.api_key_env];
  return v && v.length ? v : null;
}

/**
 * 离线确定性 provider（测试 / 无网络兜底）。
 * chat() 忽略提示，返回内部数据源的规范化 JSON 文本。
 */
class StubProvider {
  constructor(cfg) {
    this.id = cfg.id;
    this.model = cfg.model;
  }
  /** @param {Object} seed { kind, payload } 由调用方传入结构化输入 */
  async chat({ seed = null } = {}) {
    return JSON.stringify(seed);
  }
}

/**
 * 面向网络的 LLM provider（OpenAI 兼容 chat/completions）。
 */
class HttpProvider {
  constructor(cfg) {
    this.id = cfg.id;
    this.model = cfg.model;
    this.baseUrl = cfg.base_url;
    this.apiKey = resolveApiKey(cfg);
    this.timeoutMs = cfg.timeout_ms || 30000;
  }
  get ready() { return !!this.apiKey; }

  async chat({ system, user }) {
    if (!this.ready) throw new Error(`provider_${this.id}_not_configured`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`provider_${this.id}_http_${res.status}`);
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 构建 provider 实例（按配置 id）。 */
function buildProvider(cfg, { env = process.env } = {}) {
  if (cfg.category === 'offline' || cfg.id === 'stub') return new StubProvider(cfg);
  return new HttpProvider(cfg);
}

/**
 * 带路由 / 降级 / 重试的聊天调用。
 * @param {Object} options
 * @param {string} options.system
 * @param {string} options.user
 * @param {Object} options.seed 结构化输入（stub 用）
 * @param {Object} [options.config]
 * @param {Object} [options.env]
 * @param {number} [options.retries]
 * @returns {Promise<{ text:string, provider:string, degraded:boolean }>}
 */
async function chat({ system, user, seed = null, config = null, env = process.env, retries = 2 } = {}) {
  const cfg = config || loadConfig();
  const providers = cfg.providers.filter((p) => p.enabled);

  // 优先 default
  const order = [...providers.filter((p) => p.id === cfg.default), ...providers.filter((p) => p.id !== cfg.default)];

  let lastErr = null;
  for (const p of order) {
    const inst = buildProvider(p, { env });
    // 离线 stub 恒可用；联网 provider 需已配置凭证
    if (!(inst instanceof StubProvider) && !inst.ready) continue;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const text = await inst.chat({ system, user, seed });
        return { text, provider: p.id, degraded: p.degraded === true };
      } catch (e) {
        lastErr = e;
        logger.warn('ai_provider_attempt_failed', { provider: p.id, attempt, error: e.message });
      }
    }
  }

  // 全部失败：回退 stub（离线确定性），保证引擎可用
  logger.warn('ai_provider_fallback_stub', { reason: lastErr && lastErr.message });
  const stub = new StubProvider({ id: 'stub', model: 'stub-1' });
  const text = await stub.chat({ seed });
  return { text, provider: 'stub', degraded: true };
}

module.exports = { loadConfig, resolveApiKey, StubProvider, HttpProvider, buildProvider, chat, CONFIG_PATH };