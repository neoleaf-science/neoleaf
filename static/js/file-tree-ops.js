// File tree: file operations (create, upload, move, copy, rename, delete, download, preview).
// Part of the project file tree; shares its internals through window.__FT (see file-tree.js).

(function () {
  const { state, $, IMG_EXT, ext, baseName, parentOf, saveExpanded, activeId, entryById, entryByPath, expandAncestors, refresh, ask } = __FT;

  // ------------------------------------------------------------ actions

  function status(state2, text) { if (typeof updateStatus === 'function') updateStatus(state2, text); }

  // ---- files in BrowserGit: existence and open file when renaming/moving
  async function existsInGit(relPath) {
    try { await BrowserGit.getFs().pfs.stat(BrowserGit.getDir() + '/' + relPath); return true; } catch (_) { return false; }
  }

  // Writes the editor text to the old path and releases the collaborative room before touching the file system
  async function detachActive() {
    if (typeof editor === 'undefined' || !editor || !currentFileId || !window.BrowserGit) return;
    try { await BrowserGit.writeFile(currentFileId, editor.getValue()); } catch (_) {}
    if (window.collabStop) collabStop(true);
  }

  // After renaming/moving: the open file (or one inside the moved folder) now points to the new path
  function retargetActive(oldPath, newPath) {
    const id = typeof currentFileId === 'undefined' ? null : currentFileId;
    if (!id || !(id === oldPath || id.startsWith(oldPath + '/'))) return;
    const nid = newPath + id.slice(oldPath.length);
    currentFileId = nid;
    if (typeof editor !== 'undefined' && editor && typeof monaco !== 'undefined') monaco.editor.setModelLanguage(editor.getModel(), LD.languageFor(nid));
    if (window.Tabs) Tabs.state.active = nid;
    if (window.collabStart) collabStart(nid);
    FT.markActive && FT.markActive(nid);
  }

  async function newFile() {
    const name = await ask('New file', 'new.tex', 'Create');
    if (!name) return;
    try {
      if (window.BrowserGit && await BrowserGit.isCloned()) {
        const relPath = (state.selectedDir ? state.selectedDir + '/' : '') + name;
        if (await existsInGit(relPath)) { alert(T('A file or folder named "{0}" already exists in this folder.', name)); return; }
        await BrowserGit.writeFile(relPath, '');
        if (state.selectedDir) state.expanded.add(state.selectedDir);
        saveExpanded();
        await refresh();
        switchFile(relPath, relPath);
        return;
      }
      throw new Error(T('The local project is not available in this browser.'));
    } catch (e) { alert(T('Error creating file: {0}', e.message)); }
  }

  async function newFolder() {
    const name = await ask('New folder', '', 'Create');
    if (!name) return;
    try {
      if (window.BrowserGit && await BrowserGit.isCloned()) {
        const { pfs } = BrowserGit.getFs();
        const relPath = (state.selectedDir ? state.selectedDir + '/' : '') + name;
        await pfs.mkdir(BrowserGit.getDir() + '/' + relPath);
        if (state.selectedDir) state.expanded.add(state.selectedDir);
        saveExpanded();
        await refresh();
        return;
      }
      throw new Error(T('The local project is not available in this browser.'));
    } catch (e) { alert(T('Error creating folder: {0}', e.message)); }
  }

  async function upload(files) {
    const list = [...files];
    if (!list.length) return;
    if (window.BrowserGit && await BrowserGit.isCloned()) {
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        status('saving', T('Importing {0} ({1}/{2})...', f.name, i + 1, list.length));
        const buf = new Uint8Array(await f.arrayBuffer());
        const relPath = (state.selectedDir ? state.selectedDir + '/' : '') + f.name;
        await BrowserGit.writeFile(relPath, buf);
      }
      if (state.selectedDir) state.expanded.add(state.selectedDir);
      saveExpanded();
      await refresh();
      status('saved', T('Files imported into the browser'));
      return;
    }
    alert(T('The local project is not available in this browser.'));
  }

  async function moveEntry(n, targetDirPath) {
    const name = baseName(n.path);
    const dest = targetDirPath || '';
    const newPath = dest ? dest + '/' + name : name;
    if (n.path === newPath) return;
    if (entryByPath(newPath)) {
      alert(T('A file or folder named "{0}" already exists in the destination.', name));
      return;
    }
    status('saving', T('Moving {0}...', name));
    try {
      if (window.BrowserGit && await BrowserGit.isCloned()) {
        if (await existsInGit(newPath)) { alert(T('A file or folder named "{0}" already exists in the destination.', name)); return; }
        const { pfs } = BrowserGit.getFs();
        const base = BrowserGit.getDir();
        await detachActive();
        await pfs.rename(base + '/' + n.path, base + '/' + newPath);
        if (window.Tabs) Tabs.pathChanged(n.path, newPath);
        if (dest) expandAncestors(newPath);
        saveExpanded();
        await refresh();
        retargetActive(n.path, newPath);
        status('saved', T('"{0}" moved successfully', name));
        return;
      }
      throw new Error(T('The local project is not available in this browser.'));
    } catch (e) {
      status('error', T('Error moving'));
      alert(T('Error moving: {0}', e.message));
    }
  }

  function defaultCopyName(origName, parentDir) {
    const dot = origName.lastIndexOf('.');
    const base = dot > 0 ? origName.slice(0, dot) : origName;
    const extension = dot > 0 ? origName.slice(dot) : '';

    let candidate = `${base}_copia${extension}`;
    let counter = 2;
    const exists = name => {
      const p = parentDir ? `${parentDir}/${name}` : name;
      return !!entryByPath(p);
    };
    while (exists(candidate)) {
      candidate = `${base}_copia_${counter}${extension}`;
      counter++;
    }
    return candidate;
  }

  async function duplicate(n) {
    if (n.dir) return;
    const parentDir = parentOf(n.path);
    const origName = baseName(n.path);
    const suggested = defaultCopyName(origName, parentDir);
    const newName = await ask('Make a copy of file', suggested, 'Copy');
    if (!newName || newName === origName) return;

    const targetPath = parentDir ? parentDir + '/' + newName : newName;
    if (entryByPath(targetPath)) {
      alert(T('A file named "{0}" already exists in this folder.', newName));
      return;
    }

    status('saving', T('Copying {0}...', origName));
    try {
      if (n.id === activeId() && typeof saveCurrentFile === 'function') {
        try { await saveCurrentFile(); } catch (_) {}
      }

      if (window.BrowserGit && await BrowserGit.isCloned()) {
        if (n.text) {
          const text = await BrowserGit.readFile(n.path, 'utf8');
          await BrowserGit.writeFile(targetPath, text);
        } else {
          const u8 = await BrowserGit.readFile(n.path, 'uint8array');
          await BrowserGit.writeFile(targetPath, u8);
        }
        if (parentDir) state.expanded.add(parentDir);
        saveExpanded();
        await refresh();
        const created = entryByPath(targetPath);
        if (created) {
          if (created.text) {
            if (window.Tabs) Tabs.open(created, { pin: false });
            else switchFile(created.id, created.path);
          } else {
            preview(created);
          }
        }
        status('saved', T('"{0}" created', newName));
        return;
      }

      throw new Error(T('The local project is not available in this browser.'));
    } catch (e) {
      status('error', T('Error copying file'));
      alert(T('Error copying file: {0}', e.message));
    }
  }

  async function rename(n) {
    const name = await ask(T(n.dir ? 'Rename folder' : 'Rename file'), baseName(n.path), 'Rename');
    if (!name || name === baseName(n.path)) return;
    try {
      if (window.BrowserGit && await BrowserGit.isCloned()) {
        const { pfs } = BrowserGit.getFs();
        const newPath = (parentOf(n.path) ? parentOf(n.path) + '/' : '') + name;
        if (await existsInGit(newPath)) { alert(T('A file or folder named "{0}" already exists in this folder.', name)); return; }
        await detachActive();
        await pfs.rename(BrowserGit.getDir() + '/' + n.path, BrowserGit.getDir() + '/' + newPath);
        if (window.Tabs) Tabs.pathChanged(n.path, newPath);
        await refresh();
        retargetActive(n.path, newPath);
        return;
      }
      throw new Error(T('The local project is not available in this browser.'));
    } catch (e) { alert(T('Error renaming: {0}', e.message)); }
  }

  async function remove(n) {
    const what = n.dir ? T('the folder "{0}" and everything inside it', n.name || baseName(n.path)) : `"${baseName(n.path)}"`;
    if (!confirm(T('Delete {0}?', what))) return;
    try {
      if (window.BrowserGit && await BrowserGit.isCloned()) {
        const openedInside = n.dir ? (entryById(activeId()) || { path: '' }).path.startsWith(n.path + '/') : n.id === activeId();
        await BrowserGit.deleteFile(n.path);
        const nextTab = window.Tabs ? Tabs.removedPath(n.path, n.dir) : null;
        await refresh();
        if (openedInside && nextTab) { currentFileId = null; switchFile(nextTab.id, nextTab.path); return; }
        if (openedInside) {
          const next = state.entries.find(e => e.text && e.path === 'main.tex') || state.entries.find(e => e.text && e.path.endsWith('.tex')) || state.entries.find(e => e.text);
          if (next) { currentFileId = null; switchFile(next.id, next.path); }
        }
        return;
      }
      throw new Error(T('The local project is not available in this browser.'));
    } catch (e) { alert(T('Error deleting: {0}', e.message)); }
  }

  async function fileBlob(n) {
    if (window.BrowserGit && await BrowserGit.isCloned()) {
      const e = ext(n.path);
      const type = e === 'pdf' ? 'application/pdf' : IMG_EXT.includes(e) ? (e === 'svg' ? 'image/svg+xml' : 'image/' + (e === 'jpg' ? 'jpeg' : e)) : 'application/octet-stream';
      if (n.text) {
        const text = await BrowserGit.readFile(n.path, 'utf8');
        return new Blob([text], { type: 'text/plain;charset=utf-8' });
      }
      const u8 = await BrowserGit.readFile(n.path, 'uint8array');
      return new Blob([u8], { type });
    }
    throw new Error(T('The local project is not available in this browser.'));
  }

  async function download(n) {
    try {
      const blob = await fileBlob(n);
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: baseName(n.path) });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { alert(T('Error downloading: {0}', e.message)); }
  }

  let previewUrl = null;

  async function preview(n) {
    const e = ext(n.path);
    $('preview-title').textContent = n.path;
    const body = $('preview-body');
    body.textContent = 'Loading...';
    $('preview-modal').style.display = 'flex';
    try {
      if (IMG_EXT.includes(e) || e === 'pdf') {
        const blob = await fileBlob(n);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        body.textContent = '';
        body.append(e === 'pdf'
          ? h('iframe', { src: previewUrl, style: 'width:100%;height:100%;border:0;background:#fff;' })
          : h('img', { src: previewUrl, style: 'max-width:100%;max-height:100%;object-fit:contain;background:#fff;' }));
      } else {
        body.textContent = '';
        body.append(h('div', { style: 'text-align:center;color:var(--muted);' },
          h('p', { style: 'margin-bottom:14px;' }, 'This file type cannot be opened in the editor.'),
          h('button', { class: 'btn btn-primary', onclick: () => download(n) }, 'Download')));
      }
    } catch (err) {
      body.textContent = T('Error: {0}', err.message);
    }
  }

  function closePreview() {
    $('preview-modal').style.display = 'none';
    $('preview-body').textContent = '';
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }

  Object.assign(__FT, { moveEntry, upload, newFile, newFolder, duplicate, rename, remove, download, preview, closePreview });
  Object.assign(window.FT, { newFile, newFolder, upload, duplicate, closePreview });
})();
