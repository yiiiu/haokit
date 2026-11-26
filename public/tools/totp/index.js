// 2FA 验证码：粘贴密钥，实时生成 TOTP 动态码。全部在浏览器本地计算，密钥不会发送到服务器。
import { icon } from '../../assets/icons.js';
import {
  esc, toast, copyText, loadCss, store, hueOf, initialOf,
  acceptFileDrop, pickTextFile, readClipboard, autoGrow,
} from '../../assets/ui.js';
import { ALGORITHMS, cryptoAvailable, selfTest, timeStep, totp } from '../../assets/lib/totp.js';
import { parseSecrets } from './parse.js';

const SETTINGS_KEY = 'totp.settings';
const SECRETS_KEY = 'totp.secrets';
const TICK_MS = 250;
const URGENT_SECONDS = 5;
const RING_R = 17;
const RING_C = 2 * Math.PI * RING_R;
const DEFAULTS = { digits: 6, period: 30, algorithm: 'SHA-1' };
const DEMO = ['JBSWY3DPEHPK3PXP', '示例账号|GEZDGNBVGY3TQOJQ', 'otpauth://totp/GitHub:alice@example.com?secret=KRUGS4ZANFZSA4ZT&issuer=GitHub'].join('\n');

const PLACEHOLDER = ['粘贴 2FA 密钥，一行一个', 'JBSWY3DPEHPK3PXP', 'UID|密码|2FA密钥|邮箱|邮箱密码', 'otpauth://totp/…'].join('\n');

/** 123456 → 123 456；12345678 → 1234 5678 */
function groupCode(code) {
  if (!code) return '';
  const cut = code.length === 8 ? 4 : 3;
  return `${code.slice(0, cut)} ${code.slice(cut)}`;
}

const maskSecret = (s) => (s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);
const algoLabel = (a) => a.replace('-', '');
const pad = (n) => String(n).padStart(2, '0');
const isDefault = (s) => s.digits === DEFAULTS.digits && s.period === DEFAULTS.period && s.algorithm === DEFAULTS.algorithm;

function template(s) {
  const chip = (group, v, label, cur) =>
    `<button type="button" class="chip sm" data-${group}="${v}" aria-pressed="${String(cur) === String(v)}">${label}</button>`;
  return `
  <div class="tp-cq" data-ref="cq"><div class="tp">
    <section class="tp-col tp-input" aria-label="密钥">
      <header class="col-head">
        <div class="col-title"><h2>密钥</h2><span class="count-badge" data-ref="count">0</span></div>
        <div class="col-actions">
          <button type="button" class="btn ghost sm" data-act="demo" title="填入几条示例密钥">${icon('sparkle', { size: 14 })}<span>示例</span></button>
        </div>
      </header>
      <div class="tp-form">
        <div class="tp-box dropzone">
          <textarea class="tp-textarea mono" data-ref="input" rows="4" spellcheck="false" autocomplete="off"
            aria-label="2FA 密钥，一行一个" placeholder="${esc(PLACEHOLDER)}"></textarea>
          <div class="tp-bar">
            <button type="button" class="btn ghost sm" data-act="paste">${icon('clipboard', { size: 14 })}<span>粘贴</span></button>
            <button type="button" class="btn ghost sm" data-act="file">${icon('fileText', { size: 14 })}<span>导入文件</span></button>
            <button type="button" class="btn ghost sm" data-act="clear" data-ref="clear">清空</button>
          </div>
        </div>
        <p class="tp-hint">${icon('shield', { size: 14 })}<span>支持纯密钥、<code>otpauth://</code> 链接和 <code>UID|密码|2FA|邮箱</code> 这类账号行，也可以把 .txt 文件拖进来。密钥只在浏览器本地计算，不会上传。</span></p>
        <label class="check"><input type="checkbox" data-ref="remember"${s.remember ? ' checked' : ''}> 记住密钥（仅存本机浏览器）</label>

        <details class="tp-adv" data-ref="adv">
          <summary>${icon('sliders', { size: 14 })}<span>高级设置</span><span class="pill" data-ref="advState"></span>${icon('chevronDown', { size: 14, cls: 'tp-adv-chevron' })}</summary>
          <div class="tp-adv-body">
            <div class="tp-opts">
              <div class="field">
                <span class="field-label">位数</span>
                <div class="chips" data-ref="digits">${chip('digits', 6, '6 位', s.digits)}${chip('digits', 8, '8 位', s.digits)}</div>
              </div>
              <div class="field">
                <span class="field-label">周期</span>
                <div class="chips" data-ref="period">${chip('period', 30, '30 秒', s.period)}${chip('period', 60, '60 秒', s.period)}</div>
              </div>
              <div class="field">
                <label for="tp-algo">算法</label>
                <select id="tp-algo" class="input" data-ref="algorithm">
                  ${ALGORITHMS.map((a) => `<option value="${a}"${a === s.algorithm ? ' selected' : ''}>${algoLabel(a)}</option>`).join('')}
                </select>
              </div>
            </div>
            <p class="tp-note">几乎所有网站都是 6 位、30 秒、SHA1，一般不用改。<code>otpauth://</code> 链接里自带的参数会自动生效。</p>
            <div class="tp-adv-foot">
              <span class="tp-selftest" data-ref="selftest"><span class="spinner sm"></span>算法自检中…</span>
              <button type="button" class="btn ghost sm" data-act="reset" data-ref="reset">恢复默认</button>
            </div>
          </div>
        </details>
      </div>
      <ul class="tp-invalid" data-ref="invalid" hidden></ul>
    </section>

    <section class="tp-col tp-codes" aria-label="验证码">
      <header class="col-head">
        <div class="col-title"><h2>验证码</h2></div>
        <div class="col-actions">
          <span class="tp-clock" title="验证码按本机时间计算，时间不准会导致验证码错误">${icon('clock', { size: 14 })}<b class="mono" data-ref="clock"></b></span>
          <button type="button" class="btn sm" data-ref="copyAll">${icon('copy', { size: 14 })}<span>复制全部</span></button>
        </div>
      </header>
      <div class="col-scroll"><div class="tp-grid" data-ref="grid" aria-live="off"></div></div>
    </section>
  </div></div>`;
}

