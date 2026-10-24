// Web Worker for Hunspell spell checking (hunspell-asm, Hunspell compiled to WebAssembly). Runs off the main UI thread.
//
// NeoLeaf hosts no dictionary. A dictionary is downloaded by the browser from the address pinned in spellcheck-dicts.js (GitHub, then a mirror),
// checked against its SHA-256 and kept in the browser's Cache API on this device: it never goes to the NeoLeaf server or to the project repository.
// Messages are handled one at a time, in order, so a language change never overlaps another one.
/* global importScripts, HunspellAsm, NEOLEAF_DICTS */
importScripts(
  '/static/vendor/hunspell-asm.min.js' + self.location.search, // same ?v= as the page, see spellcheck.js
  '/static/js/spellcheck-dicts.js' + self.location.search
);

const CACHE_NAME = 'neoleaf-dictionaries-v1';

let factory = null;
let hunspell = null;
let mounted = [];
let currentLang = null;
const personal = new Set(); // lower-case words that are always accepted

function dictInfo(lang) {
  return NEOLEAF_DICTS.list.find(d => d.id === lang);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function verified(bytes, file) {
  return bytes.length === file.size && (await sha256Hex(bytes)) === file.sha256;
}

// The bytes kept from an earlier download, or null (also when what is kept does not match the pinned hash).
async function fromCache(cache, file) {
  const hit = await cache.match(NEOLEAF_DICTS.raw + file.path);
  if (!hit) return null;
  const bytes = new Uint8Array(await hit.arrayBuffer());
  return (await verified(bytes, file)) ? bytes : null;
}

// Downloads one file: the pinned GitHub address first, the jsDelivr mirror when that fails. Only bytes with the pinned size and SHA-256 are accepted.
async function download(file) {
  const problems = [];
  for (const base of [NEOLEAF_DICTS.raw, NEOLEAF_DICTS.mirror]) {
    try {
      const res = await fetch(base + file.path);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!(await verified(bytes, file))) throw new Error('the file does not match the pinned SHA-256');
      return bytes;
    } catch (err) {
      problems.push(new URL(base).host + ': ' + ((err && err.message) || err));
    }
  }
  throw new Error('could not download ' + file.path + ' (' + problems.join('; ') + ')');
}

// The old Hunspell files are not all UTF-8 (the German one is ISO-8859-1): they are converted here, after the hash was checked.
function toUtf8(bytes, encoding) {
  if (encoding === 'utf-8') return bytes;
  const text = new TextDecoder(encoding).decode(bytes).replace(/^SET[ \t]+\S+/m, 'SET UTF-8');
  return new TextEncoder().encode(text);
}

function release() {
  if (hunspell) {
    try { hunspell.dispose(); } catch (_) {}
  }
  for (const p of mounted) {
    try { factory.unmount(p); } catch (_) {}
  }
  hunspell = null;
  mounted = [];
  currentLang = null;
}

// Returns 'ready', or 'need' when the dictionary has to be downloaded and the person has not agreed yet.
async function load(lang, allowDownload) {
  const info = dictInfo(lang);
  if (!info) throw new Error('no dictionary for ' + lang);
  const cache = await caches.open(CACHE_NAME);
  const bytes = {};
  const missing = [];
  for (const file of info.files) {
    const kept = await fromCache(cache, file);
    if (kept) bytes[file.ext] = kept;
    else missing.push(file);
  }
  if (missing.length) {
    if (!allowDownload) {
      self.postMessage({ type: 'need', lang: lang, bytes: missing.reduce((n, f) => n + f.size, 0) });
      return 'need';
    }
    self.postMessage({ type: 'downloading', lang: lang });
    for (const file of missing) {
      bytes[file.ext] = await download(file);
      await cache.put(NEOLEAF_DICTS.raw + file.path, new Response(bytes[file.ext]));
    }
  }
  // the default wait for the runtime is 3 s, too short for a slow machine
  if (!factory) factory = await HunspellAsm.loadModule({ timeout: 60000 });
  release();
  const affPath = factory.mountBuffer(toUtf8(bytes.aff, info.encoding), lang + '.aff');
  const dicPath = factory.mountBuffer(toUtf8(bytes.dic, info.encoding), lang + '.dic');
  mounted = [affPath, dicPath];
  hunspell = factory.create(affPath, dicPath);
  currentLang = lang;
  for (const w of personal) hunspell.addWord(w);
  return 'ready';
}

async function handle(msg) {
  if (msg.type === 'init') {
    if (msg.lang === currentLang && hunspell) {
      self.postMessage({ type: 'ready', lang: msg.lang });
      return;
    }
    try {
      if ((await load(msg.lang, msg.allowDownload === true)) === 'ready') self.postMessage({ type: 'ready', lang: msg.lang });
    } catch (err) {
      release();
      self.postMessage({ type: 'error', lang: msg.lang, message: (err && err.message) || String(err) });
    }
    return;
  }

  if (msg.type === 'check') {
    const misspelled = [];
    if (hunspell) {
      const words = msg.words || [];
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (personal.has(w.toLowerCase())) continue;
        if (!hunspell.spell(w)) misspelled.push(w);
      }
    }
    self.postMessage({ type: 'result', id: msg.id, lang: currentLang, misspelled: misspelled });
    return;
  }

  if (msg.type === 'suggest') {
    const word = msg.word || '';
    const suggestions = hunspell && word ? hunspell.suggest(word).slice(0, 5) : [];
    self.postMessage({ type: 'suggestions', id: msg.id, word: word, suggestions: suggestions });
    return;
  }

  if (msg.type === 'addPersonal') {
    const word = msg.word;
    if (word) {
      personal.add(word.toLowerCase());
      if (hunspell) hunspell.addWord(word);
    }
  }
}

let queue = Promise.resolve();
self.onmessage = function (e) {
  const msg = e.data || {};
  queue = queue.then(() => handle(msg)).catch(err => {
    self.postMessage({ type: 'error', lang: currentLang, message: (err && err.message) || String(err) });
  });
};
