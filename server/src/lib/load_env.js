// ============================================================================
// 轻量 .env 加载器 —— 让本地 node 运行（run.js / start.js）也能读取仓库 .env
// 设计原则：
//   · 仅设置 process.env 中尚不存在的键；已通过 inline 环境变量显式注入的优先级更高
//     （显式优于隐式，符合零假数据 / 可审计原则）。
//   · 支持 # 注释行、空行、KEY=VALUE（VALUE 可含 = 与空格，首尾空格去除，支持单/双引号包裹）。
//   · 文件不存在时静默跳过（不影响无 .env 运行，亦兼容 docker 已注入环境变量的场景）。
// 默认目标：仓库根目录 .env（server/src/lib/load_env.js → ../../.env）。
// ============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 解析并应用 .env。
 * @param {string} [filePath] 默认仓库根 .env
 * @returns {Object} 实际加载的键值对（用于日志）
 */
function loadDotEnv(filePath) {
  const target = filePath || path.resolve(__dirname, '..', '..', '.env');
  const loaded = {};
  let text;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch (e) {
    return loaded; // 无 .env 文件 → 不报错
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
      loaded[key] = val;
    }
  }
  return loaded;
}

module.exports = { loadDotEnv };
