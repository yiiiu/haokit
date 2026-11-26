// 首页：工具画廊（大标题 + 搜索 + 分组筛选 + 作品卡片）
import { groups, tools } from './registry.js';
import { icon } from '../assets/icons.js';
import { esc } from '../assets/ui.js';

function card(t) {
  const tone = Number.isFinite(t.tone) ? t.tone : 220;
  const thumb = `
    <span class="shot-thumb" style="--tone:${tone}">
      <span class="mock" aria-hidden="true">
        <span class="mock-bar"><i></i><i></i><i></i></span>
        <span class="mock-body">
          <span class="mock-icon">${icon(t.icon, { size: 18 })}</span>
          <span class="mock-lines"><b></b><b></b><b class="code"></b></span>
        </span>
      </span>
      ${t.soon ? '' : `<span class="shot-overlay"><span>打开工具</span>${icon('arrowRight', { size: 18 })}</span>`}
    </span>`;
  const meta = `
    <span class="shot-meta" style="--tone:${tone}">
      <span class="shot-avatar">${icon(t.icon, { size: 13 })}</span>
      <span class="shot-name">${esc(t.name)}</span>
      ${t.tag ? `<span class="pill">${esc(t.tag)}</span>` : ''}
      <span class="shot-status">${t.soon ? '即将上线' : '可用'}</span>
    </span>
    <p class="shot-desc">${esc(t.desc)}</p>`;
  return t.soon
    ? `<div class="shot is-soon" data-group="${esc(t.group)}" aria-disabled="true">${thumb}${meta}</div>`
    : `<a class="shot" data-group="${esc(t.group)}" href="/${esc(t.id)}">${thumb}${meta}</a>`;
}

export function mount(el) {
  const ready = tools.filter((t) => !t.soon).length;
  const state = { group: 'all', q: '' };

  el.innerHTML = `
    <div class="home">
      <section class="hero">
        <span class="eyebrow">${icon('sparkle', { size: 14 })}${tools.length} 个工具 · ${ready} 个可用</span>
        <h1>账号相关的小工具，<br><em>打开就能用</em></h1>
        <p>收取 Outlook / Hotmail 邮件验证码、生成 2FA 动态码，常用的账号工具都放在这里，后续还会继续增加。</p>
        <label class="hero-search">
          <input type="search" data-ref="q" placeholder="搜索工具，例如：取件、验证码" autocomplete="off" aria-label="搜索工具">
          <span class="hero-search-btn" aria-hidden="true">${icon('search', { size: 18 })}</span>
        </label>
      </section>

      <div class="filter-row">
        <div class="chips" data-ref="chips" role="group" aria-label="按分组筛选">
          <button type="button" class="chip" data-group="all" aria-pressed="true">全部</button>
          ${groups.map((g) => `<button type="button" class="chip" data-group="${esc(g.id)}" aria-pressed="false">${esc(g.name)}</button>`).join('')}
        </div>
        <span class="filter-count" data-ref="count"></span>
      </div>

      <div class="shot-grid" data-ref="grid">${tools.map(card).join('')}</div>
      <div class="empty" data-ref="empty" hidden>
        <div class="empty-icon">${icon('search', { size: 22 })}</div>
        <p><strong>没有找到匹配的工具</strong>换个关键词试试。</p>
      </div>
    </div>`;

  const ref = Object.fromEntries([...el.querySelectorAll('[data-ref]')].map((n) => [n.dataset.ref, n]));
  const cards = [...ref.grid.children];

  function apply() {
    let shown = 0;
    cards.forEach((c, i) => {
      const t = tools[i];
      const g = groups.find((x) => x.id === t.group);
      const text = [t.name, t.desc, t.tag, g?.name].filter(Boolean).join(' ').toLowerCase();
      const ok = (state.group === 'all' || t.group === state.group) && (!state.q || text.includes(state.q));
      c.hidden = !ok;
      if (ok) shown++;
    });
    ref.empty.hidden = shown > 0;
    ref.grid.hidden = shown === 0;
    ref.count.textContent = `共 ${shown} 个`;
  }

  ref.q.addEventListener('input', () => {
    state.q = ref.q.value.trim().toLowerCase();
    apply();
  });
  ref.chips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-group]');
    if (!btn) return;
    state.group = btn.dataset.group;
    ref.chips.querySelectorAll('[data-group]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    apply();
  });

  apply();
}
