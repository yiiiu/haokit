// 通过 Microsoft Graph API 读取邮件
import { ToolError } from './microsoft.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const FOLDER_IDS = { inbox: 'inbox', junk: 'junkemail' };

function normalize(m, folder) {
  const isHtml = m.body?.contentType === 'html';
  return {
    id: `graph:${m.id}`,
    folder,
    subject: m.subject || '',
    from: {
      name: m.from?.emailAddress?.name || '',
      address: m.from?.emailAddress?.address || '',
    },
    date: m.receivedDateTime,
    preview: (m.bodyPreview || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    html: isHtml ? m.body.content : null,
    text: isHtml ? null : m.body?.content || '',
    isRead: Boolean(m.isRead),
  };
}

export async function listGraphMessages(accessToken, folders, top) {
  const all = [];
  for (const folder of folders) {
    const params = new URLSearchParams({
      $top: String(top),
      $orderby: 'receivedDateTime desc',
      $select: 'id,subject,from,receivedDateTime,bodyPreview,body,isRead',
    });
    const url = `${GRAPH}/me/mailFolders/${FOLDER_IDS[folder]}/messages?${params}`;

    let res;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.body-content-type="html"',
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ToolError('无法连接 Graph API', { code: 'NETWORK', detail: err.cause?.code || err.message, status: 502 });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ToolError('Graph API 读取邮件失败', {
        code: data.error?.code || `HTTP_${res.status}`,
        detail: data.error?.message || `HTTP ${res.status}`,
        status: 502,
      });
    }
    for (const m of data.value || []) all.push(normalize(m, folder));
  }
  return all;
}
