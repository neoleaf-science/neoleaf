// Markdown preview in the right panel ("Preview" tab): appears on its own when the open file is .md or .markdown and
// follows what is typed. All in the browser, no server.
//
// Security (the text may come from collaborators):
//  1. marked generates the HTML and DOMPurify cleans it (no scripts, styles, forms, iframes etc.);
//  2. the result is shown in a sandboxed iframe (isolated origin, no access to the page or the session token);
//  3. the iframe has a content security policy (CSP) that only accepts our script (by nonce), https/data images and our style.
// The libraries (marked, DOMPurify) are only loaded the first time a Markdown file is opened.

(function () {
  'use strict';

  const MAX_IMG = 3 * 1024 * 1024;        // per repository image
  const MAX_IMG_TOTAL = 8 * 1024 * 1024;  // sum of the images of one preview
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  const THEME_VARS = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--text-primary', '--text-bright', '--muted', '--border-color', '--link', '--accent-color'];
  const tr = t => (window.T ? window.T(t) : t);

  let frame = null, frameReady = false, pendingHtml = null, wasMd = false, libs = null, token = 0, timer = null;

  const isMd = () => typeof editor !== 'undefined' && editor && editor.getModel() && editor.getModel().getLanguageId() === 'markdown';

  let markedLib = null, purifyLib = null;

  // Monaco installs an AMD loader on the page (`define`), and the (UMD) libraries would register in it instead of becoming a
  // global variable. To avoid touching the page's `define` (Monaco loads modules by itself, in parallel), the code is read from our own
  // server and run with `define`, `module` and `exports` hidden: the UMD falls into the "global variable" branch.
  async function loadUmd(src, name) {
    if (window[name]) return window[name];
    const res = await fetch(src);
    if (!res.ok) throw new Error('Could not load ' + src);
    new Function('define', 'module', 'exports', await res.text())(undefined, undefined, undefined);
    if (!window[name]) throw new Error(name + ' was not defined');
    return window[name];
  }
  function loadLibs() {
    if (!libs) {
      libs = Promise.all([loadUmd('/static/vendor/marked.umd.js', 'marked'), loadUmd('/static/vendor/purify.min.js', 'DOMPurify')])
        .then(([m, p]) => { markedLib = m; purifyLib = p; })
        .catch(e => { libs = null; throw e; });
    }
    return libs;
  }

  // ---- paths relative to the open file
  function resolvePath(from, rel) {
    let r = rel;
    try { r = decodeURI(rel); } catch (_) { /* keep */ }
    const parts = r.startsWith('/') ? [] : (from.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : []);
    for (const seg of r.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
    }
    return parts.length ? parts.join('/') : null;
  }
  const isRelative = u => !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('//') && !u.startsWith('#');
  const stripQuery = u => u.replace(/[?#].*$/, '');

  function toDataUri(bytes, mime) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return `data:${mime};base64,${btoa(bin)}`;
  }

  // ---- Markdown -> clean HTML
  async function render(text, path) {
    await loadLibs();
    const raw = markedLib.parse(text, { gfm: true, async: false });
    const clean = purifyLib.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'script', 'link', 'meta', 'base', 'button', 'textarea', 'select', 'option', 'map', 'area'],
      FORBID_ATTR: ['style', 'srcset', 'formaction', 'usemap'],
    });
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + clean, 'text/html');

    for (const a of doc.body.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) continue;
      if (/^https?:/i.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); continue; }
      if (/^mailto:/i.test(href)) continue;
      if (isRelative(href)) {
        const target = resolvePath(path, stripQuery(href));
        a.removeAttribute('href');
        if (target) { a.setAttribute('data-md-path', target); a.setAttribute('href', '#'); a.setAttribute('title', target); }
        continue;
      }
      a.removeAttribute('href'); // other schemes (ftp:, data:, etc.) do not become links
    }

    let total = 0;
    for (const img of doc.body.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src') || '';
      img.setAttribute('loading', 'lazy');
      img.setAttribute('referrerpolicy', 'no-referrer');
      if (/^https:/i.test(src) || /^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)) continue;
      let uri = null;
      if (isRelative(src)) {
        const file = resolvePath(path, stripQuery(src));
        const mime = file && MIME[file.split('.').pop().toLowerCase()];
        if (file && mime && window.BrowserGit) {
          try {
            const bytes = await BrowserGit.readFile(file, 'uint8array');
            if (bytes && bytes.length <= MAX_IMG && total + bytes.length <= MAX_IMG_TOTAL) { total += bytes.length; uri = toDataUri(bytes, mime); }
          } catch (_) { /* file does not exist */ }
        }
      }
      if (uri) { img.setAttribute('src', uri); continue; }
      const miss = doc.createElement('span');
      miss.className = 'md-missing';
      miss.textContent = '[' + tr('image not found') + (img.getAttribute('alt') ? ': ' + img.getAttribute('alt') : '') + ']';
      img.replaceWith(miss);
    }
    return doc.body.innerHTML;
  }

  // ---- isolated iframe
  function themeVars() {
    const cs = getComputedStyle(document.documentElement);
    const vars = {};
    for (const k of THEME_VARS) vars[k] = cs.getPropertyValue(k).trim();
    return vars;
  }

  function shell() {
    const nonce = btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(18))));
    const css = `
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 18px 26px 40px; background: var(--bg-primary); color: var(--text-primary); font: 15px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow-wrap: anywhere; }
      h1, h2, h3, h4, h5, h6 { color: var(--text-bright); line-height: 1.25; margin: 1.5em 0 .5em; }
      h1 { font-size: 1.9em; padding-bottom: .3em; border-bottom: 1px solid var(--border-color); }
      h2 { font-size: 1.5em; padding-bottom: .25em; border-bottom: 1px solid var(--border-color); }
      h3 { font-size: 1.25em; } h4 { font-size: 1.05em; } h5, h6 { font-size: .95em; color: var(--muted); }
      body > :first-child { margin-top: 0; }
      p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
      a { color: var(--link, var(--accent-color)); text-decoration: none; } a:hover { text-decoration: underline; }
      code { font: .9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--bg-tertiary); padding: .15em .4em; border-radius: 4px; }
      pre { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px 14px; overflow: auto; }
      pre code { background: none; padding: 0; font-size: .88em; }
      blockquote { margin-left: 0; padding: .2em 1em; color: var(--muted); border-left: 4px solid var(--border-color); }
      table { border-collapse: collapse; display: block; overflow: auto; max-width: 100%; }
      th, td { border: 1px solid var(--border-color); padding: 6px 12px; }
      th { background: var(--bg-secondary); color: var(--text-bright); }
      tr:nth-child(2n) td { background: color-mix(in srgb, var(--bg-secondary) 55%, transparent); }
      hr { border: 0; border-top: 1px solid var(--border-color); margin: 1.6em 0; }
      img { max-width: 100%; height: auto; }
      li:has(> input[type="checkbox"]) { list-style: none; margin-left: -1.4em; } li > input[type="checkbox"] { margin-right: .5em; }
      .md-missing { color: var(--muted); font-style: italic; }
      .md-empty { color: var(--muted); text-align: center; margin-top: 3em; }
    `;
    const script = `
      const post = m => parent.postMessage(Object.assign({ neoleafMd: true }, m), '*');
      addEventListener('message', e => {
        if (e.source !== parent) return;
        const d = e.data || {};
        if (d.vars) for (const k in d.vars) document.documentElement.style.setProperty(k, d.vars[k]);
        if (typeof d.html === 'string') { const y = scrollY; document.body.innerHTML = d.html; scrollTo(0, y); }
      });
      document.addEventListener('click', e => {
        const a = e.target.closest && e.target.closest('a');
        if (!a) return;
        const p = a.getAttribute('data-md-path');
        if (p) { e.preventDefault(); post({ open: p }); }
        else if (a.getAttribute('href') === '#') e.preventDefault();
      });
      post({ ready: true });
    `;
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<style nonce="${nonce}">${css}</style></head><body></body><script nonce="${nonce}">${script}<\/script></html>`;
  }

  function ensureFrame() {
    const box = document.getElementById('preview-container');
    if (!box) return null;
    if (frame) return frame;
    frame = document.createElement('iframe');
    frame.id = 'md-preview-frame';
    frame.title = tr('Markdown preview');
    // no allow-same-origin: the content runs in an isolated origin, with no access to the page or the session cookie
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    frame.srcdoc = shell();
    box.appendChild(frame);
    return frame;
  }

  function post(msg) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*');
  }
  function push(html) {
    pendingHtml = html;
    if (frameReady) { post({ vars: themeVars(), html }); }
  }

  async function refresh() {
    if (!isMd() || typeof pdfTab === 'undefined' || pdfTab !== 'preview') return;
    ensureFrame();
    const mine = ++token;
    const text = editor.getValue();
    const path = typeof currentFileId === 'string' ? currentFileId : '';
    try {
      const html = text.trim() ? await render(text, path) : `<p class="md-empty">${tr('Empty document')}</p>`;
      if (mine === token) push(html);
    } catch (e) {
      if (mine === token) push(`<p class="md-missing">${tr('Could not build the preview')}</p>`);
    }
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(refresh, ms === undefined ? 250 : ms);
  }

  // opens another project file when clicking a relative link in the preview
  window.addEventListener('message', e => {
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.neoleafMd !== true) return;
    if (d.ready) { frameReady = true; post({ vars: themeVars() }); if (pendingHtml !== null) post({ html: pendingHtml }); return; }
    if (typeof d.open === 'string' && d.open.length < 300 && !/[\u0000-\u001f]/.test(d.open) && window.FT && FT.entries) {
      if (FT.entries().some(x => !x.dir && x.path === d.open)) FT.openPath(d.open);
    }
  });

  // the button and the tab follow the type of the open file
  function sync() {
    const btn = document.getElementById('tab-preview-btn');
    if (!btn) return;
    const md = isMd();
    const any = md || !!(window.MermaidPreview && MermaidPreview.active()) || !!(window.CsvPreview && CsvPreview.active()) || !!(window.PyUI && PyUI.active());   // the tab also serves Mermaid and CSV
    btn.style.display = any ? '' : 'none';
    if (frame) frame.style.display = md ? '' : 'none';
    if (any && !wasMd) { if (typeof switchTab === 'function') switchTab('preview'); }
    else if (!any && typeof pdfTab !== 'undefined' && pdfTab === 'preview' && typeof switchTab === 'function') switchTab('pdf');
    wasMd = any;
    if (md) schedule(0);
  }

  window.addEventListener('editor-ready', () => {
    editor.onDidChangeModelLanguage(sync);
    editor.onDidChangeModelContent(() => { if (isMd()) schedule(); });
    sync();
  });
  window.addEventListener('ld-theme-change', () => setTimeout(() => { if (frameReady) post({ vars: themeVars() }); }, 50));

  window.MdPreview = { refresh, show: () => { if (isMd()) { ensureFrame(); schedule(0); } } };
})();
