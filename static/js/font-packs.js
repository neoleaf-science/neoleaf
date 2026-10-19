// TeX Live WebAssembly engine loading and the per-family font packs.
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

let texliveEngine = null;
let isTexliveLoading = false;

// ---------------------------------------------------------------------
// Extra fonts PER FAMILY. The light bundle only has Computer Modern and Latin Modern; Times, Libertine, newtx, Inconsolata,
// Montserrat, Noto Sans... live in separate bundles (/static/texlive/fonts). The browser reads the project, finds out
// which families it uses and downloads only those, merging them into the light bundle before creating the engine.
// ---------------------------------------------------------------------

let fontManifest = null;                 // null = not read yet; false = unavailable
let learnedFamilies = new Set();         // families the log already reported as needed (remembered in this browser)
try { learnedFamilies = new Set(JSON.parse(localStorage.getItem('ld-font-families-' + projectId) || '[]')); } catch (_) {}   // per project: what one project needed does not weigh on the others
let engineFamilyKey = '';                // families the current engine was created with
let composedBundle = { key: '', url: '' };

// fetch with up to 3 attempts for network failures and 5xx/408/429 (a busy server or a closed connection must not break the compilation)
async function fetchRetry(url, init, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise(r => setTimeout(r, 500 * i));
    try {
      const r = await fetch(url, init);
      if (r.status < 500 && r.status !== 429 && r.status !== 408) return r;
      lastErr = new Error('HTTP ' + r.status);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function loadFontManifest() {
  if (fontManifest !== null) return fontManifest;
  try {
    const r = await fetchRetry('/static/texlive/fonts/manifest.json', { cache: 'no-cache' });
    fontManifest = r.ok ? await r.json() : false;
  } catch (_) {
    fontManifest = false;
  }
  return fontManifest;
}

// LaTeX package -> family; font family name (\fontfamily) -> family
const FAMILY_BY_PACKAGE = {
  psnfss: /^(times|mathptmx|helvet|courier|palatino|mathpazo|bookman|newcent|avant|pifont|chancery|utopia|ding)$/i,
  libertine: /^(libertine|libertinus|biolinum|linuxlibertine)/i,
  newtx: /^(newtx|txfonts)/i,
  inconsolata: /^(inconsolata|zi4)$/i,
  montserrat: /^montserrat/i,
  'noto-sans': /^noto/i
};
const FAMILY_BY_FONT = {
  psnfss: /^(ptm|phv|pcr|ppl|pzd|psy|pbk|pag|pnc|pzc|put)/i,
  libertine: /libertine|biolinum|^ll[a-z]/i,
  newtx: /^(ntx|nxt|txr|txss|txtt|txmi|txsy|txex)/i,
  inconsolata: /inconsolata|^zi4/i,
  montserrat: /^montserrat/i,
  'noto-sans': /^notosans/i,
  ec: /^(ec|tc)[a-z]{2}\d/i
};

// Families the project asks for: loaded packages (\usepackage, \RequirePackage) and font families (\fontfamily)
function detectFamilies(files) {
  const found = new Set();
  const pkgRe = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  const famRe = /\\fontfamily\s*\{([^}]*)\}/g;
  for (const [path, content] of files) {
    if (typeof content !== 'string' || !/\.(tex|sty|cls)$/i.test(path)) continue;
    for (const m of content.matchAll(pkgRe)) {
      for (const name of m[1].split(',').map(s => s.trim())) {
        for (const [fam, re] of Object.entries(FAMILY_BY_PACKAGE)) if (re.test(name)) found.add(fam);
      }
    }
    for (const m of content.matchAll(famRe)) {
      for (const [fam, re] of Object.entries(FAMILY_BY_FONT)) if (re.test(m[1].trim())) found.add(fam);
    }
  }
  return found;
}

// Families to load for these files (empty = light bundle only). "ec" (T1 metrics, 0.4 MB) goes along with the others.
async function familiesFor(files) {
  const manifest = await loadFontManifest();
  if (!manifest) return [];
  const set = detectFamilies(files);
  learnedFamilies.forEach(f => set.add(f));
  const list = [...set].filter(f => manifest.families[f] && f !== 'ec');
  if (list.length) list.push('ec');
  return list.sort();
}

// Families requested by the error log (missing font), from the file/font names it cites
function familiesFromLog(log) {
  const found = new Set();
  for (const line of String(log).split('\n')) {
    if (!FONT_ERR_RE.test(line) && !/not loadable|not found/i.test(line)) continue;
    for (const word of line.split(/[^A-Za-z0-9_-]+/)) {
      if (word.length < 3) continue;
      for (const [fam, re] of Object.entries(FAMILY_BY_FONT)) if (re.test(word)) found.add(fam);
    }
  }
  return found;
}

function learnFamilies(fams) {
  fams.forEach(f => learnedFamilies.add(f));
  try { localStorage.setItem('ld-font-families-' + projectId, JSON.stringify([...learnedFamilies])); } catch (_) {}
}

// TS1 font (text symbols: ©, °, €) of Computer Modern: it only exists as a bitmap (METAFONT) and WebAssembly does not generate PK.
// Latin Modern (lmodern) has a vector version: in that case NeoLeaf recompiles loading it before the document (without touching the files).
const TS1_ERR_RE = /Font (?:tc|ec)[a-z]{2}\d+ at \d+ not found/;
let forceLmodern = false;

// Typical font errors for fonts the light bundle does not have
const FONT_ERR_RE = /Metric \(TFM\) file not found|I can't find file [`']?[^'\s]+\.(?:tfm|vf|pfb|enc|map)|Font [^\n]*not loadable|cannot open Type 1 font file|pdfTeX error[^\n]*font/i;

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Tar without the end marker (zeroed blocks at the end), so several can be concatenated
function trimTarEnd(tar) {
  let end = tar.length;
  while (end >= 512) {
    let zero = true;
    for (let i = end - 512; i < end; i++) if (tar[i] !== 0) { zero = false; break; }
    if (!zero) break;
    end -= 512;
  }
  return tar.subarray(0, end);
}

const BUNDLE_CACHE_NAME = 'texlive-font-bundles-v1';

async function getCachedBundleBlob(cacheKey) {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(BUNDLE_CACHE_NAME);
    const match = await cache.match(cacheKey);
    if (match) return await match.blob();
  } catch (_) {}
  return null;
}

