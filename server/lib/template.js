// 读取 public/index.html 作为页面模板，并计算其中内联脚本的哈希（给内容安全策略放行用）。
// 文件改动后下一次请求自动重新读取，开发时不用重启。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'index.html');

let cache = { mtimeMs: -1, html: '', scriptHashes: [] };

export function template() {
  const { mtimeMs } = fs.statSync(FILE);
  if (mtimeMs !== cache.mtimeMs) {
    const html = fs.readFileSync(FILE, 'utf8');
    const scriptHashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
      (m) => `sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}`,
    );
    cache = { mtimeMs, html, scriptHashes };
  }
  return cache;
}
