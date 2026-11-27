// 页面渲染：每个地址返回同一个前端外壳，但标题、描述、canonical、分享卡片和无脚本简介按页面写好，
// 这样不执行 JavaScript 的搜索引擎（比如百度）也能看到每一页各自的内容。另外生成 robots.txt 和 sitemap.xml。
import { tools } from '../../public/tools/registry.js';
import { SITE, PAGES, LEGACY_IDS } from '../../public/assets/site.js';
import { config, siteBase } from './config.js';
import { template } from './template.js';

const BUILT = new Date().toISOString().slice(0, 10);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const liveTools = () => tools.filter((t) => !t.soon);

function pageFor(id) {
  if (id === '') return { path: '/', name: SITE.name, title: SITE.title, description: SITE.description };
  if (Object.hasOwn(PAGES, id)) {
    const p = PAGES[id];
    return { path: `/${id}`, name: p.name, title: p.seo.title, description: p.seo.description };
  }
  const t = liveTools().find((x) => x.id === id);
  if (!t) return null;
  return {
    path: `/${t.id}`,
    name: t.name,
    title: t.seo?.title || `${t.name} | ${SITE.name}`,
    description: t.seo?.description || t.desc,
    css: t.css,
  };
}

function headTags(page, base, status) {
  const tags = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
  ];
  if (status === 200) {
    const url = base + page.path;
    tags.push(
      `<link rel="canonical" href="${esc(url)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="${esc(SITE.name)}">`,
      `<meta property="og:title" content="${esc(page.title)}">`,
      `<meta property="og:description" content="${esc(page.description)}">`,
      `<meta property="og:url" content="${esc(url)}">`,
      `<meta property="og:image" content="${esc(base)}/brand/icon-512.png">`,
      `<meta name="twitter:card" content="summary">`,
    );
  } else {
    tags.push('<meta name="robots" content="noindex">');
  }
  return tags.join('\n  ');
}

/** 浏览器不运行脚本时显示的简介，同时给搜索引擎提供正文和站内链接 */
function noscriptBody(page) {
  const links = liveTools()
    .map((t) => `<li><a href="/${esc(t.id)}">${esc(t.name)}</a>：${esc(t.desc)}</li>`)
    .join('');
  return `<noscript><section class="noscript">
          <h1>${esc(page.name)}</h1>
          <p>${esc(page.description)}</p>
          <p>本站工具需要启用 JavaScript 才能使用。</p>
          <ul>${links}<li><a href="/privacy">隐私说明</a></li></ul>
        </section></noscript>`;
}

/**
 * Cloudflare Web Analytics 统计脚本：不用 Cookie，会自动统计站内切换页面（History API）。
 * 令牌只含字母数字（config.js 里校验过），可以直接放进属性里
 */
function analyticsTag() {
  const token = config.cfAnalyticsToken;
  if (!token) return '';
  return `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>\n`;
}

/** GET / HEAD 页面请求 */
export function renderPage(req, res) {
  let id = req.path.replace(/^\/+|\/+$/g, '');
  try {
    id = decodeURIComponent(id);
  } catch {
    // 非法编码按不存在处理
  }
  if (Object.hasOwn(LEGACY_IDS, id)) return res.redirect(301, `/${LEGACY_IDS[id]}`);

  const found = pageFor(id);
  const status = found ? 200 : 404;
  const page = found || { path: req.path, name: '页面不存在', title: `页面不存在 | ${SITE.name}`, description: SITE.description };
  const { html } = template();
  const out = html
    .replace(/<title>[\s\S]*?<\/title>/, headTags(page, siteBase(req), status))
    // 当前工具的样式表直接写进页面（在 app.css 之后），和主样式并行下载，刷新时不会先闪出没有样式的内容
    .replace('<!--tool-css-->', page.css ? `<link rel="stylesheet" href="${esc(page.css)}" data-css="${esc(page.css)}">` : '')
    .replace('<!--seo-body-->', noscriptBody(page))
    .replace('</body>', `${analyticsTag()}</body>`);

  res.status(status).set('Cache-Control', 'no-cache').type('html').send(out);
}

export function robotsTxt(req, res) {
  res
    .type('text/plain')
    .send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteBase(req)}/sitemap.xml\n`);
}

export function sitemapXml(req, res) {
  const base = siteBase(req);
  const urls = [
    { loc: '/', priority: '1.0' },
    ...liveTools().map((t) => ({ loc: `/${t.id}`, priority: '0.9' })),
    { loc: '/privacy', priority: '0.3' },
  ];
  const body = urls
    .map((u) => `  <url><loc>${esc(base + u.loc)}</loc><lastmod>${BUILT}</lastmod><priority>${u.priority}</priority></url>`)
    .join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
}
