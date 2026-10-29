// Monaco Editor + LaTeX completion and project sync configuration

let editor = null;
let currentFileId = null;
let isDirty = false;
let saveTimeout = null;


// Registers the LaTeX/BibTeX/ConTeXt languages, hover docs, theme and smart suggestions in Monaco.
function registerEditorLanguages() {
  const hoverDocs = {};
  LATEX_COMPLETIONS.forEach(c => { if (c.label.startsWith('\\') && !c.label.startsWith('\\begin{') && typeof c.documentation === 'string') hoverDocs[c.label] = c.documentation; });
  LD.register(monaco, hoverDocs);

  // Smart suggestions (commands, environments, labels, citations, files...) in autocomplete.js
  LD.smart.register(monaco);
}

// Creates the Monaco editor instance in #monaco-container and stores it in the global `editor`.
function createMonacoEditor(initialContent) {
  editor = monaco.editor.create(document.getElementById('monaco-container'), {
    value: initialContent,
    language: LD.languageFor((document.querySelector('#file-tree li.active') || { dataset: {} }).dataset.name || 'main.tex'),
    theme: LD.THEME,
    automaticLayout: true,
    fontSize: 14,
    lineNumbers: 'on',
    tabSize: 2,
    wordWrap: 'on',
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    autoClosingBrackets: 'always',
    autoClosingQuotes: 'always',
    matchBrackets: 'always',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    folding: true,
    showFoldingControls: 'mouseover',
    quickSuggestions: { other: true, comments: false, strings: false },
    renderLineHighlight: 'all',
    smoothScrolling: true
  });
}

// Locks the editor while no file is chosen yet (the project is still loading).
function lockEditorIfNoFile() {
  if (!currentFileId) { editor.updateOptions({ readOnly: true }); updateStatus('saving', 'Loading the project...'); }
}

// Debounced auto-save on every content change.
function bindEditorAutoSave() {
  editor.onDidChangeModelContent(function () {
    updateDocumentOutline();
    // With real-time editing active, saving is handled by the live session instead.
    if (window.collabActive) return;

    updateStatus('saving', 'Saving in browser...');
    isDirty = true;

    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveCurrentFile, 1200);
  });
}

// Ctrl+Enter recompiles and Ctrl+S pulls/pushes.
function bindEditorShortcuts() {
  // Keyboard Shortcut: Ctrl+Enter (or Cmd+Enter) to recompile
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function () {
    recompileLatex();
  });

  // Keyboard Shortcut: Ctrl+S (or Cmd+S) to pull/push sync
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
    syncPullPush();
  });
}

// Wraps (or unwraps) the selection with a prefix and a suffix, or inserts both around the cursor.
function wrapSelection(ed, prefix, suffix) {
    const sel = ed.getSelection();
    const model = ed.getModel();
    if (!sel || !model) return;
    const text = model.getValueInRange(sel);

    if (text.length > 0) {
      if (text.startsWith(prefix) && text.endsWith(suffix) && text.length >= prefix.length + suffix.length) {
        // Undo the formatting (unwrap)
        const inner = text.slice(prefix.length, text.length - suffix.length);
        ed.executeEdits('latex-wrap', [{
          range: sel,
          text: inner,
          forceMoveMarkers: true
        }]);
        ed.setSelection(new monaco.Selection(
          sel.startLineNumber,
          sel.startColumn,
          sel.endLineNumber,
          sel.endColumn - prefix.length - suffix.length
        ));
      } else {
        // Apply the formatting (wrap)
        ed.executeEdits('latex-wrap', [{
          range: sel,
          text: prefix + text + suffix,
          forceMoveMarkers: true
        }]);
        ed.setSelection(new monaco.Selection(
          sel.startLineNumber,
          sel.startColumn + prefix.length,
          sel.endLineNumber,
          sel.endColumn + prefix.length
        ));
      }
    } else {
      // No selection: insert prefix + suffix and place the cursor between them
      const pos = ed.getPosition();
      ed.executeEdits('latex-wrap', [{
        range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        text: prefix + suffix,
        forceMoveMarkers: true
      }]);
      ed.setPosition({
        lineNumber: pos.lineNumber,
        column: pos.column + prefix.length
      });
    }
    ed.focus();
}

