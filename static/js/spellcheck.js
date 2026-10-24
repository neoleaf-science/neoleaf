// Spell checker for LaTeX and Markdown in Monaco Editor. Runs 100% in the browser.
// Uses Hunspell dictionaries (Hunspell compiled to WebAssembly, hunspell-asm) in a Web Worker. Ignored words are saved in .neoleaf/dictionary.txt.
(function () {
  'use strict';

  // The page asks for this script as spellcheck.js?v=<build>. The worker and its library get the same version, so a worker left in the
  // browser cache (the CDN keeps static files for hours) is never mixed with a newer page.
  const ASSET_QUERY = (function () {
    try {
      const m = document.currentScript && /[?&]v=([^&#]+)/.exec(document.currentScript.src);
      return m ? '?v=' + m[1] : '';
    } catch (_) {
      return '';
    }
  })();

  let worker = null;
  let state = 'idle'; // 'idle' | 'loading' | 'needs' (waiting for the person to allow the download) | 'ready' | 'backoff' | 'error'
  let loadedLang = null; // language of the dictionary that is ready
  let wantedLang = null; // language being loaded (or last requested)
  let errorLang = null; // language whose dictionary failed to load
  let needLang = null; // language whose dictionary has to be downloaded
  let warned = false;
  let retryAt = 0; // while state is 'backoff', no new request before this time
  const failures = {}; // dictionary -> failures in a row
  let enabled = true;
  let configuredLang = 'auto'; // 'auto' | 'pt-BR' | 'en-US'
  let lastLang = null; // language used by the last check (null: the document has no dictionary)
  let checkTimer = null;
  let checkId = 0;
  let suggestId = 0;

  const projectWords = new Set();
  const sessionIgnored = new Set();
  const suggestionsCache = new Map(); // word -> string[]
  const pendingSuggestions = new Map(); // id -> resolve
  const pendingChecks = new Map(); // id -> { tokens, version }

  const tr = (t, ...args) => {
    let s = (window.T ? window.T(t) : t);
    for (let i = 0; i < args.length; i++) {
      s = s.split('{' + i + '}').join(args[i]);
    }
    return s;
  };

  // Skip LaTeX environments that contain no human prose
  const SKIP_ENVS = new Set([
    'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
    'multline', 'multline*', 'flalign', 'flalign*', 'alignat', 'alignat*',
    'split', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix',
    'verbatim', 'lstlisting', 'minted', 'tikzpicture', 'circuitikz',
    'tabular', 'tabular*'
  ]);

  // Commands whose primary braced argument contains identifiers, keys, paths, or code
  const SKIP_ARGS = new Set([
    'label', 'ref', 'pageref', 'eqref', 'autoref', 'cref', 'Cref',
    'cite', 'citep', 'citet', 'citeauthor', 'citeyear', 'nocite',
    'input', 'include', 'subfile', 'usepackage', 'documentclass',
    'bibliography', 'bibliographystyle', 'addbibresource',
    'includegraphics', 'url', 'href', 'pgfkeys', 'tikzset'
  ]);

  // Tokenize text into words with 1-based line and column coordinates
  function tokenizeLatex(text) {
    const tokens = [];
    const len = text.length;
    let pos = 0;
    let line = 1;
    let col = 1;

    function advance(n) {
      const count = n || 1;
      for (let i = 0; i < count; i++) {
        if (pos >= len) return;
        if (text[pos] === '\n') {
          line++;
          col = 1;
        } else {
          col++;
        }
        pos++;
      }
    }

    function peek(n) {
      return text[pos + (n || 0)];
    }

    function startsWith(str) {
      return text.startsWith(str, pos);
    }

    while (pos < len) {
      // Escaped characters: \%, \$, \&, \_, \#, \{, \}
      if (text[pos] === '\\' && /[%$&_#{}]/.test(peek(1))) {
        advance(2);
        continue;
      }

      // Comments: % until end of line
      if (text[pos] === '%') {
        while (pos < len && text[pos] !== '\n') advance();
        continue;
      }

      // Inline math: $ ... $
      if (text[pos] === '$' && peek(1) !== '$') {
        advance(1);
        while (pos < len && !(text[pos] === '$' && text[pos - 1] !== '\\')) {
          advance();
        }
        if (pos < len) advance(1);
        continue;
      }

      // Display math: $$ ... $$ or \[ ... \] or \( ... \)
      if (startsWith('$$')) {
        advance(2);
        while (pos < len && !startsWith('$$')) advance();
        if (pos < len) advance(2);
        continue;
      }
      if (startsWith('\\[')) {
        advance(2);
        while (pos < len && !startsWith('\\]')) advance();
        if (pos < len) advance(2);
        continue;
      }
      if (startsWith('\\(')) {
        advance(2);
        while (pos < len && !startsWith('\\)')) advance();
        if (pos < len) advance(2);
        continue;
      }

      // \begin{env} ... \end{env}
      if (startsWith('\\begin{')) {
        const match = text.slice(pos).match(/^\\begin\{([a-zA-Z*]+)\}/);
        if (match) {
          const env = match[1];
          if (SKIP_ENVS.has(env) || SKIP_ENVS.has(env.replace(/\*$/, ''))) {
            advance(match[0].length);
            const endMarker = '\\end{' + env + '}';
            while (pos < len && !startsWith(endMarker)) advance();
            if (pos < len) advance(endMarker.length);
            continue;
          }
          advance(match[0].length);
          continue;
        }
      }

      if (startsWith('\\end{')) {
        const match = text.slice(pos).match(/^\\end\{([a-zA-Z*]+)\}/);
        if (match) {
          advance(match[0].length);
          continue;
        }
      }

      // Macros / commands
      if (text[pos] === '\\') {
        const cmdMatch = text.slice(pos).match(/^\\([a-zA-Z]+)/);
        if (cmdMatch) {
          const cmdName = cmdMatch[1];
          advance(cmdMatch[0].length);
          // Optional options [ ... ]
          while (text[pos] === ' ' || text[pos] === '\t') advance();
          if (text[pos] === '[') {
            advance();
            let depth = 1;
            while (pos < len && depth > 0) {
              if (text[pos] === '[' && text[pos - 1] !== '\\') depth++;
              else if (text[pos] === ']' && text[pos - 1] !== '\\') depth--;
              advance();
            }
          }
          while (text[pos] === ' ' || text[pos] === '\t') advance();
          // If in SKIP_ARGS, skip the mandatory {argument}
          if (SKIP_ARGS.has(cmdName) && text[pos] === '{') {
            advance();
            let depth = 1;
            while (pos < len && depth > 0) {
              if (text[pos] === '{' && text[pos - 1] !== '\\') depth++;
              else if (text[pos] === '}' && text[pos - 1] !== '\\') depth--;
              advance();
            }
          }
          continue;
        }
        advance(1);
        continue;
      }

      // Extract words (letters, hyphens and apostrophes)
      const char = text[pos];
      if (/\p{L}/u.test(char)) {
        const startLine = line;
        const startCol = col;
        let word = '';
        while (pos < len && /[\p{L}\-']/u.test(text[pos]) && text[pos] !== '\n') {
          word += text[pos];
          advance();
        }
        while (word.endsWith('-') || word.endsWith("'")) {
          word = word.slice(0, -1);
        }
        // Filter out acronyms (all-caps <= 5 chars), words with digits or single letters
        if (word.length > 1 && !/^[A-Z]{2,5}$/.test(word)) {
          tokens.push({ word: word, line: startLine, startCol: startCol, endCol: startCol + word.length });
        }
        continue;
      }

      advance();
    }

    return tokens;
  }

  // Tokenize Markdown text
  function tokenizeMarkdown(text) {
    const tokens = [];
    const len = text.length;
    let pos = 0;
    let line = 1;
    let col = 1;

    function advance(n) {
      const count = n || 1;
      for (let i = 0; i < count; i++) {
        if (pos >= len) return;
        if (text[pos] === '\n') {
          line++;
          col = 1;
        } else {
          col++;
        }
        pos++;
      }
    }

    while (pos < len) {
      // Fenced code blocks ``` ... ```
      if (text.startsWith('```', pos)) {
        advance(3);
        while (pos < len && !text.startsWith('```', pos)) advance();
        if (pos < len) advance(3);
        continue;
      }

      // Inline code ` ... `
      if (text[pos] === '`') {
        advance(1);
        while (pos < len && text[pos] !== '`' && text[pos] !== '\n') advance();
        if (pos < len && text[pos] === '`') advance(1);
        continue;
      }

      // HTML tags < ... >
      if (text[pos] === '<' && /[a-zA-Z/]/.test(text[pos + 1] || '')) {
        advance(1);
        while (pos < len && text[pos] !== '>') advance();
        if (pos < len) advance(1);
        continue;
      }

      // Bare URLs: skipped up to the next space
      if ((text.startsWith('http://', pos) || text.startsWith('https://', pos))) {
        while (pos < len && !/\s/.test(text[pos])) advance();
        continue;
      }

      // Links [text](url) -> url part skipped
      if (text[pos] === ']' && text[pos + 1] === '(') {
        advance(2);
        while (pos < len && text[pos] !== ')') advance();
        if (pos < len) advance(1);
        continue;
      }

      const char = text[pos];
      if (/\p{L}/u.test(char)) {
        const startLine = line;
        const startCol = col;
        let word = '';
        while (pos < len && /[\p{L}\-']/u.test(text[pos]) && text[pos] !== '\n') {
          word += text[pos];
          advance();
        }
        while (word.endsWith('-') || word.endsWith("'")) {
          word = word.slice(0, -1);
        }
        if (word.length > 1 && !/^[A-Z]{2,5}$/.test(word)) {
          tokens.push({ word: word, line: startLine, startCol: startCol, endCol: startCol + word.length });
        }
        continue;
      }

      advance();
    }

    return tokens;
  }

  // ------------------------------------------------------------------ language

  // The dictionaries NeoLeaf can use (spellcheck-dicts.js, pinned to a commit). The browser downloads one only when a document needs it.
  // A document in any other language is not checked: using the wrong dictionary would underline every word.
  const DICTS = (window.NEOLEAF_DICTS && NEOLEAF_DICTS.list) || [];
  const SUPPORTED = DICTS.map(d => d.id);
  const dictOf = id => DICTS.find(d => d.id === id);

  // Names that babel and polyglossia accept, by dictionary.
  const LANG_NAMES = {
    'pt-BR': ['brazil', 'brazilian', 'brasil', 'ptbr', 'pt-br', 'pt', 'portuguese-brazil'],
    'pt-PT': ['portuges', 'portugues', 'portuguese', 'portugal', 'pt-pt'],
    'en-US': ['english', 'american', 'usenglish', 'canadian', 'en', 'en-us', 'usa'],
    'en-GB': ['british', 'ukenglish', 'australian', 'newzealand', 'en-gb', 'uk'],
    'es-ES': ['spanish', 'es', 'espanol', 'español'],
    'fr-FR': ['french', 'francais', 'frenchb', 'acadian', 'canadien', 'fr'],
    'it-IT': ['italian', 'it'],
    'de-DE': ['german', 'ngerman', 'austrian', 'naustrian', 'swissgerman', 'nswissgerman', 'germanb', 'de']
  };
  // Languages we have no dictionary for ('other': nothing is underlined).
  const OTHER_NAMES = ['catalan', 'galician', 'dutch', 'russian', 'polish', 'swedish', 'norwegian', 'norsk', 'nynorsk', 'danish', 'finnish', 'czech',
    'slovak', 'turkish', 'greek', 'latin', 'hungarian', 'romanian', 'croatian', 'serbian', 'bulgarian', 'ukrainian', 'esperanto', 'icelandic',
    'estonian', 'lithuanian', 'latvian'];

  function classifyName(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return undefined;
    for (const lang of Object.keys(LANG_NAMES)) {
      if (LANG_NAMES[lang].indexOf(n) !== -1) return SUPPORTED.indexOf(lang) !== -1 ? lang : null;
    }
    if (OTHER_NAMES.indexOf(n) !== -1) return null;
    return undefined; // not a language name (draft, utf8...)
  }

  // Language named in the preamble: babel (the last language option, or main=) or polyglossia (\setmainlanguage). undefined: not stated.
  function languageFromPreamble(content) {
    const head = String(content || '').slice(0, 6000);
    const poly = head.match(/\\set(?:main|default)language(?:\[[^\]]*\])?\{([^}]+)\}/i);
    if (poly) {
      const c = classifyName(poly[1]);
      if (c !== undefined) return c;
    }
    const re = /\\usepackage\[([^\]]*)\]\{[^}]*\bbabel\b[^}]*\}/gi;
    let m;
    while ((m = re.exec(head))) {
      let main;
      let last;
      for (const raw of m[1].split(',')) {
        const opt = raw.trim();
        if (/^main\s*=/.test(opt)) {
          const c = classifyName(opt.replace(/^main\s*=\s*/, ''));
          if (c !== undefined) main = c;
          continue;
        }
        if (opt.indexOf('=') !== -1) continue;
        const c = classifyName(opt);
        if (c !== undefined) last = c;
      }
      if (main !== undefined) return main;
      if (last !== undefined) return last;
    }
    return undefined;
  }

  // Frequent words of each language, used when the document does not say which language it is in. The keys that are not a dictionary ('other:...')
  // are languages we recognise only to leave them alone.
  const STOPWORDS = {
    'pt-BR': 'que não uma para com os as em um por dos das mais mas são também seu sua ele ela pelo pela foi ou ao aos nos nas na no do da você isso este esta como'.split(' '),
    'en-US': 'the and of to in is that for with are was this on as by an be from or which we it not have has their these'.split(' '),
    'es-ES': 'el los las del una por con para es en se no como más pero su al también está sus entre este'.split(' '),
    'fr-FR': 'le les des une est que pour dans qui pas sur avec ce ses sont au aux par ne nous vous'.split(' '),
    'de-DE': 'der die das und ist nicht ein eine mit für auf den dem zu von sich auch wir sind des'.split(' '),
    'it-IT': 'il di che per un una con non sono della gli nel anche più come delle alla degli'.split(' '),
    'other:sv': 'och det att en jag som han på är av för med till den har de inte om ett från vi'.split(' '),
    'other:da': 'og det at en den til er som på de med han af for ikke der var mig sig have'.split(' '),
    'other:nb': 'og det som er på en til av med for ikke jeg var den har de om fra'.split(' '),
    'other:nl': 'de het een van en in is dat op te voor met niet zijn er maar ook'.split(' '),
    'other:cs': 'a se na je že to s v o jako pro ale ve by který tak'.split(' '),
    'other:pl': 'nie się w na i z do to że jest jak ale po czy'.split(' '),
    'other:ru': 'и в не на я что он с как это по но они мы'.split(' '),
    'other:tr': 'bir ve bu için ile de da çok daha gibi olarak ama'.split(' ')
  };
  const STOPSETS = {};
  Object.keys(STOPWORDS).forEach(k => { STOPSETS[k] = new Set(STOPWORDS[k]); });

  function languageFromWords(tokens) {
    const scores = {};
    Object.keys(STOPSETS).forEach(k => { scores[k] = 0; });
    const n = Math.min(tokens.length, 3000);
    for (let i = 0; i < n; i++) {
      const w = tokens[i].word.toLowerCase();
      for (const k in STOPSETS) {
        if (STOPSETS[k].has(w)) scores[k]++;
      }
    }
    const ranked = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
    const best = ranked[0];
    const second = ranked[1];
    if (scores[best] >= 4 && scores[best] >= 1.4 * scores[second]) {
      return SUPPORTED.indexOf(best) !== -1 ? best : null;
    }
    return undefined;
  }

  // Dictionary for an interface language code ('pt', 'pt-BR', 'es'...): Portuguese gets the Portuguese one, everything else English.
  function dictionaryForUi(code) {
    return typeof code === 'string' && code.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
  }

  function uiLanguage() {
    try {
      return dictionaryForUi(window.LDI18n && typeof LDI18n.lang === 'function' ? LDI18n.lang() : '');
    } catch (_) {
      return 'en-US';
    }
  }

  // Dictionary for a document: the project setting, then the preamble, then the words, then the interface language.
  // null means the document is in a language without a dictionary: nothing is underlined.
  function chooseLanguage(content, tokens, configured, ui) {
    if (SUPPORTED.indexOf(configured) !== -1) return configured;
    const fromPreamble = languageFromPreamble(content);
    if (fromPreamble !== undefined) return fromPreamble;
    const fromWords = languageFromWords(tokens);
    if (fromWords !== undefined) return fromWords;
    return ui;
  }

  // ------------------------------------------------------------------- worker

  function clearMarkers() {
    if (typeof editor === 'undefined' || !editor || !window.monaco) return;
    const model = editor.getModel();
    if (model) monaco.editor.setModelMarkers(model, 'spellcheck', []);
  }

  function postPersonal() {
    for (const w of projectWords) worker.postMessage({ type: 'addPersonal', word: w });
  }

  // ---- consent: a dictionary is downloaded by the browser (from GitHub) only after the person agrees, once per language

  const consentKey = lang => 'neoleaf.spell.consent.' + lang;
  function hasConsent(lang) {
    try { return localStorage.getItem(consentKey(lang)) === '1'; } catch (_) { return false; }
  }
  function giveConsent(lang) {
    try { localStorage.setItem(consentKey(lang), '1'); } catch (_) {}
  }
  const declined = new Set(); // languages the person answered "Not now" to, in this session

  let banner = null;
  function hideBanner() {
    if (banner) banner.remove();
    banner = null;
  }

  function sizeText(bytes) {
    return (bytes / 1e6).toFixed(1) + ' MB';
  }

  function showBanner(lang, text, buttons) {
    if (typeof editor === 'undefined' || !editor) return;
    hideBanner();
    const host = editor.getContainerDomNode();
    if (!host) return;
    banner = document.createElement('div');
    banner.className = 'spell-banner';
    banner.setAttribute('role', 'status');
    banner.dataset.lang = lang;
    const span = document.createElement('span');
    span.textContent = text;
    banner.appendChild(span);
    (buttons || []).forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = b.primary ? 'btn btn-primary' : 'btn';
      btn.textContent = b.label;
      btn.addEventListener('click', b.run);
      banner.appendChild(btn);
    });
    host.appendChild(banner);
  }

  function askToDownload(lang, bytes) {
    const d = dictOf(lang);
    if (!d || declined.has(lang)) return;
    showBanner(lang,
      tr('Spell check needs the {0} dictionary ({1}). Your browser downloads it from GitHub and keeps it on this device; NeoLeaf\'s server does not store it.', d.label, sizeText(bytes)),
      [
        { label: tr('Download'), primary: true, run: function () { giveConsent(lang); state = 'loading'; showDownloading(lang); worker.postMessage({ type: 'init', lang: lang, allowDownload: true }); } },
        { label: tr('Not now'), run: function () { declined.add(lang); hideBanner(); clearMarkers(); } }
      ]);
  }

  function showDownloading(lang) {
    const d = dictOf(lang);
    if (d) showBanner(lang, tr('Downloading the {0} dictionary...', d.label), []);
  }

  // A dictionary that fails to load is retried twice (a dropped connection while a few MB come down is common) before the notice.
  function failed(lang, message) {
    console.warn('Spell check dictionary for ' + lang + ' could not be loaded: ' + message);
    failures[lang] = (failures[lang] || 0) + 1;
    clearMarkers();
    if (failures[lang] < 3) {
      state = 'backoff';
      wantedLang = null;
      retryAt = Date.now() + failures[lang] * 4000;
      setTimeout(checkNow, failures[lang] * 4000 + 50);
      return;
    }
    state = 'error';
    errorLang = lang;
    hideBanner();
    if (!warned) {
      warned = true;
      if (typeof window.neoToast === 'function') {
        window.neoToast(tr('The spell check dictionary could not be loaded.') + ' (' + String(message).slice(0, 140) + ')');
      }
    }
  }

  function createWorker() {
    worker = new Worker('/static/js/spellcheck-worker.js' + ASSET_QUERY);
    worker.onmessage = function (e) {
      const msg = e.data || {};
      if (msg.type === 'ready') {
        if (msg.lang !== wantedLang) return; // an older request, a newer one is on its way
        state = 'ready';
        loadedLang = msg.lang;
        errorLang = null;
        needLang = null;
        failures[msg.lang] = 0;
        hideBanner();
        postPersonal();
        checkNow();
      } else if (msg.type === 'need') {
        if (msg.lang !== wantedLang) return;
        state = 'needs';
        needLang = msg.lang;
        askToDownload(msg.lang, msg.bytes || 0);
      } else if (msg.type === 'downloading') {
        if (msg.lang === wantedLang) showDownloading(msg.lang);
      } else if (msg.type === 'error') {
        if (msg.lang && msg.lang !== wantedLang) return;
        failed(wantedLang, msg.message || 'unknown error');
      } else if (msg.type === 'result') {
        handleCheckResult(msg);
      } else if (msg.type === 'suggestions') {
        suggestionsCache.set(msg.word, msg.suggestions || []);
        const done = pendingSuggestions.get(msg.id);
        if (done) {
          pendingSuggestions.delete(msg.id);
          done(msg.suggestions || []);
        }
      }
    };
    worker.onerror = function (e) {
      failed(wantedLang, (e && e.message) || 'the worker stopped');
    };
  }

  // Asks the worker for the dictionary of `lang` (once: a request already in progress is not repeated).
  function ensureLanguage(lang) {
    if (state === 'loading' && wantedLang === lang) return;
    if (state === 'needs' && needLang === lang) return;
    if (state === 'ready' && loadedLang === lang) return;
    clearMarkers();
    hideBanner();
    suggestionsCache.clear();
    pendingChecks.clear();
    state = 'loading';
    wantedLang = lang;
    if (!worker) createWorker();
    worker.postMessage({ type: 'init', lang: lang, allowDownload: hasConsent(lang) });
  }

  function getSuggestions(word) {
    if (suggestionsCache.has(word)) return Promise.resolve(suggestionsCache.get(word));
    if (!worker || state !== 'ready') return Promise.resolve([]);
    return new Promise(function (resolve) {
      const id = ++suggestId;
      const timer = setTimeout(function () {
        pendingSuggestions.delete(id);
        resolve([]);
      }, 2500);
      pendingSuggestions.set(id, function (list) {
        clearTimeout(timer);
        resolve(list);
      });
      worker.postMessage({ type: 'suggest', id: id, word: word });
    });
  }

  async function loadProjectDictionary() {
    if (!window.BrowserGit || !(await BrowserGit.isCloned())) return;
    try {
      const text = await BrowserGit.readFile('.neoleaf/dictionary.txt', 'utf8');
      if (typeof text === 'string') {
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const w = lines[i].trim();
          if (w && !w.startsWith('#')) {
            projectWords.add(w.toLowerCase());
            if (worker) worker.postMessage({ type: 'addPersonal', word: w });
          }
        }
      }
    } catch (_) {
      // file does not exist yet
    }
  }

  async function addToDictionary(word) {
    if (!word) return;
    const lower = word.toLowerCase();
    projectWords.add(lower);
    if (worker) worker.postMessage({ type: 'addPersonal', word: word });

    if (window.BrowserGit && (await BrowserGit.isCloned())) {
      try {
        let existing = '';
        try { existing = await BrowserGit.readFile('.neoleaf/dictionary.txt', 'utf8'); } catch (_) {}
        const lines = existing.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.includes(word)) {
          lines.push(word);
          lines.sort((a, b) => a.localeCompare(b));
          await BrowserGit.writeFile('.neoleaf/dictionary.txt', lines.join('\n') + '\n');
        }
      } catch (err) {
        console.error('Could not save to .neoleaf/dictionary.txt', err);
      }
    }

    removeMarkerForWord(word);
  }

  function ignoreWord(word) {
    if (!word) return;
    sessionIgnored.add(word.toLowerCase());
    removeMarkerForWord(word);
  }

  function removeMarkerForWord(word) {
    if (typeof editor === 'undefined' || !editor || !window.monaco) return;
    const model = editor.getModel();
    if (!model) return;
    const markers = monaco.editor.getModelMarkers({ owner: 'spellcheck', resource: model.uri });
    const remaining = markers.filter(m => model.getValueInRange(m).toLowerCase() !== word.toLowerCase());
    monaco.editor.setModelMarkers(model, 'spellcheck', remaining);
  }

  function handleCheckResult(msg) {
    const req = pendingChecks.get(msg.id);
    pendingChecks.delete(msg.id);
    if (!req || msg.id !== checkId) return; // an older request
    if (typeof editor === 'undefined' || !editor || !window.monaco) return;
    const model = editor.getModel();
    if (!model || model.getVersionId() !== req.version) return; // the text changed since: the next check will redo it
    if (msg.lang !== loadedLang) return;

    const misspelledSet = new Set(msg.misspelled || []);
    const markers = [];
    for (let i = 0; i < req.tokens.length; i++) {
      const tok = req.tokens[i];
      if (misspelledSet.has(tok.word)) {
        markers.push({
          severity: monaco.MarkerSeverity.Info,
          message: tr('Possible spelling mistake: "{0}"', tok.word),
          startLineNumber: tok.line,
          startColumn: tok.startCol,
          endLineNumber: tok.line,
          endColumn: tok.endCol,
          owner: 'spellcheck'
        });
      }
    }
    monaco.editor.setModelMarkers(model, 'spellcheck', markers);
  }

  function checkNow() {
    if (typeof editor === 'undefined' || !editor || !window.monaco) return;
    const model = editor.getModel();
    if (!model) return;
    const langId = model.getLanguageId();
    if ((langId !== 'latex' && langId !== 'markdown') || !enabled) {
      monaco.editor.setModelMarkers(model, 'spellcheck', []);
      return;
    }

    const text = editor.getValue();
    const tokens = (langId === 'markdown') ? tokenizeMarkdown(text) : tokenizeLatex(text);
    const target = chooseLanguage(text, tokens, configuredLang, uiLanguage());
    lastLang = target;
    if (!target) {
      monaco.editor.setModelMarkers(model, 'spellcheck', []);
      return;
    }
    if (state === 'backoff' && Date.now() < retryAt) return; // waiting to try the dictionary again
    if (state === 'needs' && needLang === target) { // the person has to allow the download (or has said not now)
      monaco.editor.setModelMarkers(model, 'spellcheck', []);
      return;
    }
    if (state === 'error' && errorLang === target) {
      monaco.editor.setModelMarkers(model, 'spellcheck', []);
      return;
    }
    if (state !== 'ready' || loadedLang !== target) {
      ensureLanguage(target);
      return;
    }

    const wordsToCheck = [];
    const seen = new Set();
    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i].word;
      const lower = w.toLowerCase();
      if (projectWords.has(lower) || sessionIgnored.has(lower)) continue;
      if (!seen.has(w)) {
        seen.add(w);
        wordsToCheck.push(w);
      }
    }

    if (!wordsToCheck.length) {
      monaco.editor.setModelMarkers(model, 'spellcheck', []);
      return;
    }

    checkId++;
    pendingChecks.set(checkId, { tokens: tokens, version: model.getVersionId() });
    worker.postMessage({ type: 'check', id: checkId, words: wordsToCheck });
  }

  function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkNow, 500);
  }

  function registerCodeActions() {
    if (typeof monaco === 'undefined' || !monaco.languages) return;

    // Register global commands for quick fixes
    if (monaco.editor && monaco.editor.registerCommand) {
      try {
        monaco.editor.registerCommand('ld-add-to-dictionary', function (_, word) {
          addToDictionary(word);
        });
        monaco.editor.registerCommand('ld-ignore-word', function (_, word) {
          ignoreWord(word);
        });
      } catch (_) {}
    }

    const provider = {
      provideCodeActions: async function (model, range, context) {
        const actions = [];
        const markers = context.markers || [];
        for (let i = 0; i < markers.length; i++) {
          const marker = markers[i];
          if (marker.owner !== 'spellcheck') continue;

          const word = model.getValueInRange(marker);
          const suggestions = await getSuggestions(word); // asked only for the word under the cursor

          for (let j = 0; j < suggestions.length; j++) {
            const sug = suggestions[j];
            actions.push({
              title: tr('Change to "{0}"', sug),
              diagnostics: [marker],
              kind: 'quickfix',
              isPreferred: j === 0,
              edit: {
                edits: [{
                  resource: model.uri,
                  textEdit: {
                    range: new monaco.Range(marker.startLineNumber, marker.startColumn, marker.endLineNumber, marker.endColumn),
                    text: sug
                  }
                }]
              }
            });
          }

          actions.push({
            title: tr('Add "{0}" to project dictionary', word),
            diagnostics: [marker],
            kind: 'quickfix',
            command: {
              id: 'ld-add-to-dictionary',
              title: tr('Add to project dictionary'),
              arguments: [word]
            }
          });

          actions.push({
            title: tr('Ignore "{0}" in this session', word),
            diagnostics: [marker],
            kind: 'quickfix',
            command: {
              id: 'ld-ignore-word',
              title: tr('Ignore in this session'),
              arguments: [word]
            }
          });
        }

        return { actions: actions, dispose: function () {} };
      }
    };

    monaco.languages.registerCodeActionProvider('latex', provider);
    monaco.languages.registerCodeActionProvider('markdown', provider);
  }

  async function loadConfig() {
    try {
      if (window.Project && Project.config) {
        const d = await Project.config.get();
        if (d && d.config) {
          enabled = d.config.spellCheck !== false;
          configuredLang = d.config.spellLanguage || 'auto';
        }
      }
    } catch (_) {}
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    enabled = cfg.spellCheck !== false;
    configuredLang = cfg.spellLanguage || 'auto';
    errorLang = null; // a new choice is a new chance for a dictionary that failed
    Object.keys(failures).forEach(k => { failures[k] = 0; });
    warned = false;
    declined.clear();
    hideBanner();
    if (state === 'error' || state === 'backoff' || state === 'needs') state = 'idle';
    if (!enabled) clearMarkers();
    else checkNow();
  }

  window.addEventListener('editor-ready', async function () {
    await loadConfig();
    await loadProjectDictionary();
    registerCodeActions();

    if (typeof editor !== 'undefined' && editor) {
      editor.onDidChangeModelContent(function (e) {
        if (e && e.isFlush) clearMarkers(); // the whole text was replaced: old underlines would sit on the wrong words
        scheduleCheck();
      });
      editor.onDidChangeModel(function () {
        clearMarkers();
        scheduleCheck();
      });
      scheduleCheck();
    }
  });

  window.SpellCheck = {
    checkNow: checkNow,
    applyConfig: applyConfig,
    addToDictionary: addToDictionary,
    ignoreWord: ignoreWord,
    // Dictionary chosen for a text ('pt-BR', 'en-US' or null when there is none), as the editor would choose it; used by the tests.
    detectLanguage: function (text, kind, configured, uiCode) {
      const tokens = kind === 'markdown' ? tokenizeMarkdown(text) : tokenizeLatex(text);
      return chooseLanguage(text, tokens, configured || 'auto', dictionaryForUi(uiCode));
    },
    getEnabled: function () { return enabled; },
    getLanguage: function () { return configuredLang; },
    getActiveLanguage: function () { return lastLang; },
    getState: function () { return state; },
    suggest: getSuggestions,
    languages: function () { return SUPPORTED.slice(); }
  };
})();
