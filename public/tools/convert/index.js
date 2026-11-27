// 账号格式转换：按列识别字段 → 选择输出字段和顺序 → 换分隔符、去重 → 复制或下载
import { icon } from '../../assets/icons.js';
import { esc, toast, copyText, store, acceptFileDrop, pickTextFile, readClipboard, autoGrow } from '../../assets/ui.js';
import { classify, detectSeparator, splitLine, stripLabel, ROLES, ROLE_LABEL, SEPARATORS } from '../../assets/lib/accounts.js';

const SETTINGS_KEY = 'convert.settings';

const PRESETS = [
  { id: 'outlook', name: '取件格式', fields: ['email', 'password', 'clientId', 'refreshToken'], sep: '----' },
  { id: 'emailPw', name: '邮箱----密码', fields: ['email', 'password'], sep: '----' },
  { id: 'emailPwColon', name: '邮箱:密码', fields: ['email', 'password'], sep: ':' },
  { id: 'email2fa', name: '邮箱|密码|2FA', fields: ['email', 'password', 'totp'], sep: '|' },
  { id: 'uid2fa', name: 'UID|密码|2FA|邮箱|邮箱密码', fields: ['uid', 'password', 'totp', 'email', 'emailPassword'], sep: '|' },
  { id: 'email', name: '只要邮箱', fields: ['email'], sep: '----' },
];

const SECRET_ROLES = new Set(['password', 'emailPassword', 'recoveryPassword']);
const sepLabel = (id) => SEPARATORS.find((s) => s.id === id)?.label || id;
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 示例数据（全部是编造的） */
function demoText() {
  const rt = (s) => `M.C543_BAY.0.U.-Cl6${`${s}b3x!Q*k$Zp9_rT-2`.repeat(12)}$$`;
  const id = '8baaa9dd-3ea5-4e5f-86f1-ddba2230dcf2';
  return [
    `alice.demo@outlook.com----Alice#2026----backup.a@gmail.com----${id}----${rt('A')}`,
    `bob.demo@hotmail.com----Bob!pass88----backup.b@gmail.com----${id}----${rt('B')}`,
    `carol.demo@outlook.com----Carol$777----backup.c@gmail.com----${id}----${rt('C')}`,
    `alice.demo@outlook.com----Alice#2026----backup.a@gmail.com----${id}----${rt('A')}`,
  ].join('\n');
}

function sampleOf(role, value) {
  if (!value) return '（空）';
  if (SECRET_ROLES.has(role)) return `${value.slice(0, 2)}${'•'.repeat(Math.min(6, Math.max(2, value.length - 2)))}`;
  return value.length > 28 ? `${value.slice(0, 24)}…` : value;
}

