// 通过 IMAP + XOAUTH2 读取邮件
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ToolError } from './microsoft.js';

const IMAP_HOST = process.env.OUTLOOK_IMAP_HOST || 'outlook.office365.com';

function resolveFolder(boxes, folder) {
  if (folder === 'inbox') return 'INBOX';
  const junk =
    boxes.find((b) => b.specialUse === '\\Junk') ||
    boxes.find((b) => /^(junk|junk e-?mail|spam|垃圾邮件)$/i.test(b.name));
  return junk?.path || null;
}

function preview(text = '') {
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export async function listImapMessages(email, accessToken, folders, top) {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: email, accessToken },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  // 防止连接层错误变成未捕获异常导致进程退出
  client.on('error', () => {});

  try {
    await client.connect();
  } catch (err) {
    const raw = err.responseText || err.response || err.message || '';
    const authFailed = err.authenticationFailed || /AUTHENTICATE|LOGIN failed/i.test(raw);
    throw new ToolError(
      authFailed ? 'IMAP 登录失败：令牌没有 IMAP 权限，或该邮箱未开启 IMAP' : '无法连接 Outlook IMAP 服务器',
      { code: authFailed ? 'IMAP_AUTH' : 'IMAP_CONNECT', detail: String(raw).slice(0, 300), status: authFailed ? 400 : 502 },
    );
  }

  try {
    const boxes = await client.list();
    const results = [];

    for (const folder of folders) {
      const boxPath = resolveFolder(boxes, folder);
      if (!boxPath) continue;

      const lock = await client.getMailboxLock(boxPath, { readOnly: true });
      try {
        const total = client.mailbox?.exists || 0;
        if (!total) continue;
        const start = Math.max(1, total - top + 1);
        for await (const msg of client.fetch(`${start}:*`, { uid: true, source: true, flags: true, internalDate: true })) {
          const parsed = await simpleParser(msg.source, { skipTextToHtml: true });
          const from = parsed.from?.value?.[0] || {};
          results.push({
            id: `imap:${folder}:${msg.uid}`,
            folder,
            subject: parsed.subject || '',
            from: { name: from.name || '', address: from.address || '' },
            date: (parsed.date || msg.internalDate || new Date()).toISOString(),
            preview: preview(parsed.text || ''),
            html: parsed.html || null,
            text: parsed.html ? null : parsed.text || '',
            isRead: msg.flags?.has('\\Seen') ?? false,
          });
        }
      } finally {
        lock.release();
      }
    }
    return results;
  } finally {
    await client.logout().catch(() => client.close());
  }
}
