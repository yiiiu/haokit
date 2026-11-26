// Outlook / Hotmail 取件：三栏布局（账号 / 邮件列表 / 阅读区），窄屏时阅读区改为右侧抽屉
import { icon } from '../../assets/icons.js';
import {
  esc, toast, copyText, api, loadCss, store, shortTime, fullTime, runPool, hueOf, initialOf,
  openModal, confirmDialog, acceptFileDrop, pickTextFile, readClipboard, autoGrow,
} from '../../assets/ui.js';
import { extractCode } from '../../assets/lib/otp.js';
import { parseAccounts, ROLE_LABEL, ROLE_SHORT } from './parse.js';

const SETTINGS_KEY = 'outlook.settings';
const ACCOUNTS_KEY = 'outlook.accounts';
const POLL_MS = 10_000;
const CONCURRENCY = 3;
const FILTER_MIN = 6; // 账号多于这个数时显示筛选框
const PREVIEW_MAX = 200;
const FOLDER_LABEL = { inbox: '收件箱', junk: '垃圾箱', all: '全部' };
const MODE_LABEL = { graph: 'Graph', imap: 'IMAP' };

const FORMAT_EXAMPLES = [
  ['4 段', '邮箱----密码----client_id----refresh_token'],
  ['5 段', '邮箱----密码----辅助邮箱----client_id----refresh_token'],
  ['6 段', '邮箱----密码----refresh_token----client_id----access_token----时间'],
  ['冒号', '邮箱:密码:refresh_token:client_id'],
];

const SECRET_ROLES = new Set(['password', 'recoveryPassword']);

function maskValue(role, value) {
  if (SECRET_ROLES.has(role)) return '•'.repeat(Math.min(value.length, 8));
  if (value.length > 40) return `${value.slice(0, 18)}…（${value.length} 字符）`;
  return value;
}

/** 账号行悬停提示：逐段列出识别结果 */
function fieldsTitle(acc) {
  return acc.fields.map((f, i) => `第 ${i + 1} 段  ${ROLE_LABEL[f.role]}：${maskValue(f.role, f.value)}`).join('\n');
}

function fieldsSummary(acc) {
  return `${acc.fields.length} 段：${acc.fields.map((f) => ROLE_SHORT[f.role]).join(' / ')}`;
}

const keyOf = (a) => `${a.email.toLowerCase()}|${a.refreshToken.slice(-24)}`;

function dayGroup(input) {
  const t = new Date(input).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= today) return '今天';
  if (t >= today - 864e5) return '昨天';
  if (t >= today - 6 * 864e5) return '近 7 天';
  return '更早';
}

const avatar = (seed, label, cls = '') =>
  `<span class="avatar ${cls}" style="--h:${hueOf(seed)}" aria-hidden="true">${esc(initialOf(label))}</span>`;

function mailDoc(m) {
  const body = m.html || `<pre class="plain">${esc(m.text || m.preview || '')}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data: cid:; style-src 'unsafe-inline' *; font-src * data:;">
    <meta name="referrer" content="no-referrer">
    <style>
      html{background:#fff}
      body{margin:0;padding:20px 22px;color:#1f2328;font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;word-break:break-word}
      img{max-width:100%;height:auto}
      table{max-width:100%}
      pre.plain{white-space:pre-wrap;font:inherit;margin:0}
    </style></head><body>${body}</body></html>`;
}

