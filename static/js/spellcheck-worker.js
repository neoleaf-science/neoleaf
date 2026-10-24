// Web Worker for Hunspell spell checking (hunspell-asm, Hunspell compiled to WebAssembly). Runs off the main UI thread.
// Messages are handled one at a time, in order, so a language change never overlaps another one.
/* global importScripts, HunspellAsm */
importScripts('/static/vendor/hunspell-asm.min.js' + self.location.search); // same ?v= as the page, see spellcheck.js

// Bump when a file in /static/dict changes: the server sends the dictionaries with "immutable", so the URL has to change.
const DICT_VERSION = '2';

let factory = null;
let hunspell = null;
let mounted = [];
let currentLang = null;
const personal = new Set(); // lower-case words that are always accepted

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return new Uint8Array(await res.arrayBuffer());
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

async function load(lang) {
  // the default wait for the runtime is 3 s, too short for a slow machine
  if (!factory) factory = await HunspellAsm.loadModule({ timeout: 60000 });
  const base = '/static/dict/' + encodeURIComponent(lang);
  const [aff, dic] = await Promise.all([
    fetchBytes(base + '.aff?v=' + DICT_VERSION),
    fetchBytes(base + '.dic?v=' + DICT_VERSION)
  ]);
  release();
  const affPath = factory.mountBuffer(aff, lang + '.aff');
  const dicPath = factory.mountBuffer(dic, lang + '.dic');
  mounted = [affPath, dicPath];
  hunspell = factory.create(affPath, dicPath);
  currentLang = lang;
  for (const w of personal) hunspell.addWord(w);
}

async function handle(msg) {
  if (msg.type === 'init') {
    if (msg.lang === currentLang && hunspell) {
      self.postMessage({ type: 'ready', lang: msg.lang });
      return;
    }
    try {
      await load(msg.lang);
      self.postMessage({ type: 'ready', lang: msg.lang });
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