// Comments or uncomments the selected lines with % (Monaco action first, manual fallback after).
function toggleLineComment(ed) {
    // 1. Try Monaco's native action if available and supported
    const act = ed.getAction('editor.action.commentLine');
    if (act && act.isSupported()) {
      act.run();
      return;
    }

    // 2. Robust manual fallback for LaTeX (%)
    const sel = ed.getSelection();
    const model = ed.getModel();
    if (!sel || !model) return;

    const start = sel.startLineNumber;
    const end = sel.endLineNumber;

    let allCommented = true;
    const lines = [];
    for (let l = start; l <= end; l++) {
      const lineText = model.getLineContent(l);
      lines.push(lineText);
      if (!/^\s*%(.*)$/.test(lineText) && lineText.trim().length > 0) {
        allCommented = false;
      }
    }

    const edits = [];
    for (let i = 0; i < lines.length; i++) {
      const lNum = start + i;
      const lineText = lines[i];
      if (allCommented) {
        const match = lineText.match(/^(\s*)%\s?(.*)$/);
        if (match) {
          edits.push({
            range: new monaco.Range(lNum, 1, lNum, lineText.length + 1),
            text: match[1] + match[2],
            forceMoveMarkers: true
          });
        }
      } else {
        const match = lineText.match(/^(\s*)(.*)$/);
        if (match) {
          edits.push({
            range: new monaco.Range(lNum, 1, lNum, lineText.length + 1),
            text: match[1] + '% ' + match[2],
            forceMoveMarkers: true
          });
        }
      }
    }
    if (edits.length > 0) {
      ed.executeEdits('latex-comment', edits);
    }
}

