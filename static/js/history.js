// File history dialog (revisions, diff and restore).
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// =====================================================================
// Change history (file revisions from Git commits)
// =====================================================================

const GROUP_WINDOW_MS = 10 * 60 * 1000; // consecutive revisions by the same person within 10 min become one entry
let historyGroups = [];
let historyDiffEditor = null;
const revisionCache = {};
let historyCurrent = null;
let historyFile = null;   // file whose history is on screen (may differ from the one open in the editor)
const HISTORY_TEXT_RE = /\.(tex|bib|sty|cls|clo|bst|txt|md|markdown|mmd|mermaid|cfg|def|json|csv|tsv|py|ltx|bbl|ldf|fd|dbx|ins|dtx|ist|bbx|cbx|lbx|sto|rtx)$/i;

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString(LDI18n.locale()) : '';
}

function groupRevisions(revs) {
  // revs: most recent first
  const groups = [];
  revs.forEach(r => {
    const who = (r.lastModifyingUser && (r.lastModifyingUser.emailAddress || r.lastModifyingUser.displayName)) || '?';
    const t = new Date(r.modifiedTime).getTime();
    const last = groups[groups.length - 1];
    if (last && last.who === who && Math.abs(last.oldestTime - t) <= GROUP_WINDOW_MS) {
      last.count += 1;
      last.oldestTime = t;
    } else {
      groups.push({ who, user: r.lastModifyingUser || {}, revId: r.id, time: r.modifiedTime, oldestTime: t, count: 1 });
    }
  });
  return groups;
}

function openHistory() {
  historyFile = currentFileId;
  document.getElementById('history-modal').style.display = 'flex';
  document.getElementById('history-toolbar').textContent = 'Select a change to see what changed.';
  const f = document.getElementById('history-filter');
  if (f) f.value = '';
  renderHistoryFiles();
  loadHistory();
}

/** Left column: all project files (with a dot on those that have a change not committed yet). */
async function renderHistoryFiles() {
  const box = document.getElementById('history-files');
  if (!box) return;
  const q = ((document.getElementById('history-filter') || {}).value || '').trim().toLowerCase();
  let files = [];
  let changed = new Set();
  if (window.BrowserGit && await BrowserGit.isCloned()) {
    files = (await BrowserGit.listFiles()).filter(f => !f.is_folder).map(f => f.path).sort((a, b) => a.localeCompare(b));
    try { changed = new Set((await BrowserGit.status()).changes.map(c => c.file)); } catch (_) {}
  }
  box.textContent = '';
  const shown = files.filter(p => !q || p.toLowerCase().includes(q));
  if (!shown.length) { box.append(h('div', { class: 'hist-empty' }, files.length ? T('No file with that name.') : T('No files.'))); return; }
  shown.forEach(p => {
    const slash = p.lastIndexOf('/');
    const row = h('div', { class: 'hist-file' + (p === historyFile ? ' active' : ''), title: p, 'data-path': p, onclick: () => selectHistoryFile(p) },
      slash >= 0 ? h('span', { class: 'hist-file-dir' }, p.slice(0, slash + 1)) : '',
      h('span', { class: 'hist-file-name' }, p.slice(slash + 1)),
      changed.has(p) ? h('span', { class: 'hist-file-dot', title: T('Change not committed yet') }, '●') : '');
    box.append(row);
  });
}

function selectHistoryFile(path) {
  historyFile = path;
  document.querySelectorAll('#history-files .hist-file').forEach(el => el.classList.toggle('active', el.dataset.path === path));
  document.getElementById('history-toolbar').textContent = 'Select a change to see what changed.';
  loadHistory();
}

function closeHistory() {
  document.getElementById('history-modal').style.display = 'none';
}

