// Search and replace across the whole project (Ctrl+Shift+F). The search uses the same engine as Monaco (temporary models),
// so "whole word", regex and case sensitivity behave as in the editor. Replacing edits the file in the
// editor itself, so live editing and undo (Ctrl+Z) keep working.
(function () {
  const $ = id => document.getElementById(id);
  const MAX_TOTAL = 2000, MAX_PER_FILE = 500;
  const st = { q: '', rep: '', cs: false, word: false, regex: false, groups: [], busy: false, msg: '' };
  let inputQ = null, inputR = null;

  const entries = () => ((window.FT && FT.entries()) || []);
  const wordSeps = () => editor.getOption(monaco.editor.EditorOption.wordSeparators);

  async function fetchTexts() {
    const data = await Project.texts();
    const map = new Map((data.files || []).map(f => [f.path, f.text]));
    const cur = entries().find(e => e.id === currentFileId);
    if (cur && editor) map.set(cur.path, editor.getValue());      // what is on screen outranks what is in Drive
    return map;
  }

  function matchesIn(model) {
    return model.findMatches(st.q, false, st.regex, st.cs, st.word ? wordSeps() : null, true, MAX_PER_FILE).filter(m => !m.range.isEmpty());
  }

  async function run() {
    st.msg = '';
    if (!st.q) { st.groups = []; render(); return; }
    st.busy = true; render();
    try {
      if (st.regex) new RegExp(st.q);
      const texts = await fetchTexts();
      const groups = [];
      let total = 0;
      for (const [path, text] of [...texts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (total >= MAX_TOTAL) break;
        const model = monaco.editor.createModel(text, 'plaintext');
        try {
          const ms = matchesIn(model);
          if (ms.length) {
            groups.push({ path, items: ms.map(m => ({ range: m.range, matches: m.matches, line: m.range.startLineNumber, text: model.getLineContent(m.range.startLineNumber), found: model.getValueInRange(m.range) })) });
            total += ms.length;
          }
        } finally { model.dispose(); }
      }
      st.groups = groups;
      if (total >= MAX_TOTAL) st.msg = T('Showing only the first {0} results.', String(MAX_TOTAL));
    } catch (e) {
      st.groups = [];
      st.msg = st.regex && e instanceof SyntaxError ? T('Invalid regular expression.') : T('Connection failure: {0}', e.message);
    }
    st.busy = false;
    render();
  }

  // ------------------------------------------------------------ replacement
  function expand(rep, matches) {
    if (!st.regex || !matches) return rep;
    return rep.replace(/\$(\d+|&|\$)/g, (m, g) => (g === '$' ? '$' : g === '&' ? matches[0] : (matches[+g] !== undefined ? matches[+g] : m)));
  }

  function openFile(path) {
    return new Promise(resolve => {
      const entry = entries().find(e => e.path === path);
      if (!entry) { resolve(false); return; }
      if (entry.id === currentFileId) { resolve(true); return; }
      if (window.Tabs) Tabs.open(entry, { pin: true }); else switchFile(entry.id, entry.path);
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (currentFileId === entry.id && (window.collabActive || Date.now() - t0 > 3000)) { clearInterval(timer); setTimeout(() => resolve(true), 200); }
        else if (Date.now() - t0 > 8000) { clearInterval(timer); resolve(false); }
      }, 150);
    });
  }

  async function replaceInCurrent(onlyRange) {
    const model = editor.getModel();
    let ms = matchesIn(model);
    if (onlyRange) ms = ms.filter(m => m.range.equalsRange(onlyRange));
    if (!ms.length) return 0;
    editor.pushUndoStop();
    editor.executeEdits('ld-replace', ms.map(m => ({ range: m.range, text: expand(st.rep, m.matches) })));
    editor.pushUndoStop();
    return ms.length;
  }

  async function replaceOne(path, item) {
    if (!(await openFile(path))) return;
    const model = editor.getModel();
    const range = model.validateRange(item.range);
    if (model.getValueInRange(range) !== item.found) { await run(); return; }   // changed since the search
    await replaceInCurrent(range);
    await saveNow();
    await run();
  }

  async function saveNow() { if (typeof saveCurrentFile === 'function') await saveCurrentFile(); }

  async function replaceAll(onlyPath) {
    const groups = st.groups.filter(g => !onlyPath || g.path === onlyPath);
    const n = groups.reduce((s, g) => s + g.items.length, 0);
    if (!n) return;
    const msg = onlyPath ? T('Replace {0} occurrence(s) in {1}?', String(n), onlyPath) : T('Replace {0} occurrence(s) in {1} file(s)? Each file can be undone with Ctrl+Z.', String(n), String(groups.length));
    if (!confirm(msg)) return;
    st.busy = true; render();
    let done = 0;
    const origin = entries().find(e => e.id === currentFileId);
    for (const g of groups) {
      if (!(await openFile(g.path))) continue;
      done += await replaceInCurrent();
      await saveNow();
    }
    if (origin && origin.id !== currentFileId) await openFile(origin.path);
    st.busy = false;
    await run();
    st.msg = T('{0} occurrence(s) replaced.', String(done));
    render();
  }

  // ------------------------------------------------------------ go to the result
  function go(path, item) {
    openFile(path).then(ok => {
      if (!ok) return;
      const r = editor.getModel().validateRange(item.range);
      editor.revealRangeInCenter(r);
      editor.setSelection(r);
      editor.focus();
    });
  }

  // ------------------------------------------------------------ panel
  function toggle(label, title, key) {
    return h('button', { class: 'srch-tog' + (st[key] ? ' on' : ''), title, onclick: () => { st[key] = !st[key]; run(); } }, label);
  }

  function preview(item) {
    const text = item.text, s = item.range.startColumn - 1;
    const e = item.range.endLineNumber === item.range.startLineNumber ? item.range.endColumn - 1 : text.length;
    const from = Math.max(0, s - 40), to = Math.min(text.length, e + 80);
    return h('span', { class: 'srch-line' }, (from > 0 ? '…' : '') + text.slice(from, s).replace(/^\s+/, ''),
      h('mark', { class: 'srch-mark' }, text.slice(s, e)), text.slice(e, to) + (to < text.length ? '…' : ''));
  }

  function render() {
    const box = $('search-container');
    if (!box) return;
    const keepScroll = box.scrollTop, activeId = document.activeElement && document.activeElement.id;
    box.textContent = '';
    inputQ = h('input', { id: 'srch-q', class: 'form-control', placeholder: T('Search in project'), value: st.q, oninput: ev => { st.q = ev.target.value; clearTimeout(run.t); run.t = setTimeout(run, 250); }, onkeydown: ev => { if (ev.key === 'Enter') run(); } });
    inputR = h('input', { id: 'srch-r', class: 'form-control', placeholder: T('Replace with'), value: st.rep, oninput: ev => { st.rep = ev.target.value; } });
    const total = st.groups.reduce((s, g) => s + g.items.length, 0);
    box.append(h('div', { class: 'srch-head' },
      h('div', { class: 'srch-row' }, inputQ, toggle('Aa', T('Match case'), 'cs'), toggle('ab', T('Whole word'), 'word'), toggle('.*', T('Regular expression'), 'regex')),
      h('div', { class: 'srch-row' }, inputR,
        h('button', { class: 'btn srch-btn', disabled: !total || st.busy, title: T('Replace all'), onclick: () => replaceAll() }, T('Replace all')))));
    if (st.busy) box.append(h('div', { class: 'cmt-empty' }, T('Searching...')));
    else {
      if (st.q && !st.msg) box.append(h('div', { class: 'srch-sum' }, total ? T('{0} result(s) in {1} file(s)', String(total), String(st.groups.length)) : T('No results.')));
      if (st.msg) box.append(h('div', { class: 'srch-sum' }, st.msg));
      st.groups.forEach(g => {
        box.append(h('div', { class: 'srch-file' },
          h('span', { class: 'srch-path' }, g.path + ' (' + g.items.length + ')'),
          h('button', { class: 'btn srch-btn', title: T('Replace in this file'), disabled: st.busy, onclick: () => replaceAll(g.path) }, '⇄')));
        g.items.forEach(item => box.append(h('div', { class: 'srch-item', onclick: () => go(g.path, item) },
          h('span', { class: 'srch-ln' }, String(item.line)), preview(item),
          h('button', { class: 'srch-one', title: T('Replace this occurrence'), onclick: ev => { ev.stopPropagation(); replaceOne(g.path, item); } }, '⇄'))));
      });
    }
    box.scrollTop = keepScroll;
    if (activeId === 'srch-q') { const i = $('srch-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    else if (activeId === 'srch-r') { const i = $('srch-r'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }

  function focus() {
    render();
    const i = $('srch-q');
    if (i) { i.focus(); i.select(); }
  }

  function open() {
    const sel = editor && editor.getSelection();
    if (sel && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber) st.q = editor.getModel().getValueInRange(sel);
    if (typeof switchTab === 'function') switchTab('search');
    focus();
    if (st.q) run();
  }

  function hook() {
    editor.addAction({ id: 'ld.search-project', label: T('Search in project'), contextMenuGroupId: 'navigation', contextMenuOrder: 1.8, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF], run: () => open() });
    window.addEventListener('ld-lang-change', render);
  }

  // outside the editor (focus on the page): the same shortcut
  document.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'f' && !(editor && editor.hasTextFocus())) { ev.preventDefault(); open(); }
  });

  window.ProjectSearch = { open, focus, run };
  if (typeof editor !== 'undefined' && editor) hook(); else window.addEventListener('editor-ready', hook, { once: true });
})();
