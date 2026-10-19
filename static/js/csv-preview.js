// CSV and TSV (.csv, .tsv) preview as a table, in the "Preview" tab: sticky header, sort by column, row filter,
// row limit with "show more" and copy as LaTeX `tabular`. All in the browser, no server. Preview only: editing happens in the text.
//
// Security (the file may come from collaborators): PapaParse and the table run INSIDE a sandboxed iframe (isolated origin, no access to the
// page or the session token), with a content security policy (CSP) that only accepts our script (by nonce). Cells always go in as
// text (textContent), never as HTML. The library (static/vendor/papaparse.min.js, ~19 KB) is only downloaded the first time.

(function () {
  'use strict';

  const THEME_VARS = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--text-primary', '--text-bright', '--muted', '--border-color', '--link', '--accent-color'];
  const MAX_CHARS = 8 * 1024 * 1024;   // above this the preview does not try to read it
  const tr = t => (window.T ? window.T(t) : t);

  let frame = null, bar = null, frameReady = false, libReady = false, libText = null, libPromise = null, timer = null, copyTimer = null;
  let pending = null;
  const opts = { delimiter: '', header: true, filter: '' };

  const isCsv = () => typeof editor !== 'undefined' && editor && editor.getModel() && editor.getModel().getLanguageId() === 'csv';

  function loadLib() {
    if (!libPromise) {
      libPromise = fetch('/static/vendor/papaparse.min.js?v=5.7.0')
        .then(r => { if (!r.ok) throw new Error('papaparse'); return r.text(); })
        .then(t => { libText = t; })
        .catch(e => { libPromise = null; throw e; });
    }
    return libPromise;
  }

  function themeVars() {
    const cs = getComputedStyle(document.documentElement);
    const vars = {};
    for (const k of THEME_VARS) vars[k] = cs.getPropertyValue(k).trim();
    return vars;
  }

  // ---- isolated frame
  function shell() {
    const nonce = btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(18))));
    const css = `
      :root { color-scheme: light dark; }
      body { margin: 0; background: var(--bg-primary); color: var(--text-primary); font: 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .wrap { overflow: auto; height: 100vh; }
      table { border-collapse: separate; border-spacing: 0; min-width: 100%; }
      th, td { border-right: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); padding: 5px 10px; text-align: left; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      th { position: sticky; top: 0; z-index: 1; background: var(--bg-secondary); color: var(--text-bright); cursor: pointer; user-select: none; }
      th:hover { background: var(--bg-tertiary); }
      th.num, td.num { text-align: right; }
      th.idx, td.idx { position: sticky; left: 0; background: var(--bg-secondary); color: var(--muted); text-align: right; cursor: default; max-width: none; }
      th.idx { z-index: 2; }
      tbody tr:nth-child(2n) td:not(.idx) { background: color-mix(in srgb, var(--bg-secondary) 55%, transparent); }
      tbody tr:hover td { background: var(--bg-tertiary); }
      .arrow { color: var(--accent-color); margin-left: 4px; }
      .msg { color: var(--muted); text-align: center; margin: 3em 1em; }
      .more { display: block; margin: 12px auto 18px; padding: 6px 14px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font: inherit; }
      .more:hover { background: var(--bg-tertiary); }
    `;
    const script = `
      const nonce = ${JSON.stringify(nonce)};
      const post = m => parent.postMessage(Object.assign({ neoleafCsv: true }, m), '*');
      const wrap = document.getElementById('wrap');
      const PAGE = 2000;
      let ready = false, rows = [], head = [], cols = 0, delim = '', sortCol = -1, sortDir = 1, filter = '', limit = PAGE, hasHeader = true, numeric = [];
      const L = ${JSON.stringify({
        empty: tr('Empty file'), big: tr('File too large to preview'), more: tr('Show more rows'), noMatch: tr('No row matches the filter'),
      })};
      const msg = text => { wrap.innerHTML = ''; const p = document.createElement('p'); p.className = 'msg'; p.textContent = text; wrap.appendChild(p); post({ info: null }); };
      const isNum = v => /^\\s*-?\\d+(?:[.,]\\d+)?\\s*$/.test(v);
      const numVal = v => parseFloat(String(v).replace(',', '.'));

      function load(text, d, header) {
        hasHeader = header; sortCol = -1; limit = PAGE;
        if (!text.trim()) { rows = []; head = []; msg(L.empty); return; }
        const r = Papa.parse(text, { delimiter: d || undefined, skipEmptyLines: 'greedy' });
        const all = r.data.filter(x => Array.isArray(x));
        delim = (r.meta && r.meta.delimiter) || d || ',';
        cols = all.reduce((m, x) => Math.max(m, x.length), 0);
        for (const x of all) while (x.length < cols) x.push('');
        head = hasHeader && all.length ? all[0] : Array.from({ length: cols }, (_, i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''));
        rows = hasHeader ? all.slice(1) : all;
        numeric = head.map((_, c) => { let n = 0; for (const x of rows) { if (x[c] === '') continue; if (!isNum(x[c])) return false; n++; } return n > 0; });
        draw();
      }

      function visible() {
        let v = rows.map((_, i) => i);
        if (filter) { const f = filter.toLowerCase(); v = v.filter(i => rows[i].some(c => c.toLowerCase().includes(f))); }
        if (sortCol >= 0) {
          const c = sortCol, k = sortDir;
          v.sort((a, b) => {
            const x = rows[a][c], y = rows[b][c];
            if (numeric[c]) return (numVal(x) - numVal(y) || 0) * k;
            return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }) * k;
          });
        }
        return v;
      }

      function draw() {
        const v = visible();
        post({ info: { rows: rows.length, cols: cols, delim: delim, shown: v.length } });
        wrap.innerHTML = '';
        if (!rows.length && !head.length) return;
        const t = document.createElement('table');
        const hr = document.createElement('tr');
        const idx = document.createElement('th'); idx.className = 'idx'; idx.textContent = '#'; hr.appendChild(idx);
        head.forEach((h, c) => {
          const th = document.createElement('th');
          th.textContent = h;
          th.title = h;
          if (numeric[c]) th.className = 'num';
          if (sortCol === c) { const a = document.createElement('span'); a.className = 'arrow'; a.textContent = sortDir === 1 ? '▲' : '▼'; th.appendChild(a); }
          th.addEventListener('click', () => {
            if (sortCol !== c) { sortCol = c; sortDir = 1; } else if (sortDir === 1) sortDir = -1; else sortCol = -1;
            limit = PAGE; draw();
          });
          hr.appendChild(th);
        });
        const thead = document.createElement('thead'); thead.appendChild(hr); t.appendChild(thead);
        const tb = document.createElement('tbody');
        const shown = v.slice(0, limit);
        shown.forEach(ri => {
          const x = rows[ri];
          const tr = document.createElement('tr');
          const n = document.createElement('td'); n.className = 'idx'; n.textContent = String(ri + 1); tr.appendChild(n);
          x.forEach((cell, c) => { const td = document.createElement('td'); td.textContent = cell; td.title = cell; if (numeric[c]) td.className = 'num'; tr.appendChild(td); });
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        wrap.appendChild(t);
        if (!v.length) { const p = document.createElement('p'); p.className = 'msg'; p.textContent = L.noMatch; wrap.appendChild(p); }
        if (v.length > limit) {
          const b = document.createElement('button'); b.className = 'more'; b.textContent = L.more + ' (' + shown.length + ' / ' + v.length + ')';
          b.addEventListener('click', () => { limit += PAGE; draw(); });
          wrap.appendChild(b);
        }
      }

      const esc = s => String(s).replace(/\\\\/g, '\\\\textbackslash{}').replace(/[&%$#_{}]/g, m => '\\\\' + m).replace(/~/g, '\\\\textasciitilde{}').replace(/\\^/g, '\\\\textasciicircum{}').replace(/[\\r\\n]+/g, ' ');
      function tabular() {
        if (!cols) return '';
        const spec = numeric.map(n => (n ? 'r' : 'l')).join('');
        const line = x => x.map(esc).join(' & ') + ' \\\\\\\\';
        const out = ['\\\\begin{tabular}{' + spec + '}', '\\\\hline'];
        if (hasHeader) { out.push(line(head)); out.push('\\\\hline'); }
        for (const x of rows) out.push(line(x));
        out.push('\\\\hline', '\\\\end{tabular}');
        return out.join('\\n');
      }

      addEventListener('message', e => {
        if (e.source !== parent) return;
        const d = e.data || {};
        if (d.vars) for (const k in d.vars) document.documentElement.style.setProperty(k, d.vars[k]);
        if (typeof d.lib === 'string' && !ready) {
          const s = document.createElement('script');
          s.nonce = nonce;
          s.textContent = d.lib;
          document.head.appendChild(s);
          ready = typeof Papa !== 'undefined';
          post({ libReady: ready });
        }
        if (d.tooBig) { rows = []; head = []; msg(L.big); }
        else if (typeof d.text === 'string' && ready) { filter = String(d.filter || ''); load(d.text, d.delimiter || '', d.header !== false); }
        else if (typeof d.filter === 'string' && ready) { filter = d.filter; limit = PAGE; draw(); }
        if (d.export === 'tabular') post({ tabular: tabular() });
      });
      post({ ready: true });
    `;
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<style nonce="${nonce}">${css}</style></head><body><div class="wrap" id="wrap"><p class="msg">${tr('Loading...')}</p></div><script nonce="${nonce}">${script}<\/script></body></html>`;
  }

  function ensureUi() {
    const box = document.getElementById('preview-container');
    if (!box) return null;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'csv-bar';
      bar.className = 'mermaid-bar';
      const sel = document.createElement('select');
      sel.id = 'csv-delimiter';
      sel.className = 'theme-select';
      sel.title = tr('Column separator');
      sel.innerHTML = [['', tr('Separator: automatic')], [',', tr('Comma (,)')], [';', tr('Semicolon (;)')], ['\t', tr('Tab')], ['|', tr('Vertical bar (|)')]]
        .map(([v, n]) => `<option value="${v === '\t' ? 'tab' : v}">${n}</option>`).join('');
      sel.onchange = () => { opts.delimiter = sel.value === 'tab' ? '\t' : sel.value; schedule(0); };
      const lab = document.createElement('label');
      lab.className = 'csv-check';
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.id = 'csv-header'; chk.checked = true;
      chk.onchange = () => { opts.header = chk.checked; schedule(0); };
      lab.append(chk, document.createTextNode(' ' + tr('First row is the header')));
      const flt = document.createElement('input');
      flt.type = 'search'; flt.id = 'csv-filter'; flt.className = 'form-control csv-filter'; flt.placeholder = tr('Filter rows...');
      flt.oninput = () => { opts.filter = flt.value; post({ filter: opts.filter }); };
      const info = document.createElement('span');
      info.id = 'csv-info'; info.className = 'csv-info';
      const copy = document.createElement('button');
      copy.id = 'csv-copy'; copy.className = 'btn'; copy.textContent = tr('Copy as tabular'); copy.title = tr('Copies the table as LaTeX code (tabular)');
      copy.onclick = () => post({ export: 'tabular' });
      bar.append(sel, lab, flt, info, copy);
      box.prepend(bar);
    }
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'csv-preview-frame';
      frame.title = tr('Table preview');
      // no allow-same-origin: the content runs in an isolated origin, with no access to the page or the session cookie
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.srcdoc = shell();
      box.appendChild(frame);
    }
    return frame;
  }

  function post(msg) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*');
  }

  function flush() {
    if (!(frameReady && libReady && pending !== null)) return;
    post({ vars: themeVars() });
    if (pending.length > MAX_CHARS) post({ tooBig: true });
    else post({ text: pending, delimiter: opts.delimiter, header: opts.header, filter: opts.filter });
  }

  function refresh() {
    if (!isCsv() || typeof pdfTab === 'undefined' || pdfTab !== 'preview') return;
    ensureUi();
    pending = editor.getValue();
    if (!libText) { loadLib().then(() => { if (frameReady && !libReady) post({ lib: libText }); }).catch(() => {}); }
    flush();
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(refresh, ms === undefined ? 350 : ms);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* try the old way */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    return ok;
  }

  window.addEventListener('message', async e => {
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.neoleafCsv !== true) return;
    if (d.ready) {
      frameReady = true;
      post({ vars: themeVars() });
      if (libText) post({ lib: libText }); else loadLib().then(() => { if (!libReady) post({ lib: libText }); }).catch(() => {});
      return;
    }
    if (d.libReady) { libReady = true; flush(); return; }
    if ('info' in d) {
      const el = document.getElementById('csv-info');
      if (el) {
        const i = d.info;
        const names = { ',': tr('comma'), ';': tr('semicolon'), '\t': tr('tab'), '|': tr('vertical bar') };
        el.textContent = i && typeof i.rows === 'number' && typeof i.cols === 'number'
          ? i.rows + ' ' + tr('rows') + ' × ' + i.cols + ' ' + tr('columns') + ' (' + (names[i.delim] || tr('custom separator')) + ')' + (i.shown !== i.rows ? ', ' + i.shown + ' ' + tr('in the filter') : '')
          : '';
      }
      return;
    }
    if (typeof d.tabular === 'string' && d.tabular.length < MAX_CHARS) {
      const b = document.getElementById('csv-copy');
      const ok = d.tabular ? await copyText(d.tabular) : false;
      if (b) {
        b.textContent = ok ? tr('Copied!') : tr('Could not copy');
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { b.textContent = tr('Copy as tabular'); }, 1800);
      }
    }
  });

  // the bar and the frame only show with a CSV open; the button and the tab belong to md-preview.js
  function sync() {
    const on = isCsv();
    if (frame) frame.style.display = on ? '' : 'none';
    if (bar) bar.style.display = on ? '' : 'none';
    if (on) { ensureUi(); schedule(0); }
  }

  window.addEventListener('editor-ready', () => {
    editor.onDidChangeModelLanguage(sync);
    editor.onDidChangeModelContent(() => { if (isCsv()) schedule(); });
    sync();
  });
  window.addEventListener('ld-theme-change', () => setTimeout(() => { if (isCsv()) schedule(0); }, 60));

  window.CsvPreview = { active: isCsv, refresh, show: () => { if (isCsv()) { ensureUi(); schedule(0); } } };
})();
