// Gathers the whole project for a build and tracks the state of the last build (fast mode, auxiliary files).
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// ---------------------------------------------------------------------
// In-browser (WebAssembly) compilation with the whole project
// ---------------------------------------------------------------------

const texmfCache = new Map(); // "id:md5" -> [{ name, bytes }]
const assetCache = new Map(); // "id:md5" -> Uint8Array
let projectConfig = { mainFile: 'main.tex', engine: 'wasm-texlive' };

async function texmfFilesOf(item) {
  const key = `${item.id}:${item.md5 || item.size}`;
  if (!texmfCache.has(key)) {
    texmfCache.set(key, await Project.texmf.files(item.id));
  }
  return texmfCache.get(key);
}

async function assetBytes(a) {
  const key = `${a.id}:${a.md5 || a.size}`;
  if (!assetCache.has(key)) {
    assetCache.set(key, await Project.fileBytes(a.id));
  }
  return assetCache.get(key);
}

// Picks the main .tex: the configured one, if it exists; otherwise the open one (if .tex) or the first root .tex.
function pickMainFile(files, activeName) {
  let main = projectConfig.mainFile;
  if (!files.has(main)) {
    const tex = [...files.keys()].filter(k => k.endsWith('.tex') && !k.includes('/'));
    main = (activeName && activeName.endsWith('.tex') && activeName) || tex[0] || main;
  }
  return main;
}

// Copies the texmf packages into the main file's subfolder so \input and \usepackage find them there.
function linkTexmfIntoMainDir(files, main, texmfNames) {
  if (main && main.includes('/')) {
    const mainDir = main.substring(0, main.lastIndexOf('/'));
    for (const name of texmfNames) {
      const subPath = `${mainDir}/${name}`;
      if (!files.has(subPath)) {
        files.set(subPath, files.get(name));
      }
    }
  }
}

