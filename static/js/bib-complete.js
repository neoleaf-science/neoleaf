// Complete and normalize BibTeX entries from their DOI. Works on the open .bib file and always shows what would change before touching it.
// Crossref (then OpenAlex) are asked from the browser, with the DOI only: nothing of the project is sent (see ref-sources.js).
//
// What a change can be, per field of an entry:
//   add        the field is missing and the registry has it                                   (ticked)
//   normalize  the value is right but badly written: pages "12-15" -> "12--15", a doi written (ticked)
//              as a link, a url that only repeats the doi (removed)
//   change     the field has a value that differs from the registry's                         (not ticked: your value stays unless you say so)
// Only the chosen fields are edited, in place: layout, comments and citation keys stay as they are (renaming a key would break the \cite commands).
(function () {
  'use strict';

  const CONCURRENCY = 3;
  const FIELDS = ['author', 'title', 'journal', 'booktitle', 'year', 'volume', 'number', 'pages', 'publisher', 'doi'];

  // ------------------------------------------------------------ reading a .bib

  // Every @entry of `text` with the position of each field. Offsets are in UTF-16 units of `text` (what Monaco uses).
  function parseEntries(text) {
    const out = [];
    const re = /@([A-Za-z]+)\s*([{(])/g;
    let m;
    while ((m = re.exec(text))) {
      const type = m[1].toLowerCase();
      const open = m[2];
      const close = open === '{' ? '}' : ')';
      const bodyStart = m.index + m[0].length;
      if (type === 'comment' || type === 'string' || type === 'preamble') { re.lastIndex = skipBlock(text, bodyStart, open, close); continue; }
      const entry = readEntry(text, m.index, type, bodyStart, close);
      if (!entry) { re.lastIndex = bodyStart; continue; }
      out.push(entry);
      re.lastIndex = entry.end;
    }
    return out;
  }

  // index just after the block that starts at `i` (balanced braces)
  function skipBlock(text, i, open, close) {
    let depth = 1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') i++;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) return i + 1;
    }
    return text.length;
  }

  const isSpace = c => c === ' ' || c === '\t' || c === '\n' || c === '\r';

  function readEntry(text, at, type, i, close) {
    const n = text.length;
    const skipWs = () => { while (i < n && isSpace(text[i])) i++; };
    skipWs();
    const keyStart = i;
    while (i < n && text[i] !== ',' && text[i] !== close && !isSpace(text[i])) i++;
    const key = text.slice(keyStart, i);
    if (!key) return null;
    skipWs();
    const entry = { type: type, key: key, start: at, fields: [], afterKey: i, close: -1, end: n };
    if (text[i] === ',') i++;
    for (;;) {
      skipWs();
      if (i >= n) return entry;
      if (text[i] === close) { entry.close = i; entry.end = i + 1; return entry; }
      if (text[i] === ',') { i++; continue; }
      const nameStart = i;
      while (i < n && /[A-Za-z0-9_:\-.]/.test(text[i])) i++;
      if (i === nameStart) return entry; // something we cannot read: stop here, the rest is left alone
      const name = text.slice(nameStart, i).toLowerCase();
      skipWs();
      if (text[i] !== '=') return entry;
      i++;
      skipWs();
      const valueStart = i;
      let delim = '';
      let inner = '';
      if (text[i] === '{') {
        delim = '{';
        let depth = 0;
        for (; i < n; i++) {
          const c = text[i];
          if (c === '\\') { i++; continue; }
          if (c === '{') depth++;
          else if (c === '}' && --depth === 0) { i++; break; }
        }
        inner = text.slice(valueStart + 1, i - 1);
      } else if (text[i] === '"') {
        delim = '"';
        let depth = 0;
        for (i++; i < n; i++) {
          const c = text[i];
          if (c === '\\') { i++; continue; }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '"' && depth === 0) { i++; break; }
        }
        inner = text.slice(valueStart + 1, i - 1);
      } else {
        while (i < n && text[i] !== ',' && text[i] !== close && !isSpace(text[i])) i++;
        inner = text.slice(valueStart, i);
      }
      // a concatenation (a # b) is left alone: it is not one plain value
      const probe = i;
      let j = probe;
      while (j < n && isSpace(text[j])) j++;
      const concat = text[j] === '#';
      entry.fields.push({ name: name, nameStart: nameStart, valueStart: valueStart, valueEnd: i, delim: delim, value: inner, concat: concat });
      if (concat) {
        // skip to the comma that ends the field
        let depth = 0;
        for (; i < n; i++) {
          const c = text[i];
          if (c === '\\') { i++; continue; }
          if (c === '{') depth++;
          else if (c === '}') { if (depth === 0) break; depth--; } else if (c === ',' && depth === 0) break;
        }
        entry.fields[entry.fields.length - 1].valueEnd = i;
      }
    }
  }

  // ------------------------------------------------------------ comparing

  const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\\[A-Za-z]+\s*/g, '').replace(/[{}\\$]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  const doiOf = entry => {
    const get = name => { const f = entry.fields.find(x => x.name === name && !x.concat); return f ? f.value : ''; };
    return RefSources.normDoi(get('doi')) || RefSources.normDoi(get('url'));
  };
  const fieldOf = (entry, name) => entry.fields.find(f => f.name === name);

  // ------------------------------------------------------------ what to change

  // One change: { entry, field, kind: 'add'|'normalize'|'change'|'remove', before, after, checked }
  function offlineChanges(entry) {
    const out = [];
    const pages = fieldOf(entry, 'pages');
    if (pages && !pages.concat && /\d\s*[-–—]\s*\d/.test(pages.value) && !/--/.test(pages.value)) {
      const after = pages.value.replace(/\s*[-–—]+\s*/g, '--');
      if (after !== pages.value) out.push({ field: 'pages', kind: 'normalize', before: pages.value, after: after, checked: true });
    }
    const doi = fieldOf(entry, 'doi');
    if (doi && !doi.concat) {
      const clean = RefSources.parseDoi(doi.value);
      if (clean && clean !== doi.value.trim()) out.push({ field: 'doi', kind: 'normalize', before: doi.value, after: clean, checked: true });
    }
    const url = fieldOf(entry, 'url');
    const d = RefSources.normDoi(doi ? doi.value : '');
    if (url && !url.concat && d && RefSources.normDoi(url.value) === d && /doi\.org/i.test(url.value)) {
      out.push({ field: 'url', kind: 'remove', before: url.value, after: '', checked: true });
    }
    return out;
  }

  // The fields the registry would write for this item, read back from the BibTeX that the References tab already builds (same escaping, same rules)
  function wantedFields(item) {
    const entry = parseEntries(RefSources.toBibtex(item, 'k'))[0];
    const map = {};
    if (entry) for (const f of entry.fields) if (FIELDS.includes(f.name) && f.value) map[f.name] = f.value;
    return { type: entry ? entry.type : '', fields: map };
  }

  function registryChanges(entry, item) {
    const want = wantedFields(item);
    const out = [];
    const sameKind = new Set(['journal', 'booktitle']);
    for (const name of FIELDS) {
      const after = want.fields[name];
      if (!after) continue;
      if (sameKind.has(name)) {
        // an article has a journal, a paper in proceedings a booktitle: if the entry already says the other one, leave it
        const other = name === 'journal' ? 'booktitle' : 'journal';
        if (fieldOf(entry, other) && !fieldOf(entry, name)) continue;
      }
      const cur = fieldOf(entry, name);
      if (cur && cur.concat) continue;
      if (!cur || !cur.value.trim()) { out.push({ field: name, kind: 'add', before: '', after: after, checked: true }); continue; }
      if (name === 'doi' || name === 'pages') continue; // handled as normalization; the stored value is the person's
      if (plain(cur.value) === plain(after)) continue;
      if (name === 'year' && String(cur.value).trim() === String(after).trim()) continue;
      out.push({ field: name, kind: 'change', before: cur.value, after: after, checked: false });
    }
    return out;
  }

  // ------------------------------------------------------------ asking the registries

  const cache = new Map(); // doi -> Promise<item|null>

  async function lookup(doi) {
    if (cache.has(doi)) return cache.get(doi);
    const p = (async () => {
      let lastError = null;
      for (const id of ['crossref', 'openalex']) {
        try {
          const items = await RefSources.run(id, doi, { limit: 1, offset: 0 });
          if (items[0]) return { item: items[0], source: items[0].source };
        } catch (e) { lastError = e; }
      }
      return { item: null, error: lastError ? lastError.message : '' };
    })();
    cache.set(doi, p);
    return p;
  }

  async function pool(list, worker, progress) {
    let next = 0;
    let done = 0;
    const run = async () => {
      while (next < list.length) {
        const i = next++;
        await worker(list[i], i);
        progress(++done, list.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, run));
  }

  // Looks at the entries and returns { rows: [{ entry, source, changes[] }], skipped: [{ key, why }] }
  async function plan(entries, progress, useNetwork) {
    const rows = [];
    const skipped = [];
    const todo = [];
    for (const e of entries) {
      const doi = doiOf(e);
      if (doi && useNetwork) todo.push({ entry: e, doi: doi });
      else {
        const ch = offlineChanges(e);
        if (ch.length) rows.push({ entry: e, source: '', changes: ch });
        else if (!doi) skipped.push({ key: e.key, why: T('no DOI') });
      }
    }
    const looked = new Array(todo.length);
    await pool(todo, async (t, i) => { looked[i] = await lookup(t.doi); }, progress);
    todo.forEach((t, i) => {
      const r = looked[i];
      const changes = offlineChanges(t.entry);
      if (r && r.item) {
        const have = new Set(changes.map(c => c.field));
        for (const c of registryChanges(t.entry, r.item)) if (!have.has(c.field)) changes.push(c);
      } else {
        skipped.push({ key: t.entry.key, why: r && r.error ? T('could not be looked up ({0})', r.error) : T('DOI not found') });
      }
      if (changes.length) rows.push({ entry: t.entry, source: r && r.source ? r.source : '', changes: changes });
    });
    rows.sort((a, b) => a.entry.start - b.entry.start);
    return { rows: rows, skipped: skipped };
  }

  // ------------------------------------------------------------ editing

  const braced = v => '{' + v + '}';

  // The text edits (offsets in `text`) for the ticked changes of the rows
  function buildEdits(text, rows) {
    const edits = [];
    for (const row of rows) {
      const e = row.entry;
      const add = [];
      for (const c of row.changes) {
        if (!c.checked) continue;
        const f = fieldOf(e, c.field);
        if (c.kind === 'add') {
          if (f && !f.concat) edits.push({ start: f.valueStart, end: f.valueEnd, text: braced(c.after) });
          else add.push(c);
        } else if (c.kind === 'remove') {
          if (!f) continue;
          let a = f.nameStart;
          let b = f.valueEnd;
          while (a > 0 && (text[a - 1] === ' ' || text[a - 1] === '\t')) a--;
          if (a > 0 && text[a - 1] === '\n') a--;
          while (b < text.length && (text[b] === ' ' || text[b] === '\t')) b++;
          if (text[b] === ',') b++;
          edits.push({ start: a, end: b, text: '' });
        } else if (f) {
          edits.push({ start: f.valueStart, end: f.valueEnd, text: braced(c.after) });
        }
      }
      if (add.length) {
        const last = e.fields[e.fields.length - 1];
        const lineStart = last ? text.lastIndexOf('\n', last.nameStart) + 1 : 0;
        const indent = last && /^[ \t]*$/.test(text.slice(lineStart, last.nameStart)) ? text.slice(lineStart, last.nameStart) : '  ';
        const lines = add.map(c => `${indent}${c.field} = ${braced(c.after)}`);
        if (last) edits.push({ start: last.valueEnd, end: last.valueEnd, text: ',\n' + lines.join(',\n') });
        else edits.push({ start: e.afterKey, end: e.afterKey, text: ',\n' + lines.join(',\n') });
      }
    }
    return edits;
  }

  function apply(rows) {
    const model = editor.getModel();
    const text = model.getValue();
    const edits = buildEdits(text, rows).sort((a, b) => b.start - a.start);
    if (!edits.length) return 0;
    editor.pushUndoStop();
    editor.executeEdits('bib-complete', edits.map(x => {
      const a = model.getPositionAt(x.start);
      const b = model.getPositionAt(x.end);
      return { range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column), text: x.text };
    }));
    editor.pushUndoStop();
    return edits.length;
  }

  // ------------------------------------------------------------ the window

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }

  const KIND = () => ({ add: T('add'), normalize: T('fix'), remove: T('remove'), change: T('replace') });

  function show(result, scopeLabel) {
    document.getElementById('bibc-modal') && document.getElementById('bibc-modal').remove();
    const total = result.rows.reduce((n, r) => n + r.changes.length, 0);
    const count = el('span', { class: 'bibc-count' });
    const refresh = () => {
      const n = result.rows.reduce((s, r) => s + r.changes.filter(c => c.checked).length, 0);
      count.textContent = T('{0} of {1} changes selected', n, total);
      ok.disabled = n === 0;
    };
    const close = () => modal.remove();
    const ok = el('button', { class: 'btn btn-primary', type: 'button', id: 'bibc-apply', onclick: () => {
      const n = apply(result.rows);
      close();
      if (typeof updateStatus === 'function') updateStatus('saved', T('{0} bibliography changes applied', n));
    } }, T('Apply'));

    const body = el('div', { class: 'bibc-list' });
    if (!result.rows.length) body.append(el('p', { class: 'bibc-empty' }, T('Nothing to complete or fix: the entries are already complete.')));
    for (const row of result.rows) {
      const box = el('div', { class: 'bibc-entry' },
        el('div', { class: 'bibc-head' }, el('code', {}, row.entry.key), row.source ? el('span', { class: 'bibc-src' }, row.source) : null));
      for (const c of row.changes) {
        const cb = el('input', { type: 'checkbox', 'data-field': c.field, 'data-key': row.entry.key });
        cb.checked = !!c.checked;
        cb.addEventListener('change', () => { c.checked = cb.checked; refresh(); });
        const change = el('span', { class: 'bibc-change' },
          c.before ? el('del', {}, c.before) : null,
          c.before && c.after ? ' → ' : null,
          c.after ? el('ins', {}, c.after) : null);
        box.append(el('label', { class: 'bibc-row bibc-' + c.kind }, cb, el('span', { class: 'bibc-kind' }, KIND()[c.kind]), el('b', {}, c.field), change));
      }
      body.append(box);
    }
    if (result.skipped.length) {
      body.append(el('div', { class: 'bibc-skipped' }, el('b', {}, T('Skipped')), ': ',
        result.skipped.map(s => s.key + ' (' + s.why + ')').join(', ')));
    }

    const modal = el('div', { class: 'modal-backdrop', id: 'bibc-modal', style: 'display:flex;' },
      el('div', { class: 'modal-box bibc-box' },
        el('h3', { class: 'bibc-title' }, T('Complete bibliography'), scopeLabel ? ' · ' + scopeLabel : ''),
        el('p', { class: 'modal-hint' }, T('Only the ticked changes are made. Values you wrote stay unless you tick a replacement. Citation keys never change.')),
        body,
        el('div', { class: 'bibc-foot' }, count, el('span', { style: 'flex:1' }),
          el('button', { class: 'btn', type: 'button', onclick: close }, T('Cancel')), ok)));
    modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
    document.body.append(modal);
    refresh();
  }

  function busy(text) {
    if (typeof updateStatus === 'function') updateStatus('saving', text);
  }

  // ------------------------------------------------------------ entry points

  async function run(all) {
    const model = editor.getModel();
    if (!model || model.getLanguageId() !== 'bibtex') return;
    const text = model.getValue();
    let entries = parseEntries(text);
    let label = '';
    if (!all) {
      const at = model.getOffsetAt(editor.getPosition());
      const cur = entries.filter(e => e.start <= at).pop();
      if (!cur || at > cur.end) { if (typeof updateStatus === 'function') updateStatus('error', T('Place the cursor inside an entry.')); return; }
      entries = [cur];
      label = cur.key;
    } else {
      label = T('{0} entries', entries.length);
    }
    if (!entries.length) { if (typeof updateStatus === 'function') updateStatus('error', T('This file has no entries.')); return; }
    busy(T('Looking up the DOIs...'));
    let result;
    try {
      result = await plan(entries, (d, n) => busy(T('Looking up the DOIs... {0} of {1}', d, n)), true);
    } catch (e) {
      if (typeof updateStatus === 'function') updateStatus('error', T('Could not complete the bibliography: {0}', e.message));
      return;
    }
    if (model.getValue() !== text) { if (typeof updateStatus === 'function') updateStatus('error', T('The file changed while the DOIs were being looked up. Try again.')); return; }
    if (typeof updateStatus === 'function') updateStatus('saved', T('Ready'));
    show(result, label);
  }

  function hook() {
    const inBib = 'editorLangId == bibtex';
    editor.addAction({ id: 'ld.bib-complete', label: T('Complete this entry from its DOI...'), precondition: inBib, contextMenuGroupId: 'navigation', contextMenuOrder: 1.94, run: () => run(false) });
    editor.addAction({ id: 'ld.bib-complete-all', label: T('Complete all entries from their DOIs...'), precondition: inBib, contextMenuGroupId: 'navigation', contextMenuOrder: 1.95, run: () => run(true) });
  }

  window.BibComplete = { parseEntries, plan, buildEdits, offlineChanges, registryChanges, run, show };
  if (typeof editor !== 'undefined' && editor) hook(); else window.addEventListener('editor-ready', hook, { once: true });
})();
