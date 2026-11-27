// 应用外壳：侧边栏导航、工具搜索、路由（真实路径 /outlook，兼容旧的 #/outlook）、主题切换。
// 工具本身在 public/tools/ 下；网站名称和 SEO 文案在 assets/site.js。
import { groups, tools } from '../tools/registry.js';
import { SITE, PAGES, LEGACY_IDS } from './site.js';
import { icon } from './icons.js';
import { esc, toast, copyText, api, loadCss, store } from './ui.js';

const HOME = { id: '', name: '全部工具', desc: '选择一个工具开始使用', icon: 'grid', load: () => import('../tools/home.js') };
const SPECIAL = { privacy: { ...PAGES.privacy, load: () => import('../tools/privacy.js') } };
const THEMES = [
  { id: 'light', label: '浅色', icon: 'sun' },
  { id: 'dark', label: '深色', icon: 'moon' },
  { id: 'system', label: '自动', icon: 'monitor' },
];

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'),
  nav: $('nav'),
  view: $('view'),
  title: $('pageTitle'),
  group: $('pageGroup'),
  desc: $('pageDesc'),
  sidebar: $('sidebar'),
  scrim: $('scrim'),
  menuBtn: $('menuBtn'),
  search: $('navSearch'),
  themeSeg: $('themeSeg'),
};

// 传给每个工具 mount(el, ctx) 的上下文
const ctx = { toast, copyText, api, loadCss, store, icon, esc };

let cleanup = null;
let routeSeq = 0;

function currentId() {
  const seg = location.pathname.replace(/^\/+|\/+$/g, '');
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function findPage(id) {
  if (!id) return HOME;
  if (Object.hasOwn(SPECIAL, id)) return SPECIAL[id];
  return tools.find((t) => t.id === id && !t.soon) || null;
}

/** 站内跳转：改地址栏但不刷新页面 */
function navigate(href, { replace = false } = {}) {
  if (href !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState'](null, '', href);
  route();
}

/** 旧地址兼容：#/outlook、#/totp → /outlook、/2fa */
function migrateLegacyHash() {
  const m = location.hash.match(/^#\/([^?#]*)/);
  if (!m) return;
  const old = m[1].replace(/\/+$/, '');
  const id = LEGACY_IDS[old] || old;
  history.replaceState(null, '', id ? `/${encodeURIComponent(id)}` : '/');
}

// ---------- 侧边栏导航 ----------
function matches(t, q) {
  if (!q) return true;
  const g = groups.find((x) => x.id === t.group);
  return [t.name, t.desc, t.tag, g?.name].filter(Boolean).join(' ').toLowerCase().includes(q);
}

function renderNav() {
  const activeId = currentId();
  const q = els.search.value.trim().toLowerCase();
  const link = (t) => {
    if (t.soon) {
      return `<span class="nav-link is-soon" aria-disabled="true">${icon(t.icon)}<span>${esc(t.name)}</span><span class="nav-soon">即将上线</span></span>`;
    }
    const active = t.id === activeId;
    return `<a class="nav-link${active ? ' is-active' : ''}" href="/${esc(t.id)}"${active ? ' aria-current="page"' : ''}>${icon(t.icon)}<span>${esc(t.name)}</span></a>`;
  };

  const sections = groups
    .map((g) => {
      const items = tools.filter((t) => t.group === g.id && matches(t, q));
      if (!items.length) return '';
      return `<div class="nav-group"><div class="nav-label">${esc(g.name)}</div>${items.map(link).join('')}</div>`;
    })
    .join('');

  const home = q ? '' : `<div class="nav-group">${link(HOME)}</div>`;
  els.nav.innerHTML = home + (sections || `<p class="nav-empty">没有匹配「${esc(q)}」的工具</p>`);
}

function setDrawer(open) {
  els.sidebar.classList.toggle('is-open', open);
  els.scrim.hidden = !open;
  document.body.classList.toggle('no-scroll', open);
}

// ---------- 路由 ----------
async function route() {
  const seq = ++routeSeq;
  const id = currentId();
  const tool = findPage(id);

  setDrawer(false);
  renderNav();
  els.app.classList.toggle('is-home', !id);

  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch (err) {
      console.error(err);
    }
  }
  cleanup = null;
  els.view.scrollTop = 0;

  if (!tool) {
    setTitles({ name: '页面不存在', desc: '' }, '');
    els.view.innerHTML = `<div class="empty"><div class="empty-icon">${icon('alert', { size: 22 })}</div><p><strong>没有找到这个工具</strong>它可能已改名或下线；如果是新上线的工具，刷新页面后再试。</p><div class="empty-actions"><a class="btn sm" href="/">返回全部工具</a><button type="button" class="btn primary sm" data-reload>${icon('refresh', { size: 14 })}<span>刷新页面</span></button></div></div>`;
    return;
  }

  setTitles(tool, groups.find((g) => g.id === tool.group)?.name || '');
  // 每个页面挂载到一个新建的容器里，离开时整个容器被替换掉，
  // 工具绑在容器上的事件监听随之释放，不会在反复进出页面后越叠越多
  const host = document.createElement('div');
  host.className = 'view-page';
  host.innerHTML = '<div class="view-loading"><span class="spinner"></span></div>';
  els.view.replaceChildren(host);

  try {
    // 工具代码和样式表都加载好再挂载，期间一直显示加载圈，避免先闪出没有样式的内容
    const [mod] = await Promise.all([tool.load(), tool.css ? loadCss(tool.css) : null]);
    if (seq !== routeSeq) return; // 加载期间又切换了路由
    host.innerHTML = '';
    cleanup = (await mod.mount(host, ctx)) || null;
  } catch (err) {
    console.error(err);
    if (seq !== routeSeq) return;
    // 网站更新后，还开着的旧页面内存里是旧版公共模块，新工具模块会因缺少导出或文件变动而加载失败
    const stale = STALE_MODULE.test(err.message);
    els.view.innerHTML = stale
      ? `<div class="empty"><div class="empty-icon">${icon('refresh', { size: 22 })}</div><p><strong>网站已更新</strong>当前页面还是旧版本，刷新后即可使用新功能。</p><button type="button" class="btn primary sm" data-reload>${icon('refresh', { size: 14 })}<span>刷新页面</span></button></div>`
      : `<div class="empty"><div class="empty-icon">${icon('alert', { size: 22 })}</div><p><strong>工具加载失败</strong>${esc(err.message)}</p><button type="button" class="btn sm" data-reload>${icon('refresh', { size: 14 })}<span>刷新重试</span></button></div>`;
  }
}

// Chrome / Firefox / Safari 对「模块对不上」的不同报错写法
const STALE_MODULE =
  /does(?: not|n't) provide an export|import not found|binding name .* is not found|dynamically imported module|Importing a module script failed|error loading dynamically/i;

function setTitles(tool, groupName) {
  els.title.textContent = tool.name;
  els.group.textContent = groupName;
  els.desc.textContent = tool.desc || '';
  els.desc.title = tool.desc || '';
  // 和服务器端渲染的标题保持一致（server/lib/pages.js）
  document.title = tool.seo?.title || (tool.id ? `${tool.name} | ${SITE.name}` : tool === HOME ? SITE.title : `${tool.name} | ${SITE.name}`);
}

// ---------- 主题：浅色 / 深色 / 跟随系统 ----------
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function themePref() {
  try {
    const v = localStorage.getItem('app.theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(pref = themePref()) {
  const root = document.documentElement;
  const resolved = pref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : pref;
  if (root.dataset.theme !== resolved) {
    // 切换瞬间关闭过渡动画，避免颜色插值出现闪烁
    root.classList.add('theme-switching');
    root.dataset.theme = resolved;
    void root.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  }
  els.themeSeg.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === pref)));
}

els.themeSeg.innerHTML = THEMES.map(
  (t) => `<button type="button" data-theme-set="${t.id}" aria-pressed="false" title="${t.label}">${icon(t.icon, { size: 14 })}<span>${t.label}</span></button>`,
).join('');
els.themeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-theme-set]');
  if (!btn) return;
  try {
    localStorage.setItem('app.theme', btn.dataset.themeSet); // index.html 头部脚本读取的是原始字符串
  } catch {}
  applyTheme(btn.dataset.themeSet);
});
darkQuery.addEventListener('change', () => {
  if (themePref() === 'system') applyTheme('system');
});

