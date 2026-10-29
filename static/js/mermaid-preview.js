// Mermaid diagram preview (.mmd, .mermaid) in the "Preview" tab, with SVG and PNG export and an examples menu.
// All in the browser, no server.
//
// Security (the text may come from collaborators): Mermaid runs INSIDE a sandboxed iframe (isolated origin, no access to the
// page or the session token), with securityLevel "strict" (Mermaid itself sanitizes the labels) and a content security policy (CSP)
// that only accepts our script (by nonce) and data: images. Inline style must be allowed, because Mermaid uses it in the SVGs.
// The library (static/vendor/mermaid.min.js, ~3.5 MB) is only downloaded the first time a diagram is opened.

(function () {
  'use strict';

  const THEME_VARS = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--text-primary', '--text-bright', '--muted', '--border-color', '--link', '--accent-color'];
  const MAX_EXPORT = 20 * 1024 * 1024;
  const tr = t => (window.T ? window.T(t) : t);

  let frame = null, bar = null, frameReady = false, libReady = false, libText = null, libPromise = null, timer = null;
  let pending = null;   // { code, theme } waiting for the frame and the library

  const isMm = () => typeof editor !== 'undefined' && editor && editor.getModel() && editor.getModel().getLanguageId() === 'mermaid';

  const EXAMPLES = [
    ['Flowchart', 'flowchart TD\n  A[Start] --> B{Works?}\n  B -- Yes --> C[Great]\n  B -- No --> D[Debug]\n  D --> B\n'],
    ['Sequence', 'sequenceDiagram\n  participant A as Person\n  participant S as System\n  A->>S: Asks for the report\n  S-->>A: Sends the PDF\n'],
    ['Classes', 'classDiagram\n  class Animal {\n    +String name\n    +move()\n  }\n  class Dog\n  Animal <|-- Dog\n'],
    ['States', 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Published\n  Review --> Draft\n  Published --> [*]\n'],
    ['Entity-relationship', 'erDiagram\n  RESEARCHER ||--o{ PROJECT : leads\n  PROJECT ||--|{ ARTICLE : produces\n'],
    ['Gantt (schedule)', 'gantt\n  title Schedule\n  dateFormat YYYY-MM-DD\n  section Research\n  Literature review :a1, 2026-01-01, 30d\n  Experiments :after a1, 45d\n'],
    ['Pie', 'pie title Distribution\n  "A" : 40\n  "B" : 35\n  "C" : 25\n'],
    ['Mind map', 'mindmap\n  root((Thesis))\n    Introduction\n    Method\n      Collection\n      Analysis\n    Results\n'],
  ];

  // ---- library (the isolated frame cannot reach the server; the page does the fetching)
  function loadLib() {
    if (!libPromise) {
      libPromise = fetch('/static/vendor/mermaid.min.js?v=12.2.0')
        .then(r => { if (!r.ok) throw new Error('mermaid'); return r.text(); })
        .then(t => { libText = t; })
        .catch(e => { libPromise = null; throw e; });
    }
    return libPromise;
  }

  // ---- theme: the diagram follows the editor light/dark
  function themeVars() {
    const cs = getComputedStyle(document.documentElement);
    const vars = {};
    for (const k of THEME_VARS) vars[k] = cs.getPropertyValue(k).trim();
    return vars;
  }
  function isDark() {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#fff';
    document.body.appendChild(probe);
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color);
    probe.remove();
    return m ? (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) < 128 : false;
  }

  // ---- isolated frame
  function shell() {
    const nonce = btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(18))));
    const css = `
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 18px; background: var(--bg-primary); color: var(--text-primary); font: 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      #out { display: flex; justify-content: center; }
      #out svg { max-width: 100%; height: auto; }
      .mm-msg { color: var(--muted); text-align: center; margin-top: 3em; }
      .mm-err { color: #e5534b; white-space: pre-wrap; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px 14px; margin: 0 0 16px; }
    `;
    const script = `
      const nonce = ${JSON.stringify(nonce)};
      const post = m => parent.postMessage(Object.assign({ neoleafMm: true }, m), '*');
      const out = document.getElementById('out');
      let lastSvg = '', seq = 0, ready = false;
      const msg = (text, cls) => { out.innerHTML = ''; const p = document.createElement(cls === 'err' ? 'pre' : 'p'); p.className = cls === 'err' ? 'mm-err' : 'mm-msg'; p.textContent = text; out.appendChild(p); };
      const svgSize = svg => {
        const m = /viewBox="[\\d.\\-]+\\s+[\\d.\\-]+\\s+([\\d.]+)\\s+([\\d.]+)"/.exec(svg);
        return m ? [Math.ceil(+m[1]), Math.ceil(+m[2])] : [800, 600];
      };
      const standalone = svg => {
        let s = svg;
        if (!/<svg[^>]*xmlns=/.test(s)) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
        return s.replace(/<br>/g, '<br/>');
      };
      async function draw(code, theme) {
        if (!ready) return;
        const mine = ++seq;
        if (!code.trim()) { lastSvg = ''; msg(${JSON.stringify(tr('Empty document'))}); return; }
        try {
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme, htmlLabels: false, flowchart: { htmlLabels: false }, fontFamily: 'system-ui, sans-serif' });
          await mermaid.parse(code);
          const r = await mermaid.render('mm' + mine, code);
          if (mine !== seq) return;
          out.innerHTML = r.svg;
          lastSvg = standalone(r.svg);
          post({ drawn: true });
        } catch (e) {
          if (mine !== seq) return;
          document.querySelectorAll('[id^="dmm"], [id^="mm"]').forEach(n => { if (n !== out && !out.contains(n)) n.remove(); });
          lastSvg = '';
          msg(String((e && e.message) || e), 'err');
          post({ drawn: false });
        }
      }
      function exportPng(scale) {
        if (!lastSvg) return;
        const [w, h] = svgSize(lastSvg);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = w * scale; c.height = h * scale;
          const g = c.getContext('2d');
          g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          try { post({ file: 'png', data: c.toDataURL('image/png') }); } catch (_) { post({ fileError: true }); }
        };
        img.onerror = () => post({ fileError: true });
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(lastSvg);
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
          ready = typeof mermaid !== 'undefined';
          post({ libReady: ready });
        }
        if (typeof d.code === 'string') draw(d.code, d.theme === 'dark' ? 'dark' : 'default');
        if (d.export === 'svg' && lastSvg) post({ file: 'svg', data: lastSvg });
        if (d.export === 'png') exportPng(2);
      });
      post({ ready: true });
    `;
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>${css}</style></head><body><div id="out"><p class="mm-msg">${tr('Loading Mermaid...')}</p></div><script nonce="${nonce}">${script}<\/script></body></html>`;
  }

  function ensureUi() {
    const box = document.getElementById('preview-container');
    if (!box) return null;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mermaid-bar';
      bar.className = 'mermaid-bar';
      const sel = document.createElement('select');
      sel.id = 'mermaid-examples';
      sel.className = 'theme-select';
      sel.title = tr('Insert an example at the cursor');
      sel.innerHTML = `<option value="">${tr('Examples...')}</option>` + EXAMPLES.map(([n], i) => `<option value="${i}">${tr(n)}</option>`).join('');
      sel.onchange = () => { const i = sel.value; sel.value = ''; if (i !== '') insertExample(+i); };
      const svg = document.createElement('button');
      svg.id = 'mermaid-export-svg'; svg.className = 'btn'; svg.textContent = 'SVG'; svg.title = tr('Download the diagram as SVG');
      svg.onclick = () => post({ export: 'svg' });
      const png = document.createElement('button');
      png.id = 'mermaid-export-png'; png.className = 'btn'; png.textContent = 'PNG'; png.title = tr('Download the diagram as PNG');
      png.onclick = () => post({ export: 'png' });
      bar.append(sel, svg, png);
      box.prepend(bar);
    }
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'mermaid-preview-frame';
      frame.title = tr('Mermaid preview');
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

  function insertExample(i) {
    if (!isMm() || !EXAMPLES[i]) return;
    const text = EXAMPLES[i][1];
    const empty = !editor.getValue().trim();
    const sel = editor.getSelection();
    editor.executeEdits('mermaid-example', [{ range: empty ? editor.getModel().getFullModelRange() : sel, text: empty ? text : '\n' + text, forceMoveMarkers: true }]);
    editor.focus();
  }

  function flush() {
    if (frameReady && libReady && pending) { post({ vars: themeVars() }); post({ code: pending.code, theme: pending.theme }); }
  }

  function refresh() {
    if (!isMm() || typeof pdfTab === 'undefined' || pdfTab !== 'preview') return;
    ensureUi();
    pending = { code: editor.getValue(), theme: isDark() ? 'dark' : 'default' };
    if (!libText) { loadLib().then(() => { if (frameReady && !libReady) post({ lib: libText }); }).catch(() => {}); }
    flush();
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(refresh, ms === undefined ? 350 : ms);
  }

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const baseName = () => String(typeof currentFileId === 'string' ? currentFileId : 'diagrama').split('/').pop().replace(/\.(mmd|mermaid)$/i, '') || 'diagrama';

  window.addEventListener('message', e => {
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.neoleafMm !== true) return;
    if (d.ready) {
      frameReady = true;
      post({ vars: themeVars() });
      if (libText) post({ lib: libText }); else loadLib().then(() => { if (!libReady) post({ lib: libText }); }).catch(() => {});
      return;
    }
    if (d.libReady) { libReady = true; flush(); return; }
    if (d.file === 'svg' && typeof d.data === 'string' && d.data.length < MAX_EXPORT) download(baseName() + '.svg', new Blob([d.data], { type: 'image/svg+xml' }));
    if (d.file === 'png' && typeof d.data === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d.data) && d.data.length < MAX_EXPORT) {
      fetch(d.data).then(r => r.blob()).then(b => download(baseName() + '.png', b));
    }
    if (d.fileError) alert(tr('Could not export the diagram.'));
  });

  // the bar and the frame only show with a Mermaid file open; the button and the tab belong to md-preview.js
  function sync() {
    const mm = isMm();
    if (frame) frame.style.display = mm ? '' : 'none';
    if (bar) bar.style.display = mm ? '' : 'none';
    if (mm) { ensureUi(); schedule(0); }
  }

  window.addEventListener('editor-ready', () => {
    editor.onDidChangeModelLanguage(sync);
    editor.onDidChangeModelContent(() => { if (isMm()) schedule(); });
    sync();
  });
  window.addEventListener('ld-theme-change', () => setTimeout(() => { if (isMm()) schedule(0); }, 60));

  window.MermaidPreview = { active: isMm, refresh, show: () => { if (isMm()) { ensureUi(); schedule(0); } } };
})();