// Essential keyboard shortcuts (Ctrl+/, Ctrl+B, Ctrl+I, Ctrl+Shift+D, etc.) as editor actions.
function setupEditorKeybindings(ed) {
  // Ctrl + / (Comment / Uncomment Line with %)
  ed.addAction({
    id: 'latex.comment',
    label: T('Comment/Uncomment Line (%)'),
    contextMenuGroupId: 'modification',
    contextMenuOrder: 1.1,
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash,
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadDivide,
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.ABNT_C1,
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.ABNT_C2
    ],
    run: () => toggleLineComment(ed)
  });

  // Intercept keydown so it works on any keyboard layout (ABNT2, US, etc.)
  ed.onKeyDown(function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.browserEvent.key;
      const code = e.browserEvent.code;
      if (k === '/' || code === 'Slash' || code === 'IntlRo' || code === 'NumpadDivide') {
        e.preventDefault();
        e.stopPropagation();
        toggleLineComment(ed);
      }
    }
  });

  // Ctrl + B (Bold: \textbf{...})
  ed.addAction({
    id: 'latex.bold',
    label: T('Bold (\\textbf)'),
    contextMenuGroupId: 'modification',
    contextMenuOrder: 1.2,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
    run: () => (ed.getModel().getLanguageId() === 'context' ? wrapSelection(ed, '{\\bf ', '}') : wrapSelection(ed, '\\textbf{', '}'))
  });

  // Ctrl + I (Italic: \textit{...})
  ed.addAction({
    id: 'latex.italic',
    label: T('Italic (\\textit)'),
    contextMenuGroupId: 'modification',
    contextMenuOrder: 1.3,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
    run: () => (ed.getModel().getLanguageId() === 'context' ? wrapSelection(ed, '{\\it ', '}') : wrapSelection(ed, '\\textit{', '}'))
  });

  // Ctrl + Shift + D (Duplicate Line / Selection)
  ed.addAction({
    id: 'latex.duplicateLine',
    label: 'Duplicate Line or Selection',
    contextMenuGroupId: 'modification',
    contextMenuOrder: 1.4,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD],
    run: () => {
      const copyAction = ed.getAction('editor.action.copyLinesDownAction');
      if (copyAction && copyAction.isSupported()) {
        copyAction.run();
      }
    }
  });

  // Ctrl + ] (Indent Line)
  ed.addAction({
    id: 'latex.indent',
    label: T('Indent Line'),
    contextMenuGroupId: 'modification',
    contextMenuOrder: 1.5,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.BracketRight],
    run: () => {
      const a = ed.getAction('editor.action.indentLines');
      if (a && a.isSupported()) a.run();
    }
  });

  // Ctrl + [ (Outdent Line)
  ed.addAction({
    id: 'latex.outdent',
    label: T('Outdent Line'),
    contextMenuGroupId: 'modification',
    contextMenuOrder: 1.6,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.BracketLeft],
    run: () => {
      const a = ed.getAction('editor.action.outdentLines');
      if (a && a.isSupported()) a.run();
    }
  });

  // Ctrl + Shift + K (Delete Line)
  ed.addAction({
    id: 'latex.deleteLine',
    label: T('Delete Line'),
    contextMenuGroupId: 'modification',
    contextMenuOrder: 1.7,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK],
    run: () => {
      const a = ed.getAction('editor.action.deleteLines');
      if (a && a.isSupported()) a.run();
    }
  });

  // Ctrl + Shift + U (Transform to Uppercase)
  ed.addAction({
    id: 'latex.uppercase',
    label: T('Transform to Uppercase'),
    contextMenuGroupId: 'modification',
    contextMenuOrder: 1.8,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyU],
    run: () => {
      const a = ed.getAction('editor.action.transformToUppercase');
      if (a && a.isSupported()) a.run();
    }
  });

  // Ctrl + Shift + L (Transform to Lowercase)
  ed.addAction({
    id: 'latex.lowercase',
    label: T('Transform to Lowercase'),
    contextMenuGroupId: 'modification',
    contextMenuOrder: 1.9,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL],
    run: () => {
      const a = ed.getAction('editor.action.transformToLowercase');
      if (a && a.isSupported()) a.run();
    }
  });

  // Shortcut to open the shortcuts dialog
  ed.addAction({
    id: 'latex.shortcutsHelp',
    label: T('View Keyboard Shortcuts'),
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Slash],
    run: () => {
      if (typeof openShortcutsModal === 'function') openShortcutsModal();
    }
  });
}

// Loads the available engines and the project config (default engine, auto sync).
function loadEnginesAndProjectConfig() {
  // Available compilers (the browser one always; the local agent's only if installed) and the project
  // configuration (.neoleaf/config.json): default engine
  Promise.all([loadEngines(), Project.config.get().catch(() => null)]).then(([, d]) => {
    if (d && d.config) {
      projectConfig = d.config;
      const sel = document.getElementById('engine-select');
      if (sel && [...sel.options].some(o => o.value === d.config.engine)) sel.value = d.config.engine;
      if (typeof initAutoSync === 'function') initAutoSync();
    }
  });
}

// Live editing only starts after the file text came from the local clone; without BrowserGit it starts right away.
function startLiveEditingIfNoBrowserGit() {
  if (!(window.BrowserGit && typeof projectOwner !== 'undefined' && projectOwner)) {
    if (window.Project) Project.failReady();
    if (window.collabStart) collabStart(currentFileId);
  }
}

// Last PDF, engine warm-up and PDF staleness hook (no compilation on its own).
function startEditorBackgroundTasks() {
  loadLastPdf();
  window.addEventListener('collab-synced', updateFastButton);
  // warms up the engine in the background (downloads and prepares the bundle) so the first compilation is faster
  setTimeout(() => (window.requestIdleCallback || (f => setTimeout(f, 0)))(() => warmUpEngine()), 3000);
  hookPdfStale();
}

