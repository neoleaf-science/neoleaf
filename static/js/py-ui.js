// "Run" tab for Python files (.py): runs the script in the browser (py-runner.js, isolated Pyodide), shows the output, the errors and the
// generated figures, and lets you save to the project whatever the script creates. Python cannot reach the internet or your account; only what you send
// (project data files) goes in, and only what the script generates comes out. Texts and file names always enter the page as text.
(function () {
  'use strict';

  const DATA_EXT = /\.(py|csv|tsv|json|txt|dat|npy|npz|xml|ya?ml|toml|ini|md|bib)$/i;   // project files the script can read
  const MAX_FILE = 8 * 1024 * 1024, MAX_TOTAL = 30 * 1024 * 1024;
  const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  const st = { running: false, status: '', lines: [], error: '', files: {}, urls: {}, saved: new Set(), ms: null, note: '', ran: false };
  let panel = null;

  const entries = () => ((window.FT && FT.entries()) || []);
  const isPy = () => typeof editor !== 'undefined' && editor && editor.getModel() && editor.getModel().getLanguageId() === 'python';
  const extOf = n => (n.split('.').pop() || '').toLowerCase();
  const fmtSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
  const safePath = p => typeof p === 'string' && p.length > 0 && p.length < 300 && !p.startsWith('/') && !/[\u0000-\u001f\\]/.test(p) && !p.split('/').some(x => x === '..' || x === '' || x === '.')
    && !/^\.(git|neoleaf)(\/|$)/.test(p);

  // ------------------------------------------------------------ files the script sees
  async function collectFiles() {
    const files = {};
    let total = 0, skipped = 0;
    const cur = entries().find(e => e.id === currentFileId);
    const all = await BrowserGit.listFiles();
    const dirs = all.filter(f => f.is_folder).map(f => f.path);
    const list = all.filter(f => !f.is_folder && DATA_EXT.test(f.name));
    for (const f of list) {
      if ((cur && f.path === cur.path) || (f.size || 0) > MAX_FILE || total + (f.size || 0) > MAX_TOTAL) { if (!cur || f.path !== cur.path) skipped++; continue; }
      try { files[f.path] = await BrowserGit.readFile(f.path, 'uint8array'); total += f.size || 0; } catch (_) { skipped++; }
    }
    if (cur) files[cur.path] = new TextEncoder().encode(editor.getValue());   // what is on screen outranks what is saved
    return { files, dirs, skipped, scriptPath: cur ? cur.path : '' };
  }

  // ------------------------------------------------------------ execution
  function consent() {
    try { if (localStorage.getItem('ld-py-ok') === '1') return true; } catch (_) { /* always ask */ }
    const ok = confirm(T('Run Python in this browser?\n\nThe script runs isolated: no access to the internet or to your NeoLeaf account. It can read the project\'s data files (.csv, .json, .txt...) and what it generates shows up here for you to save. The first time, Python and the packages are downloaded (a few MB).'));
    if (ok) { try { localStorage.setItem('ld-py-ok', '1'); } catch (_) { /* no storage */ } }
    return ok;
  }

  function clearOutput() {
    for (const u of Object.values(st.urls)) URL.revokeObjectURL(u);
    Object.assign(st, { lines: [], error: '', files: {}, urls: {}, saved: new Set(), ms: null, note: '', status: '' });
  }

  async function run() {
    if (st.running || !isPy() || !window.PyRunner) return;
    if (!(await PyRunner.available())) { st.ran = true; clearOutput(); st.error = T('Python is not available on this server.'); render(); return; }
    if (!consent()) return;
    if (typeof switchTab === 'function') switchTab('preview');
    clearOutput();
    st.running = true; st.ran = true; st.status = T('Preparing the files...');
    render();
    let res;
    try {
      const { files, dirs, skipped, scriptPath } = await collectFiles();
      if (skipped) st.note = T('{0} project file(s) were not sent to Python (larger than 8 MB or above the 30 MB total limit).', String(skipped));
      res = await PyRunner.run(editor.getValue(), {
        files, dirs, scriptPath, timeoutMs: 120000,
        onStatus: s => { st.status = s; renderSoon(); },
        onStdout: s => { st.lines.push({ s, err: false }); renderSoon(); },
        onStderr: s => { st.lines.push({ s, err: true }); renderSoon(); },
      });
    } catch (e) {
      res = { ok: false, error: e.message || String(e), files: {}, ms: 0 };
    }
    st.running = false; st.status = '';
    st.ms = res.ms;
    if (!res.ok) st.error = res.error || T('Failed to run.');
    for (const [name, bytes] of Object.entries(res.files || {})) {
      st.files[name] = bytes;
      const mime = IMG[extOf(name)];
      if (mime) st.urls[name] = URL.createObjectURL(new Blob([bytes], { type: mime }));
    }
    render();
  }

  function stop() { if (st.running && window.PyRunner) PyRunner.stop(); }

  // ------------------------------------------------------------ save to the project
  async function saveFile(name) {
    if (!safePath(name)) { st.note = T('Invalid file name: {0}', name); render(); return false; }
    if (entries().some(e => e.path === name && !e.dir) && !confirm(T('Replace {0} in the project?', name))) return false;
    try {
      await BrowserGit.writeFile(name, st.files[name]);
      st.saved.add(name);
      if (window.FT && FT.refresh) await FT.refresh();
      return true;
    } catch (e) { st.note = T('Could not save {0}: {1}', name, e.message); return false; }
  }
  async function saveAll() {
    const names = Object.keys(st.files).filter(n => !st.saved.has(n));
    for (const n of names) if (!(await saveFile(n))) break;
    render();
  }

  // ------------------------------------------------------------ panel
  let raf = 0;
  function renderSoon() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  function fileCard(name) {
    const bytes = st.files[name], ext = extOf(name), saved = st.saved.has(name);
    const kids = [h('div', { class: 'py-fname' }, name + '  (' + fmtSize(bytes.length) + ')')];
    if (st.urls[name]) kids.push(h('img', { class: 'py-img', src: st.urls[name], alt: name }));
    const acts = [h('button', { class: 'btn py-btn', disabled: saved, onclick: async () => { await saveFile(name); render(); } }, saved ? T('Saved to the project') : T('Save to the project'))];
    if (ext === 'pdf') {
      if (!st.urls[name]) st.urls[name] = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      acts.push(h('a', { class: 'btn py-btn', href: st.urls[name], target: '_blank', rel: 'noopener noreferrer' }, T('Open')));
    }
    kids.push(h('div', { class: 'py-actions' }, ...acts));
    return h('div', { class: 'py-card' }, ...kids);
  }

  function render() {
    if (!panel) return;
    const keep = panel.scrollTop;
    panel.textContent = '';
    const run_ = h('button', { id: 'py-run', class: 'btn btn-primary py-btn', disabled: st.running, title: T('Runs the script (Ctrl+Enter)'), onclick: () => run() }, '▶ ' + T('Run'));
    const stop_ = h('button', { id: 'py-stop', class: 'btn py-btn', disabled: !st.running, title: T('Stops the script'), onclick: () => stop() }, '■ ' + T('Stop'));
    const info = h('span', { id: 'py-status', class: 'py-status' }, st.running ? st.status : (st.ms !== null ? (st.error ? T('Finished with an error') : T('Done')) + ' · ' + (st.ms / 1000).toFixed(1) + ' s' : ''));
    const bar = h('div', { class: 'py-bar' }, run_, stop_, info);
    panel.append(bar);
    if (!st.ran) panel.append(h('div', { class: 'cmt-empty' }, T('Click Run (or Ctrl+Enter) to run this script. The output and generated files show up here.')));
    if (st.note) panel.append(h('div', { class: 'py-note' }, st.note));
    if (st.lines.length) {
      const out = h('pre', { id: 'py-out', class: 'py-out' });
      for (const l of st.lines) out.append(h('span', { class: l.err ? 'py-err' : '' }, l.s + '\n'));
      panel.append(out);
    }
    if (st.error) panel.append(h('pre', { id: 'py-error', class: 'py-out py-err' }, st.error));
    const names = Object.keys(st.files);
    if (names.length) {
      panel.append(h('div', { class: 'py-files-head' }, h('b', {}, T('Generated files') + ' (' + names.length + ')'),
        h('button', { class: 'btn py-btn', disabled: names.every(n => st.saved.has(n)), onclick: () => saveAll() }, T('Save all to the project'))));
      names.forEach(n => panel.append(fileCard(n)));
    }
    panel.scrollTop = keep;
  }

  function ensurePanel() {
    const box = document.getElementById('preview-container');
    if (!box) return null;
    if (!panel) { panel = h('div', { id: 'py-panel', class: 'py-panel' }); box.appendChild(panel); render(); }
    return panel;
  }

  function sync() {
    const on = isPy();
    if (on) ensurePanel();
    if (panel) panel.style.display = on ? '' : 'none';
  }

  window.addEventListener('editor-ready', () => {
    editor.onDidChangeModelLanguage(sync);
    sync();
  });
  window.addEventListener('ld-lang-change', render);

  window.PyUI = { active: isPy, run, stop, show: () => { if (isPy()) { ensurePanel(); render(); } } };
})();