// ---------- 事件 ----------
$('searchIcon').innerHTML = icon('search', { size: 16 });
els.search.addEventListener('input', renderNav);
els.search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = els.nav.querySelector('a.nav-link:not([href="/"])') || els.nav.querySelector('a.nav-link');
    if (first) {
      navigate(first.getAttribute('href'));
      els.search.value = '';
      els.search.blur();
    }
  }
  if (e.key === 'Escape') {
    els.search.value = '';
    renderNav();
    els.search.blur();
  }
});

els.view.addEventListener('click', (e) => {
  if (e.target.closest('[data-reload]')) location.reload();
});

els.menuBtn.innerHTML = icon('menu');
els.menuBtn.addEventListener('click', () => setDrawer(true));
els.scrim.addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.sidebar.classList.contains('is-open')) setDrawer(false);
  // 「/」聚焦工具搜索（正在输入时不触发）
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && !document.activeElement?.isContentEditable) {
    e.preventDefault();
    if (matchMedia('(max-width: 900px)').matches) setDrawer(true);
    els.search.focus();
  }
});

// 站内链接不刷新页面，交给前端路由；带修饰键、新窗口打开、下载、外链和 /api/ 保持浏览器默认行为
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || /\.[a-z0-9]+$/i.test(url.pathname)) return;
  e.preventDefault();
  if (url.pathname + url.search !== location.pathname + location.search) navigate(url.pathname + url.search);
  else setDrawer(false);
});
window.addEventListener('popstate', route);
// 有人还在用旧的 #/ 链接时也能正确跳转
window.addEventListener('hashchange', () => {
  if (/^#\//.test(location.hash)) {
    migrateLegacyHash();
    route();
  }
});

$('brandName').textContent = SITE.name;
applyTheme();
migrateLegacyHash();
route();
