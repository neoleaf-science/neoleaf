// LuaLaTeX compilation in the browser (WebAssembly).
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// Waits (up to 3 s) for the LuaLaTeX WebAssembly module and fails when it is unavailable.
async function ensureLuaModule() {
  if (!window.texliveLatexmk) {
    if (!window.LuaLatex) {
      updateStatus('saving', 'Loading the LuaLaTeX WebAssembly module...');
      await new Promise((resolve) => {
        if (window.LuaLatex) return resolve();
        window.addEventListener('texlive-ready', resolve, { once: true });
        setTimeout(resolve, 3000);
      });
    }
  }

  if (!window.texliveLatexmk) {
    throw new Error('LuaLaTeX WebAssembly module unavailable.');
  }
}

// Returns the per-engine asset URLs (WASM, bundle, ICU data) for texliveLatexmk.
function luaEngineConfig(origin) {
  return (id) => {
    if (id === 'lualatex') {
      return {
        enginePath: new URL('/static/texlive/lualatex/emscripten/lualatex.wasm', origin).href,
        bundleUrl: new URL('/static/texlive/texmf-core-lualatex.tar.gz', origin).href,
        allowUnverifiedAssets: true
      };
    }
    if (id === 'bibtexu') {
      return {
        enginePath: new URL('/static/texlive/bibtexu/emscripten/bibtexu.wasm', origin).href,
        icuDataUrl: new URL('/static/texlive/icudt78l.dat', origin).href,
        allowUnverifiedAssets: true
      };
    }
    return { allowUnverifiedAssets: true };
  };
}

// Joins the main log and the per-step logs of a latexmk run, with the timings.
function buildLuaLog(result, timing) {
  const logs = [];
  if (result.log) logs.push(result.log);
  if (Array.isArray(result.logs)) {
    result.logs.forEach(l => {
      const txt = (l.log || '') + (l.stdout ? '\n' + l.stdout : '') + (l.stderr ? '\n' + l.stderr : '');
      if (txt && !logs.includes(txt)) logs.push(`\n===== ${l.cmd || 'Etapa'} =====\n${txt}`);
    });
  }
  logs.push('\n===== Tempos =====\n' + timing);
  return logs.join('\n');
}

// Shows the PDF (or the logs tab on failure) and updates the status line.
function showLuaResult(result, pdfBytes, synctexBytes) {
  if (result.success && pdfBytes && pdfBytes.length) {
    hasPdf = true;
    updatePdfEmpty();
    if (window.PdfView) {
      PdfView.show(pdfBytes, synctexBytes).catch(() => {});
      PdfView.setBusy(false);
    }
    switchTab('pdf');
    updateStatus('saved', T('Compiled successfully (LuaLaTeX WebAssembly)'));
  } else {
    updateStatus('error', 'Compilation error (LuaLaTeX)');
    switchTab('logs');
  }
}

// Local in-browser compilation with LuaLaTeX WebAssembly
async function compileWithLuaLatex() {
  updateStatus('saving', 'Gathering the project files...');
  const sw = stopwatch();
  const { files, main } = await gatherProject();
  rememberTexts(files);
  sw.lap('projeto');

  await ensureLuaModule();

  updateStatus('saving', 'Compilando via LuaLaTeX WebAssembly...');
  const origin = window.location.origin;
  const inputFiles = [...files.entries()].map(([path, content]) => ({ path, content }));

  const result = await window.texliveLatexmk({
    engine: 'lualatex',
    mainTex: main,
    files: inputFiles,
    synctex: true,
    engineConfig: luaEngineConfig(origin)
  });

  sw.lap('compilation');
  const timing = sw.summary();
  console.info('[LuaLaTeX compilation]', timing);

  const logText = buildLuaLog(result, timing);

  const pdfBytes = result.pdf || null;
  const synctexBytes = result.synctex || null;
  const diagnostics = parseLogToDiagnostics(result.log || logText);

  showLuaResult(result, pdfBytes, synctexBytes);

  return {
    success: !!(result.success && pdfBytes && pdfBytes.length),
    pdfBytes,
    synctexBytes,
    log: logText,
    diagnostics
  };
}

async function compileWithAutoInstallLua() {
  const installed = [];
  const failed = [];
  const pre = await preinstallDeclared();
  installed.push(...pre.installed);
  const tried = new Set();
  const MAX_ROUNDS = 10;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await compileWithLuaLatex();
    const auto = projectConfig.autoInstall !== false;
    const missing = [...missingFromLog(res.log || '').entries()].filter(([file]) => !tried.has(file));

    if ((res.success && !missing.some(([f]) => /-options\.bib$/i.test(f))) || !auto || missing.length === 0) {   // a successful run can still have lost the references (BibTeX could not open a package option file)
      const notes = [];
      if (installed.length) notes.push(T('Packages installed automatically (TeX Live): {0}', installed.join(', ')));
      if (failed.length) notes.push('Could not install automatically: ' + failed.join(', ') + '. Use ⚙ Project → Packages to upload them.');
      if (!res.success && pre.failed.length) notes.push('Early installation: ' + pre.failed.join('; '));
      if (!res.success) hintsFromLog(res.log || '').forEach(h2 => notes.push(h2));
      if (notes.length) {
        res.log = notes.join('\n') + '\n\n' + (res.log || '');
        if (res.success && installed.length) updateStatus('saved', T('Compiled (installed: {0})', installed.join(', ')));
      }
      return res;
    }

    let progressed = false;
    for (const [file, candidates] of missing.slice(0, 6)) {
      tried.add(file);
      let ok = false;
      const isFont = /\.(otf|ttf|ttc|pfb)$/i.test(file);
      updateStatus('saving', isFont ? T('Looking for font {0}...', file) : T('Looking for the package of {0}...', file));
      let r;
      try { r = await importQuiet({ file }); } catch (_) { r = { error: 'no connection' }; }
      if (!r.error) {
        const name = r.item.name.replace(/\.zip$/i, '');
        if (!installed.includes(name)) installed.push(name);
        ok = true;
      } else {
        for (const pkg of candidates) {
          if (installed.includes(pkg)) { ok = true; break; }
          updateStatus('saving', isFont ? `Installing the ${pkg} font family from TeX Live...` : `Installing package ${pkg}...`);
          try { r = await importQuiet({ package: pkg }); } catch (_) { r = { error: 'no connection' }; }
          if (!r.error) { installed.push(pkg); ok = true; break; }
        }
      }
      if (ok) progressed = true; else failed.push(file);
    }
    if (!progressed) {
      const final = await compileWithLuaLatex();
      final.log = [`Could not install automatically: ${failed.join(', ')}. Use ⚙ Project → Packages to upload them.`, ...hintsFromLog(final.log || '')].join('\n') + '\n\n' + (final.log || '');
      return final;
    }
    updateStatus('saving', 'Recompiling with the new fonts and packages...');
  }
  return compileWithLuaLatex();
}