const roleOptions = (selected) =>
  [...ROLES, 'ignore'].map((r) => `<option value="${r}"${r === selected ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('');

const sepOptions = (selected, withAuto = false) =>
  (withAuto ? `<option value="auto"${selected === 'auto' ? ' selected' : ''}>自动识别</option>` : '') +
  SEPARATORS.map((s) => `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.label)}</option>`).join('');

function template(s) {
  return `
  <div class="cv-cq" data-ref="cq"><div class="cv">
    <section class="cv-col cv-input" aria-label="原始数据">
      <header class="col-head">
        <div class="col-title"><h2>原始数据</h2><span class="count-badge" data-ref="count">0</span></div>
        <div class="col-actions">
          <button type="button" class="btn ghost sm" data-act="demo" title="填入几条示例数据">${icon('sparkle', { size: 14 })}<span>示例</span></button>
        </div>
      </header>
      <div class="cv-form">
        <div class="cv-box dropzone">
          <textarea class="cv-textarea mono" data-ref="input" rows="5" spellcheck="false" autocomplete="off"
            aria-label="原始账号数据，一行一个" placeholder="粘贴账号，一行一个，什么格式都行&#10;也可以把 .txt 文件拖进来"></textarea>
          <div class="cv-bar">
            <button type="button" class="btn ghost sm" data-act="paste">${icon('clipboard', { size: 14 })}<span>粘贴</span></button>
            <button type="button" class="btn ghost sm" data-act="file">${icon('fileText', { size: 14 })}<span>导入文件</span></button>
            <button type="button" class="btn ghost sm" data-act="clear" data-ref="clear" hidden>清空</button>
          </div>
        </div>

        <div class="cv-inline">
          <label for="cv-insep" class="field-label">原分隔符</label>
          <select id="cv-insep" class="input" data-ref="inSep">${sepOptions(s.inSep, true)}</select>
          <span class="cv-detected" data-ref="detected"></span>
        </div>

        <div class="cv-cols-head">
          <span class="field-label">每一列是什么</span>
          <span class="cv-cols-note" data-ref="colsNote"></span>
        </div>
        <ul class="cv-cols" data-ref="cols"></ul>
        <p class="cv-warn" data-ref="mixedWarn" hidden></p>
      </div>
    </section>

    <section class="cv-col cv-result" aria-label="转换结果">
      <header class="col-head">
        <div class="col-title"><h2>转换结果</h2><span class="count-badge" data-ref="outCount">0</span></div>
        <div class="col-actions">
          <button type="button" class="btn sm" data-ref="download">${icon('download', { size: 14 })}<span>下载 .txt</span></button>
          <button type="button" class="btn primary sm" data-ref="copy">${icon('copy', { size: 14 })}<span>复制结果</span></button>
        </div>
      </header>

      <div class="cv-controls">
        <div class="cv-row">
          <span class="cv-label">输出格式</span>
          <div class="chips" data-ref="presets" role="group" aria-label="常用格式"></div>
        </div>
        <div class="cv-row">
          <span class="cv-label">字段顺序</span>
          <div class="cv-fields-wrap">
            <div class="cv-fields" data-ref="fields"></div>
            <div class="cv-avail" data-ref="avail"></div>
          </div>
        </div>
        <div class="cv-row cv-opts">
          <span class="cv-label">输出选项</span>
          <div class="cv-opts-body">
            <label class="cv-sep">分隔符 <select class="input" data-ref="outSep">${sepOptions(s.outSep)}</select></label>
            <label class="check"><input type="checkbox" data-ref="dedupe"${s.dedupe ? ' checked' : ''}> 去掉重复行</label>
            <label class="check"><input type="checkbox" data-ref="skip"${s.skipIncomplete ? ' checked' : ''}> 跳过缺字段的行</label>
          </div>
        </div>
      </div>

      <div class="cv-stats" data-ref="stats"></div>
      <div class="cv-output-wrap">
        <textarea class="cv-output mono" data-ref="output" readonly spellcheck="false" aria-label="转换结果"
          placeholder="转换结果会显示在这里"></textarea>
      </div>
    </section>
  </div></div>`;
}

// 切到别的工具再回来时保留原始数据和手动改过的列（只在内存里，刷新页面就没有）
const session = { text: null, overrides: {}, sig: '' };

export function mount(root) {
  const settings = {
    inSep: 'auto',
    fields: [...PRESETS[0].fields],
    outSep: PRESETS[0].sep,
    dedupe: true,
    skipIncomplete: true,
    ...store.get(SETTINGS_KEY, {}),
  };
  const state = { rows: [], sep: '----', colCount: 0, autoRoles: [], overrides: {}, sig: '', mixed: 0, modeCount: 0, out: '', stats: null, dragIdx: -1 };

  root.innerHTML = template(settings);
  const ref = Object.fromEntries([...root.querySelectorAll('[data-ref]')].map((n) => [n.dataset.ref, n]));
  const save = () => store.set(SETTINGS_KEY, settings);
  const roleOfCol = (c) => state.overrides[c] ?? state.autoRoles[c] ?? 'other';

  // ---------- 分析输入 ----------
  function analyze() {
    const lines = ref.input.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const sep = settings.inSep === 'auto' ? detectSeparator(lines) : settings.inSep;
    const rows = lines.map((l) => splitLine(l, sep).map(stripLabel));
    const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);

    // 每一列按多数行的识别结果定角色
    const tallies = Array.from({ length: colCount }, () => new Map());
    for (const r of rows) {
      const roles = classify(r);
      r.forEach((v, i) => {
        if (v) tallies[i].set(roles[i], (tallies[i].get(roles[i]) || 0) + 1);
      });
    }
    const autoRoles = tallies.map((t) => {
      let best = 'other';
      let n = 0;
      for (const [role, c] of t) {
        if (c > n || (c === n && best === 'other')) {
          best = role;
          n = c;
        }
      }
      return best;
    });

    // 列数的众数，用来提示列数不一致的行
    const lenCount = new Map();
    rows.forEach((r) => lenCount.set(r.length, (lenCount.get(r.length) || 0) + 1));
    const modeCount = [...lenCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;

    // 分隔符或列数变了，手动指定的列角色作废
    const sig = `${sep}|${colCount}`;
    if (sig !== state.sig) {
      state.overrides = {};
      state.sig = sig;
    }
    Object.assign(state, { rows, sep, colCount, autoRoles, modeCount, mixed: rows.filter((r) => r.length !== modeCount).length });
  }

  // ---------- 生成结果 ----------
  function buildOutput() {
    const colsByRole = new Map();
    for (let c = 0; c < state.colCount; c++) {
      const r = roleOfCol(c);
      if (r === 'ignore') continue;
      if (!colsByRole.has(r)) colsByRole.set(r, []);
      colsByRole.get(r).push(c);
    }
    const seen = new Set();
    const lines = [];
    let skipped = 0;
    let dup = 0;
    if (settings.fields.length) {
      for (const r of state.rows) {
        const vals = settings.fields.map((role) => {
          for (const c of colsByRole.get(role) || []) if (r[c]) return r[c];
          return '';
        });
        if (settings.skipIncomplete && vals.some((v) => !v)) {
          skipped++;
          continue;
        }
        const line = vals.join(settings.outSep);
        if (settings.dedupe) {
          if (seen.has(line)) {
            dup++;
            continue;
          }
          seen.add(line);
        }
        lines.push(line);
      }
    }
    state.out = lines.join('\n');
    state.stats = { total: state.rows.length, out: lines.length, skipped, dup };
    return colsByRole;
  }

  // ---------- 渲染 ----------
  function renderInput() {
    ref.count.textContent = String(state.rows.length);
    ref.clear.hidden = !ref.input.value;
    autoGrow(ref.input, { minRows: 5, maxRows: 12 });
    ref.detected.textContent = state.rows.length ? `${settings.inSep === 'auto' ? `识别为 ${sepLabel(state.sep)} · ` : ''}${state.colCount} 列` : '';

    if (!state.rows.length) {
      ref.cols.innerHTML = '<li class="cv-cols-empty">粘贴数据后，这里会列出每一列识别成了什么，识别错了可以手动改。</li>';
      ref.colsNote.textContent = '';
      ref.mixedWarn.hidden = true;
      return;
    }
    const first = state.rows.find((r) => r.length === state.colCount) || state.rows[0];
    ref.cols.innerHTML = Array.from({ length: state.colCount }, (_, c) => {
      const role = roleOfCol(c);
      const changed = c in state.overrides;
      return `
        <li class="cv-colrow${role === 'ignore' ? ' is-ignored' : ''}">
          <span class="cv-colidx">${c + 1}</span>
          <select class="input cv-role" data-col="${c}" aria-label="第 ${c + 1} 列">${roleOptions(role)}</select>
          <span class="cv-sample mono" title="${esc(SECRET_ROLES.has(role) ? '' : first[c] || '')}">${esc(sampleOf(role, first[c]))}</span>
          ${changed ? `<button type="button" class="cv-reset" data-reset="${c}" title="恢复自动识别（${esc(ROLE_LABEL[state.autoRoles[c]])}）">已改</button>` : ''}
        </li>`;
    }).join('');
    ref.colsNote.textContent = '识别错了可以手动改';
    ref.mixedWarn.hidden = !state.mixed;
    ref.mixedWarn.innerHTML = `${icon('alert', { size: 14 })}<span>有 ${state.mixed} 行的列数和大多数行（${state.modeCount} 列）不一样，转换时可能错位，建议检查原始数据。</span>`;
  }

  function renderControls(colsByRole) {
    const preset = PRESETS.find((p) => sameList(p.fields, settings.fields) && p.sep === settings.outSep);
    ref.presets.innerHTML =
      PRESETS.map((p) => `<button type="button" class="chip sm" data-preset="${p.id}" aria-pressed="${preset?.id === p.id}">${esc(p.name)}</button>`).join('') +
      `<span class="chip sm cv-custom" aria-pressed="${!preset}">自定义</span>`;

    ref.fields.innerHTML = settings.fields.length
      ? settings.fields
          .map((role, i) => {
            const missing = state.rows.length && !colsByRole.has(role);
            return `<span class="cv-field${missing ? ' is-missing' : ''}" draggable="true" data-idx="${i}" title="${missing ? '原始数据里没有识别到这一列，可以在左侧手动指定' : '拖动可以调整顺序'}">
              <span class="cv-field-n">${i + 1}</span>${esc(ROLE_LABEL[role])}
              <button type="button" class="cv-field-x" data-remove="${i}" aria-label="移除 ${esc(ROLE_LABEL[role])}">${icon('x', { size: 12 })}</button>
            </span>`;
          })
          .join('<span class="cv-field-sep mono" aria-hidden="true">' + esc(settings.outSep === '\t' ? '⇥' : settings.outSep === ' ' ? '␣' : settings.outSep) + '</span>')
      : '<span class="cv-fields-empty">还没有选字段，从下面点选要输出的字段</span>';

    // 可添加：原始数据里识别到的字段在前，其余字段在后
    const present = ROLES.filter((r) => colsByRole.has(r) && !settings.fields.includes(r));
    const others = ROLES.filter((r) => !colsByRole.has(r) && !settings.fields.includes(r) && r !== 'other');
    ref.avail.innerHTML =
      present.map((r) => `<button type="button" class="cv-add" data-add="${r}">${icon('plus', { size: 12 })}${esc(ROLE_LABEL[r])}</button>`).join('') +
      (others.length && state.rows.length ? '<span class="cv-avail-sep"></span>' : '') +
      others.map((r) => `<button type="button" class="cv-add is-absent" data-add="${r}" title="原始数据里没有这一列">${icon('plus', { size: 12 })}${esc(ROLE_LABEL[r])}</button>`).join('');

    ref.outSep.value = settings.outSep;
  }

  function renderOutput() {
    const s = state.stats;
    ref.output.value = state.out;
    ref.outCount.textContent = String(s.out);
    ref.copy.disabled = !s.out;
    ref.download.disabled = !s.out;
    if (!s.total) {
      ref.stats.innerHTML = '';
      return;
    }
    const parts = [`<span class="pill pill-ok">${icon('check', { size: 12 })}输出 ${s.out} 行</span>`];
    if (s.skipped) parts.push(`<span class="pill pill-warn" title="这些行缺少所选的某个字段">缺字段跳过 ${s.skipped}</span>`);
    if (s.dup) parts.push(`<span class="pill">重复去掉 ${s.dup}</span>`);
    ref.stats.innerHTML = `${parts.join('')}<span class="cv-stats-total">共 ${s.total} 行</span>`;
  }

  function refresh({ reanalyze = true } = {}) {
    if (reanalyze) analyze();
    const colsByRole = buildOutput();
    renderInput();
    renderControls(colsByRole);
    renderOutput();
  }

  function setFields(fields) {
    settings.fields = fields;
    save();
    refresh({ reanalyze: false });
  }

  function appendText(text) {
    const cur = ref.input.value.replace(/\s+$/, '');
    ref.input.value = cur ? `${cur}\n${text.trim()}` : text.trim();
    refresh();
  }

  // ---------- 事件 ----------
  let inputTimer;
  ref.input.addEventListener('input', () => {
    autoGrow(ref.input, { minRows: 5, maxRows: 12 });
    clearTimeout(inputTimer);
    inputTimer = setTimeout(refresh, 200);
  });

  ref.inSep.addEventListener('change', () => {
    settings.inSep = ref.inSep.value;
    save();
    refresh();
  });

  ref.cols.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-col]');
    if (!sel) return;
    const c = Number(sel.dataset.col);
    if (sel.value === state.autoRoles[c]) delete state.overrides[c];
    else state.overrides[c] = sel.value;
    refresh({ reanalyze: false });
  });

  ref.outSep.addEventListener('change', () => {
    settings.outSep = ref.outSep.value;
    save();
    refresh({ reanalyze: false });
  });
  ref.dedupe.addEventListener('change', () => {
    settings.dedupe = ref.dedupe.checked;
    save();
    refresh({ reanalyze: false });
  });
  ref.skip.addEventListener('change', () => {
    settings.skipIncomplete = ref.skip.checked;
    save();
    refresh({ reanalyze: false });
  });

  ref.copy.addEventListener('click', () => {
    if (state.out) copyText(state.out, `已复制 ${state.stats.out} 行`);
  });
  ref.download.addEventListener('click', () => {
    if (!state.out) return;
    const blob = new Blob([`${state.out}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = `账号-${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}-${state.stats.out}行.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  root.addEventListener('click', async (e) => {
    const t = e.target;
    const preset = t.closest('[data-preset]');
    if (preset) {
      const p = PRESETS.find((x) => x.id === preset.dataset.preset);
      settings.outSep = p.sep;
      setFields([...p.fields]);
      return;
    }
    const remove = t.closest('[data-remove]');
    if (remove) {
      setFields(settings.fields.filter((_, i) => i !== Number(remove.dataset.remove)));
      return;
    }
    const add = t.closest('[data-add]');
    if (add) {
      setFields([...settings.fields, add.dataset.add]);
      return;
    }
    const reset = t.closest('[data-reset]');
    if (reset) {
      delete state.overrides[Number(reset.dataset.reset)];
      refresh({ reanalyze: false });
      return;
    }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'demo') {
      ref.input.value = demoText();
      refresh();
      ref.input.focus();
      ref.input.setSelectionRange(0, 0);
      ref.input.scrollLeft = 0;
    } else if (act === 'clear') {
      ref.input.value = '';
      refresh();
      ref.input.focus();
    } else if (act === 'paste') {
      const text = await readClipboard();
      if (text === null) {
        ref.input.focus();
        toast('浏览器不允许读取剪贴板，请在输入框里按 ⌘V / Ctrl+V 粘贴', 'info', 3500);
      } else if (!text.trim()) toast('剪贴板是空的', 'info');
      else appendText(text);
    } else if (act === 'file') {
      try {
        const text = await pickTextFile();
        if (text) appendText(text);
      } catch (err) {
        toast(err.message, 'error', 3500);
      }
    }
  });

  // 拖动字段调整顺序
  ref.fields.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.cv-field');
    if (!chip) return;
    state.dragIdx = Number(chip.dataset.idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ROLE_LABEL[settings.fields[state.dragIdx]]);
    chip.classList.add('is-dragging');
  });
  ref.fields.addEventListener('dragover', (e) => {
    if (state.dragIdx < 0) return;
    e.preventDefault();
    ref.fields.querySelectorAll('.is-drop').forEach((x) => x.classList.remove('is-drop'));
    e.target.closest('.cv-field')?.classList.add('is-drop');
  });
  ref.fields.addEventListener('drop', (e) => {
    if (state.dragIdx < 0) return;
    e.preventDefault();
    const target = e.target.closest('.cv-field');
    const from = state.dragIdx;
    state.dragIdx = -1;
    if (!target) return refresh({ reanalyze: false });
    const to = Number(target.dataset.idx);
    if (to === from) return refresh({ reanalyze: false });
    const next = [...settings.fields];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setFields(next);
  });
  ref.fields.addEventListener('dragend', () => {
    state.dragIdx = -1;
    ref.fields.querySelectorAll('.is-dragging, .is-drop').forEach((x) => x.classList.remove('is-dragging', 'is-drop'));
  });

  const detachDrop = acceptFileDrop(ref.cq, appendText);

  if (session.text !== null) {
    ref.input.value = session.text;
    state.overrides = { ...session.overrides };
    state.sig = session.sig;
  }
  refresh();

  return () => {
    Object.assign(session, { text: ref.input.value, overrides: { ...state.overrides }, sig: state.sig });
    clearTimeout(inputTimer);
    detachDrop();
  };
}