// 切到别的工具再回来时保留输入的密钥（只在内存里，刷新页面就没有；要长期保存请勾选「记住密钥」）
let draft = null;

export function mount(root) {
  loadCss('/tools/totp/totp.css');

  const settings = { ...DEFAULTS, remember: false, ...store.get(SETTINGS_KEY, {}) };
  const state = { items: [], invalid: [], cards: [], timer: null };

  root.innerHTML = template(settings);
  const ref = Object.fromEntries([...root.querySelectorAll('[data-ref]')].map((n) => [n.dataset.ref, n]));
  const saveSettings = () => store.set(SETTINGS_KEY, settings);

  /** 每条密钥最终使用的参数：链接里的优先，其次是全局设置 */
  const paramsOf = (it) => ({
    digits: it.digits || settings.digits,
    period: it.period || settings.period,
    algorithm: it.algorithm || settings.algorithm,
  });

  // ---------- 渲染 ----------
  function renderAdvState() {
    const def = isDefault(settings);
    ref.advState.className = `pill${def ? '' : ' pill-warn'}`;
    ref.advState.textContent = def ? '默认' : `已修改：${settings.digits} 位 · ${settings.period} 秒 · ${algoLabel(settings.algorithm)}`;
    ref.reset.hidden = def;
    // 改过参数时保持展开，避免忘了改回来
    if (!def) ref.adv.open = true;
  }

  function cardHtml(it, i) {
    const p = paramsOf(it);
    const name = it.label || it.issuer || `密钥 ${i + 1}`;
    const sub = [it.label && it.issuer && it.issuer !== it.label ? it.issuer : '', `${maskSecret(it.secret)} · ${it.secret.length} 位密钥`].filter(Boolean).join(' · ');
    return `
      <article class="otp-card" data-i="${i}">
        <div class="otp-top">
          <span class="avatar sm" style="--h:${hueOf(it.issuer || it.label || it.secret)}" aria-hidden="true">${esc(initialOf(name))}</span>
          <div class="otp-meta">
            <div class="otp-label" title="${esc(name)}">${esc(name)}</div>
            <div class="otp-sub mono" title="第 ${it.line} 行">${esc(sub)}</div>
          </div>
          <span class="otp-ring" aria-hidden="true">
            <svg viewBox="0 0 40 40" width="40" height="40">
              <circle class="ring-track" cx="20" cy="20" r="${RING_R}"/>
              <circle class="ring-bar" cx="20" cy="20" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="0"/>
            </svg>
            <span class="otp-sec mono"></span>
          </span>
        </div>
        <button type="button" class="otp-code mono" data-i="${i}" title="点击复制" aria-label="复制验证码"></button>
        <div class="otp-foot">
          <span class="otp-next">下一个 <b class="mono"></b></span>
          <span class="otp-params${it.digits || it.period || it.algorithm ? ' is-custom' : ''}">${algoLabel(p.algorithm)} · ${p.digits} 位 · ${p.period} 秒</span>
        </div>
      </article>`;
  }

  function renderInvalid() {
    ref.invalid.hidden = !state.invalid.length;
    ref.invalid.innerHTML = state.invalid
      .map(
        (x) =>
          `<li>${icon('alert', { size: 14 })}<span><b>第 ${x.line} 行</b>${esc(x.reason)}<em class="mono">${esc(x.raw.slice(0, 36))}${x.raw.length > 36 ? '…' : ''}</em></span></li>`,
      )
      .join('');
  }

  function renderGrid() {
    if (!cryptoAvailable()) {
      ref.grid.innerHTML = `<div class="empty"><div class="empty-icon">${icon('alert', { size: 22 })}</div><p><strong>浏览器不允许在这个页面计算验证码</strong>需要通过 HTTPS 或 localhost 访问本站，浏览器才会开放加密接口。</p></div>`;
      state.cards = [];
      return;
    }
    if (!state.items.length) {
      ref.grid.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${icon('key', { size: 22 })}</div>
          <p><strong>验证码会实时显示在这里</strong>在左侧粘贴 2FA 密钥，每 30 秒自动更新，点验证码即可复制。</p>
          <button type="button" class="btn sm" data-act="demo">${icon('sparkle', { size: 14 })}<span>试试示例密钥</span></button>
        </div>`;
      state.cards = [];
      return;
    }
    ref.grid.innerHTML = state.items.map(cardHtml).join('');
    state.cards = [...ref.grid.querySelectorAll('.otp-card')].map((el, i) => ({
      el,
      item: state.items[i],
      counter: null,
      code: '',
      ring: el.querySelector('.ring-bar'),
      sec: el.querySelector('.otp-sec'),
      codeEl: el.querySelector('.otp-code'),
      nextEl: el.querySelector('.otp-next b'),
    }));
    tick();
  }

  // ---------- 计时刷新 ----------
  function tick() {
    const now = Date.now();
    const d = new Date(now);
    ref.clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    for (const c of state.cards) {
      const p = paramsOf(c.item);
      const { counter, remaining } = timeStep(p.period, now);
      // 新周期开始时圆环瞬间回满，不做倒退动画
      c.ring.style.transition = remaining > p.period - (TICK_MS / 1000) * 1.5 ? 'none' : '';
      c.ring.style.strokeDashoffset = String(RING_C * (1 - remaining / p.period));
      c.sec.textContent = String(Math.ceil(remaining));
      c.el.classList.toggle('is-urgent', remaining <= URGENT_SECONDS);

      if (counter !== c.counter) {
        const first = c.counter === null;
        c.counter = counter;
        totp(c.item.secret, { ...p, now })
          .then(({ code, next }) => {
            if (c.counter !== counter) return;
            c.code = code;
            c.codeEl.textContent = groupCode(code);
            c.nextEl.textContent = groupCode(next);
            c.el.classList.remove('is-error');
            if (!first) {
              c.el.classList.remove('is-fresh');
              void c.el.offsetWidth;
              c.el.classList.add('is-fresh');
            }
          })
          .catch((err) => {
            c.codeEl.textContent = '——';
            c.el.classList.add('is-error');
            c.el.title = err.message;
          });
      }
    }
  }

  /** 复制前按当前时间重新计算，避免页面在后台时显示的码已过期 */
  async function freshCode(c) {
    const { code } = await totp(c.item.secret, paramsOf(c.item));
    if (code !== c.code) tick();
    return code;
  }

  function sync() {
    const { items, invalid } = parseSecrets(ref.input.value);
    state.items = items;
    state.invalid = invalid;
    ref.count.textContent = String(items.length);
    ref.copyAll.disabled = !items.length;
    ref.clear.hidden = !ref.input.value;
    autoGrow(ref.input, { minRows: 4, maxRows: 14 });
    if (settings.remember) store.set(SECRETS_KEY, ref.input.value);
    renderInvalid();
    renderGrid();
  }

  /** 把文本追加到输入框（已有内容时换行接上） */
  function appendText(text) {
    const cur = ref.input.value.replace(/\s+$/, '');
    ref.input.value = cur ? `${cur}\n${text.trim()}` : text.trim();
    sync();
  }

  function setChips(container, attr, value) {
    container.querySelectorAll(`[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value))));
  }

  function applySettings() {
    setChips(ref.digits, 'digits', settings.digits);
    setChips(ref.period, 'period', settings.period);
    ref.algorithm.value = settings.algorithm;
    saveSettings();
    renderAdvState();
    renderGrid();
  }

  // ---------- 事件 ----------
  let inputTimer;
  ref.input.addEventListener('input', () => {
    autoGrow(ref.input, { minRows: 4, maxRows: 14 });
    clearTimeout(inputTimer);
    inputTimer = setTimeout(sync, 200);
  });

  ref.digits.addEventListener('click', (e) => {
    const b = e.target.closest('[data-digits]');
    if (!b) return;
    settings.digits = Number(b.dataset.digits);
    applySettings();
  });
  ref.period.addEventListener('click', (e) => {
    const b = e.target.closest('[data-period]');
    if (!b) return;
    settings.period = Number(b.dataset.period);
    applySettings();
  });
  ref.algorithm.addEventListener('change', () => {
    settings.algorithm = ref.algorithm.value;
    applySettings();
  });
  ref.remember.addEventListener('change', () => {
    settings.remember = ref.remember.checked;
    saveSettings();
    if (settings.remember) store.set(SECRETS_KEY, ref.input.value);
    else store.remove(SECRETS_KEY);
  });

  ref.copyAll.addEventListener('click', async () => {
    const lines = await Promise.all(
      state.cards.map(async (c, i) => `${c.item.label || c.item.issuer || `密钥 ${i + 1}`}  ${await freshCode(c)}`),
    );
    if (lines.length) copyText(lines.join('\n'), `已复制 ${lines.length} 个验证码`);
  });

  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'demo') {
      ref.input.value = DEMO;
      sync();
      ref.input.focus();
      ref.input.setSelectionRange(0, 0);
      ref.input.scrollLeft = 0;
      return;
    }
    if (act === 'clear') {
      ref.input.value = '';
      store.remove(SECRETS_KEY);
      sync();
      ref.input.focus();
      return;
    }
    if (act === 'paste') {
      const text = await readClipboard();
      if (text === null) {
        ref.input.focus();
        toast('浏览器不允许读取剪贴板，请在输入框里按 Ctrl+V / ⌘V 粘贴', 'info', 3500);
      } else if (!text.trim()) {
        toast('剪贴板是空的', 'info');
      } else {
        appendText(text);
      }
      return;
    }
    if (act === 'file') {
      try {
        const text = await pickTextFile();
        if (text) appendText(text);
      } catch (err) {
        toast(err.message, 'error', 3500);
      }
      return;
    }
    if (act === 'reset') {
      Object.assign(settings, DEFAULTS);
      applySettings();
      return;
    }
    const codeBtn = e.target.closest('.otp-code[data-i]');
    if (codeBtn) {
      const c = state.cards[Number(codeBtn.dataset.i)];
      if (!c) return;
      const code = await freshCode(c);
      copyText(code, `已复制验证码 ${code}`);
      codeBtn.classList.remove('is-copied');
      void codeBtn.offsetWidth;
      codeBtn.classList.add('is-copied');
    }
  });

  // 切回页面时立刻刷新（后台标签页的定时器会被浏览器放慢）
  const onVisible = () => {
    if (!document.hidden) tick();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  const detachDrop = acceptFileDrop(ref.cq, appendText);

  // ---------- 初始化 ----------
  if (draft !== null) ref.input.value = draft;
  else if (settings.remember) ref.input.value = store.get(SECRETS_KEY, '') || '';
  renderAdvState();
  sync();
  state.timer = setInterval(tick, TICK_MS);

  if (!cryptoAvailable()) {
    toast('当前页面不是 HTTPS，无法计算验证码', 'error', 4000);
    ref.selftest.innerHTML = `${icon('alert', { size: 14 })}<span>当前页面无法使用加密接口</span>`;
    ref.selftest.className = 'tp-selftest is-bad';
  } else {
    selfTest()
      .then(({ pass, total }) => {
        const ok = pass === total;
        ref.selftest.className = `tp-selftest ${ok ? 'is-ok' : 'is-bad'}`;
        ref.selftest.innerHTML = `${icon(ok ? 'check' : 'alert', { size: 14 })}<span>算法自检${ok ? '通过' : '失败'}（RFC 6238 标准测试 ${pass}/${total}）</span>`;
      })
      .catch((err) => {
        ref.selftest.className = 'tp-selftest is-bad';
        ref.selftest.textContent = `算法自检出错：${err.message}`;
      });
  }

  return () => {
    draft = ref.input.value;
    clearInterval(state.timer);
    clearTimeout(inputTimer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    detachDrop();
  };
}
