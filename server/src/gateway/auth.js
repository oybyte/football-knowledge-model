// ============================================================================
// API 网关 · 鉴权中间件（生产级密钥校验）
// 支持多 Key（OE_API_KEYS 逗号分隔，兼容单 Key OE_API_KEY）+ 撤销 Key
// （OE_API_KEY_REVOKED 逗号分隔）→ 401（未认证）/ 403（已撤销）语义。
// 密钥校验：
//   - 常量时间比较（crypto.timingSafeEqual），防时序侧信道；
//   - 支持 sha256 哈希配置（前缀 sha256:<hex>），配置/日志不落明文密钥；
//   - 撤销列表同样支持明文或 sha256 哈希形式。
// 未配置任何有效 Key 时跳过鉴权（开发模式）。
// ============================================================================
'use strict';

const crypto = require('node:crypto');
const { defaultLogger } = require('../lib/logger');

const AUTH_HEADER = 'x-api-key';
const AUTH_QUERY = 'api_key';
const HASH_PREFIX = 'sha256:';

/** 解析逗号分隔的环境变量为去空白、去空数组。 */
function parseKeyList(value) {
  if (!value) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/** SHA-256 十六进制摘要。 */
function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** 常量时间字符串比较；长度不同直接 false（不泄露长度信息）。 */
function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** 配置项是否为 sha256 哈希形式。 */
function isHashed(configured) {
  return typeof configured === 'string' && configured.startsWith(HASH_PREFIX);
}

/**
 * 校验 provided（明文密钥）是否匹配配置项。
 * 配置项为 sha256:<hex> 时比较摘要；否则常量时间比较明文。
 * @param {string} provided
 * @param {string} configured
 * @returns {boolean}
 */
function keyMatches(provided, configured) {
  if (isHashed(configured)) {
    return timingSafeEqualStr(sha256Hex(provided), configured.slice(HASH_PREFIX.length));
  }
  return timingSafeEqualStr(provided, configured);
}

/**
 * 创建鉴权中间件
 * @param {{
 *   apiKey?: string,          // 兼容：单 Key（OE_API_KEY，明文或 sha256:<hex>）
 *   apiKeys?: string[],       // 多 Key（OE_API_KEYS）
 *   revokedKeys?: string[],   // 撤销 Key（OE_API_KEY_REVOKED）
 *   audit?: (message: string, payload: object) => void,  // 鉴权事件回调（审计落库）
 *   logger?: object,
 * }} [opts]
 * @returns {(req: object, res: object) => boolean} 返回 true 表示通过
 */
function createAuthMiddleware({
  apiKey = process.env.OE_API_KEY,
  apiKeys = parseKeyList(process.env.OE_API_KEYS),
  revokedKeys = parseKeyList(process.env.OE_API_KEY_REVOKED),
  audit,
  logger = defaultLogger,
} = {}) {
  // 合并单 Key 与多 Key 并去重；撤销 Key 从有效集合中剔除（撤销条目支持明文/哈希）。
  const allKeys = [...new Set([...(apiKey ? [apiKey] : []), ...apiKeys])];
  const revoked = revokedKeys || [];
  const validKeys = allKeys.filter((k) => !revoked.some((r) => keyMatches(k, r)));

  if (validKeys.length === 0) {
    logger.info('auth_disabled_no_api_key_configured');
    return (req, res) => true;
  }

  const record = (message, payload) => {
    if (typeof audit === 'function') audit(message, payload);
  };

  return function authMiddleware(req, res) {
    const provided = req.headers?.[AUTH_HEADER] ||
      (req.url && new URL(req.url, 'http://localhost').searchParams.get(AUTH_QUERY));

    const reject = (status, error, message) => {
      logger.warn('auth_rejected', { status, error, path: req.url, method: req.method });
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'error', error, message }));
      return false;
    };

    if (!provided) {
      record('auth_rejected', { status: 401, error: 'unauthorized', reason: 'missing_key', path: req.url, method: req.method });
      return reject(401, 'unauthorized', '缺少 X-Api-Key 头或 api_key 查询参数');
    }
    if (revoked.some((r) => keyMatches(provided, r))) {
      record('auth_rejected', { status: 403, error: 'forbidden', reason: 'revoked_key', path: req.url, method: req.method });
      return reject(403, 'forbidden', '该 API Key 已被撤销');
    }
    if (!validKeys.some((k) => keyMatches(provided, k))) {
      record('auth_rejected', { status: 401, error: 'unauthorized', reason: 'invalid_key', path: req.url, method: req.method });
      return reject(401, 'unauthorized', '无效的 API Key');
    }
    record('auth_ok', { status: 200, path: req.url, method: req.method });
    return true;
  };
}

module.exports = {
  createAuthMiddleware, parseKeyList, sha256Hex, timingSafeEqualStr, keyMatches, isHashed,
  AUTH_HEADER, AUTH_QUERY, HASH_PREFIX,
};
