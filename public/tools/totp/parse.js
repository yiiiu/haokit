// 解析 2FA 密钥：一行一个，支持
//   1. 纯密钥：JBSWY3DPEHPK3PXP、jbsw y3dp ehpk 3pxp
//   2. otpauth 链接：otpauth://totp/GitHub:alice?secret=XXX&issuer=GitHub&digits=6&period=30&algorithm=SHA1
//   3. 带备注或账号的行：备注|密钥、邮箱----密码----密钥（与取件工具相同的分隔符），自动找出 Base32 那一段
import { base32Decode, normalizeAlgorithm, normalizeSecret } from '../../assets/lib/totp.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_PREFIX = /^(?:2fa|totp|密钥|秘钥|secret|key|备注|note|账号|帐号|邮箱|email|account|密码|password|pwd)\s*[:：=]\s*/i;

const looksBase32 = (s, min) => {
  const n = normalizeSecret(s);
  return n.length >= min && /^[A-Z2-7]+$/.test(n);
};

function splitLine(line) {
  if (line.includes('----')) return line.split('----');
  if (line.includes('---')) return line.split('---');
  if (line.includes('|')) return line.split('|');
  if (line.includes('\t')) return line.split('\t');
  if (/[,，]/.test(line)) return line.split(/[,，]/);
  if (/[:：]/.test(line)) return line.split(/[:：]/);
  return line.split(/\s+/);
}

function parseOtpauth(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'otpauth 链接格式不正确' };
  }
  const type = url.hostname.toLowerCase();
  if (type === 'hotp') return { error: '暂不支持 HOTP（计数器）类型' };
  if (type !== 'totp') return { error: `不支持的类型「${type}」` };

  const p = url.searchParams;
  const secret = p.get('secret') || '';
  if (!secret) return { error: '链接里没有 secret 参数' };

  const path = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  const [labelIssuer, account] = path.includes(':') ? path.split(/:(.*)/s) : ['', path];
  const issuer = p.get('issuer') || labelIssuer || '';
  const digits = Number(p.get('digits')) || null;
  const period = Number(p.get('period')) || null;

  return {
    secret,
    label: account?.trim() || issuer,
    issuer: issuer.trim(),
    digits: digits === 6 || digits === 7 || digits === 8 ? digits : null,
    period: period && period >= 5 && period <= 300 ? period : null,
    algorithm: p.get('algorithm') ? normalizeAlgorithm(p.get('algorithm')) : null,
  };
}

function parsePlain(raw) {
  // 整行就是密钥（允许空格分组）。至少 16 位，避免把普通单词当成密钥
  if (looksBase32(raw, 16)) return { secret: raw, label: '' };

  const parts = splitLine(raw)
    .map((s) => s.trim().replace(LABEL_PREFIX, '').trim())
    .filter(Boolean);
  const candidates = parts.filter((p) => !EMAIL.test(p) && !GUID.test(p) && looksBase32(p, 16));
  if (!candidates.length) return { error: '没有找到 2FA 密钥（Base32，至少 16 位）' };

  // 和常见工具（如 2fa.fun 的 UID|密码|2FA|邮箱|邮箱密码）保持一致：优先第 3 段，其次第 1 段；
  // 都不是密钥时，在候选里优先含数字 2–7 的（纯字母的更可能是密码），再取最长
  const secret =
    [parts[2], parts[0]].find((p) => p && candidates.includes(p)) ||
    [...candidates].sort((a, b) => /[2-7]/.test(b) - /[2-7]/.test(a) || normalizeSecret(b).length - normalizeSecret(a).length)[0];
  const rest = parts.filter((p) => p !== secret);
  const label = rest.find((p) => EMAIL.test(p)) || rest[0] || '';
  return { secret, label };
}

/**
 * @returns {{ items: Array<{line,raw,secret,label,issuer,digits,period,algorithm}>, invalid: Array<{line,raw,reason}> }}
 */
export function parseSecrets(text) {
  const items = [];
  const invalid = [];

  text.split(/\r?\n/).forEach((rawLine, idx) => {
    const raw = rawLine.trim();
    if (!raw || raw.startsWith('#')) return;

    let res;
    if (/^otpauth-migration:/i.test(raw)) res = { error: '暂不支持 Google 身份验证器的批量导出链接，请逐个导出' };
    else if (/^otpauth:/i.test(raw)) res = parseOtpauth(raw);
    else res = parsePlain(raw);

    if (!res.error) {
      try {
        if (base32Decode(res.secret).length < 5) res = { error: '密钥太短' };
      } catch (err) {
        res = { error: err.message };
      }
    }

    if (res.error) {
      invalid.push({ line: idx + 1, raw, reason: res.error });
      return;
    }
    items.push({
      line: idx + 1,
      raw,
      secret: normalizeSecret(res.secret),
      label: res.label || '',
      issuer: res.issuer || '',
      digits: res.digits || null,
      period: res.period || null,
      algorithm: res.algorithm || null,
    });
  });

  return { items, invalid };
}
