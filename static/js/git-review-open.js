// =====================================================================
// Pull and push review (part 3): automatic pull on open, clone failure notices, unsent work warning and project hand-off.
// Uses window.__GR (see git-review.js).
// =====================================================================
(function () {
  'use strict';
  const { $, esc, tr, ensureStyle, renderInto, isInternal, compareSafe, describe, localPaths, neoToast } = window.__GR;

  // ---------------------------------------------------------------- automatic pull on open

  /** Updates the file tree and the editor after a pull in the browser. */
  async function refreshAfterPull(changedPaths) {
    if (window.FT && FT.refreshFromBrowserGit) await FT.refreshFromBrowserGit();
    if (typeof currentFileId !== 'undefined' && currentFileId && editor && changedPaths.includes(currentFileId)) {
      try {
        const content = await BrowserGit.readFile(currentFileId);
        if (content !== undefined && content !== editor.getValue()) { editor.setValue(content); isDirty = false; }
      } catch (_) {}
    }
  }

  /** Pulls the latest from GitHub on its own, unless it touches files you also changed (then it only warns). */
  async function autoPullOnOpen() {
    if (!(window.BrowserGit && await BrowserGit.isCloned())) return;
    if (typeof conflictState !== 'undefined' && conflictState !== null) return;
    window.__gitBusy = true;
    try {
      const info = await compareSafe();
      if (!info.behind) return;
      const local = await localPaths(info);
      const incoming = info.incoming.files.map(f => f.path);
      const clash = incoming.filter(p => local.has(p) && !isInternal(p));
      if (clash.length) {
        neoToast(tr('GitHub has updates to files you also changed. Review them in the Pull button before pulling.'));
        return;
      }
      updateStatus('saving', tr('Updating from GitHub...'));
      const res = await BrowserGit.pull();
      if (res && res.conflict) {
        updateStatus('error', tr('Conflict detected in Git Pull'));
        openGitConflictModal({ isBrowser: true, files: res.files });
        return;
      }
      await refreshAfterPull(incoming);
      updateStatus('saved', tr('Project updated with the latest from GitHub'));
      neoToast(`${tr('Updated from GitHub')}: ${incoming.length} ${tr('file(s)')}, ${info.behind} ${tr('commit(s)')}.`);
    } catch (err) {
      console.warn('Automatic pull not run:', err);
    } finally {
      window.__gitBusy = false;
      if (typeof checkGitStatus === 'function') checkGitStatus();
    }
  }

  // ---------------------------------------------------------------- failure to open the project

  /** The project could not be downloaded: warns clearly, blocks editing and offers to try again (never creates an empty project). */
  function showCloneError(err) {
    ensureStyle();
    window.__cloneFailed = true;
    const msg = (err && err.message) || String(err || '');
    let el = $('git-error-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'git-error-banner';
      el.className = 'gr-banner';
      document.body.append(el);
    }
    el.innerHTML = '';
    const b = document.createElement('strong'); b.textContent = tr('Could not open the project.');
    const t = document.createElement('span'); t.textContent = msg;
    const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'git-error-retry'; btn.textContent = tr('Try again');
    btn.onclick = () => location.reload();
    el.append(b, t, btn);
    if (typeof editor !== 'undefined' && editor) editor.updateOptions({ readOnly: true });
    updateStatus('error', tr('Project not loaded'));
  }

  /** While the project is downloaded to the browser: a fixed notice with the progress (large repositories take a while). */
  function showCloneProgress(text) {
    ensureStyle();
    let el = $('clone-progress-banner');
    if (!el) { el = document.createElement('div'); el.id = 'clone-progress-banner'; el.className = 'gr-banner gr-info'; document.body.append(el); }
    el.textContent = text;
  }
  function hideCloneProgress() { const el = $('clone-progress-banner'); if (el) el.remove(); }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /** Clone left empty by old versions (while GitHub has content): saves a ZIP copy of whatever exists and downloads again. */
  async function recloneIfStuck() {
    if (!(window.BrowserGit && await BrowserGit.isStuckEmpty())) return false;
    updateStatus('saving', tr('Redoing the local clone of the project...'));
    const files = (await BrowserGit.listFiles()).filter(f => !f.is_folder);
    if (files.length && window.Zip) {
      const entries = [];
      for (const f of files) entries.push({ name: f.path, bytes: await BrowserGit.readFile(f.path, 'uint8array') });
      const name = (projectId.split('__').slice(1).join('__') || 'project') + '-local-copy.zip';
      downloadBlob(new Blob([Zip.write(entries)], { type: 'application/zip' }), name);
      neoToast(`${tr('I saved a copy of your local files in')} ${name}.`);
    }
    await BrowserGit.wipe();
    await BrowserGit.clone(p => { if (p && p.phase) updateStatus('saving', `Git: ${p.phase}...`); });
    return true;
  }

  // ---------------------------------------------------------------- unsent work and persistent storage

  let pendingSince = 0, dismissedAt = 0;

  function hideUnsent() { const el = $('gr-unsent'); if (el) el.remove(); }

  function showUnsent(n) {
    ensureStyle();
    let el = $('gr-unsent');
    if (!el) { el = document.createElement('div'); el.id = 'gr-unsent'; el.className = 'gr-unsent'; document.body.append(el); }
    el.innerHTML = '';
    const p = document.createElement('div');
    p.textContent = `${tr('You have {0} change(s) not yet pushed to GitHub.', n)} ${tr('Right now they are saved only in this browser.')}`
      + (window.__storagePersisted === false ? ' ' + tr('The browser may delete this data: push to GitHub to be safe.') : '');
    const row = document.createElement('div'); row.className = 'gr-actions';
    const send = document.createElement('button'); send.type = 'button'; send.className = 'btn btn-primary'; send.id = 'gr-unsent-send'; send.textContent = tr('Send now');
    send.onclick = () => { hideUnsent(); if (window.openGitPushModal) openGitPushModal(); };
    const later = document.createElement('button'); later.type = 'button'; later.className = 'btn'; later.id = 'gr-unsent-later'; later.textContent = tr('Later');
    later.onclick = () => { dismissedAt = Date.now(); hideUnsent(); };
    row.append(send, later);
    el.append(p, row);
  }

  /** Called on every Git check: names what exists only in this browser and, after a while, reminds to push. */
  function updateUnsentNotice(uncommitted, ahead) {
    const n = (uncommitted || 0) + (ahead || 0);
    const btn = $('git-push-btn');
    if (btn) {
      if (!btn.dataset.baseTitle) btn.dataset.baseTitle = btn.title || '';
      btn.title = n ? tr('{0} change(s) not yet pushed to GitHub', n) : btn.dataset.baseTitle;
    }
    if (!n) { pendingSince = 0; hideUnsent(); return; }
    if (!pendingSince) pendingSince = Date.now();
    if (Date.now() - pendingSince < (window.__unsentAfterMs != null ? window.__unsentAfterMs : 10 * 60 * 1000)) return;
    if (dismissedAt && Date.now() - dismissedAt < (window.__unsentRepeatMs != null ? window.__unsentRepeatMs : 30 * 60 * 1000)) return;
    showUnsent(n);
  }

  /** Asks the browser not to delete the site data on its own (the project lives here until the Push). */
  async function requestPersistence() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return;
      let ok = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (!ok) ok = await navigator.storage.persist();
      window.__storagePersisted = !!ok;
      if (navigator.storage.estimate) {
        const { usage, quota } = await navigator.storage.estimate();
        if (quota && usage / quota > 0.8) neoToast(tr('Browser storage is almost full. Push the project to GitHub, then free up space in your profile (Storage tab).'));
      }
    } catch (_) { /* no support: carry on */ }
  }

  // ---------------------------------------------------------------- new / imported project

  /** If creation or import left files for this project (Handoff), writes them to the clone, commits and pushes. */
  async function applyHandoff() {
    if (!window.Handoff || typeof projectId === 'undefined') return false;
    const h = await Handoff.take(projectId);
    if (!h) return false;
    window.__gitBusy = true;
    try {
      updateStatus('saving', tr('Preparing the project...'));
      for (const f of h.files) await BrowserGit.writeFile(f.path, f.bytes);
      const cfg = { version: 1, mainFile: h.mainFile || 'main.tex', engine: h.engine || 'wasm-texlive', autoInstall: true };
      await BrowserGit.writeFile('.neoleaf/config.json', JSON.stringify(cfg, null, 2));
      if (h.preinstall) {
        updateStatus('saving', tr('Installing the packages the project asks for...'));
        try { await Project.texmf.preinstall(); } catch (_) { /* the compilation installs whatever is missing */ }
      }
      await BrowserGit.commit(h.message || 'feat: import project');
      try {
        await BrowserGit.push();
        neoToast(tr('Project created and pushed to GitHub.') + (h.note ? ' ' + h.note + '.' : ''));
      } catch (e) {
        neoToast(tr('Project prepared in the browser, but the push to GitHub failed: use the Push button. ') + (e.message || ''));
      }
      if (window.FT && FT.refreshFromBrowserGit) await FT.refreshFromBrowserGit();
      return true;
    } finally {
      window.__gitBusy = false;
    }
  }

  window.autoPullOnOpen = autoPullOnOpen;
  window.applyHandoff = applyHandoff;
  window.showCloneError = showCloneError;
  window.showCloneProgress = showCloneProgress;
  window.hideCloneProgress = hideCloneProgress;
  window.recloneIfStuck = recloneIfStuck;
  window.updateUnsentNotice = updateUnsentNotice;
  window.requestPersistence = requestPersistence;
})();
