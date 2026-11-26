// 号工具（HaoKit）服务端入口
//
// 日志规则：只打印错误信息和启动信息。不要打印 req.body、请求头或完整请求——
// 取件接口的请求体里有用户的 refresh_token，一旦写进日志就等于泄露。
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from './lib/config.js';
import { securityHeaders } from './lib/security.js';
import { renderPage, robotsTxt, sitemapXml } from './lib/pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TOOLS_DIR = path.join(__dirname, 'tools');

const app = express();
app.disable('x-powered-by');
// 识别反向代理转发的真实 IP 和协议（默认只信任本机的代理，见 server/lib/config.js）
app.set('trust proxy', config.trustProxy);
app.use(securityHeaders());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// 自动挂载 server/tools/<目录>/index.js 导出的 router 到 /api/<目录>
// 新增工具的后端接口时，只需新建一个目录，无需改这里。
for (const dir of fs.readdirSync(TOOLS_DIR).sort()) {
  const entry = path.join(TOOLS_DIR, dir, 'index.js');
  if (!fs.existsSync(entry)) continue;
  const mod = await import(pathToFileURL(entry).href);
  if (mod.router) {
    app.use(`/api/${dir}`, mod.router);
    console.log(`[tools] /api/${dir} 已挂载`);
  }
}

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: '接口不存在' }));

app.get('/robots.txt', robotsTxt);
app.get('/sitemap.xml', sitemapXml);
// 页面模板只能经由页面渲染访问，直接请求 index.html 时跳回首页
app.get('/index.html', (req, res) => res.redirect(301, '/'));

app.use(express.static(PUBLIC_DIR, { index: false, redirect: false }));

// 其余 GET / HEAD 请求都当作页面：已知地址返回 200，其他返回 404
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  renderPage(req, res);
});

// 兜底错误处理：不把内部错误细节暴露给前端
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: '请求体不是有效的 JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: '提交的内容太大' });
  }
  console.error('[server]', err.message);
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

app.listen(config.port, config.host, () => {
  console.log(`号工具已启动：http://${config.host}:${config.port}`);
  console.log(`[analytics] 访问统计${config.cfAnalyticsToken ? '已开启（Cloudflare Web Analytics）' : '未开启'}`);
});
