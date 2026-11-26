// 各工具共用的小工具函数
import { icon } from './icons.js';

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

/** 轻提示。type: info | ok | error */
export function toast(message, type = 'info', ms = 2600) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const ic = type === 'ok' ? 'check' : type === 'error' ? 'alert' : 'sparkle';
  el.innerHTML = `${icon(ic, { size: 16 })}<span>${esc(message)}</span>`;
  box.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }, ms);
}

export async function copyText(text, label = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label, 'ok', 1600);
}

/** POST JSON 到后端，失败时抛出带 detail 的 Error */
export async function api(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error('无法连接本站服务器，请确认服务已启动'), { code: 'OFFLINE' });
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: `服务器响应异常（HTTP ${res.status}）` };
  }
  if (!res.ok || data.ok === false) {
    throw Object.assign(new Error(data.error || `请求失败（HTTP ${res.status}）`), { code: data.code, detail: data.detail });
  }
  return data;
}

/** 按需加载工具自己的样式表 */
export function loadCss(href) {
  if (document.querySelector(`link[data-css="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.css = href;
  document.head.append(link);
}

/** localStorage 包装：任何异常都静默降级 */
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

const pad = (n) => String(n).padStart(2, '0');

/** 今天显示 HH:mm，今年显示 MM-DD HH:mm，否则显示 YYYY-MM-DD */
export function shortTime(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return hm;
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fullTime(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 以固定并发数执行异步任务 */
export async function runPool(items, limit, worker) {
  let i = 0;
  const next = async () => {
    while (i < items.length) await worker(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

/** 根据文本生成稳定的头像色相（0–359），配合 CSS 变量 --h 使用 */
export function hueOf(text = '') {
  let h = 0;
  for (const ch of String(text).toLowerCase()) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

/** 取用于头像的首字符 */
export function initialOf(text = '') {
  return (String(text).match(/[A-Za-z0-9\u4e00-\u9fa5]/)?.[0] || '?').toUpperCase();
}

/**
 * 打开模态框。body / footer 是 HTML 字符串。
 * 返回 { el, close }，el 是 .modal 元素，可以在里面查找和绑定事件。
 */
export function openModal({ title, body = '', footer = '', width = 640, onClose } = {}) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="--modal-w:${width}px">
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn sm" data-modal-close aria-label="关闭">${icon('x')}</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`;
  const prevFocus = document.activeElement;
  document.body.append(scrim);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => scrim.classList.add('is-open'));

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  function close() {
    if (!scrim.isConnected || scrim.dataset.closing) return;
    scrim.dataset.closing = '1';
    scrim.classList.remove('is-open');
    document.removeEventListener('keydown', onKey, true);
    if (!document.querySelector('.modal-scrim:not([data-closing])')) document.body.classList.remove('no-scroll');
    setTimeout(() => scrim.remove(), 200);
    prevFocus?.focus?.({ preventScroll: true });
    onClose?.();
  }
  document.addEventListener('keydown', onKey, true);
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) close();
  });
  scrim.querySelector('[data-modal-close]').addEventListener('click', close);
  return { el: scrim.querySelector('.modal'), close };
}

/** 二次确认框，返回 Promise<boolean> */
export function confirmDialog({ title, text = '', okText = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const m = openModal({
      title,
      width: 420,
      body: `<p class="modal-text">${esc(text)}</p>`,
      footer: `<button type="button" class="btn" data-cancel>取消</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okText)}</button>`,
      onClose: () => resolve(ok),
    });
    m.el.querySelector('[data-cancel]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      ok = true;
      m.close();
    });
    m.el.querySelector('[data-ok]').focus();
  });
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** 读取文本文件（.txt / .csv 等），太大或不是文本时抛错 */
export async function readTextFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`「${file.name}」超过 5 MB，请拆分后再导入`);
  if (file.type && !/^text\/|csv|json/.test(file.type)) throw new Error(`「${file.name}」不是文本文件，只支持 .txt、.csv`);
  return file.text();
}

/** 弹出文件选择框，返回所选文件的文本（取消时为 null） */
export function pickTextFile(accept = '.txt,.csv,text/plain') {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.addEventListener('change', async () => {
      const files = [...input.files];
      if (!files.length) return resolve(null);
      try {
        resolve((await Promise.all(files.map(readTextFile))).join('\n'));
      } catch (err) {
        reject(err);
      }
    });
    input.click();
  });
}

/**
 * 让元素接受拖入的文本文件：拖入时加 .is-dragover，松开后回调 onText(text)。
 * 返回解绑函数。
 */
export function acceptFileDrop(el, onText) {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const onEnter = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    el.classList.add('is-dragover');
  };
  const onOver = (e) => {
    if (hasFiles(e)) e.preventDefault();
  };
  const onLeave = (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('is-dragover');
  };
  const onDrop = async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    el.classList.remove('is-dragover');
    try {
      const texts = await Promise.all([...e.dataTransfer.files].map(readTextFile));
      onText(texts.join('\n'));
    } catch (err) {
      toast(err.message, 'error', 3500);
    }
  };
  el.addEventListener('dragenter', onEnter);
  el.addEventListener('dragover', onOver);
  el.addEventListener('dragleave', onLeave);
  el.addEventListener('drop', onDrop);
  return () => {
    el.removeEventListener('dragenter', onEnter);
    el.removeEventListener('dragover', onOver);
    el.removeEventListener('dragleave', onLeave);
    el.removeEventListener('drop', onDrop);
  };
}

/** 读取剪贴板文本；浏览器不允许时返回 null */
export async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/** 文本框随内容自动长高（在 minRows 与 maxRows 之间） */
export function autoGrow(textarea, { minRows = 3, maxRows = 12 } = {}) {
  const lines = textarea.value.split('\n').length;
  textarea.rows = Math.min(maxRows, Math.max(minRows, lines + 1));
}
