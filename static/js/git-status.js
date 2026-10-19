// Git status in the toolbar, and the push and pull flows.
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// ---------------------------------------------------------------------
// Git Integration (Status, Push, Pull)
// ---------------------------------------------------------------------

/** File to open when the page brings none: the configured main file, otherwise the first .tex, otherwise the first text file. */
async function pickInitialFile() {
  try {
    if (!(window.BrowserGit && await BrowserGit.isCloned())) return null;
    const cfg = window.Project ? await Project.loadConfig() : { mainFile: 'main.tex' };
    const files = (await BrowserGit.listFiles()).filter(f => !f.is_folder).map(f => f.path);
    const texts = files.filter(p => /\.(tex|bib|sty|cls|txt|md|bst)$/i.test(p));
    return texts.find(p => p === cfg.mainFile) || texts.find(p => p.endsWith('.tex') && !p.includes('/')) || texts.find(p => p.endsWith('.tex')) || texts[0] || null;
  } catch (_) { return null; }
}

/** The open file's text comes from the local clone (BrowserGit), which is the project's source of truth. */
async function syncEditorFromBrowserGit() {
  try {
    if (!(window.BrowserGit && await BrowserGit.isCloned()) || !currentFileId || !editor) return;
    const text = await BrowserGit.readFile(currentFileId);
    if (typeof text === 'string' && text !== editor.getValue()) {
      editor.setValue(text);
      isDirty = false;
    }
  } catch (_) { /* file is not in the clone yet: keep what the editor already has */ }
}

let gitStatusState = null;
let gitStatusInterval = null;

async function checkGitStatus() {
  if (typeof projectId === 'undefined' || !projectId) return;

  if (window.__gitBusy) return; // automatic pull in progress
  if (window.BrowserGit && await BrowserGit.isCloned()) {
    try {
      const st = await BrowserGit.status();
      const pullBtn = document.getElementById('git-pull-btn');
      const pushBadge = document.getElementById('git-push-badge');

      let cmp = { branch: 'main', ahead: 0, behind: 0 };
      try { cmp = await BrowserGit.compare(); } catch (_) { try { cmp = await BrowserGit.compare({ fetch: false }); } catch (_) {} }

      if (pullBtn) {
        if (cmp.behind > 0) {
          pullBtn.style.display = 'inline-flex';
          const pullLabel = document.getElementById('git-pull-label');
          if (pullLabel) pullLabel.textContent = `⬇ Pull (${cmp.behind})`;
        } else {
          pullBtn.style.display = 'none';
        }
      }

      if (pushBadge) {
        if (st.uncommitted) {
          pushBadge.style.display = 'inline-block';
          pushBadge.textContent = st.changes.length > 0 ? `*${st.changes.length}` : '*';
        } else if (cmp.ahead > 0) {
          pushBadge.style.display = 'inline-block';
          pushBadge.textContent = `↑${cmp.ahead}`;
        } else {
          pushBadge.style.display = 'none';
        }
      }

      gitStatusState = {
        branch: cmp.branch,
        uncommitted_changes: st.changes ? st.changes.length : 0,
        ahead: cmp.ahead,
        behind: cmp.behind
      };
      if (window.updateUnsentNotice) updateUnsentNotice(gitStatusState.uncommitted_changes, cmp.ahead);
      return;
    } catch (err) {
      console.debug('BrowserGit status check error:', err);
    }
  }

  // no local clone: nothing to show
  const pb = document.getElementById('git-pull-btn');
  if (pb) pb.style.display = 'none';
}

function formatDefaultCommitMsg() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const d = pad(now.getDate());
  const m = pad(now.getMonth() + 1);
  const y = now.getFullYear();
  const h = pad(now.getHours());
  const min = pad(now.getMinutes());
  return `Update: ${d}/${m}/${y} ${h}:${min}`;
}

