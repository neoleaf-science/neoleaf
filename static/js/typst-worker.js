// Web Worker for Typst: compiles a project to PDF with the Typst compiler in WebAssembly (typst.ts). Runs off the main UI thread.
//
// The compiler (static/typst/typst_ts_web_compiler_bg.wasm) and the fonts Typst ships with come from this server (scripts/fetch_typst_assets.py); the
// packages a document imports (@preview/...) are downloaded by the browser straight from packages.typst.org. Nothing of the project leaves the browser.
// One font is not served by NeoLeaf: New Computer Modern 10 Regular is GPL 3 or later (with the Font Exception), so the browser downloads it from the
// typst-assets repository (GitHub, then the jsDelivr mirror), checks its SHA-256 and keeps it in the Cache API of this device.
// Messages are handled one at a time, in order.
/* global importScripts, NeoTypst */
importScripts('/static/vendor/typst-engine.min.js' + self.location.search); // same ?v= as the page, see compile-typst.js

const VERSION = new URLSearchParams(self.location.search).get('v') || '';
const query = VERSION ? '?v=' + encodeURIComponent(VERSION) : '';
const asset = path => new URL('/static/typst/' + path + query, self.location.href).href;

const PDF = 1; // CompileFormatEnum.pdf

const EXTERNAL_FONT = {
  name: 'NewCM10-Regular.otf',
  size: 717588,
  sha256: '328698d764ccdf7acf6bc1088aefd83a237f6a1d8b812de1e77ac5e4483bf3d1',
  urls: [
    'https://raw.githubusercontent.com/typst/typst-assets/v0.15.1/files/fonts/NewCM10-Regular.otf',
    'https://cdn.jsdelivr.net/gh/typst/typst-assets@v0.15.1/files/fonts/NewCM10-Regular.otf'
  ]
};
const FONT_CACHE = 'neoleaf-typst-fonts-v1';

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function verified(bytes) {
  return bytes.length === EXTERNAL_FONT.size && (await sha256Hex(bytes)) === EXTERNAL_FONT.sha256;
}

// The bytes of the downloaded font (kept after the first time), or null when it cannot be had: Typst then falls back to another font.
async function externalFont() {
  try {
    const cache = await caches.open(FONT_CACHE);
    const hit = await cache.match(EXTERNAL_FONT.urls[0]);
    if (hit) {
      const kept = new Uint8Array(await hit.arrayBuffer());
      if (await verified(kept)) return kept;
    }
    for (const url of EXTERNAL_FONT.urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!(await verified(bytes))) throw new Error('the file does not match the pinned SHA-256');
        await cache.put(EXTERNAL_FONT.urls[0], new Response(bytes));
        return bytes;
      } catch (err) {
        console.warn('Typst: could not download ' + EXTERNAL_FONT.name + ' from ' + new URL(url).host + ': ' + ((err && err.message) || err));
      }
    }
  } catch (err) {
    console.warn('Typst: ' + EXTERNAL_FONT.name + ' is not available: ' + ((err && err.message) || err));
  }
  return null;
}

let snippet = null;
let setup = null; // promise: the compiler is ready

function prepare() {
  if (setup) return setup;
  setup = (async () => {
    const manifest = await (await fetch(asset('manifest.json'))).json();
    const fonts = manifest.files.filter(f => f.file.startsWith('fonts/')).map(f => asset(f.file));
    const downloaded = await externalFont();
    if (downloaded) fonts.push(downloaded);
    const { TypstSnippet, MemoryAccessModel } = NeoTypst;
    const accessModel = new MemoryAccessModel();
    snippet = new TypstSnippet();
    snippet.setCompilerInitOptions({ getModule: () => asset('typst_ts_web_compiler_bg.wasm') });
    snippet.use(
      TypstSnippet.disableDefaultFontAssets(), // the default would download the fonts from a CDN; ours are on this server
      TypstSnippet.preloadFonts(fonts),
      TypstSnippet.withAccessModel(accessModel),
      TypstSnippet.fetchPackageRegistry(accessModel) // @preview/... from packages.typst.org, cached in memory for the session
    );
    await snippet.getCompiler();
  })().catch(err => { setup = null; throw err; });
  return setup;
}

// "1:1-1:12" (line:column-line:column, counted from 0) -> { line, column, endLine, endColumn } counted from 1, as the editor does
function position(range) {
  const m = /^(\d+):(\d+)(?:-(\d+):(\d+))?/.exec(String(range || ''));
  if (!m) return { line: null, column: null, endLine: null, endColumn: null };
  const n = i => parseInt(m[i], 10) + 1;
  return { line: n(1), column: n(2), endLine: m[3] !== undefined ? n(3) : n(1), endColumn: m[4] !== undefined ? n(4) : n(2) };
}

async function compile(msg) {
  await prepare();
  const compiler = await snippet.getCompiler();
  await snippet.resetShadow();
  for (const f of msg.files) {
    const path = '/' + f.path.replace(/^\/+/, '');
    if (typeof f.text === 'string') await snippet.addSource(path, f.text);
    else await snippet.mapShadow(path, f.bytes);
  }
  const main = '/' + msg.main.replace(/^\/+/, '');
  const started = performance.now();
  const out = await compiler.compile({ mainFilePath: main, root: '/', format: PDF, diagnostics: 'full' });
  const diagnostics = (out.diagnostics || []).map(d => {
    const where = position(d.range);
    const file = d.package ? d.package + ':' + d.path : String(d.path || '').replace(/^\/+/, '');
    return { file: file, line: where.line, column: where.column, endLine: where.endLine, endColumn: where.endColumn, severity: d.severity, message: d.message };
  });
  const pdf = out.result && out.result.length ? out.result : null;
  self.postMessage({ type: 'compiled', id: msg.id, pdf: pdf, diagnostics: diagnostics, ms: Math.round(performance.now() - started) }, pdf ? [pdf.buffer] : []);
}

let queue = Promise.resolve();
self.onmessage = function (e) {
  const msg = e.data || {};
  if (msg.type === 'warmup') {
    queue = queue.then(() => prepare()).then(
      () => self.postMessage({ type: 'ready' }),
      err => self.postMessage({ type: 'error', message: (err && err.message) || String(err) })
    );
    return;
  }
  if (msg.type === 'compile') {
    queue = queue.then(() => compile(msg)).catch(err => {
      self.postMessage({ type: 'compiled', id: msg.id, pdf: null, diagnostics: [], error: (err && err.message) || String(err) });
    });
  }
};