async function setCachedBundleBlob(cacheKey, blob) {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(BUNDLE_CACHE_NAME);
    await cache.put(cacheKey, new Response(blob, {
      headers: { 'Content-Type': 'application/x-tar' }
    }));
  } catch (_) {}
}

// Joins the light bundle and the family bundles into a single tar (blob: address), which the engine reads as if it were one bundle.
async function composeBundle(families, manifest) {
  const key = families.join(',');
  if (composedBundle.key === key) return composedBundle.url;

  const cacheKey = `https://texlive-cache.local/bundle-${manifest.base.v}-${key}.tar`;
  const cachedBlob = await getCachedBundleBlob(cacheKey);
  if (cachedBlob) {
    if (composedBundle.url) URL.revokeObjectURL(composedBundle.url);
    composedBundle = { key, url: URL.createObjectURL(cachedBlob) };
    return composedBundle.url;
  }

  const urls = [`/static/texlive/${manifest.base.file}?v=${manifest.base.v}`, ...families.map(f => `/static/texlive/${manifest.families[f].file}?v=${manifest.families[f].v}`)];
  const tars = await Promise.all(urls.map(async u => {
    const r = await fetchRetry(u);
    if (!r.ok) throw new Error(`HTTP ${r.status} at ${u}`);
    return trimTarEnd(await gunzip(new Uint8Array(await r.arrayBuffer())));
  }));
  const total = tars.reduce((s, t) => s + t.length, 0) + 1024;
  const out = new Uint8Array(total);
  let off = 0;
  for (const t of tars) { out.set(t, off); off += t.length; }
  const blob = new Blob([out], { type: 'application/x-tar' });
  await setCachedBundleBlob(cacheKey, blob);
  if (composedBundle.url) URL.revokeObjectURL(composedBundle.url);
  composedBundle = { key, url: URL.createObjectURL(blob) };
  return composedBundle.url;
}

