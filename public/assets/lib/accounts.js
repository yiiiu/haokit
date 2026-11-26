// 账号行的通用解析：识别分隔符、去掉字段前的注释、按内容判断每一段是什么字段。
// Outlook 取件和账号格式转换都用这里的规则。
//
// 识别规则：
//   邮箱          优先取 outlook / hotmail / live / msn 域名，其余真实邮箱算「辅助邮箱」
//   client_id     GUID 格式
//   refresh_token 以 M.（个人号）或 0.A（企业号）开头；没有则取最长的、且不像 access_token 的长串
//   access_token  以 eyJ（JWT）或 Ew 开头的长串
//   密码          紧跟在邮箱后面的那一段；UID|密码|…|邮箱|邮箱密码 这种以数字 UID 开头的行，第 2 段是密码
//   2FA 密钥      16 位以上、含数字 2–7 的 Base32
//   UID           6–20 位纯数字（10 / 13 位的按时间戳处理）
//   时间          10 / 13 位时间戳，或 2026-11-26 这类日期

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REAL_EMAIL = /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|edu|gov|info|biz|io|co|me|[a-z]{2})$/i;
const MS_DOMAIN = /@(outlook|hotmail|live|msn|passport|windowslive)\.[a-z.]+$/i;
const RT_SIGNATURE = /^(M\.[A-Z0-9]|0\.A[\w-])/;
const AT_SIGNATURE = /^(eyJ|Ew[A-Z])/;
const BASE32 = /^[A-Z2-7]{16,64}$/i;
const TIME = /^(\d{10}|\d{13}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?)$/;
const UID = /^\d{6,20}$/;

/** 字段角色（顺序即下拉框里的顺序） */
export const ROLES = [
  'email', 'password', 'emailPassword', 'recovery', 'recoveryPassword',
  'clientId', 'refreshToken', 'accessToken', 'totp', 'uid', 'time', 'other',
];

export const ROLE_LABEL = {
  email: '邮箱',
  password: '密码',
  emailPassword: '邮箱密码',
  recovery: '辅助邮箱',
  recoveryPassword: '辅助邮箱密码',
  clientId: 'client_id',
  refreshToken: 'refresh_token',
  accessToken: 'access_token',
  totp: '2FA 密钥',
  uid: 'UID',
  time: '时间',
  other: '其他',
  ignore: '忽略',
};

export const ROLE_SHORT = {
  email: '邮箱',
  password: '密码',
  emailPassword: '邮箱密码',
  recovery: '辅助邮箱',
  recoveryPassword: '辅助密码',
  clientId: 'ID',
  refreshToken: '令牌',
  accessToken: 'AT',
  totp: '2FA',
  uid: 'UID',
  time: '时间',
  other: '其他',
  ignore: '忽略',
};

/** 可选的分隔符。id 用于保存设置和拆分 */
export const SEPARATORS = [
  { id: '----', label: '----' },
  { id: '---', label: '---' },
  { id: '|', label: '|' },
  { id: '\t', label: 'Tab' },
  { id: ':', label: '冒号 :' },
  { id: ',', label: '逗号 ,' },
  { id: ' ', label: '空格' },
];

// 字段前的注释，如「邮箱：」「密码:」「refresh_token=」「Client ID：」
const LABEL_WORDS =
  '邮箱|账号|帐号|账户|用户名|e-?mail|mail|account|user(?:name)?|密码|口令|password|passwd|pwd|pass|' +
  '辅助邮箱|恢复邮箱|备用邮箱|recovery(?:[ _]?e-?mail)?|令牌|刷新令牌|refresh[ _]?token|token|rt|' +
  'client[ _]?id|clientid|cid|access[ _]?token|at|备注|note|remark|时间|日期|date|time|2fa|totp|密钥|secret';
const LABEL_PREFIX = new RegExp(`^(?:${LABEL_WORDS})\\s*[:：=]\\s*`, 'i');
const HAS_LABEL = new RegExp(`(?:^|[\\s,，;；])(?:${LABEL_WORDS})\\s*[:：=]`, 'i');

export const stripLabel = (s) => s.trim().replace(LABEL_PREFIX, '').trim();

const SPLITTERS = {
  '----': '----',
  '---': '---',
  '|': '|',
  '\t': '\t',
  ':': /[:：]/,
  ',': /[,，]/,
  ' ': /\s+/,
};

/**
 * 拆分一行。不传 sep 时按优先级自动判断：---- > --- > | > Tab > 冒号（仅无注释数据）> 空白
 */
