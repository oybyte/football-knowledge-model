// ============================================================================
// API 网关 · 鉴权中间件
// API Key 鉴权，支持从 Header（X-Api-Key）或 Query（?api_key=）读取。
// 未配置 API_KEY 时跳过鉴权（开发模式）。
// ============================================================================
'use strict';

const { defaultLogger } = require('../lib/logger');

const AUTH_HEADER = 'x-api-key';
const AUTH_QUERY = 'api_key';

/**
 * 创建鉴权中间件
 * @param {{ apiKey?: string, logger?: object }} [opts]
 * @returns {(req: object, res: object) => boolean} 返回 true 表示通过
 */
function createAuthMiddleware({ apiKey = process.env.OE_API_KEY, logger = defaultLogger } = {}) {
  if (!apiKey) {
    logger.info('auth_disabled_no_api_key_configured');
    return (req, res) => true;
  }

  const key = apiKey;
  const masked = key.length > 4 ? key.slice(0, 2) + '***' + key.slice(-2) : '***';

  return function authMiddleware(req, res) {
    const provided = req.headers?.[AUTH_HEADER] ||
      (req.url && new URL(req.url, 'http://localhost').searchParams.get(AUTH_QUERY));

    if (provided === key) return true;

    logger.warn('auth_rejected', { path: req.url, method: req.method });
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', error: 'unauthorized', message: '有效的 X-Api-Key 头或 api_key 查询参数' }));
    return false;
  };
}

module.exports = { createAuthMiddleware, AUTH_HEADER, AUTH_QUERY };