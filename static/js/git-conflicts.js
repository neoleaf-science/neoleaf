// Visual resolution of Git merge conflicts (Monaco diff editor).
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// -------------------------------------------------------------
// Visual Git conflict resolution (Monaco Diff Editor)
// -------------------------------------------------------------
let conflictState = null;
let conflictDiffEditor = null;

async function openGitConflictModal(state) {
  conflictState = {
    isBrowser: state.isBrowser,
    files: state.files && state.files.length > 0 ? state.files : ['main.tex'],
    currentFile: state.files && state.files.length > 0 ? state.files[0] : 'main.tex',
    localText: '',
    remoteText: ''
  };

  const modal = document.getElementById('git-conflict-modal');
  if (modal) modal.style.display = 'flex';

  renderConflictTabs();
  await loadConflictFile(conflictState.currentFile);
}

function renderConflictTabs() {
  const tabs = document.getElementById('git-conflict-file-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  conflictState.files.forEach(f => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn' + (f === conflictState.currentFile ? ' btn-primary' : '');
    btn.style.padding = '3px 10px';
    btn.style.fontSize = '12px';
    btn.textContent = f;
    btn.onclick = () => {
      conflictState.currentFile = f;
      renderConflictTabs();
      loadConflictFile(f);
    };
    tabs.appendChild(btn);
  });
}

async function loadConflictFile(file) {
  const label = document.getElementById('git-conflict-filename');
  if (label) label.textContent = file;

  let local = '';
  let remote = '';

  const data = await BrowserGit.getConflictData(file);
  local = data.local;
  remote = data.remote;

  conflictState.localText = local;
  conflictState.remoteText = remote;

  const container = document.getElementById('git-conflict-diff-container');
  if (!conflictDiffEditor && container) {
    conflictDiffEditor = monaco.editor.createDiffEditor(container, {
      readOnly: true,
      renderSideBySide: true,
      automaticLayout: true,
      theme: LD.THEME,
      fontSize: 13,
      originalEditable: false
    });
  }

  if (conflictDiffEditor) {
    const old = conflictDiffEditor.getModel();
    const lang = LD.languageFor(file);
    conflictDiffEditor.setModel({
      original: monaco.editor.createModel(local, lang),
      modified: monaco.editor.createModel(remote, lang)
    });
    if (old) { old.original.dispose(); old.modified.dispose(); }
  }
}

async function abortGitConflict() {
  if (!confirm(T('Do you really want to cancel the Git Pull and undo the merge attempt?'))) return;
  try {
    await BrowserGit.abortMerge();
  } catch (_) {}

  closeGitConflictModal();
  updateStatus('saved', 'Pull cancelled. State restored.');
  await checkGitStatus();
}

function closeGitConflictModal() {
  const modal = document.getElementById('git-conflict-modal');
  if (modal) modal.style.display = 'none';
  conflictState = null;
}

async function resolveGitConflict(choice) {
  if (!conflictState) return;
  const file = conflictState.currentFile;
  const local = conflictState.localText;
  const remote = conflictState.remoteText;

  if (choice === 'manual') {
    const markers = `<<<<<<< My Version (Local)\n${local}\n=======\n${remote}\n>>>>>>> GitHub Version (Remote)\n`;
    await BrowserGit.writeFile(file, markers);

    closeGitConflictModal();

    if (window.FT && window.FT.openPath) {
      await FT.openPath(file);
    } else if (editor) {
      editor.setValue(markers);
      isDirty = true;
    }
    updateStatus('saving', 'Markers inserted. Adjust the code and save to finish.');
    return;
  }

  if (choice === 'local') {
    await BrowserGit.resolveConflict(file, 'local');
  } else if (choice === 'remote') {
    await BrowserGit.resolveConflict(file, 'remote');
    if (file === currentFileId && editor) {
      editor.setValue(remote);
      isDirty = false;
    }
  }

  // Remove the resolved file from the list
  conflictState.files = conflictState.files.filter(f => f !== file);
  if (conflictState.files.length > 0) {
    conflictState.currentFile = conflictState.files[0];
    renderConflictTabs();
    await loadConflictFile(conflictState.currentFile);
  } else {
    closeGitConflictModal();
    updateStatus('saved', 'All conflicts were resolved successfully!');
    if (window.FT && FT.refreshFromBrowserGit) await FT.refreshFromBrowserGit();
    if (window.FT && FT.refresh) FT.refresh();
    await checkGitStatus();
  }
}

window.checkGitStatus = checkGitStatus;
window.openGitPushModal = openGitPushModal;
window.closeGitPushModal = closeGitPushModal;
window.handleGitPushSubmit = handleGitPushSubmit;
window.gitPull = gitPull;
window.openGitConflictModal = openGitConflictModal;
window.closeGitConflictModal = closeGitConflictModal;
window.abortGitConflict = abortGitConflict;
window.resolveGitConflict = resolveGitConflict;