// Initial Git status and polling every 30 seconds.
function startGitStatusPolling() {
  checkGitStatus();
  if (gitStatusInterval) clearInterval(gitStatusInterval);
  gitStatusInterval = setInterval(checkGitStatus, 30000);
}

// Clones the repository into the browser, or checks a stuck clone; returns false when the project cannot load.
async function cloneOrOpenLocalRepo() {
  const cloned = await BrowserGit.isCloned();
  if (!cloned) {
    updateStatus('saving', 'Cloning the repository into the browser...');
    window.__cloning = true;
    window.__cloneProgress = '';
    if (window.showCloneProgress) showCloneProgress(T('Downloading the project to the browser. Large repositories take a while: wait before compiling.'));
    try {
      await BrowserGit.clone((progress) => {
        if (progress && progress.phase) {
          const pct = progress.total ? Math.min(100, Math.round(100 * progress.loaded / progress.total)) + '%' : '';
          window.__cloneProgress = [progress.phase, pct].filter(Boolean).join(' ');
          updateStatus('saving', `Git: ${window.__cloneProgress}...`);
          if (window.showCloneProgress) showCloneProgress(T('Downloading the project to the browser. Large repositories take a while: wait before compiling.') + ' (' + window.__cloneProgress + ')');
        }
      });
      window.__cloning = false;
      if (window.hideCloneProgress) hideCloneProgress();
      updateStatus('saved', 'Repository cloned into the browser');
      if (window.FT && FT.refreshFromBrowserGit) {
        await FT.refreshFromBrowserGit();
      }
    } catch (cloneErr) {
      window.__cloning = false;
      if (window.hideCloneProgress) hideCloneProgress();
      console.warn('Error cloning the repository in the browser:', cloneErr);
      if (window.showCloneError) showCloneError(cloneErr);
      if (window.Project) Project.failReady();
      return;   // no project: do not carry on with an empty repository
    }

  } else {
    try { if (window.recloneIfStuck) await recloneIfStuck(); }
    catch (e) { console.warn('Could not redo the clone:', e); if (window.showCloneError) showCloneError(e); if (window.Project) Project.failReady(); return; }
    if (window.FT && FT.refreshFromBrowserGit) {
      await FT.refreshFromBrowserGit();
    }
  }
  return true;
}

