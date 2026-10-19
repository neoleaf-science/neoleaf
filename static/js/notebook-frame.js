// Notebook (.ipynb) Jupyter style: runs INSIDE a sandboxed iframe (isolated origin, no access to the page, the session or the internet),
// assembled by notebook.js. This code is ours (trusted); the notebook DATA is not: markdown and HTML go through marked and DOMPurify,
// images go in as data: URIs and everything else as text. Python execution is requested from the page (py-runner.js), which returns the outputs.
(function () {
  'use strict';

  const post = m => parent.postMessage(Object.assign({ neoleafNb: true }, m), '*');
  const $ = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === false || v === null || v === undefined) { /* attribute off */ }
      else n.setAttribute(k, v === true ? '' : v);
    }
    kids.forEach(c => { if (c !== null && c !== undefined && c !== false) n.append(c); });
    return n;
  };

  const DEFAULT_LABELS = {
    run: 'Run', runTitle: 'Run the cell (Shift+Enter)', runAll: 'Run all', stop: 'Stop', stopTitle: 'Interrupts the execution (restarts the kernel)', restart: 'Restart the kernel',
    add: '+ Cell', addTitle: 'Insert a cell below (B)', del: 'Delete', delTitle: 'Delete the cell (DD)', code: 'Code', markdown: 'Markdown', raw: 'Raw',
    clear: 'Clear outputs', save: 'Save', noOutputs: 'Save without outputs', noOutputsTitle: 'Saves the file without the cells\' outputs (smaller file, cleaner Git)',
    saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving...', kernelNone: 'Kernel: stopped (starts when you run)', kernelBusy: 'Kernel: busy', kernelIdle: 'Kernel: idle',
    kernelRestarted: 'Kernel restarted: the variables were erased.', empty: 'This notebook has no cells. Use "+ Cell" to start.', emptyMd: '(empty text cell: double-click to edit)',
    undo: 'Cell deleted. Press Z to undo.', interrupted: 'Execution interrupted; the kernel was restarted.', noPython: 'Python is not available on this server.', truncated: '(output truncated: text too long)',
    imageMissing: '[image not found]', cantRead: 'Could not open this notebook', unsupported: 'Only notebooks in format 4 (nbformat 4) are supported.', shortcuts: 'Shortcuts: Enter edits, Esc leaves, Shift+Enter runs, A/B insert, DD deletes, M/Y change the type, C/X/V copy, cut and paste, Z undoes.',
  };
  let L = Object.assign({}, DEFAULT_LABELS);

  const st = { nb: null, cells: [], sel: 0, editing: false, execCount: 0, clip: null, deleted: [], running: null, queue: [], kernel: 'none', status: '', dirty: false, saving: false, strip: false, canRun: true, uid: 0, lastD: 0, path: '' };
  let saveTimer = null, root = null, bar = null, list = null, banner = null;
  const imageWaiters = new Map();

  // ------------------------------------------------------------ text: ANSI, escapes and safe markdown
  const ANSI_CLS = { 30: 'k', 31: 'r', 32: 'g', 33: 'y', 34: 'b', 35: 'm', 36: 'c', 37: 'w', 90: 'k', 91: 'r', 92: 'g', 93: 'y', 94: 'b', 95: 'm', 96: 'c', 97: 'w' };
  function ansi(text, into) {
    const re = /\u001b\[([0-9;]*)m|\u001b\[[0-9;?]*[A-Za-z]/g;
    let last = 0, cls = [], m;
    const flush = end => {
      const piece = text.slice(last, end);
      if (!piece) return;
      if (cls.length) into.append($('span', { class: cls.join(' ') }, piece)); else into.append(piece);
    };
    while ((m = re.exec(text))) {
      flush(m.index);
      last = m.index + m[0].length;
      if (m[1] !== undefined && m[0].endsWith('m')) {
        let fg = cls.find(c => c.startsWith('fg-')), bold = cls.includes('bold');
        for (const code of (m[1] || '0').split(';').map(Number)) {
          if (code === 0) { fg = null; bold = false; } else if (code === 1) bold = true; else if (code === 22) bold = false; else if (code === 39) fg = null;
          else if (ANSI_CLS[code]) fg = 'fg-' + ANSI_CLS[code] + (code >= 90 ? ' bright' : '');
        }
        cls = [fg, bold ? 'bold' : ''].filter(Boolean).join(' ').split(' ').filter(Boolean);
      }
    }
    flush(text.length);
    return into;
  }

  const SAN = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'script', 'link', 'meta', 'base', 'button', 'textarea', 'select', 'option', 'map', 'area', 'audio', 'video', 'source'],
    FORBID_ATTR: ['style', 'srcset', 'formaction', 'usemap', 'autofocus', 'autoplay'],
  };
  const MATH_DELIMS = [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }];

  function cleanHtml(raw) { return window.DOMPurify ? DOMPurify.sanitize(raw, SAN) : ''; }

  // protect the formulas from marked (the `_` and `*` inside them would become italics) without touching code blocks and spans
  function renderMarkdown(src, attachments) {
    const math = [];
    const protectedText = src.replace(/(```[\s\S]{0,50000}?```|`[^`\n]*`)|(\$\$[\s\S]{1,20000}?\$\$)|(\$(?!\s)[^$\n]+?(?<!\s)\$)/g, (m, code, d1, d2) => {
      if (code) return code;
      math.push(m);
      return '@@MATH' + (math.length - 1) + '@@';
    });
    if (!window.marked) return $('div', { class: 'md' }, src);
    let html = cleanHtml(marked.parse(protectedText, { gfm: true, async: false }));
    html = html.replace(/@@MATH(\d+)@@/g, (m, i) => math[+i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    const box = $('div', { class: 'md' });
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html');
    for (const a of doc.body.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (/^https?:/i.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
      else if (!href.startsWith('#')) a.removeAttribute('href');
    }
    for (const img of doc.body.querySelectorAll('img[src]')) {
      img.setAttribute('loading', 'lazy');
      const src2 = img.getAttribute('src') || '';
      const att = /^attachment:(.+)$/.exec(src2);
      if (att && attachments && attachments[att[1]]) {
        const mime = Object.keys(attachments[att[1]])[0];
        if (mime && /^image\/(png|jpeg|gif|webp)$/.test(mime) && /^[A-Za-z0-9+/=\s]+$/.test(attachments[att[1]][mime])) { img.setAttribute('src', 'data:' + mime + ';base64,' + String(attachments[att[1]][mime]).replace(/\s+/g, '')); continue; }
        img.removeAttribute('src');
      } else if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src2)) { /* already fine */ }
      else if (!/^[a-z][a-z0-9+.-]*:/i.test(src2) && !src2.startsWith('//')) { img.setAttribute('data-nbpath', src2); img.removeAttribute('src'); }
      else img.removeAttribute('src');
    }
    box.innerHTML = doc.body.innerHTML;
    if (window.renderMathInElement) { try { renderMathInElement(box, { delimiters: MATH_DELIMS, throwOnError: false, ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] }); } catch (_) { /* invalid formula */ } }
    box.querySelectorAll('img[data-nbpath]').forEach(img => {
      const path = img.getAttribute('data-nbpath');
      if (!imageWaiters.has(path)) imageWaiters.set(path, []);
      imageWaiters.get(path).push(img);
      post({ image: { path } });
    });
    return box;
  }

  // ------------------------------------------------------------ Python highlighting (light)
  const KW = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
  const BI = new Set('print len range int float str list dict set tuple open enumerate zip map filter sum min max abs round sorted reversed isinstance type super object bool bytes input any all next iter repr format getattr setattr hasattr'.split(' '));
  function highlight(src, into) {
    const re = /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?\b)|(@[A-Za-z_][\w.]*)|([A-Za-z_]\w*)|([\s\S])/g;
    let m, buf = '';
    const out = (txt, cls) => { if (cls) into.append($('span', { class: cls }, txt)); else into.append(txt); };
    while ((m = re.exec(src))) {
      if (m[1]) out(m[1], 'tk-c');
      else if (m[2]) out(m[2], 'tk-s');
      else if (m[3]) out(m[3], 'tk-n');
      else if (m[4]) out(m[4], 'tk-d');
      else if (m[5]) out(m[5], KW.has(m[5]) ? 'tk-k' : (BI.has(m[5]) ? 'tk-b' : ''));
      else buf = m[6] || '', out(buf, '');
    }
    return into;
  }

  // ------------------------------------------------------------ notebook model
  const joinSrc = v => (Array.isArray(v) ? v.join('') : (typeof v === 'string' ? v : ''));
  const lines = s => { const out = s.split('\n').map((l, i, a) => (i < a.length - 1 ? l + '\n' : l)); return out[out.length - 1] === '' ? out.slice(0, -1) : out; };
  const newId = () => Math.random().toString(16).slice(2, 10);

  function normOutput(o) {
    if (!o || typeof o !== 'object') return null;
    const out = Object.assign({}, o);
    if (o.output_type === 'stream') out.text = joinSrc(o.text);
    else if (o.output_type === 'error') out.traceback = Array.isArray(o.traceback) ? o.traceback.map(String) : [];
    else if (o.data && typeof o.data === 'object') {
      out.data = {};
      for (const [k, v] of Object.entries(o.data)) out.data[k] = (k.startsWith('image/') && !k.includes('svg')) ? String(v).replace(/\s+/g, '') : (typeof v === 'string' || Array.isArray(v) ? joinSrc(v) : v);
    }
    return out;
  }

  function loadCell(raw) {
    const type = ['code', 'markdown', 'raw'].includes(raw.cell_type) ? raw.cell_type : 'raw';
    const { cell_type, source, outputs, execution_count, metadata, id, attachments, ...extra } = raw;
    const c = { uid: ++st.uid, type, source: joinSrc(source), metadata: metadata && typeof metadata === 'object' ? metadata : {}, id: id || '', attachments: attachments || null, extra,
      outputs: type === 'code' ? (Array.isArray(outputs) ? outputs.map(normOutput).filter(Boolean) : []) : [], count: type === 'code' && Number.isInteger(execution_count) ? execution_count : null,
      running: false, queued: false, rendered: type !== 'markdown' ? false : true, collapsed: !!(metadata && metadata.collapsed) };
    if (c.count) st.execCount = Math.max(st.execCount, c.count);
    return c;
  }

  function dumpOutput(o) {
    const out = Object.assign({}, o);
    if (o.output_type === 'stream') out.text = lines(o.text);
    else if (o.data) { out.data = {}; for (const [k, v] of Object.entries(o.data)) out.data[k] = (typeof v === 'string' && (k.startsWith('text/') || k.includes('svg') || k === 'application/javascript')) ? lines(v) : v; }
    return out;
  }
  function dumpCell(c) {
    const o = Object.assign({}, c.extra);
    o.cell_type = c.type;
    if (c.id) o.id = c.id;
    o.metadata = c.metadata;
    if (c.attachments) o.attachments = c.attachments;
    o.source = lines(c.source);
    if (c.type === 'code') {
      o.execution_count = st.strip ? null : c.count;
      o.outputs = st.strip ? [] : c.outputs.map(dumpOutput);
    }
    return o;
  }
  const sorted = v => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = sorted(v[k]); }); return o; }
    return v;
  };
  function serialize() {
    const nb = Object.assign({}, st.nb);
    nb.cells = st.cells.map(dumpCell);
    nb.metadata = Object.assign({}, st.nb.metadata || {});
    if (!nb.metadata.kernelspec) nb.metadata.kernelspec = { display_name: 'Python 3', language: 'python', name: 'python3' };
    if (!nb.metadata.language_info) nb.metadata.language_info = { name: 'python' };
    // like Jupyter: keys in alphabetical order, 1-space indentation and a line break at the end (same diffs as Jupyter's)
    return JSON.stringify(sorted(nb), null, 1) + '\n';
  }

  // ------------------------------------------------------------ save
  function markDirty() {
    st.dirty = true; setStatus();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1200);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!st.dirty || !st.nb) return;
    st.saving = true; setStatus();
    post({ save: serialize() });
  }
  function setStatus() {
    const s = document.getElementById('nb-save');
    if (s) s.textContent = st.saving ? L.saving : (st.dirty ? L.unsaved : L.saved);
    const k = document.getElementById('nb-kernel');
    if (k) k.textContent = st.status && st.kernel === 'busy' ? st.status : (st.kernel === 'busy' ? L.kernelBusy : (st.kernel === 'idle' ? L.kernelIdle : L.kernelNone));
  }

  // ------------------------------------------------------------ outputs
  const MIME_ORDER = ['text/html', 'text/markdown', 'image/svg+xml', 'image/png', 'image/jpeg', 'text/latex', 'application/json', 'text/plain'];
  const MAX_TEXT = 400000;
  const clip = t => (t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '\n' + L.truncated : t);

  function renderData(data) {
    const mime = MIME_ORDER.find(m => data[m] !== undefined && data[m] !== null);
    if (!mime) return $('pre', { class: 'plain' }, '');
    const v = data[mime];
    if (mime === 'text/html') { const d = $('div', { class: 'html' }); d.innerHTML = cleanHtml(String(v)); d.querySelectorAll('a[href]').forEach(a => { if (/^https?:/i.test(a.getAttribute('href'))) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); } else a.removeAttribute('href'); }); d.querySelectorAll('img').forEach(i => { if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(i.getAttribute('src') || '')) i.removeAttribute('src'); }); return d; }
    if (mime === 'text/markdown') return renderMarkdown(String(v), null);
    if (mime === 'image/svg+xml') return $('img', { class: 'img', alt: '', src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(v)) });
    if (mime === 'image/png' || mime === 'image/jpeg') { const b = String(v).replace(/\s+/g, ''); return /^[A-Za-z0-9+/=]+$/.test(b) ? $('img', { class: 'img', alt: '', src: 'data:' + mime + ';base64,' + b }) : $('pre', { class: 'plain' }, ''); }
    if (mime === 'text/latex') { const d = $('div', { class: 'latex' }); try { katex.render(String(v).replace(/^\s*\$\$?|\$\$?\s*$/g, ''), d, { displayMode: true, throwOnError: false }); } catch (_) { d.textContent = String(v); } return d; }
    if (mime === 'application/json') return $('pre', { class: 'plain' }, clip(JSON.stringify(v, null, 2)));
    return ansi(clip(String(v)), $('pre', { class: 'plain' }));
  }

  function renderOutputs(c, cellEl) {
    const box = cellEl.querySelector('.outputs');
    box.textContent = '';
    box.classList.toggle('collapsed', c.collapsed);
    for (const o of c.outputs) {
      const row = $('div', { class: 'out-row' });
      const prompt = $('div', { class: 'prompt out-prompt', title: '' }, o.output_type === 'execute_result' ? 'Out [' + (o.execution_count || c.count || ' ') + ']:' : '');
      prompt.addEventListener('click', () => { c.collapsed = !c.collapsed; c.metadata.collapsed = c.collapsed || undefined; if (!c.collapsed) delete c.metadata.collapsed; box.classList.toggle('collapsed', c.collapsed); markDirty(); });
      let body;
      if (o.output_type === 'stream') body = ansi(clip(o.text || ''), $('pre', { class: 'stream ' + (o.name === 'stderr' ? 'stderr' : 'stdout') }));
      else if (o.output_type === 'error') body = ansi(clip((o.traceback && o.traceback.length ? o.traceback.join('\n') : (o.ename || 'Error') + ': ' + (o.evalue || ''))), $('pre', { class: 'error' }));
      else body = renderData(o.data || {});
      row.append(prompt, $('div', { class: 'out-body' }, body));
      box.append(row);
    }
  }

  // ------------------------------------------------------------ cells
  const promptText = c => 'In [' + (c.running || c.queued ? '*' : (c.count || ' ')) + ']:';

  function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

  function indentOf(line) { return (/^[ \t]*/.exec(line) || [''])[0]; }
  function editorKeys(c, ta, ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); enterCommand(); return; }
    if (ev.key === 'Enter' && (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey)) {
      ev.preventDefault();
      runCell(c);
      if (ev.altKey) { insertCell(idx(c) + 1, c.type === 'markdown' ? 'markdown' : 'code'); startEdit(); }
      else if (ev.shiftKey) { const i = idx(c); if (i === st.cells.length - 1) { insertCell(i + 1, 'code'); startEdit(); } else { select(i + 1); enterCommand(); } }
      else enterCommand();
      return;
    }
    if (c.type === 'code' && ev.key === 'Tab') {
      ev.preventDefault();
      const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
      if (s === e && !ev.shiftKey) { ta.setRangeText('    ', s, e, 'end'); }
      else {
        const from = v.lastIndexOf('\n', s - 1) + 1, to = e;
        const block = v.slice(from, to).split('\n').map(l => (ev.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : '    ' + l)).join('\n');
        ta.setRangeText(block, from, to, 'select');
      }
      ta.dispatchEvent(new Event('input'));
      return;
    }
    if (c.type === 'code' && ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      const s = ta.selectionStart, v = ta.value;
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const before = v.slice(lineStart, s);
      const extra = /:\s*$/.test(before) ? '    ' : '';
      ta.setRangeText('\n' + indentOf(before) + extra, s, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  }

  function buildCell(c) {
    const el = $('div', { class: 'cell ' + c.type, 'data-uid': String(c.uid) });
    const input = $('div', { class: 'input-row' });
    const prompt = $('div', { class: 'prompt in-prompt' }, c.type === 'code' ? promptText(c) : '');
    const body = $('div', { class: 'in-body' });
    if (c.type === 'markdown') {
      const view = $('div', { class: 'md-view' });
      const ta = $('textarea', { class: 'src md-src', spellcheck: 'false', rows: '1' });
      ta.value = c.source;
      ta.addEventListener('input', () => { c.source = ta.value; autosize(ta); markDirty(); });
      ta.addEventListener('keydown', ev => editorKeys(c, ta, ev));
      ta.addEventListener('focus', () => { st.editing = true; select(idx(c), true); el.classList.add('edit'); });
      ta.addEventListener('blur', () => { st.editing = false; el.classList.remove('edit'); });
      view.addEventListener('dblclick', () => { select(idx(c)); startEdit(); });
      body.append(view, ta);
    } else {
      const wrap = $('div', { class: 'code-wrap' });
      const hl = $('pre', { class: 'hl' });
      const ta = $('textarea', { class: 'src code-src', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', rows: '1', wrap: 'off' });
      ta.value = c.source;
      const refresh = () => { hl.textContent = ''; highlight(c.source + '\n', hl); autosize(ta); };
      ta.addEventListener('input', () => { c.source = ta.value; refresh(); markDirty(); });
      ta.addEventListener('scroll', () => { hl.scrollLeft = ta.scrollLeft; });
      ta.addEventListener('keydown', ev => editorKeys(c, ta, ev));
      ta.addEventListener('focus', () => { st.editing = true; select(idx(c), true); el.classList.add('edit'); });
      ta.addEventListener('blur', () => { st.editing = false; el.classList.remove('edit'); });
      wrap.append(hl, ta);
      body.append(wrap);
      c.refresh = refresh;
    }
    input.append(prompt, body);
    el.append(input);
    if (c.type === 'code') el.append($('div', { class: 'outputs' }));
    el.addEventListener('mousedown', ev => { if (!ev.target.closest('textarea')) { select(idx(c)); if (st.editing) enterCommand(); } });
    c.el = el; c.promptEl = prompt;
    return el;
  }

  function paint(c) {
    const el = c.el;
    if (c.type === 'code') {
      c.promptEl.textContent = promptText(c);
      el.classList.toggle('running', c.running);
      el.classList.toggle('queued', c.queued && !c.running);
      renderOutputs(c, el);
      if (c.refresh) c.refresh();
    } else if (c.type === 'markdown') {
      const view = el.querySelector('.md-view'), ta = el.querySelector('textarea');
      const editing = !c.rendered;
      el.classList.toggle('editing-md', editing);
      view.style.display = editing ? 'none' : '';
      ta.style.display = editing ? '' : 'none';
      if (!editing) { view.textContent = ''; view.append(c.source.trim() ? renderMarkdown(c.source, c.attachments) : $('div', { class: 'md-empty' }, L.emptyMd)); }
      else { ta.value = c.source; autosize(ta); }
    } else {
      const ta = el.querySelector('textarea');
      if (ta) autosize(ta);
    }
  }

  const idx = c => st.cells.indexOf(c);

  function renderAll() {
    list.textContent = '';
    if (!st.cells.length) list.append($('div', { class: 'empty' }, L.empty));
    st.cells.forEach(c => { if (!c.el) c.el = buildCell(c); list.append(c.el); paint(c); });
    select(Math.min(st.sel, Math.max(0, st.cells.length - 1)), true);
    setStatus();
  }

  function select(i, keepFocus) {
    if (!st.cells.length) return;
    st.sel = Math.max(0, Math.min(st.cells.length - 1, i));
    st.cells.forEach((c, k) => c.el && c.el.classList.toggle('selected', k === st.sel));
    const cur = st.cells[st.sel];
    if (cur && cur.el && !keepFocus) cur.el.scrollIntoView({ block: 'nearest' });
    const ty = document.getElementById('nb-type');
    if (ty && cur) ty.value = cur.type;
  }

  function startEdit() {
    const c = st.cells[st.sel];
    if (!c) return;
    if (c.type === 'markdown') { c.rendered = false; paint(c); }
    const ta = c.el.querySelector('textarea');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  function enterCommand() {
    st.editing = false;
    const c = st.cells[st.sel];
    if (c && c.el) { const ta = c.el.querySelector('textarea'); if (ta && document.activeElement === ta) ta.blur(); }
    root.focus();
  }

  function insertCell(at, type) {
    const raw = { cell_type: type, source: '', metadata: {}, ...(type === 'code' ? { outputs: [], execution_count: null } : {}) };
    const c = loadCell(raw);
    if ((st.nb.nbformat_minor || 0) >= 5) c.id = newId();
    st.cells.splice(at, 0, c);
    if (type === 'markdown') c.rendered = false;
    renderAll(); select(at); markDirty();
    return c;
  }
  function deleteCell() {
    if (!st.cells.length) return;
    const c = st.cells[st.sel];
    st.deleted.push({ cell: c, at: st.sel });
    if (st.deleted.length > 20) st.deleted.shift();
    st.queue = st.queue.filter(q => q !== c);
    st.cells.splice(st.sel, 1);
    if (c.el) c.el.remove();
    renderAll(); markDirty();
    flash(L.undo);
  }
  function undoDelete() {
    const d = st.deleted.pop();
    if (!d) return;
    st.cells.splice(Math.min(d.at, st.cells.length), 0, d.cell);
    renderAll(); select(d.at); markDirty();
  }
  function convert(type) {
    const c = st.cells[st.sel];
    if (!c || c.type === type) return;
    const i = st.sel;
    const raw = dumpCell(c);
    raw.cell_type = type;
    if (type !== 'code') { delete raw.outputs; delete raw.execution_count; } else { raw.outputs = []; raw.execution_count = null; }
    const n = loadCell(raw);
    n.id = c.id; n.rendered = type === 'markdown';
    st.cells[i] = n;
    if (c.el) c.el.remove();
    renderAll(); select(i); markDirty();
  }
  function moveSel(d) { select(st.sel + d); }

  function flash(msg) {
    if (!banner) return;
    banner.textContent = msg; banner.style.display = '';
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { banner.style.display = 'none'; }, 3500);
  }

  // ------------------------------------------------------------ execution
  function runCell(c) {
    if (c.type === 'markdown') { c.rendered = true; paint(c); return; }
    if (c.type !== 'code') return;
    if (c.queued || c.running) return;
    c.queued = true; paint(c);
    st.queue.push(c);
    pump();
  }
  function runAll() { st.cells.forEach(c => { if (c.type === 'markdown') { c.rendered = true; paint(c); } else if (c.type === 'code') runCell(c); }); }

  function pump() {
    if (st.running) return;
    const c = st.queue.shift();
    if (!c) { st.kernel = st.kernel === 'none' ? 'none' : 'idle'; st.status = ''; setStatus(); return; }
    if (!st.canRun) { c.queued = false; c.outputs = [{ output_type: 'error', ename: 'Error', evalue: L.noPython, traceback: [L.noPython] }]; paint(c); pump(); return; }
    st.running = c; c.running = true; c.queued = false; c.outputs = [];
    st.kernel = 'busy'; st.status = ''; setStatus(); paint(c);
    post({ run: { code: c.source } });
  }

  function addStream(name, text) {
    const c = st.running;
    if (!c) return;
    const last = c.outputs[c.outputs.length - 1];
    if (last && last.output_type === 'stream' && last.name === name) last.text += text; else c.outputs.push({ output_type: 'stream', name, text });
    if (c.outputs[c.outputs.length - 1].text.length > MAX_TEXT * 2) c.outputs[c.outputs.length - 1].text = c.outputs[c.outputs.length - 1].text.slice(-MAX_TEXT);
    if (!c.paintTimer) c.paintTimer = requestAnimationFrame(() => { c.paintTimer = 0; renderOutputs(c, c.el); });
  }

  function cellDone(m) {
    const c = st.running;
    st.running = null;
    if (!c) return;
    c.running = false;
    if (c.paintTimer) { cancelAnimationFrame(c.paintTimer); c.paintTimer = 0; }
    if (m.interrupted) {
      c.outputs.push({ output_type: 'error', ename: 'KeyboardInterrupt', evalue: '', traceback: [L.interrupted] });
      st.queue.forEach(q => { q.queued = false; paint(q); });
      st.queue = [];
      st.execCount = 0;
      st.kernel = 'none';
      paint(c); markDirty(); setStatus(); flash(L.kernelRestarted);
      return;
    }
    st.execCount += 1;
    c.count = st.execCount;
    for (const o of (m.outputs || [])) {
      const out = normOutput(o);
      if (out.output_type === 'execute_result') out.execution_count = c.count;
      c.outputs.push(out);
    }
    if (m.error) {
      c.outputs.push({ output_type: 'error', ename: String(m.error.ename || 'Error'), evalue: String(m.error.evalue || ''), traceback: Array.isArray(m.error.traceback) ? m.error.traceback.map(String) : [] });
      st.queue.forEach(q => { q.queued = false; paint(q); });   // as in Jupyter, an error interrupts "Run all"
      st.queue = [];
    }
    paint(c); markDirty();
    pump();
  }

  function restartKernel() {
    st.queue.forEach(q => { q.queued = false; paint(q); });
    st.queue = [];
    st.execCount = 0;
    post({ reset: true });
    st.kernel = 'none'; setStatus();
    flash(L.kernelRestarted);
  }
  function clearOutputs() { st.cells.forEach(c => { if (c.type === 'code') { c.outputs = []; c.count = null; paint(c); } }); st.execCount = 0; markDirty(); }

  // ------------------------------------------------------------ keyboard (command mode) and bar
  function onKey(ev) {
    if (st.editing || !st.nb) return;
    if (ev.target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(ev.target.tagName)) return;
    const c = st.cells[st.sel];
    const k = ev.key;
    if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === 's') { ev.preventDefault(); saveNow(); return; }
    if (ev.ctrlKey || ev.metaKey) { if (k === 'Enter' && c) { ev.preventDefault(); runCell(c); } return; }
    if (k === 'Enter' && ev.shiftKey && c) { ev.preventDefault(); runCell(c); if (st.sel === st.cells.length - 1) insertCell(st.cells.length, 'code'); else select(st.sel + 1); return; }
    if (k === 'Enter' && ev.altKey && c) { ev.preventDefault(); runCell(c); insertCell(st.sel + 1, 'code'); return; }
    if (k === 'Enter') { ev.preventDefault(); startEdit(); return; }
    if (k === 'ArrowUp' || k === 'k') { ev.preventDefault(); moveSel(-1); return; }
    if (k === 'ArrowDown' || k === 'j') { ev.preventDefault(); moveSel(1); return; }
    if (k === 'a') { ev.preventDefault(); insertCell(st.sel, 'code'); return; }
    if (k === 'b') { ev.preventDefault(); insertCell(st.sel + 1, 'code'); return; }
    if (k === 'm') { ev.preventDefault(); convert('markdown'); return; }
    if (k === 'y') { ev.preventDefault(); convert('code'); return; }
    if (k === 'r') { ev.preventDefault(); convert('raw'); return; }
    if (k === 'z') { ev.preventDefault(); undoDelete(); return; }
    if (k === 'c' && c) { ev.preventDefault(); st.clip = JSON.parse(JSON.stringify(dumpCell(c))); return; }
    if (k === 'x' && c) { ev.preventDefault(); st.clip = JSON.parse(JSON.stringify(dumpCell(c))); deleteCell(); return; }
    if (k === 'v' && st.clip) { ev.preventDefault(); const n = loadCell(JSON.parse(JSON.stringify(st.clip))); n.id = (st.nb.nbformat_minor || 0) >= 5 ? newId() : ''; st.cells.splice(st.sel + 1, 0, n); renderAll(); select(st.sel + 1); markDirty(); return; }
    if (k === 'd') { ev.preventDefault(); const now = Date.now(); if (now - st.lastD < 700) { st.lastD = 0; deleteCell(); } else st.lastD = now; return; }
  }

  function buildBar() {
    const btn = (id, label, title, fn) => $('button', { id, class: 'tb', title: title || label, onclick: fn }, label);
    bar = $('div', { class: 'bar' },
      btn('nb-save-btn', '💾', L.save, () => saveNow()),
      btn('nb-add', L.add, L.addTitle, () => { insertCell(st.cells.length ? st.sel + 1 : 0, 'code'); startEdit(); }),
      btn('nb-del', '🗑', L.delTitle, () => deleteCell()),
      $('span', { class: 'sep' }),
      btn('nb-run', '▶ ' + L.run, L.runTitle, () => { const c = st.cells[st.sel]; if (c) { runCell(c); if (c.type === 'markdown' || st.sel < st.cells.length - 1) select(st.sel + 1); } }),
      btn('nb-stop', '■ ' + L.stop, L.stopTitle, () => { if (st.running) post({ stop: true }); }),
      btn('nb-restart', '↻', L.restart, () => restartKernel()),
      btn('nb-runall', '⏩ ' + L.runAll, L.runAll, () => runAll()),
      $('select', { id: 'nb-type', class: 'tb', onchange: ev => convert(ev.target.value) },
        $('option', { value: 'code' }, L.code), $('option', { value: 'markdown' }, L.markdown), $('option', { value: 'raw' }, L.raw)),
      btn('nb-clear', L.clear, L.clear, () => clearOutputs()),
      $('label', { class: 'strip', title: L.noOutputsTitle }, $('input', { id: 'nb-strip', type: 'checkbox', onchange: ev => { st.strip = ev.target.checked; post({ strip: st.strip }); markDirty(); } }), ' ' + L.noOutputs),
      $('span', { id: 'nb-kernel', class: 'kernel' }, ''),
      $('span', { id: 'nb-save', class: 'savest' }, ''));
    return bar;
  }

  function build() {
    document.body.textContent = '';
    root = $('div', { id: 'nb', tabindex: '0' });
    banner = $('div', { class: 'banner', style: 'display:none' });
    list = $('div', { id: 'cells' });
    root.append(buildBar(), banner, list);
    document.body.append(root);
    document.getElementById('nb-strip').checked = st.strip;
    root.addEventListener('keydown', onKey);
    root.focus();
  }

  // ------------------------------------------------------------ messages from the page
  function applyVars(v) { if (v) for (const k in v) document.documentElement.style.setProperty(k, v[k]); }

  function init(m) {
    if (m.labels) L = Object.assign({}, DEFAULT_LABELS, m.labels);
    applyVars(m.vars);
    document.documentElement.classList.toggle('dark', !!m.dark);
    st.canRun = m.canRun !== false; st.strip = !!m.strip; st.path = m.path || '';
    if (m.error || !m.nb) { document.body.textContent = ''; document.body.append($('div', { class: 'fatal' }, $('b', {}, L.cantRead), $('div', {}, m.error || ''))); return; }
    const raw = m.nb;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cells) || !(raw.nbformat >= 4)) {
      document.body.textContent = ''; document.body.append($('div', { class: 'fatal' }, $('b', {}, L.cantRead), $('div', {}, L.unsupported))); return;
    }
    const { cells, ...rest } = raw;
    st.nb = rest;
    st.cells = []; st.uid = 0; st.execCount = 0;
    st.cells = cells.filter(c => c && typeof c === 'object').map(loadCell);
    st.nb.nbformat_minor = Number.isInteger(rest.nbformat_minor) ? rest.nbformat_minor : 0;
    build();
    renderAll();
    select(0);
    setStatus();
  }

  window.addEventListener('message', e => {
    if (e.source !== parent) return;
    const d = e.data || {};
    if (d.init) init(d.init);
    else if (d.labels) { L = Object.assign({}, DEFAULT_LABELS, d.labels); if (st.nb) { const keep = st.sel; build(); renderAll(); select(keep); } }
    else if (d.vars) { applyVars(d.vars); document.documentElement.classList.toggle('dark', !!d.dark); }
    else if (d.stream) addStream(d.stream.name === 'stderr' ? 'stderr' : 'stdout', String(d.stream.text || '') + '\n');
    else if (typeof d.status === 'string') { st.status = d.status.slice(0, 120); setStatus(); }
    else if (d.cellDone) cellDone(d.cellDone);
    else if (d.saved === false) { st.saving = false; setStatus(); flash(L.saveError + ': ' + String(d.saveError || '')); }
    else if (d.saved) { st.saving = false; st.dirty = false; setStatus(); }
    else if (d.image) {
      const imgs = imageWaiters.get(d.image.path) || [];
      imageWaiters.delete(d.image.path);
      imgs.forEach(i => { if (d.image.uri) i.setAttribute('src', d.image.uri); else i.setAttribute('alt', L.imageMissing); });
    } else if (d.flush) { saveNow(); post({ flushed: true }); }
  });

  post({ ready: true });
})();
