// 从邮件中识别验证码。其他工具也可以复用。

const KEYWORD = new RegExp(
  [
    '验证码', '校验码', '驗證碼', '验证代码', '动态码', '动态密码', '确认码', '確認碼', '安全码', '安全代码', '登录码', '代码', '代碼',
    'コード', '인증', '\\b(?:verification|security|confirmation|login|sign[- ]?in|one[- ]time|access|auth(?:entication)?)\\s+code\\b',
    '\\bpass ?code\\b', '\\bOTP\\b', '\\bPIN\\b', '\\bcode\\b',
  ].join('|'),
  'gi',
);

// 6 位以内纯数字、"123 456"/"123-456"、或同时含字母和数字的 5–8 位大写码
const CODE = /(?<![A-Za-z0-9])(\d{3}[ -]\d{3}|\d{4,8}|(?=[A-Z]*\d)(?=\d*[A-Z])[A-Z0-9]{5,8})(?![A-Za-z0-9])/g;

const looksLikeYear = (s) => /^(19|20)\d{2}$/.test(s);

export function htmlToText(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style,script,head,title').forEach((n) => n.remove());
  return doc.body?.textContent || '';
}

function afterKeyword(text) {
  KEYWORD.lastIndex = 0;
  for (const k of text.matchAll(KEYWORD)) {
    const start = k.index + k[0].length;
    const windowText = text.slice(start, start + 60);
    CODE.lastIndex = 0;
    let m;
    while ((m = CODE.exec(windowText))) {
      const code = m[1].replace(/[ -]/g, '');
      if (!looksLikeYear(code)) return code;
    }
  }
  return null;
}

function beforeKeyword(text) {
  const m = text.match(/(?<![A-Za-z0-9])(\d{4,8})(?![A-Za-z0-9])\s*(?:is your|is the|为您的|是您的|是你的|為您的|為你的|為)/i);
  return m ? m[1] : null;
}

/**
 * @param {{subject?: string, text?: string|null, html?: string|null, preview?: string}} msg
 * @returns {string|null}
 */
export function extractCode(msg) {
  const subject = (msg.subject || '').replace(/\s+/g, ' ');
  const body = (msg.text || htmlToText(msg.html) || msg.preview || '').replace(/\s+/g, ' ');

  for (const text of [subject, body]) {
    const hit = afterKeyword(text) || beforeKeyword(text);
    if (hit) return hit;
  }

  // 兜底：正文里只出现一个独立的 6 位数字
  const sixes = [...new Set(body.match(/(?<![\d.:/#-])\d{6}(?![\d.:/-])/g) || [])];
  return sixes.length === 1 ? sixes[0] : null;
}
