// ============================================================================
// 最小 RESP 协议 Redis 兼容服务器（测试辅助，纯 Node / 零依赖）
// 用途：在没有 Redis 守护进程的 CI/开发机上，给后端 RedisCacheAdapter /
// RedisLockManager / RedisAnalysisQueue 提供「走真实 TCP + RESP 协议」的替身，
// 用于验证 OE_REDIS_URL 接线（backend=redis）与「重启缓存不丢」。
// 仅实现后端用到的命令：PING SELECT AUTH GET SET SETEX DEL EXISTS
//   RPUSH LPOP LLEN SCAN EVAL SCANSTREAM 见下。
// 不用于生产；数据存内存，进程退出即失（与真实 Redis 的持久化无关）。
// ============================================================================
'use strict';

const net = require('node:net');

/**
 * RESP 编解码 + 命令分发
 */
class MinimalRedisServer {
  /**
   * @param {{ port?: number, host?: string }} [opts]
   */
  constructor({ port = 0, host = '127.0.0.1' } = {}) {
    this.port = port;
    this.host = host;
    /** @type {Map<string, string>} key -> raw value */
    this._store = new Map();
    /** @type {Map<string, string[]>} key -> list */
    this._lists = new Map();
    /** @type {Map<string, number>} key -> expireAt(ms) */
    this._expires = new Map();
    this._server = null;
    /** @type {Set<import('node:net').Socket>} 存活连接，close() 时一并销毁 */
    this._sockets = new Set();
  }

  async listen() {
    return new Promise((resolve, reject) => {
      this._server = net.createServer((socket) => {
        this._sockets.add(socket);
        socket.on('close', () => this._sockets.delete(socket));
        socket.on('error', () => {});
        this._onSocket(socket);
      });
      this._server.on('error', reject);
      this._server.listen(this.port, this.host, () => {
        this.port = this._server.address().port;
        resolve(this.port);
      });
    });
  }

  close() {
    if (this._server) {
      // 只 close() 不会结束既有连接 → 残留 Socket 手柄，测试进程不退出；显式销毁。
      for (const s of this._sockets) s.destroy();
      this._sockets.clear();
      this._server.close();
    }
  }

