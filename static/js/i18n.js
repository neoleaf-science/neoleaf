// Internationalization. English is the source language of the system and the key of every translation.
// Each other language is one file, static/js/i18n-<code>.js, which adds `window.LD_I18N[<code>] = { "English text": "translation" }`.
// Only the file of the language in use is loaded (synchronously while the page is parsed, so nothing flashes in English).
// Translates what is already on the page (and what the JavaScript inserts later), tooltips/attributes and
// alert/confirm/prompt. File text, the editor and project names are never touched.
(function () {
  const KEY = 'ld-lang';
  // The languages, in the order of the picker, each with its own name. English is the source; the others have a file.
  const LANGS = { en: 'English', cs: 'Čeština', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', sv: 'Svenska', tr: 'Türkçe', it: 'Italiano', zh: '简体中文', nb: 'Norsk', ru: 'Русский', da: 'Dansk', ko: '한국어', ja: '日本語' };
  const HTML_LANG = { en: 'en', cs: 'cs', es: 'es', pt: 'pt-BR', fr: 'fr', de: 'de', sv: 'sv', tr: 'tr', it: 'it', zh: 'zh-CN', nb: 'nb', ru: 'ru', da: 'da', ko: 'ko', ja: 'ja' };
  // the privacy policy and the terms are translated only into these; in the others the page shows its English text and a notice
  const LEGAL_LANGS = ['en', 'pt', 'es', 'zh'];
  // the version of this script (?v=...) is reused for the language files, so a deploy refreshes them together
  const VERSION = (document.currentScript && (document.currentScript.src.split('?')[1] || '')) || '';
  const langUrl = l => `/static/js/i18n-${l}.js${VERSION ? '?' + VERSION : ''}`;
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  const SKIP = '[data-no-i18n], .lang-select, .monaco-editor, .monaco-diff-editor, .pdf-pages, #raw-log, pre, code, textarea, script, style, .tree-name, .tab-name, .pl-title, .pk-name, .perm-name, .perm-email, .hist-user, .project-title, #name-title, .collab-avatar, .cmt-text, .cmt-quote, .cmt-diff, .cmt-author, .cmt-where, .mm-node, .ol-title, .ol-file';

  let lang = 'en';
  let exact = new Map();       // English text -> translation, for the language in use
  let patterns = [];           // texts with {0}, {1}... : { re, names, src, tr }
  let builtFor = 'en';
  let builtTable;              // the table the lookups were built from (to notice when the file arrives later)

  /** Builds the lookup tables of `l` from window.LD_I18N[l] (nothing to do when it is English or not loaded yet). */
  function build(l) {
    exact = new Map();
    patterns = [];
    builtFor = l;
    const table = (window.LD_I18N || {})[l];
    builtTable = table;
    if (!table) return;
    for (const src of Object.keys(table)) {
      const tr = table[src];
      if (/\{\d+\}/.test(src)) {
        const names = [];
        const re = '^' + src.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\d+\}/g, m => { names.push(+m.slice(1, -1)); return '([\\s\\S]*?)'; }) + '$';
        patterns.push({ re: new RegExp(re), names, src, tr });
      } else {
        exact.set(src, tr);
      }
    }
    // most specific patterns (more fixed text) first
    patterns.sort((a, b) => b.src.replace(/\{\d+\}/g, '').length - a.src.replace(/\{\d+\}/g, '').length);
  }

  /** The translation table of `l` is in memory (English needs none). */
  const loaded = l => l === 'en' || !!(window.LD_I18N && window.LD_I18N[l]);

  /** Loads the language file; resolves true when the language is usable. */
  function load(l) {
    if (!LANGS[l]) return Promise.resolve(false);
    if (loaded(l)) return Promise.resolve(true);
    return new Promise(resolve => {
      const el = document.createElement('script');
      el.src = langUrl(l);
      el.onload = () => resolve(loaded(l));
      el.onerror = () => resolve(false);
      document.head.appendChild(el);
    });
  }

  function fill(tpl, vals) { return tpl.replace(/\{(\d+)\}/g, (m, i) => (vals[+i] !== undefined ? vals[+i] : m)); }

  // translates an English text; returns the text itself when there is no translation
  function t(src, ...args) {
    if (typeof src !== 'string') return src;
    let out = src;
    if (lang !== 'en') {
      if (builtFor !== lang || builtTable !== (window.LD_I18N || {})[lang]) build(lang);
      const tr = exact.get(src);
      if (tr) out = tr;
      else {
        for (const p of patterns) {
          const m = p.re.exec(src);
          if (!m) continue;
          const vals = {};
          p.names.forEach((n, i) => { vals[n] = translateInner(m[i + 1]); });
          out = fill(p.tr || src, vals);
          break;
        }
      }
    }
    return args.length ? fill(out, args) : out;
  }

  // short variable parts that have a translation too (e.g. "the file", "(you)")
  function translateInner(s) {
    return exact.get(s) || s;
  }

  // ---------------------------------------------------------------- DOM
  const textOrig = new WeakMap();   // text node -> { orig, shown }
  const attrOrig = new WeakMap();   // elemento -> { attr: { orig, shown } }
  const htmlOrig = new WeakMap();   // elemento (data-i18n-html) -> { orig, shown }

  const skipped = el => !el || (el.closest && el.closest(SKIP));
  const norm = s => s.replace(/\s+/g, ' ').trim();

  function doText(node) {
    const el = node.parentElement;
    if (!el || skipped(el) || el.closest('[data-i18n-html]')) return;
    let rec = textOrig.get(node);
    const cur = node.nodeValue;
    if (!rec || cur !== rec.shown) rec = { orig: cur, shown: cur };   // new text (or replaced by the page code)
    const core = norm(rec.orig);
    if (!core) { textOrig.set(node, rec); return; }
    const lead = rec.orig.match(/^\s*/)[0], trail = rec.orig.match(/\s*$/)[0];
    const tr = lang === 'en' ? core : t(core);
    const shown = lead + (tr === core ? core : tr) + trail;
    const next = lang === 'en' ? rec.orig : (tr === core ? rec.orig : shown);
    if (node.nodeValue !== next) node.nodeValue = next;
    textOrig.set(node, { orig: rec.orig, shown: next });
  }

  function doAttrs(el) {
    // text typed by the user is not translated, but the field hint (placeholder) and the project tag buttons belong to the interface
    if (skipped(el) && !el.matches('textarea, .pl-tag, .pl-tag-add')) return;
    let map = attrOrig.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      const rec = map && map[a] && map[a].shown === cur ? map[a] : { orig: cur, shown: cur };
      const tr = lang === 'en' ? rec.orig : t(norm(rec.orig));
      const next = lang === 'en' || tr === norm(rec.orig) ? rec.orig : tr;
      if (cur !== next) el.setAttribute(a, next);
      if (!map) { map = {}; attrOrig.set(el, map); }
      map[a] = { orig: rec.orig, shown: next };
    }
  }

  function doHtml(el) {
    const cur = el.innerHTML;
    let rec = htmlOrig.get(el);
    if (!rec || cur !== rec.shown) rec = { orig: cur, shown: cur };
    const core = norm(rec.orig);
    const tr = lang === 'en' ? core : t(core);
    const next = lang === 'en' || tr === core ? rec.orig : tr;
    if (cur !== next) el.innerHTML = next;
    htmlOrig.set(el, { orig: rec.orig, shown: next });
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches('[data-i18n-html]')) { doHtml(root); return; }
    doAttrs(root);
    for (const el of root.querySelectorAll('[data-i18n-html]')) doHtml(el);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === 1) return (n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.hasAttribute('data-i18n-html')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    const texts = [];
    while ((n = tw.nextNode())) texts.push(n);
    texts.forEach(doText);
    root.querySelectorAll('[title],[placeholder],[aria-label],[alt]').forEach(doAttrs);
  }

  let busy = false;
  const observer = new MutationObserver(muts => {
    if (busy) return;
    busy = true;
    try {
      for (const m of muts) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else m.addedNodes.forEach(n => walk(n));
      }
      // page title
      doText(document.querySelector('title') && document.querySelector('title').firstChild);
    } finally { busy = false; observer.takeRecords(); }
  });

  function startObserver() {
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function apply() {
    document.documentElement.lang = HTML_LANG[lang];
    const note = document.getElementById('legal-lang-note');   // privacy and terms pages: only some languages have the full text
    if (note) note.hidden = LEGAL_LANGS.includes(lang);
    busy = true;
    try {
      walk(document.documentElement);
      const title = document.querySelector('title');
      if (title && title.firstChild) doText(title.firstChild);
    } finally { busy = false; observer.takeRecords(); }
    window.dispatchEvent(new CustomEvent('ld-lang-change', { detail: { lang } }));
  }

  // ---------------------------------------------------------------- language choice
  function detect() {
    for (const raw of navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']) {
      const n = String(raw).toLowerCase();
      if (/^(no|nb|nn)\b/.test(n)) return 'nb';       // Norwegian: Bokmål is the written form we ship
      const code = n.slice(0, 2);
      if (LANGS[code]) return code;
    }
    return 'en';
  }

  function pref() {
    try { const v = localStorage.getItem(KEY); if (LANGS[v]) return v; } catch (_) {}
    const c = (document.cookie.match(/(?:^|; )ld_lang=([^;]*)/) || [])[1];   // profile language, written at login
    return LANGS[c] ? c : detect();
  }

  async function setLang(l) {
    if (!LANGS[l]) return;
    if (!(await load(l))) return;   // the file could not be loaded: keep the language in use
    lang = l;
    build(l);
    try { localStorage.setItem(KEY, l); } catch (_) {}
    apply();
    document.querySelectorAll('.lang-select').forEach(s => { s.value = l; });
    // the preference stays in this browser only
  }

  function syncFromProfile() {
    document.querySelectorAll('.lang-select').forEach(s => { s.value = lang; });
  }

  function mount() {
    document.querySelectorAll('[data-lang-picker]').forEach(host => {
      if (host.firstChild) return;
      const sel = document.createElement('select');
      sel.className = 'theme-select lang-select';
      sel.setAttribute('data-no-i18n', '');
      sel.title = 'Language';
      Object.keys(LANGS).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = LANGS[k]; sel.appendChild(o); });
      sel.value = lang;
      sel.addEventListener('change', () => setLang(sel.value));
      host.appendChild(sel);
    });
  }

  // alert / confirm / prompt are translated too
  const nativeAlert = window.alert.bind(window), nativeConfirm = window.confirm.bind(window), nativePrompt = window.prompt.bind(window);
  window.alert = m => nativeAlert(t(String(m)));
  window.confirm = m => nativeConfirm(t(String(m)));
  window.prompt = (m, d) => nativePrompt(t(String(m)), d);

  lang = pref();
  // the chosen language is loaded right now, while the page is still being parsed, so the first paint is already translated
  if (lang !== 'en' && !loaded(lang)) {
    if (document.readyState === 'loading') document.write(`<script src="${langUrl(lang)}"><\/script>`);   // runs before the next script
    else load(lang).then(ok => { if (ok) apply(); else lang = 'en'; });
  }
  window.T = t;
  window.LDI18n = { t, locale: () => HTML_LANG[lang], setLang, lang: () => lang, langs: LANGS, mount, load };

  document.addEventListener('DOMContentLoaded', () => {
    if (!loaded(lang)) lang = 'en';   // the file did not load (offline, blocked): English, the source language
    mount();
    apply();
    startObserver();
    syncFromProfile();
  });
})();
