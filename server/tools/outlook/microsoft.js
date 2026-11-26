// 微软 OAuth2：用 refresh_token 换取 access_token
const TENANT = process.env.MS_TENANT || 'common';
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

export const GRAPH_SCOPE = 'https://graph.microsoft.com/.default offline_access';
export const IMAP_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access';

export class ToolError extends Error {
  constructor(message, { code = 'ERROR', detail, status = 400 } = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

// 常见 AADSTS 错误码 → 中文说明
const AAD_MESSAGES = {
  AADSTS70000: '刷新令牌无效、已过期或权限不足',
  AADSTS70008: '刷新令牌已过期，需要重新授权',
  AADSTS700082: '刷新令牌因长期未使用已过期',
  AADSTS50173: '令牌已失效（账号密码可能已被修改）',
  AADSTS700016: 'client_id 不存在，或该应用不支持此类账号',
  AADSTS65001: '该应用未获得此权限的授权',
  AADSTS70011: '请求的权限范围（scope）无效',
  AADSTS9002313: '请求无效，请检查令牌是否完整',
  AADSTS90023: '请求无效，请检查令牌是否完整',
  AADSTS50057: '账号已被禁用',
  AADSTS50034: '账号不存在',
  AADSTS50076: '账号需要多重验证',
  AADSTS50079: '账号需要多重验证',
  AADSTS53003: '被条件访问策略阻止',
};

function tokenError(data, httpStatus) {
  const desc = String(data?.error_description || '');
  const aad = desc.match(/AADSTS\d+/)?.[0];
  let message = (aad && AAD_MESSAGES[aad]) || '刷新令牌失败';
  if (/service abuse mode/i.test(desc)) message = '账号已被微软封禁（service abuse mode）';
  else if (/locked|blocked/i.test(desc) && !aad) message = '账号已被锁定';
  return new ToolError(message, {
    code: aad || data?.error || 'TOKEN_ERROR',
    detail: desc.split(/\r?\n/)[0] || `HTTP ${httpStatus}`,
    status: 400,
  });
}

/**
 * @returns {Promise<{access_token:string, refresh_token?:string, scope?:string, expires_in:number}>}
 */
export async function refreshAccessToken({ clientId, refreshToken, scope }) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope,
  });

  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ToolError('无法连接微软登录服务器，请检查服务器网络或代理', {
      code: 'NETWORK',
      detail: err.cause?.code || err.message,
      status: 502,
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw tokenError(data, res.status);
  return data;
}

export function hasGraphMailRead(scopeString = '') {
  return /(^|[\s/])Mail\.Read(Write)?(\s|$)/i.test(scopeString);
}