export function splitLine(line, sep) {
  if (sep && SPLITTERS[sep]) return line.split(SPLITTERS[sep]);
  if (line.includes('----')) return line.split('----');
  if (line.includes('---')) return line.split('---');
  if (line.includes('|')) return line.split('|');
  if (line.includes('\t')) return line.split('\t');
  if (/[:：]/.test(line) && !HAS_LABEL.test(line)) return line.split(/[:：]/);
  return line.split(/[\s,，;；]+/);
}

/** 看多数行用的是哪个分隔符 */
export function detectSeparator(lines) {
  const list = lines.filter(Boolean);
  if (!list.length) return '----';
  const share = (test) => list.filter(test).length / list.length;
  if (share((l) => l.includes('----')) >= 0.6) return '----';
  if (share((l) => l.includes('---') && !l.includes('----')) >= 0.6) return '---';
  if (share((l) => l.includes('|')) >= 0.6) return '|';
  if (share((l) => l.includes('\t')) >= 0.6) return '\t';
  if (share((l) => /[:：]/.test(l) && !HAS_LABEL.test(l) && !/^[a-z]+:\/\//i.test(l)) >= 0.6) return ':';
  if (share((l) => /[,，]/.test(l)) >= 0.6) return ',';
  return ' ';
}

const isLongToken = (s) => s.length >= 50 && !/\s/.test(s);

/** 给每一段分配角色，返回与 parts 等长的角色数组；空字段记为 other */
export function classify(parts) {
  const roles = parts.map(() => null);
  const free = (i) => i >= 0 && i < parts.length && roles[i] === null && parts[i] !== '';
  const pick = (test) => parts.findIndex((p, i) => free(i) && test(p));

  // 1. 主邮箱：优先微软域名
  let mainIdx = pick((p) => EMAIL.test(p) && MS_DOMAIN.test(p));
  if (mainIdx < 0) mainIdx = pick((p) => REAL_EMAIL.test(p));
  if (mainIdx < 0) mainIdx = pick((p) => EMAIL.test(p));
  if (mainIdx >= 0) roles[mainIdx] = 'email';

  // 2. client_id
  const idIdx = pick((p) => GUID.test(p));
  if (idIdx >= 0) roles[idIdx] = 'clientId';

  // 3. 长令牌：先认 refresh_token 特征，再排除 access_token 后取最长
  parts.forEach((p, i) => {
    if (free(i) && isLongToken(p) && AT_SIGNATURE.test(p)) roles[i] = 'accessToken';
  });
  let rtIdx = pick((p) => isLongToken(p) && RT_SIGNATURE.test(p));
  if (rtIdx < 0) {
    rtIdx = parts
      .map((p, i) => (free(i) && isLongToken(p) ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => parts[b].length - parts[a].length)[0] ?? -1;
  }
  if (rtIdx >= 0) roles[rtIdx] = 'refreshToken';

  // 4. 密码
  if (mainIdx > 0 && UID.test(parts[0]) && !TIME.test(parts[0]) && free(0) && free(1) && !EMAIL.test(parts[1])) {
    // UID|密码|2FA|邮箱|邮箱密码：第 2 段是平台密码，紧跟邮箱的是邮箱密码
    roles[0] = 'uid';
    roles[1] = 'password';
    if (free(mainIdx + 1) && !REAL_EMAIL.test(parts[mainIdx + 1]) && parts[mainIdx + 1].length < 50) roles[mainIdx + 1] = 'emailPassword';
  } else if (mainIdx >= 0 && free(mainIdx + 1) && !REAL_EMAIL.test(parts[mainIdx + 1])) {
    roles[mainIdx + 1] = 'password';
  }

  // 5. 其余字段
  parts.forEach((p, i) => {
    if (!free(i)) return;
    if (REAL_EMAIL.test(p)) roles[i] = 'recovery';
    else if (TIME.test(p)) roles[i] = 'time';
    else if (BASE32.test(p.replace(/\s/g, '')) && /\d/.test(p)) roles[i] = 'totp';
    else if (UID.test(p)) roles[i] = 'uid';
  });

  // 紧跟辅助邮箱的短字段视为辅助邮箱密码
  roles.forEach((r, i) => {
    if (r === 'recovery' && free(i + 1) && parts[i + 1].length < 50) roles[i + 1] = 'recoveryPassword';
  });

  // 6. 没找到密码时，取第一个未识别的短字段
  if (!roles.includes('password')) {
    const pw = pick((p) => p.length < 50);
    if (pw >= 0) roles[pw] = 'password';
  }

  return roles.map((r) => r || 'other');
}