function openGitPushModal() {
  const modal = document.getElementById('git-push-modal');
  if (!modal) return;
  const info = document.getElementById('git-push-info');
  const errBox = document.getElementById('git-push-error');
  const input = document.getElementById('git-commit-msg');
  if (errBox) errBox.style.display = 'none';
  if (info) {
    if (gitStatusState) {
      const parts = [];
      parts.push(`Branch: <strong>${escapeHtml(String(gitStatusState.branch || 'main'))}</strong>`);
      if (gitStatusState.ahead > 0) parts.push(`${T('Commits ahead')}: <strong>${gitStatusState.ahead}</strong>`);
      if (gitStatusState.uncommitted_changes > 0) parts.push(`${T('Modified files')}: <strong>${gitStatusState.uncommitted_changes}</strong>`);
      if (gitStatusState.last_commit) parts.push(`${T('Last commit')}: <em>${escapeHtml(String(gitStatusState.last_commit))}</em>`);
      info.innerHTML = parts.join(' &bull; ');
    } else {
      info.textContent = T('Pushing local changes to the repository on GitHub.');
    }
  }
  modal.style.display = 'flex';
  if (window.fillGitPushChanges) fillGitPushChanges();
  if (input) {
    input.value = formatDefaultCommitMsg();
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }
}

function closeGitPushModal() {
  const modal = document.getElementById('git-push-modal');
  if (!modal) return;
  modal.style.display = 'none';
}

async function handleGitPushSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('git-commit-msg');
  const btn = document.getElementById('btn-push-submit');
  const cancelBtn = document.getElementById('btn-push-cancel');
  const errBox = document.getElementById('git-push-error');
  let msg = input ? input.value.trim() : '';

  if (!msg) {
    msg = formatDefaultCommitMsg();
    if (input) input.value = msg;
  }
  if (btn) { btn.disabled = true; btn.textContent = T('Sending (Push)...'); }
  if (cancelBtn) cancelBtn.disabled = true;
  if (errBox) errBox.style.display = 'none';

  try {
    if (isDirty) await saveCurrentFile();

    if (window.BrowserGit && await BrowserGit.isCloned()) {
      updateStatus('saving', 'Pushing changes from the browser (Push)...');
      const st = await BrowserGit.status();
      if (st.uncommitted) await BrowserGit.commit(msg);
      let behind = 0;
      try { behind = (await BrowserGit.compare()).behind; } catch (_) {}
      if (behind > 0) {
        // GitHub rejects the push if it has commits you do not have: pull first
        updateStatus('saving', 'Pulling the latest from GitHub before pushing...');
        const pr = await BrowserGit.pull();
        if (pr && pr.conflict) {
          closeGitPushModal();
          updateStatus('error', 'Conflict detected in Git Pull');
          openGitConflictModal({ isBrowser: true, files: pr.files });
          return;
        }
        if (window.FT && FT.refreshFromBrowserGit) await FT.refreshFromBrowserGit();
      }
      await BrowserGit.push();
      closeGitPushModal();
      updateStatus('saved', 'Push completed successfully!');
      await checkGitStatus();
      return;
    }

    throw new Error('The local project is not available in this browser.');
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message || T('Error performing Git Push');
      errBox.style.display = 'block';
    } else {
      alert(T('Error in Git Push: {0}', err.message));
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm and Send (Push)'; }
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

async function gitPull() {
  const pullBtn = document.getElementById('git-pull-btn');
  const pullLabel = document.getElementById('git-pull-label');
  if (pullBtn) pullBtn.disabled = true;
  if (pullLabel) pullLabel.textContent = T('⬇ Pulling...');

  try {
    if (window.BrowserGit && await BrowserGit.isCloned()) {
      updateStatus('saving', 'Pulling changes from GitHub...');
      const pullResult = await BrowserGit.pull();
      if (pullResult && pullResult.conflict) {
        updateStatus('error', 'Conflict detected in Git Pull');
        openGitConflictModal({ isBrowser: true, files: pullResult.files });
        return;
      }
      updateStatus('saved', 'Pull completed successfully!');
      if (window.FT && FT.refreshFromBrowserGit) await FT.refreshFromBrowserGit();
      if (currentFileId) {
        try {
          const content = await BrowserGit.readFile(currentFileId);
          if (content !== undefined && editor) {
            editor.setValue(content);
            isDirty = false;
          }
        } catch (_) {}
      }
      await checkGitStatus();
      return;
    }

    throw new Error('The local project is not available in this browser.');
  } catch (err) {
    alert(T('Error performing Git Pull: {0}', err.message));
  } finally {
    if (pullBtn) pullBtn.disabled = false;
    if (pullLabel) pullLabel.textContent = '⬇ Pull';
  }
}
