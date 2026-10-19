// PDF viewer (PDF.js) with SyncTeX: double-clicking the PDF takes you to the code; "Go to this point in the PDF" does the reverse.
//
// API: PdfView.show(bytes, synctexGzBytes|null)  PdfView.blobUrl()  PdfView.locate()  PdfView.setSynctex(bytes|null)
(function () {
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  // Subresource Integrity: a changed file on the CDN is not run (regenerate with openssl dgst -sha384 -binary | openssl base64 -A when the version changes)
  const SRI_LIB = 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e';
  const SRI_WORKER = 'SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2';
  const $ = id => document.getElementById(id);

  const st = {
    lib: null, doc: null, pages: [], scale: 1, fit: true, bytes: null, url: null,
    sync: null, token: 0, observer: null, rendered: new Set()
  };

  // ------------------------------------------------------------ PDF.js
  async function loadLib() {
    if (st.lib) return st.lib;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.integrity = SRI_LIB;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load PDF.js'));
      document.head.appendChild(s);
    });
    // the Worker cannot be created directly from another domain: download the script and use a local blob
    const buf = await (await fetch(PDFJS + 'pdf.worker.min.js')).arrayBuffer();
    const digest = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-384', buf))));
    if ('sha384-' + digest !== 'sha384-' + SRI_WORKER) throw new Error('PDF.js worker failed the integrity check');
    const code = new TextDecoder().decode(buf);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    st.lib = window.pdfjsLib;
    return st.lib;
  }

  // ------------------------------------------------------------ structure
  function ensureDom() {
    const host = $('pdf-viewer');
    if (host.dataset.ready) return host;
    host.dataset.ready = '1';
    host.textContent = '';
    host.classList.add('pdf-host');
    const bar = document.createElement('div');
    bar.className = 'pdf-toolbar';
    const btn = (label, title, fn) => { const b = document.createElement('button'); b.className = 'pdf-tb'; b.textContent = label; b.title = title; b.addEventListener('click', fn); return b; };
    st.zoomLabel = document.createElement('span');
    st.zoomLabel.className = 'pdf-zoom';
    st.pageLabel = document.createElement('span');
    st.pageLabel.className = 'pdf-zoom';
    bar.append(btn('−', 'Zoom out (Ctrl+-)', () => zoomBy(1 / 1.15)), st.zoomLabel, btn('+', 'Zoom in (Ctrl++)', () => zoomBy(1.15)),
      btn('↔', 'Fit to width', () => { st.fit = true; relayout(); }), st.pageLabel,
      btn('⇢ Find in PDF', 'Shows in the PDF the spot where the cursor is in the code (Ctrl+Alt+J). Double-clicking the PDF does the reverse', () => locate()));
    st.scroll = document.createElement('div');
    st.scroll.className = 'pdf-scroll';
    st.pagesBox = document.createElement('div');
    st.pagesBox.className = 'pdf-pages';
    st.scroll.append(st.pagesBox);
    host.append(bar, st.scroll);
    st.scroll.addEventListener('dblclick', onDblClick);
    st.scroll.addEventListener('scroll', updatePageLabel, { passive: true });
    st.scroll.addEventListener('wheel', ev => { if (ev.ctrlKey) { ev.preventDefault(); zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1); } }, { passive: false });
    let timer = null;
    new ResizeObserver(() => { if (!st.fit) return; clearTimeout(timer); timer = setTimeout(relayout, 150); }).observe(st.scroll);
    return host;
  }

  function fitScale() {
    const p = st.pages[0];
    if (!p) return 1;
    const avail = Math.max(200, st.scroll.clientWidth - 32);
    return Math.min(3, Math.max(0.3, avail / p.base.width));
  }

  // ------------------------------------------------------------ drawing
  async function layout() {
    const token = ++st.token;
    st.rendered.clear();
    if (st.observer) st.observer.disconnect();
    if (st.fit) st.scale = fitScale();
    st.zoomLabel.textContent = Math.round(st.scale * 100) + '%';
    st.pages.forEach(p => {
      const w = Math.floor(p.base.width * st.scale), h = Math.floor(p.base.height * st.scale);
      p.el.style.width = w + 'px';
      p.el.style.height = h + 'px';
      p.el.textContent = '';
      p.canvas = null;
    });
    st.observer = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) renderPage(+e.target.dataset.n, token); });
    }, { root: st.scroll, rootMargin: '600px 0px' });
    st.pages.forEach(p => st.observer.observe(p.el));
    updatePageLabel();
  }

  async function renderPage(n, token) {
    const p = st.pages[n - 1];
    if (!p || st.rendered.has(n) || token !== st.token) return;
    st.rendered.add(n);
    const dpr = window.devicePixelRatio || 1;
    const vp = p.page.getViewport({ scale: st.scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = Math.floor(p.base.width * st.scale) + 'px';
    canvas.style.height = Math.floor(p.base.height * st.scale) + 'px';
    try {
      await p.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    } catch (_) { return; }
    if (token !== st.token) return;
    p.el.textContent = '';
    p.el.append(canvas);
    p.canvas = canvas;
  }

  function relayout() { if (st.doc) layout(); }

  function zoomBy(f) {
    st.fit = false;
    st.scale = Math.min(5, Math.max(0.25, st.scale * f));
    // keeps the center of the window
    const ratio = st.scroll.scrollTop / Math.max(1, st.scroll.scrollHeight);
    layout().then(() => { st.scroll.scrollTop = ratio * st.scroll.scrollHeight; });
  }

  function currentPage() {
    const top = st.scroll.scrollTop + st.scroll.clientHeight / 3;
    let cur = 1;
    for (const p of st.pages) { if (p.el.offsetTop <= top) cur = +p.el.dataset.n; else break; }
    return cur;
  }

  function updatePageLabel() {
    if (st.pageLabel && st.pages.length) st.pageLabel.textContent = T('p. {0}/{1}', currentPage(), st.pages.length);
  }

  // ------------------------------------------------------------ load a PDF
  // displays happen one at a time (the preview and the final PDF may arrive almost together)
  let chain = Promise.resolve();
  function show(bytes, synctexBytes) {
    const run = chain.then(() => doShow(bytes, synctexBytes));
    chain = run.catch(() => {});
    return run;
  }

  // shows "updating..." while the remaining passes finish
  function setBusy(on) {
    ensureDom();
    if (!st.busyLabel) {
      st.busyLabel = document.createElement('span');
      st.busyLabel.className = 'pdf-busy';
      st.busyLabel.textContent = '⟳ ' + T('updating');
      $('pdf-viewer').querySelector('.pdf-toolbar').append(st.busyLabel);
    }
    st.busyLabel.style.display = on ? '' : 'none';
  }

  async function doShow(bytes, synctexBytes) {
    const host = ensureDom();
    host.style.display = 'flex';
    const copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(new Blob([copy], { type: 'application/pdf' }));
    st.bytes = copy;
    setSynctex(synctexBytes);
    const lib = await loadLib();
    const keep = st.doc ? { top: st.scroll.scrollTop, page: currentPage() } : null;
    // isEvalSupported:false: pdf.js 3.x runs font programs through eval, which CVE-2024-4367 turns into code execution from a crafted PDF
    const doc = await lib.getDocument({ data: copy.slice(), isEvalSupported: false }).promise;
    if (st.doc) st.doc.destroy();
    st.doc = doc;
    st.pagesBox.textContent = '';
    st.pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.dataset.n = String(n);
      st.pagesBox.append(el);
      st.pages.push({ page, base: { width: base.width, height: base.height }, el, canvas: null });
    }
    await layout();
    if (keep) st.scroll.scrollTop = keep.top;
  }

  async function setSynctex(gz) {
    st.sync = null;
    if (!gz || !gz.length) return;
    try {
      const ds = new DecompressionStream('gzip');
      const text = await new Response(new Blob([gz]).stream().pipeThrough(ds)).text();
      st.sync = SyncTeX.parse(text);
    } catch (e) { console.warn('Unreadable SyncTeX:', e); }
  }

  const projectPaths = () => ((window.FT && FT.entries()) || []).filter(e => !e.dir).map(e => e.path);

  // ------------------------------------------------------------ PDF -> code
  function onDblClick(ev) {
    const pageEl = ev.target.closest('.pdf-page');
    if (!pageEl) return;
    if (!st.sync) { toast('No sync data: recompile the project with the browser engine (WebAssembly).'); return; }
    const r = pageEl.getBoundingClientRect();
    const x = (ev.clientX - r.left) / st.scale, y = (ev.clientY - r.top) / st.scale;
    const hit = SyncTeX.pdfToSource(st.sync, +pageEl.dataset.n, x, y);
    if (!hit) { toast('Could not find this spot in the code.'); return; }
    const path = SyncTeX.pathForTag(st.sync, hit.tag, projectPaths());
    if (!path) { toast(T('This spot comes from a file outside the project ({0}).', st.sync.inputs.get(hit.tag) || '?')); return; }
    pulse(pageEl, ev.clientX - r.left, ev.clientY - r.top);
    LD.smart.goTo(path, hit.line);
    flashLine(path, hit.line);
  }

  function pulse(pageEl, px, py) {
    const d = document.createElement('div');
    d.className = 'pdf-pulse';
    d.style.left = px + 'px';
    d.style.top = py + 'px';
    pageEl.append(d);
    setTimeout(() => d.remove(), 900);
  }

  function flashLine(path, line) {
    const entry = ((window.FT && FT.entries()) || []).find(e => e.path === path);
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (!entry || tries > 30) { clearInterval(t); return; }
      if (currentFileId !== entry.id || editor.getModel().getLineCount() < line) return;
      clearInterval(t);
      const ids = editor.deltaDecorations([], [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'ld-flash-line' } }]);
      setTimeout(() => editor.deltaDecorations(ids, []), 1600);
    }, 150);
  }

  // ------------------------------------------------------------ code -> PDF
  function locate() {
    if (!st.doc) { toast('Compile the project first.'); return; }
    if (!st.sync) { toast('No sync data: recompile the project with the browser engine (WebAssembly).'); return; }
    const entry = ((window.FT && FT.entries()) || []).find(e => e.id === currentFileId);
    if (!entry) return;
    const tag = SyncTeX.tagForPath(st.sync, entry.path);
    if (tag === null) { toast('This file is not part of the current PDF (it is not included by the main document).'); return; }
    const line = editor.getPosition().lineNumber;
    const spot = SyncTeX.sourceToPdf(st.sync, tag, line);
    if (!spot) { toast('This line did not produce content in the PDF.'); return; }
    const p = st.pages[spot.page - 1];
    if (!p) return;
    const top = p.el.offsetTop + spot.y * st.scale - st.scroll.clientHeight / 3;
    st.scroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    const hl = document.createElement('div');
    hl.className = 'pdf-hl';
    hl.style.left = Math.max(0, spot.x * st.scale - 4) + 'px';
    hl.style.top = Math.max(0, spot.y * st.scale - 2) + 'px';
    hl.style.width = (spot.w * st.scale + 8) + 'px';
    hl.style.height = (spot.h * st.scale + 4) + 'px';
    p.el.append(hl);
    setTimeout(() => hl.remove(), 2200);
    if (typeof switchTab === 'function') switchTab('pdf');
  }

  let toastTimer = null;
  function toast(msg) {
    let el = $('pdf-toast');
    if (!el) { el = document.createElement('div'); el.id = 'pdf-toast'; el.className = 'pdf-toast'; $('pdf-viewer').append(el); }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  window.PdfView = { show, setBusy, setSynctex, locate, blobUrl: () => st.url, hasPdf: () => !!st.doc };
  window.addEventListener('editor-ready', () => {
    editor.addAction({
      id: 'ld.locate-in-pdf', label: T('Go to this point in the PDF'), contextMenuGroupId: 'navigation', contextMenuOrder: 1.5,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyJ], run: () => locate()
    });
  }, { once: true });
})();
