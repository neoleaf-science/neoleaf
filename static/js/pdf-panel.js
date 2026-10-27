// Compile button, log parsing, the PDF pane state and the compiler output.
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// Parse LaTeX log text into line-numbered errors & warnings
function parseLogToDiagnostics(log) {
  const list = [];
  const lines = log.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('! ')) {
      const msg = line.substring(2);
      let lineNum = null;
      // Look ahead for "l.<number>"
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const match = lines[j].match(/^l\.(\d+)/);
        if (match) {
          lineNum = parseInt(match[1], 10);
          break;
        }
      }
      list.push({ line: lineNum, message: msg, is_error: true });
    } else if (/^tex error\s*>\s*tex error on line (\d+) in file ([^:]+): (.*)$/.test(line) || /^lua error\s*>\s*(?:.*)$/.test(line)) {
      // ConTeXt: "tex error > tex error on line 3 in file ./main.tex: Undefined control sequence"
      const mm = line.match(/tex error on line (\d+) in file ([^:]+): (.*)$/);
      list.push(mm ? { line: parseInt(mm[1], 10), message: mm[3] + (mm[2] ? ' (' + mm[2].replace(/^\.\//, '') + ')' : ''), is_error: true } : { line: null, message: line.replace(/^lua error\s*>\s*/, 'Lua: '), is_error: true });
    } else if (/\b(WARN|ERROR) - /.test(line) && !/^\s*!/.test(line)) {
      // Biber: "ERROR - Cannot find 'refs.bib'", "WARN - Entry 'x' ..."
      const bm = line.match(/\b(WARN|ERROR) - (.*)$/);
      list.push({ line: null, message: 'Biber: ' + bm[2], is_error: bm[1] === 'ERROR' });
    } else if (/^Warning--/.test(line)) {
      list.push({ line: null, message: 'BibTeX: ' + line.replace(/^Warning--/, ''), is_error: false });
    } else if (/^I couldn't open (database|style) file/.test(line)) {
      list.push({ line: null, message: 'BibTeX: ' + line, is_error: true });
    } else if (line.toLowerCase().includes('latex warning:')) {
      const match = line.match(/on input line (\d+)/i);
      const lineNum = match ? parseInt(match[1], 10) : null;
      list.push({ line: lineNum, message: line, is_error: false });
    }
  }
  // The log file and the console output both carry each message: show it once
  const seen = new Set();
  return list.filter(d => {
    const key = (d.is_error ? 'E' : 'W') + '|' + d.line + '|' + d.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------
// Last compiled PDF (stored in .neoleaf/last.pdf)
// ---------------------------------------------------------------------

let pdfMeta = null;      // data of the PDF shown (when and who compiled it)
let hasPdf = false;      // is there a PDF on screen?
let pdfTab = 'pdf';      // tab open in the right panel (pdf | logs)

// The "no PDF" notice only shows on the PDF tab and while there is no PDF
function updatePdfEmpty() {
  const box = document.getElementById('pdf-empty');
  if (box) box.style.display = (!hasPdf && pdfTab === 'pdf') ? 'flex' : 'none';
}
let pdfStale = false;    // there were changes after it

function fmtPdfDate(iso) {
  try { return new Date(iso).toLocaleString(LDI18n.locale(), { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return iso || ''; }
}

function setPdfInfo(meta, stale) {
  pdfMeta = meta || null;
  const el = document.getElementById('pdf-info');
  if (!el) return;
  el.textContent = '';
  el.style.display = pdfMeta ? 'block' : 'none';
  if (!pdfMeta) return;
  const who = pdfMeta.by && (pdfMeta.by.name || pdfMeta.by.email);
  const text = (who ? T('PDF from {0} · {1}', fmtPdfDate(pdfMeta.savedAt), who) : T('PDF from {0}', fmtPdfDate(pdfMeta.savedAt)));
  el.title = text + (stale ? ' · there are uncompiled changes' : '');
  el.append(text);
  if (stale) {
    const b = document.createElement('span');
    b.className = 'pdf-stale';
    b.textContent = 'outdated';
    b.title = 'The text changed after this PDF. Click Recompile (Ctrl+Enter) to update.';
    el.append(b);
  }
}

function markPdfStale() {
  if (pdfMeta && !pdfStale) { pdfStale = true; setPdfInfo(pdfMeta, true); }
}

// keys that change the text mark the PDF as outdated
function hookPdfStale() {
  editor.onKeyDown(ev => {
    const e = ev.browserEvent;
    const mod = e.ctrlKey || e.metaKey;
    const changes = mod ? ['v', 'x', 'z', 'y'].includes(String(e.key).toLowerCase()) : (!e.altKey && (e.key.length === 1 || ['Backspace', 'Delete', 'Enter', 'Tab'].includes(e.key)));
    if (changes) markPdfStale();
  });
  editor.onDidPaste(markPdfStale);
}

async function loadLastPdf() {
  const viewer = document.getElementById('pdf-viewer');
  const showEmpty = () => { hasPdf = false; updatePdfEmpty(); setPdfInfo(null); };
  try {
    const meta = await Project.pdf.meta();
    if (!meta.available) { showEmpty(); return; }
    const bytes = await Project.pdf.file();
    if (!bytes) { showEmpty(); return; }
    const sync = await Project.pdf.synctex().catch(() => null);
    await PdfView.show(bytes, sync);
    hasPdf = true;
    updatePdfEmpty();
    pdfStale = !!meta.stale;
    setPdfInfo(meta, pdfStale);
  } catch (_) {
    showEmpty();
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

// Stores the freshly compiled PDF in the project (in the background): next time it opens without recompiling
async function persistLastPdf(res, engine) {
  try {
    const b64 = res.pdf_base64 || (res.pdfBytes ? bytesToBase64(res.pdfBytes) : null);
    if (!b64) return;
    setPdfInfo({ savedAt: new Date().toISOString(), by: { name: 'you, just now' } }, false);
    try {
      const meta = await Project.pdf.save({ content: b64, mainFile: res.mainFile || projectConfig.mainFile, engine, synctex: res.synctexBytes ? bytesToBase64(res.synctexBytes) : undefined, bbl: res.bblBytes ? bytesToBase64(res.bblBytes) : undefined });
      setPdfInfo(meta, false);
    } catch (e) {
      console.warn('Could not store the PDF:', e.message);
      const el = document.getElementById('pdf-info');
      if (el) { el.append(' · '); const w = document.createElement('span'); w.className = 'pdf-stale'; w.textContent = 'not saved in the project'; w.title = e.message; el.append(w); }
    }
  } catch (err) {
    console.warn('Could not store the PDF:', err);
  }
}

const COMPILE_PLAY_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>';
const COMPILE_SPINNER_SVG = '<svg class="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" /></svg>';

const ENGINE_LABELS = {
  'wasm-texlive': '⚡ Browser (pdfLaTeX)',
  'wasm-xelatex': '⚡ Browser (XeLaTeX / WebAssembly)',
  'wasm-lualatex': '⚡ Browser (LuaLaTeX / WebAssembly)',
  'wasm-typst': '⚡ Browser (Typst / WebAssembly)',
  'server-tectonic': '🖥️ Server (Tectonic)',
  'server-tinytex': '🖥️ Server (TinyTeX / TeX Live)'
};

// Builds the selector with only the compilers that exist; with a single one, the selector disappears
async function loadEngines() {
  const sel = document.getElementById('engine-select');
  if (!sel) return;
  // the browser engines (the local agent adds its own); nothing is compiled on the server
  const ids = ['wasm-texlive', 'wasm-xelatex', 'wasm-lualatex', 'wasm-typst'];
  sel.textContent = '';
  ids.forEach(id => { const o = document.createElement('option'); o.value = id; o.textContent = ENGINE_LABELS[id] || id; sel.appendChild(o); });
  sel.style.display = ids.length > 1 ? '' : 'none';
  const sel2 = document.getElementById('cfg-engine');            // Project window
  if (sel2) { sel2.textContent = ''; ids.forEach(id => { const o = document.createElement('option'); o.value = id; o.textContent = ENGINE_LABELS[id] || id; sel2.appendChild(o); }); }
  window.availableEngines = ids;
  if (window.LDAgent) LDAgent.syncOptions();
}

// Compiles with XeLaTeX (WebAssembly, auto-installing packages) and shows the result.
async function compileAndShowXe() {
  try {
    let wasmRes = await compileWithAutoInstallXe();
    renderCompileResult(wasmRes);
    if (wasmRes.success && !wasmRes.partial) persistLastPdf(wasmRes, 'wasm-xelatex');
  } catch (wasmErr) {
    console.error('XeLaTeX WebAssembly compilation error:', wasmErr);
    renderCompileResult({
      success: false,
      log: T('Error running the XeLaTeX WebAssembly compiler: {0}', wasmErr.message),
      diagnostics: [{ line: 1, message: wasmErr.message, is_error: true }]
    });
  }
}

// Compiles with LuaLaTeX (WebAssembly, auto-installing packages) and shows the result.
async function compileAndShowLua() {
  try {
    let wasmRes = await compileWithAutoInstallLua();
    renderCompileResult(wasmRes);
    if (wasmRes.success && !wasmRes.partial) persistLastPdf(wasmRes, 'wasm-lualatex');
  } catch (wasmErr) {
    console.error('LuaLaTeX WebAssembly compilation error:', wasmErr);
    renderCompileResult({
      success: false,
      log: T('Error running the LuaLaTeX WebAssembly compiler: {0}', wasmErr.message),
      diagnostics: [{ line: 1, message: wasmErr.message, is_error: true }]
    });
  }
}

// Compiles with pdfLaTeX (WebAssembly), switching to XeLaTeX when the project needs it, and shows the result.
async function compileAndShowPdflatex(engineSelect) {
  try {
    let wasmRes = await compileWithAutoInstall();
    // project that asks for XeTeX/LuaTeX (fontspec or OpenType/TrueType fonts):
    if (!wasmRes.success && (/requires (?:either )?XeTeX or\s+(?:\([A-Za-z]+\)\s+)?LuaTeX/i.test(wasmRes.log || '') || /File [`']fontspec\.sty' not found/i.test(wasmRes.log || '') || /The font "[^"]+" cannot be found/i.test(wasmRes.log || '') || /Package fontspec Error:/i.test(wasmRes.log || ''))) {
      updateStatus('saving', 'This project needs XeLaTeX: switching to XeLaTeX (WebAssembly)...');
      if (engineSelect) engineSelect.value = 'wasm-xelatex';
      projectConfig.engine = 'wasm-xelatex';
      let xeRes = await compileWithAutoInstallXe();
      renderCompileResult(xeRes);
      if (xeRes.success && !xeRes.partial) persistLastPdf(xeRes, 'wasm-xelatex');
      return;
    }
    renderCompileResult(wasmRes);
    if (wasmRes.success && !wasmRes.partial) persistLastPdf(wasmRes, 'wasm-texlive');   // the partial PDF does not replace the stored one
  } catch (wasmErr) {
    console.error('WebAssembly compilation error:', wasmErr);
    renderCompileResult({
      success: false,
      log: T('Error running the WebAssembly compiler: {0}\n\nTip: You can switch to the "⚡ Browser (XeLaTeX / WebAssembly)" option in the selector above.', wasmErr.message),
      diagnostics: [{ line: 1, message: wasmErr.message, is_error: true }]
    });
  }
}

// Compile LaTeX: browser (WebAssembly) engines and the local agent
async function recompileLatex(ev) {
  if (window.PyUI && PyUI.active()) { PyUI.run(); return; }   // with a .py open, ▶ and Ctrl+Enter run the Python
  if (ev && ev.shiftKey) forceCleanBuild = true;     // Shift+click: clean build, reusing nothing
  window.dispatchEvent(new CustomEvent('ld-compile', { detail: { phase: 'start' } }));   // the mascot listens
  const compileBtn = document.getElementById('compile-btn');
  const engineSelect = document.getElementById('engine-select');
  const selectedEngine = engineSelect ? engineSelect.value : 'wasm-texlive';

  if (compileBtn) {
    compileBtn.innerHTML = COMPILE_SPINNER_SVG;
    compileBtn.title = selectedEngine.startsWith('agent-') ? T('⏳ Compiling in the local agent...') : T('⏳ Compiling (WebAssembly)...');
    compileBtn.disabled = true;
  }

  // Ensure content is saved first to the local clone
  if (isDirty) {
    await saveCurrentFile();
  }
  pdfStale = false;

  const content = editor ? editor.getValue() : '';

  try {
    // a Typst project (its main file is .typ, or the Typst engine is chosen) compiles in the browser: the local agent has no Typst
    const mainFile = String((projectConfig && projectConfig.mainFile) || '');
    if (selectedEngine === 'wasm-typst' || /\.typ$/i.test(mainFile)) {
      if (engineSelect && engineSelect.value !== 'wasm-typst' && engineSelect.querySelector('option[value="wasm-typst"]')) engineSelect.value = 'wasm-typst';
      projectConfig.engine = 'wasm-typst';
      await compileAndShowTypst();
    } else if (selectedEngine.startsWith('agent-')) {
      await compileOnAgent(selectedEngine);
    } else if (selectedEngine === 'wasm-xelatex') {
      await compileAndShowXe();
    } else if (selectedEngine === 'wasm-lualatex') {
      await compileAndShowLua();
    } else {
      // 2. Compile via WebAssembly in browser (pdfLaTeX)
      await compileAndShowPdflatex(engineSelect);
    }
  } catch (err) {
    console.error('Compilation error:', err);
    alert(T('Compilation error: {0}', err.message));
  } finally {
    if (window.PdfView) PdfView.setBusy(false);
    if (compileBtn) {
      compileBtn.innerHTML = COMPILE_PLAY_SVG;
      compileBtn.title = T('Recompile document (Ctrl + Enter)');
      compileBtn.disabled = false;
    }
  }
}

// Render compilation output (PDF or error logs)
function renderCompileResult(res) {
  window.dispatchEvent(new CustomEvent('ld-compile', { detail: { phase: 'done', success: !!(res && res.success) } }));
  const viewer = document.getElementById('pdf-viewer');
  const logsContainer = document.getElementById('logs-container');
  const diagnosticsList = document.getElementById('diagnostics-list');
  const errorBadge = document.getElementById('error-badge');

  // Clear previous editor markers
  if (editor && monaco) {
    const model = editor.getModel();
    // a message about another file (Typst reports the file) is not drawn on this one
    const markers = (res.diagnostics || []).filter(diag => !diag.file || diag.file === currentFileId).map(diag => ({
      severity: diag.is_error ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      startLineNumber: diag.line || 1,
      startColumn: diag.column || 1,
      endLineNumber: diag.endLine || diag.line || 1,
      endColumn: diag.endLine ? (diag.endColumn || 100) : 100,
      message: diag.message
    }));
    monaco.editor.setModelMarkers(model, 'tinytex', markers);
  }

  // Populate logs
  if (logsContainer) {
    const rawPre = document.getElementById('raw-log');
    if (rawPre) {
      rawPre.innerText = res.log || 'No log available.';
    } else {
      logsContainer.innerText = res.log || 'No log available.';
    }
  }

  // Populate diagnostics
  if (diagnosticsList) {
    diagnosticsList.innerHTML = '';
    const errors = (res.diagnostics || []).filter(d => d.is_error);
    if (errorBadge) {
      errorBadge.innerText = errors.length > 0 ? T('{0} error(s)', errors.length) : '';
      errorBadge.style.display = errors.length > 0 ? 'inline-block' : 'none';
    }

    (res.diagnostics || []).forEach(d => {
      const el = document.createElement('div');
      el.className = `diagnostic-item ${d.is_error ? 'error' : 'warning'}`;
      el.innerHTML = `<div class="diagnostic-title">${d.is_error ? T('❌ Error') : T('⚠️ Warning')}${d.line ? ` (${T('Line {0}', d.line)})` : ''}</div><div>${escapeHtml(d.message)}</div>`;
      if (d.line && editor) {
        el.onclick = () => {
          editor.revealLineInCenter(d.line);
          editor.setPosition({ lineNumber: d.line, column: 1 });
          editor.focus();
        };
      }
      diagnosticsList.appendChild(el);
    });
  }

  if (res.success && (res.blobUrl || res.pdf_base64)) {
    // Display PDF in iframe
    hasPdf = true;
    updatePdfEmpty();
    const bytes = res.pdfBytes || (res.pdf_base64 ? base64ToBytes(res.pdf_base64) : null);
    if (bytes) PdfView.show(bytes, res.synctexBytes || null).catch(err => console.warn('PDF:', err));
    switchTab('pdf');
  } else if (res.success && res.pdfBytes && res.pdfBytes.length) {
    // XeLaTeX and LuaLaTeX already showed their PDF (showXeResult / showLuaResult): just keep the PDF tab open
    switchTab('pdf');
  } else {
    // Show logs tab automatically if compilation failed
    switchTab('logs');
  }
}


// Copies the compiler's raw output to the clipboard (to paste in a conversation or a bug report).
async function copyCompilerLog(btn) {
  const text = (document.getElementById('raw-log') || {}).textContent || '';
  const original = btn ? btn.dataset.label || btn.textContent : '';
  if (btn && !btn.dataset.label) btn.dataset.label = original;
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
  } catch (_) {}
  if (!ok) {
    // context without API permission (e.g. a page without HTTPS): fall back to the old method
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  if (btn) {
    btn.textContent = ok ? T('Copied!') : T('Could not copy');
    setTimeout(() => { btn.textContent = T('Copy log'); }, 1800);
  }
}
