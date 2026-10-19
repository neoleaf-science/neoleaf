// "References" tab: searches articles in several sources (ref-sources.js) and inserts the citation in the text and the entry in the project's .bib.
// The entry is written by the editor itself (opens the .bib, edits and saves, like the project replace), so live editing,
// undo and saving keep working. The data from the sources is third-party: everything enters the page as text, never as HTML.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const PAGE = 10;
  const NEW_BIB = 'references.bib';
  const DEFAULTS = ['crossref', 'openalex', 'arxiv', 'dblp'];

  const loadSel = () => {
    try { const v = JSON.parse(localStorage.getItem('ld-refs-sources') || 'null'); if (Array.isArray(v)) return new Set(v); } catch (_) { /* use the default */ }
    return new Set(DEFAULTS);
  };
  const st = { q: '', sel: loadSel(), raw: [], results: [], status: {}, offsets: {}, busy: false, working: false, msg: '', target: '', searched: false, isDoi: false };

  const entries = () => ((window.FT && FT.entries()) || []);
  const bibEntries = () => entries().filter(e => !e.dir && /\.bib$/i.test(e.path));
  const saveSel = () => { try { localStorage.setItem('ld-refs-sources', JSON.stringify([...st.sel])); } catch (_) { /* no storage */ } };

  // ------------------------------------------------------------ search
  async function search(more) {
    const q = st.q.trim();
    if (!q || st.busy) return;
    const ids = RefSources.list.filter(s => st.sel.has(s.id)).map(s => s.id);
    if (!ids.length) { st.msg = T('Select at least one source.'); render(); return; }
    const doi = RefSources.parseDoi(q);
    const use = doi ? ids.filter(id => RefSources.list.find(s => s.id === id).doi) : ids;
    if (!use.length) { st.msg = T('To search by DOI, select Crossref, OpenAlex, Europe PMC, HAL, Zenodo or OpenAIRE.'); render(); return; }
    if (!more) { st.raw = []; st.results = []; st.status = {}; st.offsets = {}; }
    st.msg = ''; st.busy = true; st.searched = true; st.isDoi = !!doi;
    render();
    const limit = doi ? 1 : PAGE;
    const settled = await Promise.allSettled(use.map(id => RefSources.run(id, q, { limit, offset: st.offsets[id] || 0 })));
    settled.forEach((r, i) => {
      const id = use[i];
      if (r.status === 'fulfilled') {
        st.status[id] = { n: (st.status[id] ? st.status[id].n : 0) + r.value.length };
        st.offsets[id] = (st.offsets[id] || 0) + limit;
        if (!r.value.length) st.status[id].done = true;
        st.raw.push(...r.value);
      } else {
        st.status[id] = { n: st.status[id] ? st.status[id].n : 0, error: String((r.reason && r.reason.message) || r.reason) };
      }
    });
    st.results = RefSources.dedupe(st.raw);
    st.busy = false;
    render();
  }

  // ------------------------------------------------------------ the project's .bib
  function parseBib(text) {
    const out = [];
    const re = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
    const marks = [];
    let m;
    while ((m = re.exec(text))) marks.push({ type: m[1].toLowerCase(), key: m[2], at: m.index });
    marks.forEach((mk, i) => {
      if (['comment', 'string', 'preamble'].includes(mk.type)) return;
      const body = text.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : text.length);
      const doi = /\bdoi\s*=\s*[{"]?\s*(?:https?:\/\/(?:dx\.)?doi\.org\/)?([^\s,}"]+)/i.exec(body);
      const ep = /\beprint\s*=\s*[{"]?\s*([^\s,}"]+)/i.exec(body);
      out.push({ key: mk.key, doi: doi ? doi[1].toLowerCase() : '', eprint: ep ? ep[1].replace(/v\d+$/, '') : '' });
    });
    return out;
  }

  async function bibFiles() {
    const data = await Project.texts();
    const cur = entries().find(e => e.id === currentFileId);
    return (data.files || []).filter(f => /\.bib$/i.test(f.path)).map(f => {
      const text = cur && cur.path === f.path && editor ? editor.getValue() : f.text;   // what is on screen outranks the rest
      return { path: f.path, entries: parseBib(text || '') };
    });
  }

  function findExisting(item, files) {
    for (const f of files) {
      for (const e of f.entries) {
        if ((item.doi && e.doi && e.doi === item.doi) || (item.eprint && e.eprint && e.eprint === item.eprint)) return { key: e.key, path: f.path };
      }
    }
    return null;
  }

  // ------------------------------------------------------------ editing through the editor
  function openFile(path) {
    return new Promise(resolve => {
      const entry = entries().find(e => e.path === path);
      if (!entry) { resolve(false); return; }
      if (entry.id === currentFileId) { resolve(true); return; }
      if (window.Tabs) Tabs.open(entry, { pin: true }); else switchFile(entry.id, entry.path);
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (currentFileId === entry.id && (window.collabActive || Date.now() - t0 > 3000)) { clearInterval(timer); setTimeout(() => resolve(true), 200); }
        else if (Date.now() - t0 > 20000) { clearInterval(timer); resolve(false); }   // slow or busy machine: gives time to switch files
      }, 150);
    });
  }

  async function saveNow() { if (typeof saveCurrentFile === 'function') await saveCurrentFile(); }

  async function appendEntry(path, bibtex) {
    if (!entries().some(e => e.path === path)) {
      await BrowserGit.writeFile(path, '');
      await FT.refresh();
    }
    if (!(await openFile(path))) throw new Error(T('Could not open {0}.', path));
    const model = editor.getModel();
    const text = model.getValue();
    const prefix = !text ? '' : (text.endsWith('\n\n') ? '' : (text.endsWith('\n') ? '\n' : '\n\n'));
    const end = model.getFullModelRange().getEndPosition();
    editor.pushUndoStop();
    editor.executeEdits('ld-refs', [{ range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column), text: prefix + bibtex }]);
    editor.pushUndoStop();
    await saveNow();
  }

  function chooseTarget(files) {
    if (st.target && files.some(f => f.path === st.target)) return st.target;
    return files.length ? files[0].path : NEW_BIB;
  }

  async function insert(item, withCite, replace) {
    if (typeof editor === 'undefined' || !editor) return;
    if (st.working) { st.msg = T('Wait for the previous operation to finish.'); render(); return; }   // a search in progress does not prevent inserting
    st.working = true; st.msg = ''; render();
    try {
      const origin = entries().find(e => e.id === currentFileId);
      const canCite = withCite && origin && editor.getModel().getLanguageId() === 'latex';
      const pos = editor.getPosition();
      const repl = replace ? editor.getSelection() : null;   // passage (a selected DOI) that the citation replaces
      const files = await bibFiles();
      const dup = findExisting(item, files);
      let key, note;
      if (dup) {
        key = dup.key;
        note = T('Already in {0}.', dup.path);
      } else {
        const taken = new Set(files.flatMap(f => f.entries.map(e => e.key)));
        key = RefSources.uniqueKey(item, taken);
        const target = chooseTarget(files);
        await appendEntry(target, RefSources.toBibtex(item, key));
        note = T('Added to {0}.', target);
      }
      if (canCite) {
        if (!(await openFile(origin.path))) throw new Error(T('Could not go back to {0}.', origin.path));
        const p = editor.getModel().validatePosition(pos);
        const cite = '\\cite{' + key + '}';
        const range = repl && !repl.isEmpty() ? editor.getModel().validateRange(repl) : new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column);
        editor.pushUndoStop();
        editor.executeEdits('ld-refs', [{ range, text: cite }]);
        editor.pushUndoStop();
        editor.setPosition({ lineNumber: range.startLineNumber, column: range.startColumn + cite.length });
        editor.focus();
        await saveNow();
        note += ' ' + T('Inserted in the text: {0}', cite);
      } else {
        if (withCite) note += ' ' + T('\\cite is only inserted in LaTeX files; use the key {0}.', key);
        if (origin && currentEntryPath() !== origin.path) await openFile(origin.path);   // the .bib stayed open: go back to the origin file
      }
      st.msg = note;
    } catch (e) {
      st.msg = T('Could not insert: {0}', e.message);
    }
    st.working = false;
    render();
  }
  const currentEntryPath = () => { const e = entries().find(x => x.id === currentFileId); return e ? e.path : ''; };

  async function copyBibtex(item) {
    try {
      const files = await bibFiles();
      const dup = findExisting(item, files);
      const taken = new Set(files.flatMap(f => f.entries.map(e => e.key)));
      const bib = RefSources.toBibtex(item, dup ? dup.key : RefSources.uniqueKey(item, taken));
      let ok = false;
      try { await navigator.clipboard.writeText(bib); ok = true; } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = bib; document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch (_e) { ok = false; }
        ta.remove();
      }
      st.msg = ok ? T('BibTeX copied.') : T('Could not copy.');
    } catch (e) { st.msg = T('Could not copy.'); }
    render();
  }

  async function findPdf(item) {
    if (st.working) return;
    st.working = true; st.msg = T('Looking for the open-access PDF...'); render();
    try {
      const url = await RefSources.openPdf(item.doi);
      if (url) { item.pdf = url; st.msg = ''; } else st.msg = T('No open-access PDF found for this DOI.');
    } catch (e) { st.msg = T('Could not query Unpaywall: {0}', e.message); }
    st.working = false; render();
  }

  // ------------------------------------------------------------ panel
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const link = (text, url, cls) => h('a', { class: cls || '', href: url, target: '_blank', rel: 'noopener noreferrer' }, text);

  function card(item) {
    const authors = item.authors.length > 4 ? item.authors.slice(0, 4).join('; ') + ' ' + T('et al.') : item.authors.join('; ');
    const meta = [item.venue, item.year ? String(item.year) : ''].filter(Boolean).join(', ');
    const url = item.url || (item.doi ? 'https://doi.org/' + item.doi : '');
    const actions = [
      h('button', { class: 'btn refs-btn primary', disabled: st.working, title: T('Adds the entry to the .bib and inserts the \\cite at the cursor'), onclick: () => insert(item, true) }, '\\cite'),
      h('button', { class: 'btn refs-btn', disabled: st.working, title: T('Adds only the entry to the .bib'), onclick: () => insert(item, false) }, T('Add to .bib')),
      h('button', { class: 'btn refs-btn', disabled: st.working, title: T('Copies the BibTeX entry'), onclick: () => copyBibtex(item) }, 'BibTeX'),
    ];
    if (item.pdf) actions.push(link('PDF', item.pdf, 'btn refs-btn'));
    else if (item.doi) actions.push(h('button', { class: 'btn refs-btn', disabled: st.working, title: T('Looks for an open-access PDF (Unpaywall)'), onclick: () => findPdf(item) }, T('Open PDF?')));
    const kids = [
      h('div', { class: 'refs-title' }, url ? link(item.title, url) : item.title),
      h('div', { class: 'refs-authors' }, authors || T('(no authors)')),
      h('div', { class: 'refs-meta' }, [meta, item.doi ? 'DOI ' + item.doi : '', item.sources.join(' + ')].filter(Boolean).join(' · ')),
    ];
    if (item.abstract) kids.push(h('details', { class: 'refs-abs' }, h('summary', {}, T('Abstract')), h('p', {}, trunc(item.abstract, 1500))));
    kids.push(h('div', { class: 'refs-actions' }, ...actions));
    return h('div', { class: 'refs-card' }, ...kids);
  }

  function render() {
    const box = $('refs-container');
    if (!box) return;
    const keepScroll = box.scrollTop, hadFocus = document.activeElement && document.activeElement.id === 'refs-q';
    box.textContent = '';
    const input = h('input', {
      id: 'refs-q', class: 'form-control', placeholder: T('Title, authors, subject or DOI'), value: st.q,
      oninput: ev => { st.q = ev.target.value; }, onkeydown: ev => { if (ev.key === 'Enter') search(false); },
    });
    const chips = RefSources.list.map(s => h('button', {
      class: 'refs-chip' + (st.sel.has(s.id) ? ' on' : ''), title: s.direct ? s.name : s.name + ' ' + T('(goes through the NeoLeaf server, nothing is stored)'),
      onclick: () => { if (st.sel.has(s.id)) st.sel.delete(s.id); else st.sel.add(s.id); saveSel(); render(); },
    }, s.name));
    const bibs = bibEntries();
    const target = h('select', { id: 'refs-target', class: 'theme-select refs-target', title: T('The .bib file that receives the entries'), onchange: ev => { st.target = ev.target.value; } },
      ...(bibs.length ? bibs.map(b => h('option', { value: b.path, selected: (st.target || bibs[0].path) === b.path }, b.path)) : [h('option', { value: NEW_BIB }, NEW_BIB + ' ' + T('(will be created)'))]));
    box.append(h('div', { class: 'refs-head' },
      h('div', { class: 'refs-row' }, input, h('button', { class: 'btn refs-btn primary', disabled: st.busy || !st.q.trim(), onclick: () => search(false) }, T('Search'))),
      h('div', { class: 'refs-chips' }, ...chips),
      h('div', { class: 'refs-row' }, h('span', { class: 'refs-lbl' }, T('Save to')), target)));
    if (st.msg) box.append(h('div', { class: 'refs-msg' }, st.msg));
    if (st.busy) box.append(h('div', { class: 'cmt-empty' }, T('Searching...')));
    const names = Object.fromEntries(RefSources.list.map(s => [s.id, s.name]));
    const lines = Object.keys(st.status).map(id => st.status[id].error ? names[id] + ': ' + T('error') + ' (' + st.status[id].error + ')' : names[id] + ': ' + st.status[id].n);
    if (lines.length) box.append(h('div', { class: 'refs-status' }, lines.join(' · ')));
    if (st.searched && !st.busy && !st.results.length) box.append(h('div', { class: 'cmt-empty' }, T('No results.')));
    st.results.forEach(it => box.append(card(it)));
    const canMore = !st.isDoi && !st.busy && st.results.length && Object.keys(st.status).some(id => !st.status[id].error && !st.status[id].done);
    if (canMore) box.append(h('button', { class: 'btn refs-more', onclick: () => search(true) }, T('More results')));
    box.scrollTop = keepScroll;
    if (hadFocus) { const i = $('refs-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }

  function focus() {
    render();
    const i = $('refs-q');
    if (i) { i.focus(); i.select(); }
  }

  function open() {
    const sel = editor && editor.getSelection();
    if (sel && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber) st.q = editor.getModel().getValueInRange(sel).slice(0, 200);
    if (typeof switchTab === 'function') switchTab('refs');
    focus();
    if (st.q.trim()) search(false);
  }

  // ------------------------------------------------------------ editor menu
  const bibLang = () => editor.getModel() && editor.getModel().getLanguageId() === 'bibtex';

  function flash(msg) {
    const d = h('div', { class: 'refs-toast' }, msg);
    document.body.append(d);
    setTimeout(() => d.remove(), 3200);
  }

  // value of a BibTeX field (with balanced braces), without braces or escapes
  function fieldOf(body, name) {
    const m = new RegExp('\\b' + name + '\\s*=\\s*', 'i').exec(body);
    if (!m) return '';
    let i = m.index + m[0].length, out = '';
    const c = body[i];
    if (c === '{') {
      let d = 0;
      for (; i < body.length; i++) {
        const ch = body[i];
        if (ch === '{') { d++; if (d === 1) continue; } else if (ch === '}') { d--; if (d === 0) break; }
        out += ch;
      }
    } else if (c === '"') {
      for (i++; i < body.length && body[i] !== '"'; i++) out += body[i];
    } else {
      for (; i < body.length && !/[,\s}]/.test(body[i]); i++) out += body[i];
    }
    return out.replace(/\\([&%#_$])/g, '$1').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  }

  // the entry the cursor is in (in an open .bib)
  function entryAt(model, pos) {
    const text = model.getValue(), at = model.getOffsetAt(pos);
    const re = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
    const marks = [];
    let m;
    while ((m = re.exec(text))) if (!['comment', 'string', 'preamble'].includes(m[1].toLowerCase())) marks.push({ key: m[2], at: m.index });
    let cur = null, next = text.length;
    for (let i = 0; i < marks.length; i++) { if (marks[i].at <= at) { cur = marks[i]; next = i + 1 < marks.length ? marks[i + 1].at : text.length; } }
    return cur ? { key: cur.key, body: text.slice(cur.at, next) } : null;
  }

  const doiOfBody = body => RefSources.normDoi(fieldOf(body, 'doi')) || RefSources.normDoi(fieldOf(body, 'url'));

  // citation key under the cursor or selected, if it exists in any .bib of the project
  function citeKeyAt() {
    const model = editor.getModel(), keys = (window.LD && LD.bibKeys) || [];
    if (!model || !keys.length || bibLang()) return '';
    const sel = editor.getSelection();
    if (sel && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber) {
      const t = model.getValueInRange(sel).trim();
      return keys.includes(t) ? t : '';
    }
    const pos = editor.getPosition(), line = model.getLineContent(pos.lineNumber);
    const re = /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\[[^\]]*\])*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(line))) {
      const start = m.index + m[0].indexOf('{') + 1;
      if (pos.column - 1 < start || pos.column - 1 > start + m[1].length) continue;
      let off = start;
      for (const part of m[1].split(',')) {
        const lead = part.length - part.trimStart().length, k = part.trim();
        if (pos.column - 1 >= off && pos.column - 1 <= off + part.length) return keys.includes(k) ? k : '';
        off += part.length + 1;
      }
    }
    return '';
  }

  async function findEntry(key) {
    const data = await Project.texts();
    const cur = entries().find(e => e.id === currentFileId);
    for (const f of (data.files || []).filter(x => /\.bib$/i.test(x.path))) {
      const text = cur && cur.path === f.path ? editor.getValue() : f.text;
      const m = new RegExp('@\\w+\\s*[{(]\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*,').exec(text || '');
      if (m) {
        const rest = (text || '').slice(m.index + 1).search(/\n\s*@\w+\s*[{(]/);
        return { path: f.path, line: (text.slice(0, m.index).match(/\n/g) || []).length + 1, key, body: (text || '').slice(m.index, rest < 0 ? undefined : m.index + 1 + rest) };
      }
    }
    return null;
  }

  async function goToEntry(key) {
    const e = await findEntry(key);
    if (!e) { flash(T('Entry not found: {0}', key)); return; }
    if (!(await openFile(e.path))) return;
    editor.revealLineInCenter(e.line);
    editor.setPosition({ lineNumber: e.line, column: 1 });
    editor.focus();
  }

  function openDoi(doi) {
    if (!doi) { flash(T('This entry has no DOI or DOI URL.')); return; }
    window.open('https://doi.org/' + doi, '_blank', 'noopener,noreferrer');
  }

  async function openPdfOf(doi) {
    if (!doi) { flash(T('This entry has no DOI or DOI URL.')); return; }
    flash(T('Looking for the open-access PDF...'));
    try {
      const url = await RefSources.openPdf(doi);
      if (url) window.open(url, '_blank', 'noopener,noreferrer'); else flash(T('No open-access PDF found for this DOI.'));
    } catch (e) { flash(T('Could not query Unpaywall: {0}', e.message)); }
  }

  async function addByDoi(doi) {
    flash(T('Looking up the DOI on Crossref...'));
    try {
      const items = RefSources.dedupe(await RefSources.run('crossref', doi, { limit: 1, offset: 0 }));
      if (!items.length) { flash(T('DOI not found on Crossref.')); return; }
      await insert(items[0], true, true);
      if (st.msg) flash(st.msg);
    } catch (e) { flash(T('Could not look up the DOI: {0}', e.message)); }
  }

  const selectedText = () => {
    const sel = editor.getSelection();
    return sel && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber ? editor.getModel().getValueInRange(sel).trim() : '';
  };

  function hook() {
    const kDoi = editor.createContextKey('ldSelectionIsDoi', false);
    const kCite = editor.createContextKey('ldCiteKeyAtCursor', false);
    const update = () => { const t = selectedText(); kDoi.set(!!t && !!RefSources.parseDoi(t)); kCite.set(!!citeKeyAt()); };
    editor.onDidChangeCursorSelection(update);
    editor.onDidChangeModel(update);
    const menu = (id, label, order, precondition, run, keybindings) => editor.addAction({
      id, label, precondition, keybindings, run, ...(order ? { contextMenuGroupId: 'navigation', contextMenuOrder: order } : {}),
    });
    // selected text
    menu('ld.refs', T('Search references for the selected text'), 1.9, 'editorHasSelection && editorLangId != bibtex', () => open());
    menu('ld.refs-open', T('Open the References tab'), 0, null, () => open(), [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyR]);
    menu('ld.refs-doi-add', T('Add this reference by DOI'), 1.91, 'ldSelectionIsDoi', () => addByDoi(RefSources.parseDoi(selectedText())));
    menu('ld.refs-doi-open', T('Open this DOI'), 1.92, 'ldSelectionIsDoi', () => openDoi(RefSources.parseDoi(selectedText())));
    // citation key
    menu('ld.refs-key-go', T('Go to the entry in the .bib'), 1.93, 'ldCiteKeyAtCursor', () => goToEntry(citeKeyAt()));
    menu('ld.refs-key-doi', T('Open this reference\'s DOI'), 1.94, 'ldCiteKeyAtCursor', async () => { const e = await findEntry(citeKeyAt()); openDoi(e && doiOfBody(e.body)); });
    menu('ld.refs-key-pdf', T('Look for this reference\'s open-access PDF'), 1.95, 'ldCiteKeyAtCursor', async () => { const e = await findEntry(citeKeyAt()); openPdfOf(e && doiOfBody(e.body)); });
    // inside a .bib
    const inBib = 'editorLangId == bibtex';
    menu('ld.bib-search', T('Search this paper online'), 1.9, inBib, () => {
      const e = entryAt(editor.getModel(), editor.getPosition());
      if (!e) { flash(T('Place the cursor inside an entry.')); return; }
      st.q = (fieldOf(e.body, 'title') || e.key).slice(0, 200);
      if (typeof switchTab === 'function') switchTab('refs');
      focus();
      search(false);
    });
    menu('ld.bib-doi', T('Open this entry\'s DOI'), 1.91, inBib, () => { const e = entryAt(editor.getModel(), editor.getPosition()); openDoi(e && doiOfBody(e.body)); });
    menu('ld.bib-pdf', T('Look for this entry\'s open-access PDF'), 1.92, inBib, () => { const e = entryAt(editor.getModel(), editor.getPosition()); openPdfOf(e && doiOfBody(e.body)); });
    menu('ld.bib-cite', T('Copy \\cite{key}'), 1.93, inBib, async () => {
      const e = entryAt(editor.getModel(), editor.getPosition());
      if (!e) { flash(T('Place the cursor inside an entry.')); return; }
      try { await navigator.clipboard.writeText('\\cite{' + e.key + '}'); flash(T('Copied: {0}', '\\cite{' + e.key + '}')); } catch (_) { flash(T('Could not copy.')); }
    });
    window.addEventListener('ld-lang-change', render);
    update();
  }

  window.References = { open, focus, search: () => search(false), entryAt, fieldOf };
  if (typeof editor !== 'undefined' && editor) hook(); else window.addEventListener('editor-ready', hook, { once: true });
})();
