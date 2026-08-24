// ============================================================================
// G3 结构化日志 —— 统一日志规范（timestamp / level / service / trace_id / message）
// 敏感字段自动脱敏。阶段 1 以 console 输出，接口与 winston/pino 等价。
// ============================================================================
'use strict';

const LEVELS = Object.freeze({ DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 });

const SENSITIVE_KEYS = Object.freeze([
  'api_key', 'apikey', 'token', 'secret', 'password', 'pwd', 'credential', 'authorization',
]);

/**
 * 递归脱敏：对已知敏感键名遮蔽为 ***。
 * @param {*} val
 * @param {string} [key] 当前键名（用于判断是否敏感）
 * @returns {*}
 */
function mask(val, key) {
  if (key && SENSITIVE_KEYS.includes(key.toLowerCase())) return '***';
  if (val == null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map((v) => mask(v));
  const out = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = SENSITIVE_KEYS.includes(k.toLowerCase()) ? '***' : mask(v, k);
  }
  return out;
}

/**
 * 结构化日志记录器。
 */
class Logger {
  constructor({ service = 'unknown', minLevel = LEVELS.INFO, sink = null } = {}) {
    this.service = service;
    this.minLevel = minLevel;
    this.sink = sink || ((line) => console.log(line));
  }

  /**
   * 写一条日志。
   * @param {string} level 级别名
   * @param {string} message 摘要
   * @param {Object} [ctx] 上下文附加字段
   * @param {string} [traceId] 链路追踪 ID
   */
  log(level, message, ctx = {}, traceId = null) {
    const lv = LEVELS[level];
    if (lv == null || lv < this.minLevel) return;
    const tid = traceId || ctx.trace_id || '-';
    const { trace_id: _omit, ...rest } = ctx;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      trace_id: tid,
      message,
      ...mask(rest),
    };
    this.sink(JSON.stringify(entry));
  }

  debug(msg, ctx, tid) { this.log('DEBUG', msg, ctx, tid); }
  info(msg, ctx, tid) { this.log('INFO', msg, ctx, tid); }
  warn(msg, ctx, tid) { this.log('WARN', msg, ctx, tid); }
  error(msg, ctx, tid) { this.log('ERROR', msg, ctx, tid); }
}

const defaultLogger = new Logger({ service: 'rule-storage' });

module.exports = { Logger, LEVELS, mask, SENSITIVE_KEYS, defaultLogger };