function template(s) {
  const opt = (v, label, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${label}</option>`;
  const folderChip = (v) => `<button type="button" class="chip sm" data-folder="${v}" aria-pressed="${s.folder === v}">${FOLDER_LABEL[v]}</button>`;
  return `
  <div class="ol-cq" data-ref="cq"><div class="ol">
    <section class="ol-col ol-accounts" aria-label="账号">
      <header class="col-head ol-acc-head">
        <div class="col-title"><h2>账号</h2><span class="count-badge" data-ref="count">0</span></div>
        <div class="col-actions">
          <button type="button" class="icon-btn sm" data-ref="exportAll" title="导出全部账号（令牌已替换为最新）" aria-label="导出全部账号">${icon('copy', { size: 16 })}</button>
          <button type="button" class="icon-btn sm" data-ref="settingsBtn" title="取件设置" aria-label="取件设置" aria-haspopup="true" aria-expanded="false">${icon('sliders', { size: 16 })}</button>
          <button type="button" class="btn primary sm" data-act="import">${icon('plus', { size: 14 })}<span>导入</span></button>
        </div>
        <div class="popover ol-settings" data-ref="settingsPop" hidden>
          <div class="field">
            <label for="ol-mode" title="自动：先用 Graph API，失败再用 IMAP">读取方式</label>
            <select id="ol-mode" class="input" data-ref="mode">
              ${opt('auto', '自动（推荐）', s.mode)}
              ${opt('graph', 'Graph API', s.mode)}
              ${opt('imap', 'IMAP', s.mode)}
            </select>
          </div>
          <div class="field">
            <label for="ol-top">每次读取</label>
            <select id="ol-top" class="input" data-ref="top">
              ${[5, 10, 20, 50].map((n) => opt(n, `${n} 封`, s.top)).join('')}
            </select>
          </div>
          <label class="check"><input type="checkbox" data-ref="remember"${s.remember ? ' checked' : ''}> 记住账号（仅存本机浏览器）</label>
          <div class="popover-sep"></div>
          <button type="button" class="btn ghost danger sm" data-act="clearAll">${icon('trash', { size: 14 })}<span>清空全部账号</span></button>
        </div>
      </header>

      <div class="acc-toolbar" data-ref="accToolbar" hidden>
        <label class="acc-filter" data-ref="filterBox">
          ${icon('search', { size: 14 })}
          <input type="search" data-ref="filter" placeholder="筛选账号" autocomplete="off" aria-label="筛选账号">
        </label>
        <button type="button" class="btn sm" data-ref="fetchAll"></button>
      </div>

      <div class="col-scroll"><ul class="acc-list" data-ref="accList"></ul></div>
    </section>

    <section class="ol-col ol-mails" aria-label="邮件列表">
      <header class="col-head mail-head" data-ref="mailHead"></header>
      <div class="mail-toolbar">
        <div class="chips" data-ref="folder" role="group" aria-label="文件夹">${folderChip('inbox')}${folderChip('junk')}${folderChip('all')}</div>
        <button type="button" class="chip sm" data-ref="codeOnly" aria-pressed="${Boolean(s.codeOnly)}" title="只看识别到验证码的邮件">
          ${icon('key', { size: 13 })}<span>有验证码</span><span class="chip-count" data-ref="codeCount"></span>
        </button>
      </div>
      <div class="col-scroll" data-ref="mailBody"></div>
    </section>

    <section class="ol-col ol-reader" data-ref="reader" aria-label="邮件内容"></section>
  </div></div>

  <div class="drawer-scrim" data-ref="scrim" hidden></div>
  <aside class="drawer" data-ref="drawer" role="dialog" aria-modal="true" aria-label="邮件详情" hidden></aside>`;
}

// 跨页面保留的数据：模块只加载一次，切到别的工具再回来时账号、已取到的邮件和选中状态都还在，不用重新取件。
// view 指向当前挂载的界面；页面切走后仍在进行的取件完成时，用它刷新正在显示的界面。
const session = { accounts: [], selectedKey: null, openMailId: null, filter: '', busy: false, restored: false, view: null };

export function mount(root) {
  loadCss('/tools/outlook/outlook.css');

  const settings = { folder: 'inbox', mode: 'auto', top: 10, remember: false, auto: false, codeOnly: false, ...store.get(SETTINGS_KEY, {}) };
  const state = session;
  // 只属于这一次挂载的东西：定时器、导入弹窗
  const local = { pollTimer: null, importOpen: false, importModal: null };

  root.innerHTML = template(settings);
  const ref = Object.fromEntries([...root.querySelectorAll('[data-ref]')].map((n) => [n.dataset.ref, n]));

  const saveSettings = () => store.set(SETTINGS_KEY, settings);
  const selected = () => state.accounts.find((a) => a.key === state.selectedKey) || null;
  const tokenOf = (acc) => acc.newRefreshToken || acc.refreshToken;
  const updatedLine = (acc) => (acc.newRefreshToken ? acc.raw.replace(acc.refreshToken, acc.newRefreshToken) : acc.raw);
  const visibleMessages = (acc) => (acc?.messages ? (settings.codeOnly ? acc.messages.filter((m) => m.code) : acc.messages) : []);
  const visibleAccounts = () => {
    const q = state.filter.trim().toLowerCase();
    return q ? state.accounts.filter((a) => a.email.toLowerCase().includes(q)) : state.accounts;
  };
  const isWide = () => getComputedStyle(ref.reader).display !== 'none';

  // ---------- 账号增删 ----------
  function persist() {
    if (settings.remember) store.set(ACCOUNTS_KEY, state.accounts.map(updatedLine).join('\n'));
  }

  /** 加入新账号（按邮箱 + 令牌去重），返回真正新增的账号 */
  function addAccounts(parsed) {
    const known = new Set(state.accounts.map((a) => a.key));
    const added = [];
    for (const a of parsed) {
      const key = keyOf(a);
      if (known.has(key)) continue;
      known.add(key);
      added.push({ ...a, key, status: 'idle', messages: null });
    }
    state.accounts.push(...added);
    if (!selected() && added.length) {
      state.selectedKey = added[0].key;
      state.openMailId = null;
    }
    persist();
    renderAll();
    return added;
  }

  function removeAccount(key) {
    const idx = state.accounts.findIndex((a) => a.key === key);
    if (idx < 0) return;
    const [gone] = state.accounts.splice(idx, 1);
    if (state.selectedKey === key) {
      state.selectedKey = (state.accounts[idx] || state.accounts[idx - 1])?.key || null;
      state.openMailId = null;
      closeDrawer({ restoreFocus: false });
    }
    persist();
    renderAll();
    toast(`已移除 ${gone.email}`, 'info', 2000);
  }

  async function clearAll() {
    closeSettings();
    if (!state.accounts.length) return;
    const ok = await confirmDialog({
      title: '清空全部账号？',
      text: `会从列表里移除 ${state.accounts.length} 个账号${settings.remember ? '，并删除浏览器里记住的账号' : ''}。导出过的账号不受影响。`,
      okText: '清空',
      danger: true,
    });
    if (!ok) return;
    state.accounts = [];
    state.selectedKey = null;
    state.openMailId = null;
    state.filter = '';
    ref.filter.value = '';
    store.remove(ACCOUNTS_KEY);
    closeDrawer({ restoreFocus: false });
    renderAll();
  }

  function renderAll() {
    renderAccountsHead();
    renderList();
    renderMail();
  }

  function renderAccountsHead() {
    const n = state.accounts.length;
    const shown = visibleAccounts().length;
    ref.count.textContent = String(n);
    ref.exportAll.disabled = !n;
    ref.accToolbar.hidden = !n;
    ref.filterBox.hidden = n <= FILTER_MIN && !state.filter;
    ref.fetchAll.disabled = !shown || state.busy;
    ref.fetchAll.innerHTML = state.busy
      ? '<span class="spinner sm"></span><span>取件中…</span>'
      : `${icon('refresh', { size: 14 })}<span>${state.filter ? `取件 ${shown} 个` : `全部取件（${n}）`}</span>`;
  }

  // ---------- 账号列表 ----------
  function statusPill(acc) {
    if (acc.loading) return '<span class="spinner sm" aria-label="读取中"></span>';
    if (acc.status === 'error') return '<span class="pill pill-err">失败</span>';
    if (acc.status === 'ok') {
      const code = acc.messages?.find((m) => m.code)?.code;
      return code
        ? `<button type="button" class="code-chip sm" data-copy="${esc(code)}" title="复制验证码">${esc(code)}</button>`
        : `<span class="pill">${acc.messages.length} 封</span>`;
    }
    return '<span class="pill">待取件</span>';
  }

  function renderList() {
    if (!state.accounts.length) {
      ref.accList.innerHTML = `
        <li class="acc-empty dropzone">
          <div class="empty-icon">${icon('upload', { size: 22 })}</div>
          <strong>导入 Outlook 账号</strong>
          <p>把账号 .txt 文件拖到这里，或者直接在页面上按 <kbd>⌘V</kbd> / <kbd>Ctrl+V</kbd> 粘贴</p>
          <div class="acc-empty-actions">
            <button type="button" class="btn primary sm" data-act="import">${icon('clipboard', { size: 14 })}<span>粘贴账号</span></button>
            <button type="button" class="btn sm" data-act="pickFile">${icon('fileText', { size: 14 })}<span>选择文件</span></button>
          </div>
          <span class="acc-empty-note">支持 4 段、5 段、6 段等常见格式，字段顺序不限</span>
        </li>`;
      return;
    }
    const list = visibleAccounts();
    if (!list.length) {
      ref.accList.innerHTML = `<li class="acc-none">没有匹配「${esc(state.filter)}」的账号</li>`;
      return;
    }
    ref.accList.innerHTML = list
      .map((acc) => {
        const active = acc.key === state.selectedKey;
        const status = acc.loading ? 'loading' : acc.status;
        const sub =
          acc.status === 'error'
            ? esc(acc.error)
            : acc.fetchedAt
              ? `${MODE_LABEL[acc.mode] || ''} · ${shortTime(acc.fetchedAt)} 更新`
              : esc(fieldsSummary(acc));
        return `
          <li>
            <div class="acc-row${active ? ' is-active' : ''}" data-select="${esc(acc.key)}" role="button" tabindex="0" aria-pressed="${active}" title="${esc(fieldsTitle(acc))}">
              <span class="acc-avatar">${avatar(acc.email, acc.email, 'sm')}<span class="acc-dot is-${status}" aria-hidden="true"></span></span>
              <span class="acc-main">
                <span class="acc-email">${esc(acc.email)}</span>
                <span class="acc-sub${acc.status === 'error' ? ' is-error' : ''}">${sub}</span>
              </span>
              <span class="acc-side">${statusPill(acc)}</span>
            </div>
          </li>`;
      })
      .join('');
  }

  // ---------- 导入弹窗 ----------
  function openImport(prefill = '') {
    if (local.importOpen) return;
    local.importOpen = true;
    closeSettings();

    const m = openModal({
      title: '导入账号',
      width: 700,
      body: `
        <div class="imp">
          <div class="imp-box dropzone">
            <textarea class="imp-text mono" rows="6" spellcheck="false" autocomplete="off" aria-label="账号，一行一个"
              placeholder="把账号粘贴到这里，一行一个&#10;也可以直接把 .txt 文件拖进这个窗口"></textarea>
            <div class="imp-bar">
              <button type="button" class="btn ghost sm" data-imp="paste">${icon('clipboard', { size: 14 })}<span>从剪贴板粘贴</span></button>
              <button type="button" class="btn ghost sm" data-imp="file">${icon('fileText', { size: 14 })}<span>选择文件</span></button>
              <button type="button" class="btn ghost sm" data-imp="clear" hidden>清空</button>
            </div>
          </div>
          <div class="imp-result" data-imp-result></div>
        </div>`,
      footer: `
        <span class="imp-foot-note" data-imp-note></span>
        <button type="button" class="btn" data-imp="only">只导入</button>
        <button type="button" class="btn primary" data-imp="fetch"></button>`,
      onClose: () => {
        local.importOpen = false;
        local.importModal = null;
        detachDrop();
      },
    });
    local.importModal = m;

    const q = (sel) => m.el.querySelector(sel);
    const text = q('.imp-text');
    const result = q('[data-imp-result]');
    const note = q('[data-imp-note]');
    const btnOnly = q('[data-imp="only"]');
    const btnFetch = q('[data-imp="fetch"]');
    const btnClear = q('[data-imp="clear"]');
    let parsed = { fresh: [], dup: 0, invalid: [] };

    function guideHtml() {
      return `
        <div class="imp-guide">
          <div class="imp-guide-title">${icon('help', { size: 14 })}<span>支持这些格式，字段顺序不限，多余字段自动忽略</span></div>
          <ul>${FORMAT_EXAMPLES.map(([tag, ex]) => `<li><span class="pill">${tag}</span><code>${esc(ex)}</code></li>`).join('')}</ul>
          <p>分隔符支持 <code>----</code> <code>---</code> <code>|</code> Tab 和冒号；字段前可以带「邮箱：」「令牌：」这类注释。</p>
        </div>`;
    }

    function update() {
      const raw = text.value;
      btnClear.hidden = !raw;
      autoGrow(text, { minRows: 6, maxRows: 14 });
      if (!raw.trim()) {
        parsed = { fresh: [], dup: 0, invalid: [] };
        result.innerHTML = guideHtml();
      } else {
        const { accounts, invalid } = parseAccounts(raw);
        const known = new Set(state.accounts.map((a) => a.key));
        const seen = new Set();
        const rows = [];
        const fresh = [];
        let dup = 0;
        for (const a of accounts) {
          const key = keyOf(a);
          const dupTag = known.has(key) ? '已在列表' : seen.has(key) ? '重复' : '';
          seen.add(key);
          if (dupTag) dup++;
          else fresh.push(a);
          rows.push({ a, dupTag });
        }
        parsed = { fresh, dup, invalid };

        const badHtml = invalid.slice(0, PREVIEW_MAX).map(
          (x) => `
            <li class="imp-row is-bad">
              <span class="avatar sm acc-bad" aria-hidden="true">!</span>
              <span class="imp-main"><span class="imp-email">第 ${x.line} 行：${esc(x.reason)}</span><span class="imp-sub mono">${esc(x.raw.slice(0, 60))}${x.raw.length > 60 ? '…' : ''}</span></span>
            </li>`,
        );
        const okHtml = rows.slice(0, PREVIEW_MAX).map(
          ({ a, dupTag }) => `
            <li class="imp-row${dupTag ? ' is-dup' : ''}" title="${esc(fieldsTitle(a))}">
              ${avatar(a.email, a.email, 'sm')}
              <span class="imp-main"><span class="imp-email">${esc(a.email)}</span><span class="imp-sub">${esc(fieldsSummary(a))}</span></span>
              <span class="pill${dupTag ? '' : ' pill-ok'}">${dupTag || '新账号'}</span>
            </li>`,
        );
        const more = accounts.length + invalid.length - Math.min(accounts.length, PREVIEW_MAX) - Math.min(invalid.length, PREVIEW_MAX);
        result.innerHTML = `
          <div class="imp-summary">
            <span class="pill pill-ok">${icon('check', { size: 12 })}可导入 ${fresh.length}</span>
            ${dup ? `<span class="pill">重复跳过 ${dup}</span>` : ''}
            ${invalid.length ? `<span class="pill pill-err">无法识别 ${invalid.length}</span>` : ''}
          </div>
          <ul class="imp-list">${badHtml.join('')}${okHtml.join('')}</ul>
          ${more > 0 ? `<p class="imp-more">还有 ${more} 行未显示</p>` : ''}`;
      }
      const n = parsed.fresh.length;
      btnOnly.disabled = !n;
      btnFetch.disabled = !n;
      btnFetch.innerHTML = `${icon('inbox', { size: 15 })}<span>${n ? `导入并取件（${n}）` : '导入并取件'}</span>`;
      note.textContent = n ? `将导入 ${n} 个新账号` : raw.trim() ? '没有可导入的新账号' : '';
    }

    function append(t) {
      const cur = text.value.replace(/\s+$/, '');
      text.value = cur ? `${cur}\n${t.trim()}` : t.trim();
      update();
    }

    function commit(fetchAfter) {
      const added = addAccounts(parsed.fresh);
      m.close();
      if (!added.length) return;
      state.selectedKey = added[0].key;
      state.openMailId = null;
      renderAll();
      toast(`已导入 ${added.length} 个账号${parsed.dup ? `，跳过 ${parsed.dup} 个重复` : ''}`, 'ok');
      if (fetchAfter) fetchMany(added);
    }

    let timer;
    text.addEventListener('input', () => {
      autoGrow(text, { minRows: 6, maxRows: 14 });
      clearTimeout(timer);
      timer = setTimeout(update, 150);
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && parsed.fresh.length) {
        e.preventDefault();
        commit(true);
      }
    });
    m.el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-imp]')?.dataset.imp;
      if (act === 'paste') {
        const t = await readClipboard();
        if (t === null) {
          text.focus();
          toast('浏览器不允许读取剪贴板，请在输入框里按 ⌘V / Ctrl+V 粘贴', 'info', 3500);
        } else if (!t.trim()) toast('剪贴板是空的', 'info');
        else append(t);
      } else if (act === 'file') {
        try {
          const t = await pickTextFile();
          if (t) append(t);
        } catch (err) {
          toast(err.message, 'error', 3500);
        }
      } else if (act === 'clear') {
        text.value = '';
        update();
        text.focus();
      } else if (act === 'only') commit(false);
      else if (act === 'fetch') commit(true);
    });
    const detachDrop = acceptFileDrop(m.el, append);

    if (prefill) text.value = prefill.trim();
    update();
    text.focus();
  }

  // ---------- 设置菜单 ----------
  function closeSettings() {
    if (ref.settingsPop.hidden) return;
    ref.settingsPop.hidden = true;
    ref.settingsBtn.setAttribute('aria-expanded', 'false');
  }
  ref.settingsBtn.addEventListener('click', () => {
    const open = ref.settingsPop.hidden;
    ref.settingsPop.hidden = !open;
    ref.settingsBtn.setAttribute('aria-expanded', String(open));
  });
  const onDocDown = (e) => {
    if (!ref.settingsPop.hidden && !ref.settingsPop.contains(e.target) && !ref.settingsBtn.contains(e.target)) closeSettings();
  };
  document.addEventListener('mousedown', onDocDown);

  // ---------- 邮件列表 ----------
  function renderMailHead(acc) {
    if (!acc) {
      ref.mailHead.innerHTML = '<div class="col-title"><h2>邮件</h2></div>';
      return;
    }
    const meta = [
      acc.mode ? `<span class="pill pill-accent">${MODE_LABEL[acc.mode]}</span>` : '',
      acc.fetchedAt ? `<span>${shortTime(acc.fetchedAt)} 更新</span>` : `<span>未取件</span>`,
      acc.newRefreshToken ? `<span class="pill pill-ok" title="微软返回了新的 refresh_token，可以导出保存">令牌已更新</span>` : '',
    ].join('');
    ref.mailHead.innerHTML = `
      <div class="mh-top">
        ${avatar(acc.email, acc.email, 'sm')}
        <div class="mh-info">
          <div class="mh-email" title="${esc(acc.email)}">${esc(acc.email)}</div>
          <div class="mh-meta">${meta}<label class="switch" title="每 ${POLL_MS / 1000} 秒自动刷新当前账号"><input type="checkbox" data-act="auto"${settings.auto ? ' checked' : ''}><span>自动刷新</span></label></div>
        </div>
        <button type="button" class="icon-btn sm" data-act="copyLine" title="复制此账号（含最新令牌）" aria-label="复制此账号">${icon('copy', { size: 16 })}</button>
        <button type="button" class="icon-btn sm" data-act="remove" title="从列表移除此账号" aria-label="移除此账号">${icon('trash', { size: 16 })}</button>
        <button type="button" class="icon-btn sm" data-act="refresh" title="刷新" aria-label="刷新"${acc.loading ? ' disabled' : ''}>${acc.loading ? '<span class="spinner sm"></span>' : icon('refresh', { size: 16 })}</button>
      </div>`;
  }

  function renderToolbar(acc) {
    const n = acc?.messages?.filter((m) => m.code).length || 0;
    ref.codeCount.textContent = acc?.messages ? String(n) : '';
    ref.codeOnly.setAttribute('aria-pressed', String(Boolean(settings.codeOnly)));
  }

  function mailRow(m) {
    const name = m.from.name || m.from.address || '(未知发件人)';
    const active = m.id === state.openMailId;
    return `
      <li class="mail-row${m.isNew ? ' is-new' : ''}${m.isRead ? '' : ' is-unread'}${active ? ' is-active' : ''}" data-open="${esc(m.id)}" role="button" tabindex="0" aria-current="${active}">
        ${avatar(m.from.address || name, name)}
        <span class="mr-main">
          <span class="mr-top">
            <span class="mr-from" title="${esc(m.from.address)}">${esc(name)}</span>
            ${m.folder === 'junk' ? '<span class="pill pill-warn">垃圾箱</span>' : ''}
            <time class="mr-time" datetime="${esc(m.date)}" title="${esc(fullTime(m.date))}">${esc(shortTime(m.date))}</time>
          </span>
          <span class="mr-subject">${esc(m.subject || '(无主题)')}</span>
          <span class="mr-bottom">
            <span class="mr-preview">${esc(m.preview)}</span>
            ${m.code ? `<button type="button" class="code-chip" data-copy="${esc(m.code)}" title="复制验证码">${esc(m.code)}${icon('copy', { size: 13 })}</button>` : ''}
          </span>
        </span>
      </li>`;
  }

  function emptyBlock(iconName, title, text, action = '') {
    return `<div class="empty"><div class="empty-icon">${icon(iconName, { size: 22 })}</div><p><strong>${title}</strong>${text}</p>${action}</div>`;
  }

  function renderMail() {
    const acc = selected();
    renderMailHead(acc);
    renderToolbar(acc);

    if (!acc) {
      ref.mailBody.innerHTML = emptyBlock('inbox', '还没有账号', '点左上角「导入」添加账号，邮件会按时间分组显示在这里。');
    } else if (acc.loading && !acc.messages) {
      const sk = '<li class="mail-row is-skeleton"><span class="avatar"></span><span class="mr-main"><span class="sk w40"></span><span class="sk w70"></span><span class="sk w90"></span></span></li>';
      ref.mailBody.innerHTML = `<ul class="mail-list"><li class="group-label">读取中</li>${sk.repeat(5)}</ul>`;
    } else if (acc.status === 'error') {
      ref.mailBody.innerHTML = `
        <div class="ol-error" role="alert">
          <div class="ol-error-title">${icon('alert', { size: 18 })}<span>${esc(acc.error)}</span></div>
          ${acc.errorDetail ? `<pre class="ol-error-detail">${esc(acc.errorDetail)}</pre>` : ''}
          <button type="button" class="btn sm" data-act="refresh">${icon('refresh', { size: 14 })}<span>重试</span></button>
        </div>`;
    } else if (!acc.messages) {
      ref.mailBody.innerHTML = emptyBlock('mail', '这个账号还没有取件', '点下面的按钮读取最新邮件。', `<button type="button" class="btn primary sm" data-act="refresh">${icon('inbox', { size: 14 })}<span>取件</span></button>`);
    } else {
      const list = visibleMessages(acc);
      if (!list.length) {
        ref.mailBody.innerHTML =
          settings.codeOnly && acc.messages.length
            ? emptyBlock('key', '没有带验证码的邮件', `最近 ${acc.messages.length} 封邮件里没有识别到验证码。`, '<button type="button" class="btn sm" data-act="showAll">显示全部邮件</button>')
            : emptyBlock('inbox', `${FOLDER_LABEL[settings.folder]}是空的`, '换个文件夹看看，或稍后刷新。');
      } else {
        let html = '';
        let last = '';
        for (const m of list) {
          const g = dayGroup(m.date);
          if (g !== last) html += `<li class="group-label">${g}</li>`;
          last = g;
          html += mailRow(m);
        }
        ref.mailBody.innerHTML = `<ul class="mail-list">${html}</ul>`;
      }
    }
    syncReader();
  }

  // ---------- 阅读区 / 抽屉 ----------
  function readerHtml(m, closable) {
    const name = m.from.name || m.from.address || '(未知发件人)';
    return `
      <div class="reader">
        <div class="reader-head">
          <div class="reader-top">
            <h3 class="reader-subject">${esc(m.subject || '(无主题)')}</h3>
            ${closable ? `<button type="button" class="icon-btn" data-act="close" aria-label="关闭">${icon('x')}</button>` : ''}
          </div>
          <div class="reader-from">
            ${avatar(m.from.address || name, name)}
            <div class="rf-main">
              <div class="rf-name">${esc(name)}</div>
              <div class="rf-addr">${esc(m.from.address)}</div>
            </div>
            <div class="rf-side">
              <time datetime="${esc(m.date)}">${esc(fullTime(m.date))}</time>
              <span class="pill${m.folder === 'junk' ? ' pill-warn' : ''}">${FOLDER_LABEL[m.folder]}</span>
            </div>
          </div>
        </div>
        ${
          m.code
            ? `<div class="code-card">
                <div class="code-card-text"><span class="code-card-label">验证码</span><strong class="code-card-value">${esc(m.code)}</strong></div>
                <button type="button" class="btn accent sm" data-copy="${esc(m.code)}">${icon('copy', { size: 14 })}<span>复制</span></button>
              </div>`
            : ''
        }
        <div class="reader-frame">
          <iframe title="邮件正文" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>
        </div>
      </div>`;
  }

  function mountReader(container, m, closable) {
    container.innerHTML = readerHtml(m, closable);
    container.querySelector('iframe').srcdoc = mailDoc(m);
    container.dataset.mailId = m.id;
  }

  function renderReaderEmpty(iconName, title, text) {
    ref.reader.dataset.mailId = '';
    ref.reader.innerHTML = emptyBlock(iconName, title, text);
  }

  function highlightRow(id) {
    root.querySelectorAll('.mail-row.is-active').forEach((r) => {
      r.classList.remove('is-active');
      r.setAttribute('aria-current', 'false');
    });
    if (!id) return;
    const row = root.querySelector(`.mail-row[data-open="${CSS.escape(id)}"]`);
    row?.classList.add('is-active');
    row?.classList.remove('is-new');
    row?.setAttribute('aria-current', 'true');
  }

  /** 宽屏时让阅读区与列表保持一致：没有打开的邮件就自动打开最新一封 */
  function syncReader() {
    if (!isWide()) return;
    const acc = selected();
    const list = visibleMessages(acc);
    if (!acc) return renderReaderEmpty('mailOpen', '邮件内容会显示在这里', '验证码会自动识别并放大显示，点一下即可复制。');
    if (acc.loading && !acc.messages) return renderReaderEmpty('mailOpen', '正在读取邮件…', '读取完成后会自动打开最新一封。');
    if (!list.length) return renderReaderEmpty('mailOpen', '没有可显示的邮件', '取件成功后，点选左侧的邮件查看内容。');
    const current = list.find((m) => m.id === state.openMailId);
    if (current) {
      if (ref.reader.dataset.mailId !== current.id) mountReader(ref.reader, current, false);
      return;
    }
    openMail(list[0].id);
  }

  function openMail(id) {
    const acc = selected();
    const m = acc?.messages?.find((x) => x.id === id);
    if (!m) return;
    state.openMailId = id;
    m.isNew = false;
    highlightRow(id);

    if (isWide()) {
      mountReader(ref.reader, m, false);
      return;
    }
    mountReader(ref.drawer, m, true);
    ref.drawer.hidden = false;
    ref.scrim.hidden = false;
    requestAnimationFrame(() => {
      ref.drawer.classList.add('is-open');
      ref.scrim.classList.add('is-open');
    });
    ref.drawer.querySelector('[data-act="close"]').focus();
  }

  function closeDrawer({ restoreFocus = true } = {}) {
    if (ref.drawer.hidden) return;
    const lastId = state.openMailId;
    if (!isWide()) {
      state.openMailId = null;
      highlightRow(null);
    }
    ref.drawer.classList.remove('is-open');
    ref.scrim.classList.remove('is-open');
    setTimeout(() => {
      if (ref.drawer.classList.contains('is-open')) return;
      ref.drawer.hidden = true;
      ref.scrim.hidden = true;
      ref.drawer.innerHTML = '';
      ref.drawer.dataset.mailId = '';
    }, 220);
    if (restoreFocus && lastId) root.querySelector(`.mail-row[data-open="${CSS.escape(lastId)}"]`)?.focus();
  }

  // 窗口变宽时把抽屉里的邮件移到阅读区
  const resizeObs = new ResizeObserver(() => {
    if (isWide() && !ref.drawer.hidden) {
      const id = state.openMailId;
      closeDrawer({ restoreFocus: false });
      state.openMailId = id;
      highlightRow(id);
    }
    syncReader();
  });
  resizeObs.observe(ref.cq);

  // ---------- 取件 ----------
  /** 刷新当前显示的界面（取件可能在页面切走后才完成） */
  function redraw(acc) {
    const v = session.view;
    if (!v) return;
    v.renderList();
    if (acc.key === session.selectedKey) v.renderMail();
  }

  async function fetchAccount(acc, { silent = false } = {}) {
    if (acc.loading) return;
    acc.loading = true;
    redraw(acc);

    try {
      const data = await api('/api/outlook/messages', {
        email: acc.email,
        clientId: acc.clientId,
        refreshToken: tokenOf(acc),
        folders: settings.folder === 'all' ? ['inbox', 'junk'] : [settings.folder],
        top: settings.top,
        mode: settings.mode,
      });
      const known = acc.messages && acc.status === 'ok' ? new Set(acc.messages.map((m) => m.id)) : null;
      const messages = data.messages.map((m) => ({ ...m, code: extractCode(m), isNew: known ? !known.has(m.id) : false }));
      const fresh = messages.filter((m) => m.isNew);

      Object.assign(acc, { messages, mode: data.mode, status: 'ok', error: null, errorDetail: null, fetchedAt: new Date() });
      if (data.newRefreshToken && data.newRefreshToken !== acc.refreshToken) {
        acc.newRefreshToken = data.newRefreshToken;
        persist();
      }

      if (silent && fresh.length) {
        const code = fresh.find((m) => m.code)?.code;
        toast(`${acc.email} 收到 ${fresh.length} 封新邮件${code ? `，验证码 ${code}` : ''}`, 'ok', 4000);
      }
    } catch (err) {
      if (!silent || acc.status !== 'ok') {
        Object.assign(acc, { status: 'error', error: err.message, errorDetail: err.detail || '' });
      }
    } finally {
      acc.loading = false;
      if (state.accounts.includes(acc)) redraw(acc);
    }
  }

  async function fetchMany(list) {
    if (!list.length || state.busy) return;
    state.busy = true;
    session.view?.renderAccountsHead();
    await runPool([...list], CONCURRENCY, (acc) => fetchAccount(acc));
    state.busy = false;
    session.view?.renderAccountsHead();
    const failed = list.filter((a) => a.status === 'error').length;
    if (list.length > 1) toast(failed ? `取件完成，${failed} 个账号失败` : `${list.length} 个账号取件完成`, failed ? 'error' : 'ok');
  }

  // ---------- 自动刷新 ----------
  function schedulePoll() {
    clearInterval(local.pollTimer);
    local.pollTimer = null;
    if (!settings.auto) return;
    local.pollTimer = setInterval(() => {
      const acc = selected();
      if (acc && acc.status !== 'idle' && !document.hidden) fetchAccount(acc, { silent: true });
    }, POLL_MS);
  }

  // ---------- 事件 ----------
  ref.filter.addEventListener('input', () => {
    state.filter = ref.filter.value;
    renderAccountsHead();
    renderList();
  });
  ref.fetchAll.addEventListener('click', () => fetchMany(visibleAccounts()));

  ref.folder.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-folder]');
    if (!btn || btn.dataset.folder === settings.folder) return;
    settings.folder = btn.dataset.folder;
    saveSettings();
    ref.folder.querySelectorAll('[data-folder]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    state.openMailId = null;
    const acc = selected();
    if (acc && acc.status !== 'idle') fetchAccount(acc);
    else renderMail();
  });

  ref.codeOnly.addEventListener('click', () => {
    settings.codeOnly = !settings.codeOnly;
    saveSettings();
    renderMail();
  });

  ref.mode.addEventListener('change', () => {
    settings.mode = ref.mode.value;
    saveSettings();
  });
  ref.top.addEventListener('change', () => {
    settings.top = Number(ref.top.value);
    saveSettings();
  });
  ref.remember.addEventListener('change', () => {
    settings.remember = ref.remember.checked;
    saveSettings();
    if (settings.remember) persist();
    else store.remove(ACCOUNTS_KEY);
    toast(settings.remember ? '已开启：账号会保存在这台电脑的浏览器里' : '已关闭，并删除了浏览器里保存的账号', 'info', 2600);
  });

  ref.exportAll.addEventListener('click', () => {
    if (!state.accounts.length) return;
    const updated = state.accounts.filter((a) => a.newRefreshToken).length;
    copyText(
      state.accounts.map(updatedLine).join('\n'),
      updated ? `已复制 ${state.accounts.length} 个账号（${updated} 个令牌已更新）` : `已复制 ${state.accounts.length} 个账号`,
    );
  });

  root.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      e.stopPropagation();
      copyText(copyBtn.dataset.copy, `已复制验证码 ${copyBtn.dataset.copy}`);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'import') return openImport();
    if (act === 'pickFile') {
      try {
        const text = await pickTextFile();
        if (text) openImport(text);
      } catch (err) {
        toast(err.message, 'error', 3500);
      }
      return;
    }
    if (act === 'clearAll') return clearAll();
    if (act === 'refresh') {
      const acc = selected();
      if (acc) fetchAccount(acc);
      return;
    }
    if (act === 'remove') {
      const acc = selected();
      if (acc) removeAccount(acc.key);
      return;
    }
    if (act === 'copyLine') {
      const acc = selected();
      if (acc) copyText(updatedLine(acc), acc.newRefreshToken ? '已复制账号（含最新令牌）' : '已复制账号');
      return;
    }
    if (act === 'showAll') {
      settings.codeOnly = false;
      saveSettings();
      renderMail();
      return;
    }
    if (act === 'close') return closeDrawer();

    const sel = e.target.closest('[data-select]');
    if (sel) {
      if (sel.dataset.select !== state.selectedKey) {
        state.selectedKey = sel.dataset.select;
        state.openMailId = null;
        renderList();
        renderMail();
      }
      const acc = selected();
      if (acc && acc.status === 'idle') fetchAccount(acc);
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) openMail(open.dataset.open);
  });

  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-act="auto"]')) {
      settings.auto = e.target.checked;
      saveSettings();
      schedulePoll();
      toast(settings.auto ? `已开启自动刷新（每 ${POLL_MS / 1000} 秒）` : '已关闭自动刷新', 'info', 1800);
    }
  });

  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-select],[data-open]')) {
      e.preventDefault();
      e.target.click();
    }
    // 在邮件列表里用 ↑ ↓ 切换邮件
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.matches('.mail-row')) {
      e.preventDefault();
      const rows = [...root.querySelectorAll('.mail-row[data-open]')];
      const next = rows[rows.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        next.focus();
        if (isWide()) openMail(next.dataset.open);
      }
    }
  });

  ref.scrim.addEventListener('click', () => closeDrawer());
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (!ref.settingsPop.hidden) return closeSettings();
    closeDrawer();
  };
  document.addEventListener('keydown', onKey);

  // 在页面空白处直接 ⌘V / Ctrl+V 粘贴账号 → 打开导入弹窗
  const onPaste = (e) => {
    if (local.importOpen) return;
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const text = e.clipboardData?.getData('text') || '';
    if (!/@/.test(text)) return;
    e.preventDefault();
    openImport(text);
  };
  document.addEventListener('paste', onPaste);

  // 把 .txt 文件拖到工具区域 → 打开导入弹窗
  const detachDrop = acceptFileDrop(ref.cq, (text) => openImport(text));

  // ---------- 初始化 ----------
  const view = { renderList, renderMail, renderAccountsHead };
  session.view = view;
  ref.filter.value = state.filter;
  if (!session.restored) {
    // 本标签页第一次打开取件器时，读取浏览器里记住的账号；之后切页面回来直接用内存里的数据
    session.restored = true;
    if (settings.remember) {
      const saved = store.get(ACCOUNTS_KEY, '');
      if (saved) addAccounts(parseAccounts(saved).accounts);
    }
  }
  renderAll();
  schedulePoll();

  return () => {
    // 窄屏时阅读用的抽屉会随页面一起消失，回来时不再标记打开的那封邮件
    if (!isWide()) state.openMailId = null;
    if (session.view === view) session.view = null;
    local.importModal?.close();
    clearInterval(local.pollTimer);
    resizeObs.disconnect();
    detachDrop();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('paste', onPaste);
    document.removeEventListener('mousedown', onDocDown);
  };
}