// Initialize texlive-wasm / BusyTeX WebAssembly Engine (one engine per set of font families)
async function getTexliveEngine(families = []) {
  const key = families.join(',');
  if (texliveEngine && key === engineFamilyKey) return texliveEngine;
  if (texliveEngine) { try { await texliveEngine.dispose(); } catch (_) {} texliveEngine = null; }

  if (!window.PdfLatex) {
    updateStatus('saving', 'Loading the texlive-wasm module...');
    await new Promise((resolve) => {
      if (window.PdfLatex) return resolve();
      window.addEventListener('texlive-ready', resolve, { once: true });
      setTimeout(resolve, 3000);
    });
  }

  const PdfLatexClass = window.PdfLatex;
  if (!PdfLatexClass) {
    throw new Error("The texlive-wasm WebAssembly module is unavailable.");
  }

  isTexliveLoading = true;
  const manifest = await loadFontManifest();
  let bundleUrl;
  if (manifest && families.length) {
    const cacheKey = `https://texlive-cache.local/bundle-${manifest.base.v}-${families.join(',')}.tar`;
    const cachedBlob = await getCachedBundleBlob(cacheKey);
    if (cachedBlob) {
      bundleUrl = URL.createObjectURL(cachedBlob);
    } else {
      const mb = families.reduce((s, f) => s + (manifest.families[f] ? manifest.families[f].size : 0), 0) / 1048576;
      updateStatus('saving', `Loading fonts (${families.filter(f => f !== 'ec').join(', ')}; ~${mb.toFixed(0)} MB, first time only)...`);
      bundleUrl = await composeBundle(families, manifest);
    }
  } else if (manifest) {
    updateStatus('saving', 'Initializing TeX Live WebAssembly...');
    bundleUrl = new URL(`/static/texlive/${manifest.base.file}?v=${manifest.base.v}`, window.location.origin).href;
  } else {
    updateStatus('saving', 'Initializing TeX Live WebAssembly...');
    bundleUrl = new URL('/static/texlive/texmf-core-pdflatex.tar.gz', window.location.origin).href;
  }

  texliveEngine = new PdfLatexClass({
    enginePath: new URL('/static/texlive/pdflatex.wasm', window.location.origin).href,
    bundleUrl,
    allowUnverifiedAssets: true
  });
  engineFamilyKey = key;
  isTexliveLoading = false;
  return texliveEngine;
}

// Warms up the engine in the background: downloads and prepares the bundle while the person is still reading/editing, so the first
// compilation does not pay for initialization. Runs a minimal compilation just to force loading.
let warmedUp = false;
async function warmUpEngine() {
  if (warmedUp || typeof navigator === 'undefined') return;
  const conn = navigator.connection;
  if ((conn && conn.saveData) || (navigator.deviceMemory && navigator.deviceMemory <= 2)) return;   // data/memory saving
  const sel = document.getElementById('engine-select');
  if (sel && sel.value && sel.value !== 'wasm-texlive') return;
  warmedUp = true;
  try {
    const texts = await Project.texts();
    const files = new Map((texts.files || []).map(f => [f.path, f.text]));
    rememberTexts(files);
    const engine = await getTexliveEngine(await familiesFor(files));
    await engine.compile({ mainTex: 'warm.tex', files: [{ path: 'warm.tex', content: '\\documentclass{article}\\begin{document}.\\end{document}' }] });
  } catch (_) { /* warming up is optional */ }
}
