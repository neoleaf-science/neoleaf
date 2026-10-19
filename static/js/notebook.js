// Jupyter notebooks (.ipynb): opens, edits, runs (Pyodide) and saves, full screen, Jupyter style. All in the browser.
//
// The notebook is a project file like any other: read and written by BrowserGit, no server route. The interface runs in a sandboxed
// iframe (isolated origin, no access to the page, the session or the internet) and a restricted content policy; the markdown and HTML of the
// outputs are cleaned by DOMPurify and images only go in as data:. Python execution is done by py-runner.js (isolated Worker, kernel with
// state between cells). Live editing: there is no room for the .ipynb (it is a single JSON), so only one person edits at a time.
(function () {
  'use strict';

  const VENDOR = location.origin + '/static/vendor/';
  const QUERY = (() => { try { const s = document.currentScript && document.currentScript.src; return s && s.includes('?') ? '?' + s.split('?')[1] : ''; } catch (_) { return ''; } })();
  const MAX_BYTES = 25 * 1024 * 1024;
  const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  const THEME_VARS = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover', '--text-primary', '--text-bright', '--muted', '--border-color', '--link', '--accent-color', '--on-accent'];
  const tr = t => (window.T ? window.T(t) : t);

  let overlay = null, frame = null, path = '', frameReady = false, initMsg = null, flushWaiter = null, frameText = null;

  const strip = () => { try { return localStorage.getItem('ld-nb-strip') === '1'; } catch (_) { return false; } };

  function labels() {
    return {
      run: tr('Run'), runTitle: tr('Run the cell (Shift+Enter)'), runAll: tr('Run all'), stop: tr('Stop'), stopTitle: tr('Interrupts the execution (restarts the kernel)'),
      restart: tr('Restart the kernel'), add: tr('+ Cell'), addTitle: tr('Insert a cell below (B)'), del: tr('Delete'), delTitle: tr('Delete the cell (DD)'),
      code: tr('Code'), markdown: tr('Markdown'), raw: tr('Raw'), clear: tr('Clear outputs'), save: tr('Save'), noOutputs: tr('Save without outputs'),
      noOutputsTitle: tr('Saves the file without the cells\' outputs (smaller file, cleaner Git)'), saved: tr('Saved'), unsaved: tr('Unsaved changes'), saving: tr('Saving...'),
      kernelNone: tr('Kernel: stopped (starts when you run)'), kernelBusy: tr('Kernel: busy'), kernelIdle: tr('Kernel: idle'),
      kernelRestarted: tr('Kernel restarted: the variables were erased.'), empty: tr('This notebook has no cells. Use "+ Cell" to start.'),
      emptyMd: tr('(empty text cell: double-click to edit)'), undo: tr('Cell deleted. Press Z to undo.'), interrupted: tr('Execution interrupted; the kernel was restarted.'),
      noPython: tr('Python is not available on this server.'), truncated: tr('(output truncated: text too long)'), imageMissing: tr('[image not found]'),
      cantRead: tr('Could not open this notebook'), unsupported: tr('Only notebooks in format 4 (nbformat 4) are supported.'), saveError: tr('Could not save the notebook'), shortcuts: tr('Shortcuts: Enter edits, Esc leaves, Shift+Enter runs, A/B insert, DD deletes, M/Y change the type, C/X/V copy, cut and paste, Z undoes.'),
    };
  }

  function themeVars() {
    const cs = getComputedStyle(document.documentElement);
    const v = {};
    for (const k of THEME_VARS) v[k] = cs.getPropertyValue(k).trim();
    return v;
  }
  function isDark() {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#fff';
    document.body.appendChild(probe);
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color);
    probe.remove();
    return m ? (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) < 128 : false;
  }

  // ---- isolated iframe
  const CSS = `
    :root { --nb-in: #303F9F; --nb-out: #D84315; --nb-sel: #42A5F5; --nb-edit: #66BB6A; --cell-bg: var(--bg-secondary, #f7f7f7); --cell-bd: var(--border-color, #cfcfcf); --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color-scheme: light dark; }
    :root.dark { --nb-in: #7986CB; --nb-out: #FF8A65; }
    html, body { margin: 0; height: 100%; background: var(--bg-primary, #fff); color: var(--text-primary, #222); font: 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    #nb { height: 100%; overflow: auto; outline: none; }
    .bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 12px; background: var(--bg-secondary, #f0f0f0); border-bottom: 1px solid var(--cell-bd); }
    .tb { background: var(--bg-tertiary, #e8e8e8); color: var(--text-primary, #222); border: 1px solid var(--cell-bd); border-radius: 4px; padding: 3px 9px; font: inherit; font-size: 12px; cursor: pointer; }
    .tb:hover { background: var(--bg-hover, #ddd); }
    .sep { width: 1px; height: 18px; background: var(--cell-bd); margin: 0 2px; }
    .strip { font-size: 12px; color: var(--muted, #666); display: flex; align-items: center; gap: 3px; cursor: pointer; }
    .kernel, .savest { font-size: 12px; color: var(--muted, #666); }
    .kernel { margin-left: auto; }
    .banner { position: sticky; top: 38px; z-index: 4; margin: 6px 12px; padding: 6px 12px; background: var(--bg-secondary, #fffbe6); border: 1px solid var(--cell-bd); border-radius: 4px; font-size: 12px; }
    .fatal { padding: 30px; color: #e5534b; } .fatal div { margin-top: 8px; color: var(--muted, #666); }
    #cells { max-width: 1180px; margin: 0 auto; padding: 12px 12px 120px; }
    .empty { color: var(--muted, #666); text-align: center; padding: 40px 0; }
    .cell { border-left: 5px solid transparent; padding: 2px 0 2px 2px; margin: 3px 0; border-radius: 2px; }
    .cell.selected { border-left-color: var(--nb-sel); } .cell.selected.edit { border-left-color: var(--nb-edit); }
    .input-row, .out-row { display: flex; align-items: flex-start; }
    .prompt { flex: 0 0 86px; text-align: right; padding: 6px 8px 0 0; font: 12px/1.5 var(--mono); user-select: none; }
    .in-prompt { color: var(--nb-in); } .out-prompt { color: var(--nb-out); cursor: pointer; }
    .running .in-prompt, .queued .in-prompt { font-weight: bold; }
    .in-body { flex: 1; min-width: 0; }
    .code-wrap { position: relative; border: 1px solid var(--cell-bd); background: var(--cell-bg); border-radius: 2px; }
    .selected .code-wrap { border-color: color-mix(in srgb, var(--nb-sel) 55%, var(--cell-bd)); } .edit .code-wrap { border-color: var(--nb-edit); }
    pre.hl, textarea.code-src { font: 13px/1.5 var(--mono); padding: 6px 8px; margin: 0; white-space: pre; tab-size: 4; box-sizing: border-box; }
    pre.hl { position: absolute; inset: 0; overflow: hidden; pointer-events: none; color: var(--text-primary, #222); }
    textarea.src { display: block; width: 100%; border: 0; outline: 0; resize: none; overflow: hidden; background: transparent; }
    textarea.code-src { position: relative; color: transparent; caret-color: var(--text-bright, #000); overflow-x: auto; }
    textarea.code-src::selection { background: color-mix(in srgb, var(--nb-sel) 35%, transparent); color: transparent; }
    textarea.md-src { font: 13px/1.5 var(--mono); padding: 6px 8px; color: var(--text-primary, #222); border: 1px solid var(--nb-edit); background: var(--cell-bg); border-radius: 2px; box-sizing: border-box; }
    .tk-k { color: #008000; font-weight: bold; } .tk-b { color: #008000; } .tk-s { color: #BA2121; } .tk-c { color: #408080; font-style: italic; } .tk-n { color: #666; } .tk-d { color: #AA22FF; }
    :root.dark .tk-k, :root.dark .tk-b { color: #6cc070; } :root.dark .tk-s { color: #e8837f; } :root.dark .tk-c { color: #7fb0b0; } :root.dark .tk-n { color: #aaa; } :root.dark .tk-d { color: #c88bff; }
    .md-view { padding: 4px 8px; min-height: 24px; } .md-empty { color: var(--muted, #888); font-style: italic; }
    .md { line-height: 1.6; overflow-wrap: anywhere; }
    .md h1, .md h2, .md h3, .md h4, .md h5, .md h6 { color: var(--text-bright, #111); line-height: 1.25; margin: 1em 0 .4em; } .md h1 { font-size: 1.9em; } .md h2 { font-size: 1.5em; } .md h3 { font-size: 1.25em; }
    .md > :first-child { margin-top: 0; } .md p, .md ul, .md ol, .md pre, .md table, .md blockquote { margin: 0 0 .9em; } .md a { color: var(--link, #2a6fdb); }
    .md code { font: .9em var(--mono); background: var(--bg-tertiary, #eee); padding: .1em .35em; border-radius: 3px; } .md pre { background: var(--cell-bg); border: 1px solid var(--cell-bd); padding: 8px 10px; overflow: auto; } .md pre code { background: none; padding: 0; }
    .md blockquote { border-left: 4px solid var(--cell-bd); margin-left: 0; padding: 0 1em; color: var(--muted, #666); } .md table { border-collapse: collapse; } .md th, .md td { border: 1px solid var(--cell-bd); padding: 4px 10px; } .md img { max-width: 100%; }
    .outputs { margin-top: 2px; } .outputs.collapsed .out-body { display: none; }
    .out-body { flex: 1; min-width: 0; max-height: 560px; overflow: auto; padding-top: 2px; }
    pre.stream, pre.plain, pre.error { margin: 0; padding: 4px 8px; font: 13px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    pre.stderr { background: rgba(229, 83, 75, .12); } pre.error { background: rgba(229, 83, 75, .12); }
    .img { max-width: 100%; height: auto; background: #fff; }
    .html { overflow: auto; padding: 2px 4px; } .html table { border-collapse: collapse; border: 0; font-size: 13px; } .html thead th { text-align: right; vertical-align: bottom; border-bottom: 1px solid var(--cell-bd); }
    .html th, .html td { padding: .45em .9em; text-align: right; border: 0; } .html tbody tr:nth-child(odd) { background: color-mix(in srgb, var(--bg-secondary, #f5f5f5) 70%, transparent); } .html tbody tr:hover { background: var(--bg-hover, #e6f0fa); } .html tbody th { font-weight: bold; }
    .latex { padding: 4px 8px; }
    .fg-k { color: #3e424d; } .fg-r { color: #e75c58; } .fg-g { color: #00a250; } .fg-y { color: #ddb62b; } .fg-b { color: #208ffb; } .fg-m { color: #d160c4; } .fg-c { color: #60c6c8; } .fg-w { color: #c5c1b4; } .bold { font-weight: bold; }
    :root:not(.dark) .fg-y { color: #b08800; } :root:not(.dark) .fg-w { color: #7d786b; } :root:not(.dark) .fg-c { color: #1a9ca0; }
  `;

  function shell(nonce, frameJs) {
    const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' ${VENDOR}katex/; font-src ${VENDOR}katex/; img-src data:`;
    const libs = ['marked.umd.js', 'purify.min.js', 'katex/katex.min.js', 'katex/auto-render.min.js'].map(f => `<script nonce="${nonce}" src="${VENDOR}${f}"><\/script>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${VENDOR}katex/katex.min.css"><style>${CSS}</style></head><body>${libs}<script nonce="${nonce}">${frameJs.replace(/<\/script/gi, '<\\/script')}<\/script></body></html>`;
  }

  async function loadFrameJs() {
    if (frameText) return frameText;
    const r = await fetch('/static/js/notebook-frame.js' + QUERY);
    if (!r.ok) throw new Error('notebook-frame.js');
    frameText = await r.text();
    return frameText;
  }

  // ---- project files requested by the notebook (relative markdown images)
  function resolvePath(from, rel) {
    let r = rel;
    try { r = decodeURI(rel); } catch (_) { /* keep */ }
    const parts = r.startsWith('/') ? [] : (from.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : []);
    for (const seg of r.replace(/[?#].*$/, '').split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
    }
    return parts.length ? parts.join('/') : null;
  }
  async function imageUri(rel) {
    const file = resolvePath(path, rel);
    const mime = file && IMG_MIME[file.split('.').pop().toLowerCase()];
    if (!file || !mime || /^\.(git|neoleaf)\//.test(file)) return '';
    try {
      const bytes = await BrowserGit.readFile(file, 'uint8array');
      if (!bytes || bytes.length > 3 * 1024 * 1024) return '';
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return `data:${mime};base64,${btoa(bin)}`;
    } catch (_) { return ''; }
  }

  function post(msg) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*'); }

  async function sendInit() {
    const canRun = window.PyRunner ? await PyRunner.available() : false;
    post({ init: Object.assign({ labels: labels(), vars: themeVars(), dark: isDark(), canRun, strip: strip(), path }, initMsg) });
    try { frame.focus(); } catch (_) { /* no focus */ }
  }

  async function runCell(code) {
    const send = m => post(m);
    let res;
    try {
      const extra = await kernelFiles().catch(() => ({}));
      res = await PyRunner.cell(String(code), {
        cwd: dirOf(path), files: extra.files, dirs: extra.dirs,
        onStatus: s => send({ status: s }),
        onStdout: s => send({ stream: { name: 'stdout', text: s } }),
        onStderr: s => send({ stream: { name: 'stderr', text: s } }),
      });
    } catch (e) {
      res = { ok: true, outputs: [], error: { ename: 'Error', evalue: e.message || String(e), traceback: [e.message || String(e)] } };
    }
    send({ cellDone: { interrupted: !!res.interrupted, outputs: res.outputs || [], error: res.error || null } });
  }

  window.addEventListener('message', async e => {
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.neoleafNb !== true) return;
    if (d.ready) { frameReady = true; sendInit(); return; }
    if (typeof d.save === 'string') {
      try { await BrowserGit.writeFile(path, d.save); post({ saved: true }); } catch (err) { post({ saved: false, saveError: String(err.message || err) }); }
      return;
    }
    if (d.run && typeof d.run.code === 'string') { if (window.PyRunner) runCell(d.run.code); return; }
    if (d.reset) { if (window.PyRunner) PyRunner.resetKernel(); return; }
    if (d.stop) { if (window.PyRunner) PyRunner.stop(); return; }
    if (typeof d.strip === 'boolean') { try { localStorage.setItem('ld-nb-strip', d.strip ? '1' : '0'); } catch (_) { /* no storage */ } return; }
    if (d.image && typeof d.image.path === 'string' && d.image.path.length < 400) { post({ image: { path: d.image.path, uri: await imageUri(d.image.path) } }); return; }
    if (d.flushed && flushWaiter) { const w = flushWaiter; flushWaiter = null; w(); }
  });

  // ---- file tree on the left: notebooks, data files and images (no .py, .tex or LaTeX structure)
  const NB_RE = /\.ipynb$/i;
  const IMG_RE = /\.(png|jpe?g|gif|svg|webp)$/i;
  const DATA_RE = /\.(csv|tsv|json|jsonl|txt|dat|npy|npz|xml|ya?ml|toml|ini|xlsx?|parquet|feather|h5|hdf5|pkl|pickle|sqlite|db)$/i;
  const TEXT_RE = /\.(csv|tsv|json|jsonl|txt|dat|xml|ya?ml|toml|ini)$/i;
  // what the kernel sees (the same rules as py-ui.js, plus images and the project's .py modules)
  const KERNEL_RE = /\.(py|csv|tsv|json|jsonl|txt|dat|npy|npz|xml|ya?ml|toml|ini|md|bib|png|jpe?g|gif|svg|webp)$/i;
  const MAX_KERNEL_FILE = 8 * 1024 * 1024, MAX_KERNEL_TOTAL = 30 * 1024 * 1024;
  const kind = n => (NB_RE.test(n) ? 'nb' : IMG_RE.test(n) ? 'img' : DATA_RE.test(n) ? 'data' : '');
  const ICON = { nb: '📓', img: '🖼️', data: '📊' };
  const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const fmtSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');

  let tree = null, treeBody = null, main = null, viewer = null, viewerUrl = null, nbPath = '', collapsed = new Set(), treeHidden = false, lastSig = '', lastEpoch = -1;

  async function listProject() {
    try { return await BrowserGit.listFiles(); } catch (_) { return []; }
  }

  async function renderTree() {
    if (!treeBody) return;
    const all = (await listProject()).filter(f => !f.is_folder && kind(f.path));
    const root = { dirs: new Map(), files: [] };
    for (const f of all) {
      let node = root;
      const parts = f.path.split('/');
      for (const part of parts.slice(0, -1)) { if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] }); node = node.dirs.get(part); }
      node.files.push(f);
    }
    treeBody.textContent = '';
    if (!all.length) { treeBody.append(h('div', { class: 'nb-tree-empty' }, tr('No notebook, data file or image in this project.'))); return; }
    const walk = (node, prefix, depth, into) => {
      for (const [name, sub] of [...node.dirs].sort((x, y) => x[0].localeCompare(y[0]))) {
        const dp = prefix ? prefix + '/' + name : name, closed = collapsed.has(dp);
        into.append(h('div', { class: 'nb-tree-row dir', style: 'padding-left:' + (8 + depth * 14) + 'px', title: dp, onclick: () => { if (closed) collapsed.delete(dp); else collapsed.add(dp); renderTree(); } }, (closed ? '▸ ' : '▾ ') + name));
        if (!closed) walk(sub, dp, depth + 1, into);
      }
      for (const f of node.files.sort((x, y) => x.name.localeCompare(y.name))) {
        const k = kind(f.path), active = f.path === (viewing || nbPath);
        into.append(h('div', { class: 'nb-tree-row file ' + k + (active ? ' active' : ''), 'data-path': f.path, style: 'padding-left:' + (8 + depth * 14) + 'px', title: f.path, onclick: () => openFile(f.path) }, ICON[k] + ' ' + f.name));
      }
    };
    walk(root, '', 0, treeBody);
  }

  // ---- viewer for files that are not notebooks (image, data text or binary file notice)
  let viewing = '';
  async function showFile(p) {
    viewing = p;
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
    viewer.textContent = '';
    const k = kind(p);
    const head = h('div', { class: 'nb-viewer-head' }, h('b', { class: 'nb-title' }, p),
      h('button', { class: 'btn', id: 'nb-copy-path', onclick: async () => { try { await navigator.clipboard.writeText(p); } catch (_) { /* no permission */ } } }, tr('Copy path')),
      nbPath ? h('button', { class: 'btn', id: 'nb-back', onclick: () => backToNotebook() }, '← ' + tr('Back to the notebook')) : null);
    const body = h('div', { class: 'nb-viewer-body' }, tr('Loading...'));
    viewer.append(head, body);
    if (frame) frame.style.display = 'none';
    viewer.style.display = 'flex';
    renderTree();
    try {
      const bytes = await BrowserGit.readFile(p, 'uint8array');
      body.textContent = '';
      if (k === 'img') {
        viewerUrl = URL.createObjectURL(new Blob([bytes], { type: IMG_MIME[p.split('.').pop().toLowerCase()] || 'application/octet-stream' }));
        body.append(h('img', { class: 'nb-viewer-img', src: viewerUrl, alt: p }));
      } else if (TEXT_RE.test(p)) {
        const part = bytes.length > 200000 ? bytes.subarray(0, 200000) : bytes;
        body.append(h('pre', { class: 'nb-viewer-text' }, new TextDecoder('utf-8', { fatal: false }).decode(part)));
        if (bytes.length > 200000) body.append(h('div', { class: 'nb-viewer-note' }, tr('Showing only the start of the file ({0}).').replace('{0}', fmtSize(bytes.length))));
      } else {
        body.append(h('div', { class: 'nb-viewer-note' }, tr('Binary file ({0}). Python sees it at: {1}').replace('{0}', fmtSize(bytes.length)).replace('{1}', p)));
      }
    } catch (e) { body.textContent = tr('Could not open: {0}').replace('{0}', e.message || String(e)); }
  }
  function backToNotebook() {
    viewing = '';
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
    viewer.style.display = 'none'; viewer.textContent = '';
    if (frame) { frame.style.display = ''; try { frame.focus(); } catch (_) { /* no focus */ } }
    renderTree();
  }

  // ---- project files the kernel sees: sent only when they change (or when the engine restarted)
  async function kernelFiles() {
    const all = await listProject();
    const dirs = all.filter(f => f.is_folder).map(f => f.path);
    const list = all.filter(f => !f.is_folder && KERNEL_RE.test(f.name) && (f.size || 0) <= MAX_KERNEL_FILE);
    const sig = list.map(f => f.path + ':' + (f.size || 0)).join('|') + '#' + dirs.join('|');
    const epoch = window.PyRunner && PyRunner.epoch ? PyRunner.epoch() : 0;
    if (sig === lastSig && epoch === lastEpoch) return {};
    const files = {};
    let total = 0;
    for (const f of list) {
      if (total + (f.size || 0) > MAX_KERNEL_TOTAL) continue;
      try { files[f.path] = await BrowserGit.readFile(f.path, 'uint8array'); total += f.size || 0; } catch (_) { /* vanishes from disk */ }
    }
    lastSig = sig; lastEpoch = epoch;
    return { files, dirs };
  }

  // ---- open and close
  async function open(p) {
    if (overlay) await close(true);
    overlay = h('div', { id: 'nb-overlay', class: 'nb-overlay', onclick: ev => { if (ev.target === overlay) close(); } });
    const box = h('div', { class: 'nb-modal' });
    box.append(h('div', { class: 'nb-head' },
      h('button', { id: 'nb-tree-toggle', class: 'btn', title: tr('Show or hide the file list'), onclick: () => { treeHidden = !treeHidden; tree.style.display = treeHidden ? 'none' : ''; } }, '☰'),
      h('b', { class: 'nb-title', id: 'nb-title' }, ''),
      h('button', { id: 'nb-close', class: 'btn', title: tr('Close the notebook'), onclick: () => close() }, '✕ ' + tr('Close'))));
    treeBody = h('div', { class: 'nb-tree-body' });
    tree = h('div', { id: 'nb-tree', class: 'nb-tree' },
      h('div', { class: 'nb-tree-head' }, h('span', {}, tr('Files')), h('button', { class: 'btn', title: tr('Refresh the list'), onclick: () => renderTree() }, '↻')), treeBody);
    main = h('div', { class: 'nb-main' });
    viewer = h('div', { id: 'nb-viewer', class: 'nb-viewer', style: 'display:none' });
    box.append(h('div', { class: 'nb-body' }, tree, main));
    main.append(viewer);
    overlay.append(box);
    document.body.appendChild(overlay);
    treeHidden = false; viewing = ''; nbPath = ''; lastSig = ''; lastEpoch = -1;
    await openFile(p);
  }

  async function loadNotebook(p) {
    if (frame) { await flushFrame(); frame.remove(); frame = null; }
    if (window.PyRunner) PyRunner.stop();
    path = p; nbPath = p; viewing = '';
    if (viewer) { viewer.style.display = 'none'; viewer.textContent = ''; }
    const t = document.getElementById('nb-title'); if (t) t.textContent = p;
    frameReady = false; lastSig = ''; lastEpoch = -1;
    let nb = null, error = '';
    try {
      const text = await BrowserGit.readFile(p);
      if (text.length > MAX_BYTES) throw new Error(tr('The notebook is over 25 MB.'));
      nb = JSON.parse(text);
    } catch (e) { error = e instanceof SyntaxError ? tr('The file is not valid JSON.') : (e.message || String(e)); }
    initMsg = { nb, error };
    const nonce = btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(18))));
    const js = await loadFrameJs();
    frame = document.createElement('iframe');
    frame.id = 'nb-frame';
    frame.title = p;
    // no allow-same-origin: the notebook runs in an isolated origin, with no access to the page or the session cookie (allow-popups only to open links)
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    frame.srcdoc = shell(nonce, js);
    main.prepend(frame);
    renderTree();
  }

  async function openFile(p) {
    if (!overlay) return;
    if (NB_RE.test(p)) { await loadNotebook(p); return; }
    if (!frame) { path = ''; nbPath = ''; }
    await showFile(p);
  }

  function flushFrame() {
    if (!frameReady || !frame) return Promise.resolve();
    return new Promise(resolve => { flushWaiter = resolve; post({ flush: true }); setTimeout(() => { if (flushWaiter) { flushWaiter = null; resolve(); } }, 3000); });
  }

  async function close(silent) {
    if (!overlay) return;
    if (!silent && window.PyRunner && PyRunner.isReady() && !confirm(tr('Close the notebook? The kernel\'s variables will be lost.'))) return;
    await flushFrame();
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
    overlay.remove();
    overlay = null; frame = null; frameReady = false; viewer = null; tree = null; treeBody = null; main = null; viewing = ''; nbPath = '';
    if (window.PyRunner) PyRunner.stop();
    if (window.FT && FT.refresh) FT.refresh().catch(() => {});
  }

  window.addEventListener('ld-lang-change', () => { if (frameReady) post({ labels: labels() }); });
  window.addEventListener('ld-theme-change', () => setTimeout(() => { if (frameReady) post({ vars: themeVars(), dark: isDark() }); }, 60));

  window.NotebookView = { open, close, isOpen: () => !!overlay };
})();
