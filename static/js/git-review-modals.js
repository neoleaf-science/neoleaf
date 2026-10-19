// =====================================================================
// Pull and push review (part 2): the pull dialog, the list in the push dialog and the reset dialog. Uses window.__GR (see git-review.js).
// =====================================================================
(function () {
  'use strict';
  const { $, esc, tr, ensureStyle, renderInto, isInternal, compareSafe, describe, localPaths, neoToast } = window.__GR;

  // ---------------------------------------------------------------- pull dialog

  async function openGitPullModal() {
    ensureStyle();
    const modal = $('git-pull-modal');
    if (!modal) return gitPull();
    const list = $('git-pull-changes'), btn = $('btn-pull-submit'), warn = $('git-pull-warn');
    modal.style.display = 'flex';
    warn.style.display = 'none';
    btn.disabled = true;
    list.innerHTML = `<div class="gr-empty">${esc(tr('Querying GitHub...'))}</div>`;
    if (!(window.BrowserGit && await BrowserGit.isCloned())) {
      list.innerHTML = `<div class="gr-empty">${esc(tr('The updates from GitHub will be brought into the project.'))}</div>`;
      btn.disabled = false;
      return;
    }
    try {
      const info = await compareSafe();
      const files = await describe(info, 'incoming', info.incoming.files.map(f => f.path));
      const local = await localPaths(info);
      const clash = new Set(files.filter(f => local.has(f.path) && !isInternal(f.path)).map(f => f.path));
      renderInto(list, { commits: info.incoming.commits, files, clash, emptyText: tr('Nothing new on GitHub.') });
      if (clash.size) {
        warn.textContent = tr('These files were also changed by you and the pull may cause a conflict (you can resolve it afterwards): ') + [...clash].join(', ');
        warn.style.display = 'block';
      }
      btn.disabled = info.behind === 0;
    } catch (err) {
      list.innerHTML = `<div class="gr-empty">${esc(tr('I could not query GitHub: '))}${esc(err.message || err)}</div>`;
    }
  }

  function closeGitPullModal() { const m = $('git-pull-modal'); if (m) m.style.display = 'none'; }

  async function confirmGitPull() {
    closeGitPullModal();
    await gitPull();
  }

  // ---------------------------------------------------------------- list in the push dialog

  async function fillGitPushChanges() {
    ensureStyle();
    const list = $('git-push-changes'), warn = $('git-push-behind');
    if (!list) return;
    if (warn) warn.style.display = 'none';
    if (!(window.BrowserGit && await BrowserGit.isCloned())) { list.innerHTML = ''; return; }
    list.innerHTML = `<div class="gr-empty">${esc(tr('Working out what will be pushed...'))}</div>`;
    try {
      if (typeof isDirty !== 'undefined' && isDirty && typeof saveCurrentFile === 'function') await saveCurrentFile();
      const info = await compareSafe();
      const st = await BrowserGit.status();
      const paths = new Set([...info.outgoing.files.map(f => f.path), ...st.changes.map(c => c.file)]);
      if (typeof isDirty !== 'undefined' && isDirty && typeof currentFileId !== 'undefined' && currentFileId) paths.add(currentFileId);
      // what is saved in the working folder; the editor's unsaved text goes in when the push saves the file
      const files = await describe(info, 'outgoing', [...paths]);
      renderInto(list, { commits: info.outgoing.commits, files, emptyText: tr('Nothing to push: everything is already on GitHub.') });
      if (warn && info.behind > 0) {
        warn.textContent = tr('GitHub has {0} new commit(s). They will be pulled before the push; see what is coming in the Pull button.', info.behind);
        warn.style.display = 'block';
      }
    } catch (err) {
      list.innerHTML = `<div class="gr-empty">${esc(tr('I could not work out the changes: '))}${esc(err.message || err)}</div>`;
    }
  }

  // ---------------------------------------------------------------- reset: GitHub overwrites the local copy

  async function openGitResetModal() {
    ensureStyle();
    const modal = $('git-reset-modal'), list = $('git-reset-changes'), err = $('git-reset-error');
    if (!modal) return;
    err.style.display = 'none';
    modal.style.display = 'flex';
    list.innerHTML = `<div class="gr-empty">${esc(tr('Working out what will be lost...'))}</div>`;
    if (!(window.BrowserGit && await BrowserGit.isCloned())) { list.innerHTML = `<div class="gr-empty">${esc(tr('The project will be rebuilt from GitHub.'))}</div>`; return; }
    try {
      if (typeof isDirty !== 'undefined' && isDirty && typeof saveCurrentFile === 'function') await saveCurrentFile();
      const info = await compareSafe();
      const paths = await localPaths(info);
      const files = await describe(info, 'outgoing', [...paths]);
      renderInto(list, { commits: info.outgoing.commits, files, emptyText: tr('Nothing local will be lost: the project already matches what is on GitHub.') });
    } catch (e) {
      list.innerHTML = `<div class="gr-empty">${esc(tr('I could not calculate: '))}${esc(e.message || e)}</div>`;
    }
  }

  function closeGitResetModal() { const m = $('git-reset-modal'); if (m) m.style.display = 'none'; }

  async function confirmGitReset() {
    const btn = $('btn-reset-submit'), cancel = $('btn-reset-cancel'), err = $('git-reset-error');
    btn.disabled = true; cancel.disabled = true; btn.textContent = tr('Resetting...');
    err.style.display = 'none';
    window.__resetting = true;
    try {
      // the browser clone becomes exactly what is on GitHub
      if (window.BrowserGit && await BrowserGit.isCloned()) await BrowserGit.resetToRemote();
      // nothing from the editor may be written over it on reload
      if (typeof collabStop === 'function') collabStop(true);
      if (typeof isDirty !== 'undefined') isDirty = false;
      location.reload();
    } catch (e) {
      window.__resetting = false;
      err.textContent = e.message || String(e);
      err.style.display = 'block';
      btn.disabled = false; cancel.disabled = false; btn.textContent = tr('Yes, overwrite with GitHub');
    }
  }

  window.openGitPullModal = openGitPullModal;
  window.closeGitPullModal = closeGitPullModal;
  window.confirmGitPull = confirmGitPull;
  window.fillGitPushChanges = fillGitPushChanges;
  window.openGitResetModal = openGitResetModal;
  window.closeGitResetModal = closeGitResetModal;
  window.confirmGitReset = confirmGitReset;
})();
