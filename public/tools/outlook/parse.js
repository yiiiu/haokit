// 解析 Outlook 账号文本：一行一个，段数和字段顺序都不限（4 段、5 段、6 段……）。
// 分隔符识别、注释去除和每一段的识别规则在 assets/lib/accounts.js，这里只负责挑出取件需要的字段。
import { classify, splitLine, stripLabel, ROLE_LABEL, ROLE_SHORT } from '../../assets/lib/accounts.js';

export { classify, ROLE_LABEL, ROLE_SHORT };

/**
 * @returns {{
 *   accounts: Array<{email,password,clientId,refreshToken,raw,line,fields:Array<{role,value}>}>,
 *   invalid: Array<{line,raw,reason}>
 * }}
 */
export function parseAccounts(text) {
  const accounts = [];
  const invalid = [];

  text.split(/\r?\n/).forEach((rawLine, idx) => {
    const raw = rawLine.trim();
    if (!raw || raw.startsWith('#')) return;

    const parts = splitLine(raw).map(stripLabel).filter(Boolean);
    const roles = classify(parts);
    const get = (role) => parts[roles.indexOf(role)];
    const email = get('email');
    const clientId = get('clientId');
    const refreshToken = get('refreshToken');

    let reason = '';
    if (!email) reason = '没有找到邮箱';
    else if (!clientId) reason = '没有找到 client_id';
    else if (!refreshToken) reason = roles.includes('accessToken') ? '只有 access_token，缺少 refresh_token' : '没有找到 refresh_token';

    if (reason) {
      invalid.push({ line: idx + 1, raw, reason });
      return;
    }
    accounts.push({
      email,
      password: get('password') || '',
      recovery: get('recovery') || '',
      clientId,
      refreshToken,
      raw,
      line: idx + 1,
      fields: parts.map((value, i) => ({ role: roles[i], value })),
    });
  });

  return { accounts, invalid };
}