async function loadHistory() {
  const list = document.getElementById('history-list');
  const file = historyFile;
  document.getElementById('history-file').textContent = file || '';
  list.textContent = 'Loading...';
  try {
    let revisions = null;
    if (window.BrowserGit && await BrowserGit.isCloned()) {
      try {
        const commits = await BrowserGit.fileLog(file, 100);
        if (commits && commits.length) {
          revisions = commits.map(c => ({
            id: c.oid,
            modifiedTime: new Date(c.commit.author.timestamp * 1000).toISOString(),
            lastModifyingUser: { displayName: c.commit.author.name, emailAddress: c.commit.author.email },
            message: c.commit.message
          }));
        }
      } catch (_) {}
    }

    if (!revisions || revisions.length === 0) {
      list.textContent = 'No history for this file.';
      return;
    }

    if (file !== historyFile) return;   // the person already chose another file while it was loading
    historyGroups = groupRevisions(revisions);
    list.textContent = '';
    if (historyGroups.length === 0) { list.textContent = 'No history for this file.'; return; }
    historyGroups.forEach((g, i) => {
      const item = h('div', { class: 'hist-item', onclick: () => showRevisionDiff(i) },
        h('div', { class: 'hist-user' }, g.user.displayName || g.user.emailAddress || T('Unknown')),
        h('div', { class: 'hist-date' }, fmtDate(g.time)));
      if (g.count > 1) item.append(h('div', { class: 'hist-count' }, T('{0} grouped saves', g.count)));
      list.append(item);
    });
    showRevisionDiff(0);
  } catch (err) {
    list.textContent = 'No history available for this file.';
  }
}

async function revisionText(revId) {
  const key = `${revId}\u0001${historyFile}`;   // the same commit has different content in each file
  if (revisionCache[key] !== undefined) return revisionCache[key];
  if (window.BrowserGit && await BrowserGit.isCloned()) {
    try {
      const { git, fs } = BrowserGit.getGit();
      const { blob } = await git.readBlob({ fs, dir: BrowserGit.getDir(), oid: revId, filepath: historyFile });
      const text = new TextDecoder().decode(blob);
      revisionCache[key] = text;
      return text;
    } catch (e) {
      // in this revision the file did not exist (not created yet or already deleted): counts as empty
      if (e && (e.code === 'NotFoundError' || /Could not find|not find/i.test(e.message || ''))) { revisionCache[key] = ''; return ''; }
    }
  }

  throw new Error('Revision content not found');
}

async function showRevisionDiff(i) {
  document.querySelectorAll('#history-list .hist-item').forEach((el, idx) => el.classList.toggle('active', idx === i));
  const g = historyGroups[i];
  const prev = historyGroups[i + 1];
  const toolbar = document.getElementById('history-toolbar');
  if (!HISTORY_TEXT_RE.test(historyFile || '')) {
    historyCurrent = null;
    toolbar.textContent = 'Binary file (image, PDF, font...): there are no text differences to show.';
    if (historyDiffEditor) {
      const m = historyDiffEditor.getModel();
      historyDiffEditor.setModel({ original: monaco.editor.createModel('', 'plaintext'), modified: monaco.editor.createModel('', 'plaintext') });
      if (m) { m.original.dispose(); m.modified.dispose(); }
    }
    return;
  }
  toolbar.textContent = 'Loading changes...';
  const forFile = historyFile;
  try {
    const [after, before] = await Promise.all([revisionText(g.revId), prev ? revisionText(prev.revId) : Promise.resolve('')]);
    if (forFile !== historyFile) return;
    historyCurrent = { text: after, label: `${g.user.displayName || g.user.emailAddress || T('Unknown')} · ${fmtDate(g.time)}` };
    toolbar.textContent = '';
    toolbar.append(
      h('span', {}, prev ? T('Changes from {0} (compared to the previous entry)', historyCurrent.label) : T('Initial version: {0}', historyCurrent.label)),
      h('button', { class: 'btn btn-primary', style: 'padding:4px 10px;font-size:12px;', onclick: restoreRevision }, '↩ Restore this version'));

    const container = document.getElementById('history-diff-container');
    if (!historyDiffEditor) {
      historyDiffEditor = monaco.editor.createDiffEditor(container, {
        readOnly: true, renderSideBySide: true, automaticLayout: true, theme: LD.THEME, fontSize: 13, originalEditable: false
      });
    }
    const old = historyDiffEditor.getModel();
    const histLang = LD.languageFor(historyFile);
    historyDiffEditor.setModel({
      original: monaco.editor.createModel(before, histLang),
      modified: monaco.editor.createModel(after, histLang)
    });
    if (old) { old.original.dispose(); old.modified.dispose(); }
  } catch (err) {
    toolbar.textContent = T('Error loading revision: {0}', err.message);
  }
}

async function restoreRevision() {
  if (!historyCurrent || !editor || !historyFile) return;
  if (!confirm(T('Replace the current content of "{0}" with this version? (the current version stays in the history)', historyFile))) return;
  const text = historyCurrent.text;
  const file = historyFile;
  closeHistory();
  // the history may be of another file than the open one: open it before restoring
  if (file !== currentFileId && typeof switchFile === 'function') await switchFile(file, file);
  if (file === currentFileId) editor.setValue(text);
}