// Collects the bibliography keys of all .bib texts (a Map path -> text) into LD.bibKeys.
function setBibKeysFromFiles(files) {
  try {
    const keys = new Set();
    for (const [p, content] of files) {
      if (!/\.bib$/i.test(p) || typeof content !== 'string') continue;
      for (const m of content.matchAll(/@(?!comment|string|preamble)[a-zA-Z]+\s*[{(]\s*([^,\s]+)\s*,/gi)) keys.add(m[1]);
    }
    LD.bibKeys = [...keys].sort();
  } catch (_) {}
}

// Gathers the project from the local BrowserGit clone (texts, assets, texmf packages, open editor text).
async function gatherFromBrowserGit() {
  const gitFiles = await BrowserGit.getAllTexAndAssetFiles();
  const files = new Map();
  const texmfNames = new Set();
  let activeName = null;

  try {
    const cfgText = await BrowserGit.readFile('.neoleaf/config.json');
    if (cfgText) projectConfig = JSON.parse(cfgText);
  } catch (_) {}

  // Load the extra packages (the project's texmf and the global one)
  let bundle = { files: [], texmf: [] };
  try {
    const serverBundle = await Project.build();
    if (serverBundle) {
      bundle = serverBundle;
      if (serverBundle.config && !projectConfig.mainFile) {
        projectConfig = serverBundle.config;
      }
      for (const item of serverBundle.texmf || []) {
        for (const f of await texmfFilesOf(item)) {
          files.set(f.name, f.bytes);
          texmfNames.add(f.name);
        }
      }
    }
  } catch (err) {
    console.warn('Error loading texmf packages:', err);
  }

  for (const [p, content] of Object.entries(gitFiles)) {
    const live = p === currentFileId && editor;
    if (live) activeName = p;
    files.set(p, live ? editor.getValue() : content);
    texmfNames.delete(p);
  }

  if (currentFileId && editor && !files.has(currentFileId)) {
    files.set(currentFileId, editor.getValue());
    activeName = currentFileId;
    texmfNames.delete(currentFileId);
  }

  setBibKeysFromFiles(files);

  const main = pickMainFile(files, activeName);

  // If the main file is in a subfolder (e.g. samples/cbsoft-acm-like.tex), make the texmf packages available
  // inside that subfolder too, so that \input or \usepackage finds them
  linkTexmfIntoMainDir(files, main, texmfNames);

  return { files, main, bundle, texmfOnly: texmfNames };
}

// Fallback: gathers the project from the Project.build() bundle.
async function gatherFromBundle() {
  const bundle = await Project.build();
  projectConfig = bundle.config || projectConfig;
  // bibliography keys (all .bib files of the project) to suggest in \\cite{...}
  try {
    const keys = new Set();
    for (const f of bundle.files || []) {
      if (!/\.bib$/i.test(f.path)) continue;
      for (const m of String(f.text).matchAll(/@(?!comment|string|preamble)[a-zA-Z]+\s*[{(]\s*([^,\s]+)\s*,/gi)) keys.add(m[1]);
    }
    LD.bibKeys = [...keys].sort();
  } catch (_) {}

  const files = new Map(); // path -> content (later ones override earlier ones)
  const texmfNames = new Set();   // came from the project's extra packages (.neoleaf/texmf), not from the project itself
  for (const item of bundle.texmf || []) {
    for (const f of await texmfFilesOf(item)) { files.set(f.name, f.bytes); texmfNames.add(f.name); }
  }
  for (const a of bundle.assets || []) {
    files.set(a.path, await assetBytes(a));
    texmfNames.delete(a.path);
  }
  let activeName = null;
  for (const f of bundle.files || []) {
    const live = f.id === currentFileId && editor;
    if (live) activeName = f.path;
    files.set(f.path, live ? editor.getValue() : f.text);
    texmfNames.delete(f.path);
  }

  // Main file: the configured one, if it exists; otherwise the open one, if it is .tex
  const main = pickMainFile(files, activeName);

  // If the main file is in a subfolder (e.g. samples/cbsoft-acm-like.tex), make the texmf packages available
  // inside that subfolder too, so that \input or \usepackage finds them
  linkTexmfIntoMainDir(files, main, texmfNames);

  return { files, main, bundle, texmfOnly: texmfNames };
}

// Gathers the project: texts (including what is being edited right now), images and extra packages.
async function gatherProject() {
  if (window.BrowserGit && await BrowserGit.isCloned()) {
    try {
      return await gatherFromBrowserGit();
    } catch (e) {
      console.warn('Error gathering files from BrowserGit, using the fallback:', e);
    }
  }
  return gatherFromBundle();
}

// Stopwatch for the compilation steps (shown at the end of the log: shows where the time went)
function stopwatch() {
  const t0 = performance.now();
  let last = t0;
  const laps = [];
  return {
    lap(label) { const n = performance.now(); laps.push(`${label} ${((n - last) / 1000).toFixed(1)}s`); last = n; },
    summary() { return laps.join(' · ') + ` · total ${((performance.now() - t0) / 1000).toFixed(1)}s`; }
  };
}

// Shows the PDF of an intermediate pass while the others finish
function showPreview(pdfBytes) {
  hasPdf = true;
  updatePdfEmpty();
  if (window.PdfView) {
    PdfView.show(pdfBytes, null).catch(() => {});
    PdfView.setBusy(true);
  }
  switchTab('pdf');
  updateStatus('saving', 'Preview ready; finishing the remaining passes...');
}

// State of the last successful compilation: auxiliary files (.aux, .toc, .out...), .bbl and what generated the .bbl. On the next
// compilation LaTeX already starts from them; if nothing changed at the end of the first pass, the PDF is ready (1 pass instead of 3 or 4).
let lastBuild = null;
let forceCleanBuild = false;

// Fast mode: the project splits its text with \include; compiles only the open file (\includeonly) and uses the .aux files of the others
const knownTexts = new Map();           // project texts (to know whether fast mode applies)
function rememberTexts(files) {
  knownTexts.clear();
  for (const [p, c] of files) if (typeof c === 'string' && /\.tex$/i.test(p)) knownTexts.set(p, c);
  updateFastButton();
}

// The fast mode button only appears in projects that use \include; it is on/off and says what will happen
function updateFastButton() {
  const btn = document.getElementById('fast-btn');
  if (!btn) return;
  const main = projectConfig.mainFile;
  const chapters = includedChapters(knownTexts.get(main));
  btn.style.display = chapters.length ? '' : 'none';
  if (!chapters.length) return;
  const open = ((window.FT && FT.entries()) || []).find(e => e.id === currentFileId);
  const only = chapterOfOpenFile(knownTexts.get(main), open && open.path);
  btn.classList.toggle('on', fastMode);
  btn.title = fastMode
    ? (only ? T('Fast mode on: compiles only {0}. Run a full compilation first.', only) : T('Fast mode on, but the open file is not one of those included with \\include: compiling everything.'))
    : T('Fast mode: compiles only the open file (\\includeonly), using the rest from the last full compilation.');
}

function toggleFastMode() {
  fastMode = !fastMode;
  try { localStorage.setItem('ld-fast-' + projectId, fastMode ? '1' : '0'); } catch (_) {}
  updateFastButton();
}

let fastMode = false;
try { fastMode = localStorage.getItem('ld-fast-' + projectId) === '1'; } catch (_) {}

// The files the main file includes with \include{...} (outside comments), as written in the command
function includedChapters(mainText) {
  const out = [];
  for (const line of String(mainText || '').split('\n')) {
    const code = line.replace(/(^|[^\\])%.*$/, '$1');
    for (const m of code.matchAll(/\\include\s*\{([^}]+)\}/g)) out.push(m[1].trim());
  }
  return out;
}

// The name (as in \include) of the open file, if it is one of the included ones
function chapterOfOpenFile(mainText, openPath) {
  if (!openPath) return null;
  const norm = p => String(p).replace(/^\.\//, '').replace(/\.tex$/i, '');
  return includedChapters(mainText).find(c => norm(c) === norm(openPath)) || null;
}

function sameBytes(a, b) {
  if (a === b) return true;
  const x = typeof a === 'string' ? new TextEncoder().encode(a) : a;
  const y = typeof b === 'string' ? new TextEncoder().encode(b) : b;
  if (!x || !y || x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// Are the auxiliary files generated in this pass equal to those it received? Then we reached the fixed point.
function auxChanged(outputs, inputs) {
  const changed = [];
  for (const [path, bytes] of outputs) {
    const before = inputs.get(path);
    if (!before || !sameBytes(before, bytes)) changed.push(path);
  }
  return changed;
}
// The engine only returns new or changed files (those equal to the input do not come back): no changes = fixed point.
function auxStable(outputs, inputs) {
  return auxChanged(outputs, inputs).length === 0;
}

function hashFiles(files, re) {
  let h = 2166136261;
  for (const path of [...files.keys()].filter(p => re.test(p)).sort()) {
    const data = files.get(path);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619);
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  }
  return String(h >>> 0);
}

// Citations and style requested in the .aux: if they did not change (and the .bib files neither), the previous .bbl is still valid
function citeKeyOf(auxText) {
  return (auxText.match(/^\\(?:citation|bibstyle|bibdata)\{.*$/gm) || []).sort().join('\n');
}

const RERUN_RE = /Rerun to get|Label\(s\) may have changed|There were undefined references|Please \(re\)run|Rerun LaTeX/i;

function outputGet(outputs, name) {
  if (!outputs) return null;
  if (typeof outputs.get === 'function') return outputs.get(name) || null;
  return outputs[name] || null;
}

function outputEntries(outputs) {
  if (!outputs) return [];
  return typeof outputs.entries === 'function' ? [...outputs.entries()] : Object.entries(outputs);
}