// Makes sure .gitignore does not ignore .neoleaf and that .neoleaf/config.json exists locally.
async function repairNeoleafFiles() {
  try {
    const gi = await BrowserGit.readFile('.gitignore');
    if (gi && (gi.includes('.neoleaf/\n') || gi.trim().endsWith('.neoleaf/'))) {
      await BrowserGit.writeFile('.gitignore', gi.replace(/\.neoleaf\//g, '.neoleaf/last.*'));
    }
  } catch (_) {}
  try {
    const cfg = await BrowserGit.readFile('.neoleaf/config.json');
    if (!cfg && typeof projectConfig !== 'undefined') {
      await BrowserGit.writeFile('.neoleaf/config.json', JSON.stringify(projectConfig, null, 2));
    }
  } catch (_) {
    if (typeof projectConfig !== 'undefined') {
      try { await BrowserGit.writeFile('.neoleaf/config.json', JSON.stringify(projectConfig, null, 2)); } catch (_) {}
    }
  }
}

// Reports a failure while preparing Git in the browser (only when the project was not ready yet).
function handleGitPrepError(err, prepReady) {
  window.__cloning = false;
  if (window.hideCloneProgress) hideCloneProgress();
  // it used to go only to the console and the project stayed "unavailable" with no explanation; now the notice says why (once the project is ready, an isolated error does not block)
  if (!prepReady && window.showCloneError && !window.__cloneFailed) {
    showCloneError(new Error(T('I could not prepare the project in this browser') + ' (' + ((err && err.message) || err) + '). ' + T('If you are in a private window or the browser storage is blocked, open a normal window.')));
  }
  if (window.Project) Project.failReady();
}

// After Git is ready: opens the main file (no file chosen) or syncs the editor from BrowserGit and joins the room.
async function openInitialFileAfterGit() {
  if (window.__cloneFailed) return;   // the project did not load: the notice is already on screen and editing stays blocked
  if (!currentFileId) {
    // page with no file chosen (the server does not know the project): open the main file, or the first .tex
    const first = await pickInitialFile();
    if (first) { await switchFile(first, first); }
    else { editor.updateOptions({ readOnly: false }); updateStatus('saved', 'Project has no text files'); }
  } else {
    await syncEditorFromBrowserGit();
    if (window.collabStart) collabStart(currentFileId);
  }
}

// Initializes the browser-first Git engine and opens the project once the local clone is ready.
function initBrowserGitEngine() {
  if (!(window.BrowserGit && typeof projectOwner !== 'undefined' && projectOwner)) return;
  let prepReady = false;
  BrowserGit.init(projectOwner, projectRepo, typeof currentUser !== 'undefined' ? currentUser : null).then(async () => {
    if (!(await cloneOrOpenLocalRepo())) return;   // no project: do not carry on with an empty repository
    await repairNeoleafFiles();
    if (window.requestPersistence) requestPersistence();
    if (window.Project) Project.ready();   // the local clone is ready: the local API (config, comments...) can answer now
    prepReady = true;
    // newly created or imported project: write the files prepared in the panel, commit and push
    try { if (window.applyHandoff) await applyHandoff(); } catch (e) { console.warn('Failed to prepare the new project:', e); }
    checkGitStatus();
    // pull on its own what arrived on GitHub (if there is no risk of conflict) and notify
    if (window.autoPullOnOpen) await autoPullOnOpen();
  }).catch(err => {
    handleGitPrepError(err, prepReady);
  }).then(openInitialFileAfterGit);
}

// Shows the import summary (installed packages), if the project was just imported.
function showImportNote() {
  try {
    const note = sessionStorage.getItem('importNote');
    if (note) {
      sessionStorage.removeItem('importNote');
      const el = document.getElementById('raw-log');
      if (el) el.innerText = note;
    }
  } catch (_) {}
}

// Entry point: loads Monaco, then runs the setup steps in order.
function initLatexEditor(initialContent, fileId) {
  if (fileId && typeof fileId === 'string' && fileId.length > 25 && !fileId.includes('.') && !fileId.includes('/')) {
    fileId = 'main.tex';
  }
  currentFileId = fileId;

  require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.56.0/min/vs' } });

  require(['vs/editor/editor.main'], function () {
    registerEditorLanguages();
    createMonacoEditor(initialContent);
    lockEditorIfNoFile();
    bindEditorAutoSave();
    bindEditorShortcuts();
    setupEditorKeybindings(editor);

    // Initial outline render
    updateDocumentOutline();

    loadEnginesAndProjectConfig();

    LD.smart.attach(editor);
    window.dispatchEvent(new CustomEvent('editor-ready'));

    startLiveEditingIfNoBrowserGit();
    startEditorBackgroundTasks();
    startGitStatusPolling();
    initBrowserGitEngine();
    showImportNote();
  });
}


// Auto-save file content to local repository
async function saveCurrentFile() {
  if (!currentFileId || !editor || window.collabActive) return;

  const content = editor.getValue();

  if (window.BrowserGit && await BrowserGit.isCloned()) {
    try {
      await BrowserGit.writeFile(currentFileId, content);
      isDirty = false;
      updateStatus('saved', 'Saved in browser');
      checkGitStatus();
      return;
    } catch (e) {
      console.warn('Error saving to BrowserGit:', e);
    }
  }

  updateStatus('error', 'Could not save: the local project is not available in this browser');
}
