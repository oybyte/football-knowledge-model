// ============================================================================
// 测试辅助 · 自签 X.509 证书生成器（零依赖，纯 Node ASN.1/签名）
// Node 无原生证书签发能力；用 crypto 生成 RSA 密钥并按 X.509 v3 手工编码
// 一个只供测试/本地 TLS 验证用的自签证书（CN=odds-edge-selfsigned）。
// 返回 { certPem, keyPem }，可直接写盘供 https.createServer(cert,key) 使用。
// ============================================================================
'use strict';

const crypto = require('node:crypto');

// ---- ASN.1 DER 编码原语 ----
function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  while (n > 0) { b.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | b.length, ...b]);
}
function concat(...parts) {
  return Buffer.concat(parts);
}
function tag(t, content) {
  return concat(Buffer.from([t]), derLen(content.length), content);
}
function seq(...parts) {
  return tag(0x30, concat(...parts));
}
function oid(bytes) { return tag(0x06, Buffer.from(bytes)); }
function printStr(s) { return tag(0x13, Buffer.from(s, 'ascii')); }
function integer(buf) {
  // 去掉前导 0；符号位为 1 时补 0 前缀，保证正整数
  let i = 0;
  while (buf[i] === 0) i++;
  buf = buf.subarray(i);
  if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
  return tag(0x02, buf);
}
function bitString(content) { return tag(0x03, concat(Buffer.from([0]), content)); } // unused bits = 0
function octetStr(b) { return tag(0x04, b); }
function boolTrue() { return Buffer.from([0x01, 0x01, 0xff]); }
function utcTime(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tag(0x17, Buffer.from(s, 'ascii'));
}

const OID = {
  rsa: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01],
  sha256RSA: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b],
  commonName: [0x55, 0x04, 0x03],
  basicConstraints: [0x55, 0x1d, 0x13],
  keyUsage: [0x55, 0x1d, 0x0f],
  subjectAltName: [0x55, 0x1d, 0x11],
};

/** 生成自签证书。@returns {{ certPem: string, keyPem: string }} */
function selfSigned() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const cn = 'odds-edge-selfsigned';
  const notBefore = utcTime(new Date(Date.now() - 86_400_000)); // 昨天
  const notAfter = utcTime(new Date(Date.now() + 365 * 86_400_000)); // 一年后

  // 名称（X.501）：Name=SEQUENCE{ RDNSequence } → RDN=SET{ ATV } → ATV=SEQUENCE{ OID, value }
  // 中间层 RDN 必须是 SET(0x31)，OpenSSL 对 SEQUENCE(0x30) 会报 wrong tag。
  const name = seq(tag(0x31, seq(oid(OID.commonName), printStr(cn))));
  const sigAlg = seq(oid(OID.sha256RSA), tag(0x05, Buffer.alloc(0))); // NULL

  // 扩展；critical 为普通 BOOLEAN(0x01)，非 context-specific
  const extensions = [];
  // basicConstraints CA:FALSE（critical）
  extensions.push(seq(oid(OID.basicConstraints), boolTrue(), octetStr(seq())));
  // keyUsage digitalSignature(128) | keyEncipherment(32) = 0xA0（critical）
  extensions.push(seq(oid(OID.keyUsage), boolTrue(), octetStr(bitString(Buffer.from([0xa0])))));
  // subjectAltName: DNS:localhost, IP:127.0.0.1
  const san = seq(
    tag(0x82, Buffer.from('localhost', 'ascii')),
    tag(0x87, Buffer.from([127, 0, 0, 1])),
  );
  extensions.push(seq(oid(OID.subjectAltName), octetStr(san)));

  const tbs = seq(
    tag(0xa0, integer(Buffer.from([2]))),           // [0] v3
    integer(Buffer.from([1])),                       // serialNumber
    sigAlg,                                          // signature algorithm
    name,                                            // issuer
    seq(notBefore, notAfter),                        // validity
    name,                                            // subject
    publicKey,                                       // SubjectPublicKeyInfo (SPKI DER)
    tag(0xa3, seq(...extensions)),                   // [3] extensions
  );

  const signature = crypto.createSign('sha256').update(tbs).end().sign(privateKey);

  const certDer = seq(tbs, sigAlg, bitString(signature));
  const certPem = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

  return { certPem, keyPem: privateKey };
}

module.exports = { selfSigned };