  _onSocket(socket) {
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let parsed;
      while ((parsed = this._readCommand(buf)) !== null) {
        buf = parsed.rest;
        const { args } = parsed;
        const reply = this._dispatch(args);
        socket.write(this._encode(reply));
      }
    });
    socket.on('error', () => {});
  }

  /** 解析缓冲区中第一条 RESP 数组命令；不足则返回 null。 */
  _readCommand(buf) {
    if (buf.length === 0 || buf[0] !== 0x2a /* '*' */) return null;
    const newline = buf.indexOf('\r\n');
    if (newline === -1) return null;
    const argc = parseInt(buf.toString('utf8', 1, newline), 10);
    if (!Number.isFinite(argc)) return null;
    let pos = newline + 2;
    const args = [];
    for (let i = 0; i < argc; i++) {
      const parsed = this._readBulk(buf, pos);
      if (!parsed) return null; // 数据不足
      args.push(parsed.value);
      pos = parsed.pos;
    }
    const bytes = pos;
    return { args, rest: buf.subarray(bytes) };
  }

  _readBulk(buf, pos) {
    if (buf[pos] !== 0x24 /* '$' */) return null;
    const newline = buf.indexOf('\r\n', pos);
    if (newline === -1) return null;
    const len = parseInt(buf.toString('utf8', pos + 1, newline), 10);
    if (!Number.isFinite(len)) return null;
    const dataStart = newline + 2;
    if (buf.length < dataStart + len + 2) return null; // 数据不足
    const value = buf.toString('utf8', dataStart, dataStart + len);
    return { value, pos: dataStart + len + 2 };
  }

  /** RESP 编码 */
  _encode(reply) {
    if (reply === null || reply === undefined) return '$-1\r\n'; // null bulk（ioredis 解析为 null）
    if (reply === 'OK') return '+OK\r\n';
    if (reply === 0 || reply === 1) return ':' + reply + '\r\n';
    if (typeof reply === 'string') {
      const body = Buffer.byteLength(reply);
      return '$' + body + '\r\n' + reply + '\r\n';
    }
    if (Array.isArray(reply)) {
      if (reply.length === 0) return '*0\r\n';
      // 前两条作为（空键，空值）→ 是 scan 游标应答
      return '*2\r\n$1\r\n0\r\n*' + reply.length + '\r\n' + reply.map((v) => this._encode(v)).join('');
    }
    // 大整数
    return ':' + reply + '\r\n';
  }

  _dispatch(args) {
    const cmd = String(args[0]).toUpperCase();
    const key = args[1];
    switch (cmd) {
      case 'PING': return 'PONG';
      case 'SELECT': return 'OK';
      case 'AUTH': return 'OK';
      case 'ECHO': return args[1];
      case 'GET': {
        if (!key) return null;
        this._purge(key);
        const v = this._store.get(key);
        return v === undefined ? null : v;
      }
      case 'SET': {
        // SET key value [EX s|PX ms] [NX|XX]
        const value = args[2];
        let expireMs = null;
        let nx = false;
        for (let i = 3; i < args.length; i++) {
          const opt = String(args[i]).toUpperCase();
          if (opt === 'EX') { expireMs = Number(args[i + 1]) * 1000; i++; }
          else if (opt === 'PX') { expireMs = Number(args[i + 1]); i++; }
          else if (opt === 'NX') nx = true;
          else if (opt === 'XX') nx = false; // simplify
        }
        if (nx && this._store.has(key)) return null; // NX 失败 → 空
        this._store.set(key, value);
        this._lists.delete(key);
        if (expireMs !== null) this._expires.set(key, Date.now() + expireMs);
        else this._expires.delete(key);
        return 'OK';
      }
      case 'SETEX': {
        // SETEX key seconds value
        const seconds = Number(args[2]);
        this._store.set(key, args[3]);
        this._lists.delete(key);
        this._expires.set(key, Date.now() + seconds * 1000);
        return 'OK';
      }
      case 'DEL': {
        let n = 0;
        for (let i = 1; i < args.length; i++) {
          if (this._store.delete(args[i]) || this._lists.delete(args[i])) n++;
        }
        return n;
      }
      case 'EXISTS': {
        let n = 0;
        for (let i = 1; i < args.length; i++) {
          if (this._store.has(args[i])) n++;
        }
        return n;
      }
      case 'INCR': {
        // INCR key —— 数值自增（限流固定窗口用）
        this._purge(key);
        const cur = Number(this._store.get(key)) || 0;
        const nv = cur + 1;
        this._store.set(key, String(nv));
        return nv;
      }
      case 'EXPIRE': {
        // EXPIRE key seconds
        const secs = Number(args[2]);
        if (this._store.has(key)) { this._expires.set(key, Date.now() + secs * 1000); return 1; }
        return 0;
      }
      case 'RPUSH': {
        if (!this._lists.has(key)) this._lists.set(key, []);
        const list = this._lists.get(key);
        for (let i = 2; i < args.length; i++) list.push(args[i]);
        return list.length;
      }
      case 'LPOP': {
        const list = this._lists.get(key);
        if (!list || list.length === 0) return null;
        const v = list.shift();
        if (list.length === 0) this._lists.delete(key);
        return v;
      }
      case 'LLEN': {
        const list = this._lists.get(key) || [];
        return list.length;
      }
      case 'SCAN': {
        // 简化：SCAN cursor MATCH pattern —— 返回 [next_cursor, [keys]]
        let pattern = '*';
        for (let i = 3; i < args.length; i++) if (String(args[i]).toUpperCase() === 'MATCH') pattern = args[i + 1];
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        const keys = [...this._store.keys()].concat([...this._lists.keys()]);
        const matched = keys.filter((k) => regex.test(k));
        return [['0'], matched]; // 前一条是游标，后一条是 key 列表
      }
      case 'EVAL': {
        const script = args[1];
        // 解析 KEYS/ARGV；简化实现 Lua 常用：GET/PEXPIRE/DEL
        const numKeys = Number(args[2]);
        const keys = args.slice(3, 3 + numKeys);
        const argv = args.slice(3 + numKeys);
        const k = keys[0];
        if (script.includes('pexpire')) {
          const ttl = Number(argv[1]);
          if (this._store.get(k) === argv[0]) {
            this._expires.set(k, Date.now() + ttl);
            return 1;
          }
          return 0;
        }
        if (script.includes('del') && this._store.get(k) === argv[0] && numKeys === 1 && argv.length === 0) {
          this._store.delete(k);
          return 1;
        }
        if (script.includes('del')) {
          if (this._store.get(k) === argv[0]) { this._store.delete(k); return 1; }
          return 0;
        }
        return 0;
      }
      default:
        return 'OK';
    }
  }

  _purge(key) {
    const exp = this._expires.get(key);
    if (exp !== undefined && Date.now() > exp) this._store.delete(key);
  }

  /** 测试辅助：列出当前内存 key（模拟真实 Redis 存活数据，跨实例存活验证用）。 */
  keys() { return [...this._store.keys()]; }
}

module.exports = { MinimalRedisServer };

if (require.main === module) {
  const srv = new MinimalRedisServer({ port: Number(process.env.PORT) || 6379 });
  srv.listen().then((port) => {
    console.log(`[resp-server] listening on 127.0.0.1:${port}`);
  });
}