// Outlook / Hotmail 取件接口：POST /api/outlook/messages
// 请求体里有用户的 refresh_token：不要打印 req.body，也不要把令牌写进任何日志。
import { Router } from 'express';
import { GRAPH_SCOPE, IMAP_SCOPE, ToolError, hasGraphMailRead, refreshAccessToken } from './microsoft.js';
import { listGraphMessages } from './graph.js';
import { listImapMessages } from './imap.js';
import { config, clientIp } from '../../lib/config.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { createLimiter, BusyError } from '../../lib/limiter.js';

export const router = Router();

// 每个 IP 的请求频率上限，以及全站 / 单个 IP 同时取件的数量上限（数值见 .env.example）
const limitRate = rateLimit({ ...config.rateLimit, keyFn: clientIp });
const limiter = createLimiter(config.concurrency);

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FOLDERS = ['inbox', 'junk'];
const MODES = ['auto', 'graph', 'imap'];

function validate(body = {}) {
  const email = String(body.email || '').trim();
  const clientId = String(body.clientId || '').trim();
  const refreshToken = String(body.refreshToken || '').trim();
  const folders = (Array.isArray(body.folders) ? body.folders : ['inbox']).filter((f) => FOLDERS.includes(f));
  const mode = MODES.includes(body.mode) ? body.mode : 'auto';
  const top = Math.min(50, Math.max(1, Number.parseInt(body.top, 10) || 10));

  if (!EMAIL.test(email)) throw new ToolError('邮箱格式不正确', { code: 'BAD_EMAIL' });
  if (!GUID.test(clientId)) throw new ToolError('client_id 格式不正确（应为 GUID）', { code: 'BAD_CLIENT_ID' });
  if (refreshToken.length < 50) throw new ToolError('refresh_token 不完整', { code: 'BAD_TOKEN' });
  if (!folders.length) throw new ToolError('请选择要读取的文件夹', { code: 'BAD_FOLDER' });

  return { email, clientId, refreshToken, folders: [...new Set(folders)], mode, top };
}

function newest(messages, top) {
  return messages.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, top);
}

async function viaGraph({ clientId, refreshToken, folders, top }) {
  const token = await refreshAccessToken({ clientId, refreshToken, scope: GRAPH_SCOPE });
  if (!hasGraphMailRead(token.scope)) {
    throw new ToolError('该令牌没有 Graph 邮件读取权限（Mail.Read），请改用 IMAP', {
      code: 'NO_GRAPH_SCOPE',
      detail: `scope: ${token.scope || '(空)'}`,
    });
  }
  const messages = await listGraphMessages(token.access_token, folders, top);
  return { mode: 'graph', messages, newRefreshToken: token.refresh_token || null };
}

async function viaImap({ email, clientId, refreshToken, folders, top }) {
  const token = await refreshAccessToken({ clientId, refreshToken, scope: IMAP_SCOPE });
  const messages = await listImapMessages(email, token.access_token, folders, top);
  return { mode: 'imap', messages, newRefreshToken: token.refresh_token || null };
}

async function fetchMessages(input) {
  if (input.mode === 'graph') return viaGraph(input);
  if (input.mode === 'imap') return viaImap(input);

  // 自动模式：先试 Graph（更快，带 HTML 正文），失败再走 IMAP
  try {
    return await viaGraph(input);
  } catch (graphErr) {
    try {
      return await viaImap(input);
    } catch (imapErr) {
      imapErr.detail = [imapErr.detail, `Graph: ${graphErr.message}${graphErr.detail ? ` (${graphErr.detail})` : ''}`]
        .filter(Boolean)
        .join('\n');
      throw imapErr;
    }
  }
}

router.post('/messages', limitRate, async (req, res) => {
  let release;
  try {
    const input = validate(req.body);
    release = await limiter.acquire(clientIp(req));
    const result = await fetchMessages(input);
    res.json({
      ok: true,
      mode: result.mode,
      newRefreshToken: result.newRefreshToken,
      messages: newest(result.messages, input.top),
    });
  } catch (err) {
    const known = err instanceof ToolError || err instanceof BusyError;
    // 只打印错误信息本身，不打印请求内容
    if (!known) console.error('[outlook]', err.message);
    res.status(known ? err.status : 500).json({
      ok: false,
      error: known ? err.message : '服务器内部错误',
      code: err.code,
      detail: err instanceof ToolError ? err.detail : undefined,
    });
  } finally {
    release?.();
  }
});
