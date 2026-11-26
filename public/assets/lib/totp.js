// TOTP / HOTP（RFC 4226 / RFC 6238），用浏览器自带的 Web Crypto 在本地计算，密钥不离开浏览器。
// 需要安全上下文（HTTPS 或 localhost），否则 crypto.subtle 不可用。

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-512'];

/** 规范化 Base32 密钥：去空格、横线、末尾等号，转大写 */
export function normalizeSecret(secret) {
  return String(secret || '').replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
}

export function isBase32(secret) {
  return /^[A-Z2-7]+$/.test(normalizeSecret(secret));
}

/** Base32 → 字节 */
export function base32Decode(secret) {
  const s = normalizeSecret(secret);
  const out = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`密钥含有非 Base32 字符「${ch}」`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(out);
}

/** 统一算法名：SHA1 / sha256 / SHA-512 → SHA-1 / SHA-256 / SHA-512 */
export function normalizeAlgorithm(name = 'SHA-1') {
  const n = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (n === 'SHA256') return 'SHA-256';
  if (n === 'SHA512') return 'SHA-512';
  return 'SHA-1';
}

export function cryptoAvailable() {
  return Boolean(globalThis.crypto?.subtle);
}

const keyCache = new Map();

async function importKey(secret, algorithm) {
  const cacheKey = `${algorithm}:${normalizeSecret(secret)}`;
  if (!keyCache.has(cacheKey)) {
    const raw = base32Decode(secret);
    if (!raw.length) throw new Error('密钥为空');
    keyCache.set(cacheKey, crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: { name: algorithm } }, false, ['sign']));
  }
  return keyCache.get(cacheKey);
}

/** HOTP：counter 为整数计数器 */
export async function hotp(secret, counter, { digits = 6, algorithm = 'SHA-1' } = {}) {
  const key = await importKey(secret, normalizeAlgorithm(algorithm));
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) | (sig[offset + 1] << 16) | (sig[offset + 2] << 8) | sig[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** 当前时间所在的计数器和剩余秒数 */
export function timeStep(period = 30, nowMs = Date.now()) {
  const seconds = nowMs / 1000;
  const counter = Math.floor(seconds / period);
  const remaining = period - (seconds % period);
  return { counter, remaining };
}

/** TOTP：返回当前码和下一个码 */
export async function totp(secret, { digits = 6, period = 30, algorithm = 'SHA-1', now = Date.now() } = {}) {
  const { counter, remaining } = timeStep(period, now);
  const [code, next] = await Promise.all([
    hotp(secret, counter, { digits, algorithm }),
    hotp(secret, counter + 1, { digits, algorithm }),
  ]);
  return { code, next, counter, remaining };
}

/** 字节 → Base32（无填充） */
export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// RFC 6238 附录 B 的标准测试向量：[时间(秒), SHA-1, SHA-256, SHA-512]，均为 8 位
const RFC_SEEDS = {
  'SHA-1': '12345678901234567890',
  'SHA-256': '12345678901234567890123456789012',
  'SHA-512': '1234567890123456789012345678901234567890123456789012345678901234',
};
const RFC_VECTORS = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

/** 在当前浏览器里跑一遍 RFC 6238 测试向量，确认计算无误 */
export async function selfTest() {
  let pass = 0;
  let total = 0;
  for (const [t, ...codes] of RFC_VECTORS) {
    for (const [i, algorithm] of ALGORITHMS.entries()) {
      total++;
      const secret = base32Encode(new TextEncoder().encode(RFC_SEEDS[algorithm]));
      const { code } = await totp(secret, { digits: 8, period: 30, algorithm, now: t * 1000 });
      if (code === codes[i]) pass++;
    }
  }
  return { pass, total };
}
