// Badness in the editor: format document, syntax errors and style findings (with their quick fixes) for LaTeX and BibTeX files.
// Badness is compiled to WebAssembly and runs in a Web Worker (badness-worker.js) on the text of the open file: nothing leaves the browser.
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).
//
// The rules that need the whole project (undefined references and citations, duplicate labels across files) are not run by Badness here: the editor's
// own warnings (autocomplete.js) already cover them with the project's files.

// The page asks for this script as badness.js?v=<build>: the worker and its WebAssembly get the same version, so a worker kept in a cache is never
// mixed with a newer page.
const BADNESS_QUERY = (function () {
  try {
    const m = document.currentScript && /[?&]v=([^&#]+)/.exec(document.currentScript.src);
    return m ? '?v=' + m[1] : '';
  } catch (_) {
    return '';
  }
})();

(function () {
  const OWNER = 'badness';
  const DEFAULTS = { styleCheck: true, formatWrap: 'reflow', formatLineWidth: 80 };
  const WRAPS = ['reflow', 'sentence', 'semantic', 'preserve'];

  let worker = null;
  let callId = 0;
  const calls = new Map();   // id -> { resolve, reject }
  let options = { ...DEFAULTS };
  let lintTimer = null;
  let found = null;          // { uri, version, findings } of the last check, for the quick fixes

  function getWorker() {
    if (worker) return worker;
    worker = new Worker('/static/js/badness-worker.js' + BADNESS_QUERY);
    worker.onmessage = function (e) {
      const msg = e.data || {};
      const call = calls.get(msg.id);
      if (!call) return;
      calls.delete(msg.id);
      if (msg.type === 'error') call.reject(new Error(msg.message));
      else call.resolve(msg);
    };
    worker.onerror = function (e) {
      const err = new Error((e && e.message) || 'the worker stopped');
      for (const [id, call] of calls) { calls.delete(id); call.reject(err); }
      worker = null;
    };
    return worker;
  }

  function request(type, payload) {
    return new Promise((resolve, reject) => {
      const id = ++callId;
      calls.set(id, { resolve, reject });
      try { getWorker().postMessage({ type: type, id: id, ...payload }); } catch (err) { calls.delete(id); reject(err); }
    });
  }

  // 'tex', 'sty-cls', 'dtx' or 'bib' for a file name; null for what Badness does not read
  function kindOf(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
    const ext = m ? m[1].toLowerCase() : '';
    if (ext === 'bib') return 'bib';
    if (['sty', 'cls', 'clo', 'def', 'ldf', 'fd', 'bbx', 'cbx', 'lbx'].includes(ext)) return 'sty-cls';
    if (ext === 'dtx') return 'dtx';
    if (['tex', 'ltx', 'latex'].includes(ext)) return 'tex';
    return null;
  }

  function currentKind(model) {
    const id = model && model.getLanguageId();
    if (id === 'bibtex') return 'bib';
    if (id !== 'latex') return null;
    return kindOf(typeof currentFileId === 'string' ? currentFileId : '') || 'tex';
  }

  const formatOptions = () => ({ lineWidth: options.formatLineWidth, indentWidth: 2, wrap: options.formatWrap });

  // ---------------------------------------------------------------- findings in the editor

  const SEVERITY = () => ({ error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info, hint: monaco.MarkerSeverity.Hint });

  function clearMarkers() {
    found = null;
    if (typeof editor === 'undefined' || !editor || !window.monaco) return;
    const model = editor.getModel();
    if (model) monaco.editor.setModelMarkers(model, OWNER, []);
  }

  async function lintNow() {
    if (!options.styleCheck || typeof editor === 'undefined' || !editor || !window.monaco) return;
    const model = editor.getModel();
    const kind = currentKind(model);
    if (!model || !kind) { clearMarkers(); return; }
    if (model.getValueLength() > 1500000) { clearMarkers(); return; } // a huge file would keep the worker busy on every pause in typing
    const version = model.getVersionId();
    let res;
    try {
      res = await request('check', { text: model.getValue(), kind: kind });
    } catch (err) {
      console.warn('Badness:', err.message);
      return;
    }
    if (model.isDisposed() || model.getVersionId() !== version || !options.styleCheck) return; // the text changed meanwhile: a newer check is on its way
    const sev = SEVERITY();
    const markers = res.findings.map(f => {
      const a = model.getPositionAt(f.start);
      const b = model.getPositionAt(f.end);
      return {
        severity: sev[f.severity] || sev.warning,
        message: f.message,
        code: f.rule,
        source: 'Badness',
        startLineNumber: a.lineNumber,
        startColumn: a.column,
        endLineNumber: b.lineNumber,
        endColumn: Math.max(b.column, a.lineNumber === b.lineNumber ? a.column + 1 : b.column)
      };
    });
    monaco.editor.setModelMarkers(model, OWNER, markers);
    found = { uri: model.uri.toString(), version: version, findings: res.findings };
  }

  function lintSoon() {
    clearTimeout(lintTimer);
    lintTimer = setTimeout(lintNow, 900);
  }

  // ---------------------------------------------------------------- edits

  // One edit that turns `before` into `after`: the common beginning and end stay untouched, so the collaborators' cursors and the undo history are not disturbed
  function minimalEdit(model, before, after) {
    if (before === after) return null;
    let start = 0;
    const max = Math.min(before.length, after.length);
    while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
    let endB = before.length;
    let endA = after.length;
    while (endB > start && endA > start && before.charCodeAt(endB - 1) === after.charCodeAt(endA - 1)) { endB--; endA--; }
    const a = model.getPositionAt(start);
    const b = model.getPositionAt(endB);
    return { range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column), text: after.slice(start, endA) };
  }

  async function formatText(text, kind) {
    const res = await request('format', { text: text, kind: kind, options: formatOptions() });
    return res.text;
  }

  function registerFormatter() {
    const provider = {
      displayName: 'Badness',
      provideDocumentFormattingEdits: async function (model) {
        const kind = currentKind(model);
        if (!kind) return [];
        const before = model.getValue();
        let after;
        try {
          after = await formatText(before, kind);
        } catch (err) {
          if (typeof updateStatus === 'function') updateStatus('error', T('Could not format the document: {0}', err.message));
          return [];
        }
        if (model.getValue() !== before) return []; // the text changed while formatting
        const edit = minimalEdit(model, before, after);
        return edit ? [edit] : [];
      }
    };
    monaco.languages.registerDocumentFormattingEditProvider('latex', provider);
    monaco.languages.registerDocumentFormattingEditProvider('bibtex', provider);
  }

  function registerQuickFixes() {
    const provider = {
      provideCodeActions: function (model, range, context) {
        if (!found || found.uri !== model.uri.toString() || found.version !== model.getVersionId()) return { actions: [], dispose: function () {} };
        const actions = [];
        for (const marker of context.markers) {
          if (marker.source !== 'Badness') continue;
          const f = found.findings.find(x => x.rule === marker.code && model.getPositionAt(x.start).lineNumber === marker.startLineNumber && model.getPositionAt(x.start).column === marker.startColumn);
          if (!f || !f.fix) continue;
          actions.push({
            title: f.fix.description,
            diagnostics: [marker],
            kind: 'quickfix',
            isPreferred: f.fix.safe,
            edit: {
              edits: f.fix.edits.map(e => {
                const a = model.getPositionAt(e.start);
                const b = model.getPositionAt(e.end);
                return { resource: model.uri, textEdit: { range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column), text: e.content } };
              })
            }
          });
        }
        return { actions: actions, dispose: function () {} };
      }
    };
    monaco.languages.registerCodeActionProvider('latex', provider);
    monaco.languages.registerCodeActionProvider('bibtex', provider);
  }

  // Applies every automatic fix that cannot change the meaning of the text
  async function fixAll() {
    if (typeof editor === 'undefined' || !editor) return;
    const model = editor.getModel();
    const kind = currentKind(model);
    if (!kind) return;
    const before = model.getValue();
    try {
      const after = (await request('fix', { text: before, kind: kind, includeUnsafe: false })).text;
      if (model.getValue() !== before) return;
      const edit = minimalEdit(model, before, after);
      if (!edit) { if (typeof updateStatus === 'function') updateStatus('saved', T('Nothing to fix automatically')); return; }
      editor.executeEdits('badness-fix-all', [edit]);
      editor.pushUndoStop();
      if (typeof updateStatus === 'function') updateStatus('saved', T('Fixes applied'));
    } catch (err) {
      if (typeof updateStatus === 'function') updateStatus('error', T('Could not fix the document: {0}', err.message));
    }
  }

  function registerActions() {
    editor.addAction({
      id: 'badness.fixAll',
      label: T('Fix all style issues'),
      contextMenuGroupId: 'modification',
      contextMenuOrder: 2.5,
      precondition: null,
      run: fixAll
    });
    editor.addAction({
      id: 'ld.wrapMode',
      label: T('Line wrapping: next mode'),
      contextMenuGroupId: 'modification',
      contextMenuOrder: 2.6,
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
      run: cycleWrap
    });
  }

  // ---------------------------------------------------------------- settings

  function readConfig(cfg) {
    cfg = cfg || {};
    options = {
      styleCheck: cfg.styleCheck !== false,
      formatWrap: WRAPS.includes(cfg.formatWrap) ? cfg.formatWrap : DEFAULTS.formatWrap,
      formatLineWidth: Math.max(40, Math.min(200, parseInt(cfg.formatLineWidth, 10) || DEFAULTS.formatLineWidth))
    };
  }

  // Line wrapping is a personal choice, kept in this browser (not in the project, which is shared and goes to Git):
  //   format  LaTeX and BibTeX lines wrap at the width Format Document uses (never wider than the window), so the screen matches what the formatter writes;
  //           other files wrap at the window                                                                       (the default)
  //   window  every file wraps at the edge of the window
  //   off     lines do not wrap: they scroll sideways
  const WRAP_KEY = 'neoleaf.editor.wrap';
  const WRAP_MODES = ['format', 'window', 'off'];

  function wrapMode() {
    try { const v = localStorage.getItem(WRAP_KEY); return WRAP_MODES.includes(v) ? v : 'format'; } catch (_) { return 'format'; }
  }

  // LaTeX and BibTeX are shown in a monospaced font, so that a column of the editor is one character and "80" on the screen is the 80 characters of the
  // formatter. (The page's reset `* { font-family }` reaches the spans that Monaco draws and made them proportional, which also threw its measures off:
  // see the `ld-mono` rule in editor.css.)
  const MONO_FONT = 'Consolas, "SFMono-Regular", Menlo, "DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace';
  let baseFont = null;

  function applyLayout() {
    if (typeof editor === 'undefined' || !editor || !window.monaco) return;
    const mode = wrapMode();
    const model = editor.getModel();
    const id = model && model.getLanguageId();
    const mono = id === 'latex' || id === 'bibtex';
    if (baseFont === null) baseFont = editor.getOption(monaco.editor.EditorOption.fontFamily);
    const box = document.getElementById('monaco-container');
    if (box) box.classList.toggle('ld-mono', mono);
    const font = mono ? MONO_FONT : baseFont;
    if (editor.getOption(monaco.editor.EditorOption.fontFamily) !== font) editor.updateOptions({ fontFamily: font });
    if (mode === 'off') editor.updateOptions({ wordWrap: 'off' });
    else if (mode === 'format' && mono) editor.updateOptions({ wordWrap: 'bounded', wordWrapColumn: options.formatLineWidth });
    else editor.updateOptions({ wordWrap: 'on' });
  }

  function wrapLabel(mode) {
    return mode === 'off' ? T('turned off') : mode === 'window' ? T('at the window edge') : T('at the formatter width ({0} columns)', options.formatLineWidth);
  }

  function setWrapMode(mode) {
    if (!WRAP_MODES.includes(mode)) return;
    try { localStorage.setItem(WRAP_KEY, mode); } catch (_) {}
    applyLayout();
  }

  function cycleWrap() {
    const next = WRAP_MODES[(WRAP_MODES.indexOf(wrapMode()) + 1) % WRAP_MODES.length];
    setWrapMode(next);
    if (typeof updateStatus === 'function') updateStatus('saved', T('Line wrapping: {0}', wrapLabel(next)));
  }

  function applyConfig(cfg) {
    readConfig(cfg);
    applyLayout();
    if (!options.styleCheck) clearMarkers();
    else lintSoon();
  }

  window.addEventListener('editor-ready', async function () {
    try {
      if (window.Project && Project.config) {
        const d = await Project.config.get();
        if (d && d.config) readConfig(d.config);
      }
    } catch (_) {}
    if (!window.monaco || typeof editor === 'undefined' || !editor) return;
    registerFormatter();
    registerQuickFixes();
    registerActions();
    editor.onDidChangeModelContent(function (e) {
      if (e && e.isFlush) clearMarkers();
      lintSoon();
    });
    editor.onDidChangeModel(function () { clearMarkers(); lintSoon(); applyLayout(); });
    editor.onDidChangeModelLanguage(applyLayout);
    applyLayout();
    lintSoon();
  });

  window.LDBadness = {
    kindOf: kindOf,
    applyConfig: applyConfig,
    check: (text, kind) => request('check', { text: text, kind: kind }).then(r => r.findings),
    format: (text, kind, opts) => request('format', { text: text, kind: kind, options: { ...formatOptions(), ...(opts || {}) } }).then(r => r.text),
    fix: (text, kind, includeUnsafe) => request('fix', { text: text, kind: kind, includeUnsafe: includeUnsafe === true }).then(r => r.text),
    fixAll: fixAll,
    wrapMode: wrapMode,
    setWrapMode: setWrapMode,
    cycleWrap: cycleWrap,
    options: () => ({ ...options })
  };
})();
