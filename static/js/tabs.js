// Editor tabs: one click opens the file in a preview tab (italic, replaced by the next click);
// two clicks (or editing the file) pin the tab. Each tab remembers the cursor and scroll of its file.
//
// Depends on globals: projectId, currentFileId, switchFile(), editor, h(); and on FT (tree) for the icons.

(function () {
  const $ = id => document.getElementById(id);
  const baseName = p => String(p).split('/').pop();
  const parentName = p => { const parts = String(p).split('/'); return parts.length > 1 ? parts[parts.length - 2] : ''; };

  const state = {
    tabs: [],            // { id, path, preview }
    active: null,
    views: new Map(),    // id -> Monaco view state (cursor, scroll)
    pendingRestore: null // file whose state must be restored when collaboration syncs
  };

  const storeKey = () => 'ld-tabs-' + projectId;

  function isLegacyHash(s) {
    if (!s || typeof s !== 'string') return false;
    return s.length > 25 && !s.includes('.') && !s.includes('/');
  }

  function persist() {
    try { localStorage.setItem(storeKey(), JSON.stringify({ tabs: state.tabs, active: state.active })); } catch (_) {}
  }

  function loadStored() {
    try {
      const data = JSON.parse(localStorage.getItem(storeKey()) || 'null');
      if (!data) return null;
      if (Array.isArray(data.tabs)) {
        data.tabs = data.tabs.filter(t => t && !isLegacyHash(t.id) && !isLegacyHash(t.path));
      }
      if (data.active && isLegacyHash(data.active)) {
        data.active = null;
      }
      return data;
    } catch (_) { return null; }
  }

  const activeId = () => {
    const id = currentFileId || (typeof activeFileId !== 'undefined' ? activeFileId : null);
    return isLegacyHash(id) ? 'main.tex' : id;
  };

  // ------------------------------------------------------------ drawing

  function label(tab) {
    if (isLegacyHash(tab.path)) return 'main.tex';
    const name = baseName(tab.path);
    const twin = state.tabs.some(t => t.id !== tab.id && baseName(t.path) === name);
    const folder = parentName(tab.path);
    return twin && folder ? `${name} · ${folder}` : name;
  }

  const FILE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
  const BOOK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></svg>';

  function render() {
    const bar = $('tab-bar');
    if (!bar) return;
    bar.textContent = '';
    state.tabs.forEach(tab => {
      const isActive = tab.id === state.active;
      const icon = h('span', { class: 'tab-icon' });
      icon.innerHTML = /\.bib$/i.test(tab.path) ? BOOK_ICON : FILE_ICON;
      const el = h('div', { class: 'tab' + (isActive ? ' active' : '') + (tab.preview ? ' preview' : ''), 'data-id': tab.id, title: tab.path },
        icon,
        h('span', { class: 'tab-name' }, label(tab)));
      if (state.tabs.length > 1) {
        el.append(h('button', { class: 'tab-close', title: 'Close tab', onclick: ev => { ev.stopPropagation(); close(tab.id); } }, '×'));
      }
      el.addEventListener('click', () => activate(tab.id));
      el.addEventListener('dblclick', () => pin(tab.id));
      el.addEventListener('auxclick', ev => { if (ev.button === 1 && state.tabs.length > 1) { ev.preventDefault(); close(tab.id); } });
      bar.append(el);
    });
    const act = bar.querySelector('.tab.active');
    if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (window.collabLockRefresh) window.collabLockRefresh();
  }

  // ------------------------------------------------------------ operations

  function findTab(id) { return state.tabs.find(t => t.id === id); }

  // Opens a file: new (preview) tab or the pinned one, if `pin`
  function open(entry, opts) {
    const pinned = !!(opts && opts.pin);
    let tab = findTab(entry.id);
    if (!tab) {
      tab = { id: entry.id, path: entry.path, preview: !pinned };
      const previewIdx = pinned ? -1 : state.tabs.findIndex(t => t.preview);
      if (previewIdx >= 0) state.tabs[previewIdx] = tab; else state.tabs.push(tab);
    } else if (pinned) {
      tab.preview = false;
    }
    state.active = entry.id;
    render();
    persist();
    switchFile(entry.id, entry.path);
  }

  function activate(id) {
    const tab = findTab(id);
    if (!tab || id === activeId()) return;
    state.active = id;
    render();
    persist();
    switchFile(tab.id, tab.path);
  }

  function pin(id) {
    const tab = findTab(id);
    if (tab && tab.preview) { tab.preview = false; render(); persist(); }
  }

  // Called by switchFile when the file actually changed: ensures the tab and marks it active
  function touch(id, path) {
    if (isLegacyHash(id)) return;
    const cleanPath = (!path || isLegacyHash(path)) ? (id && id.includes('.') ? id : 'main.tex') : path;
    let tab = findTab(id);
    if (!tab) {
      tab = { id, path: cleanPath, preview: true };
      const previewIdx = state.tabs.findIndex(t => t.preview);
      if (previewIdx >= 0) state.tabs[previewIdx] = tab; else state.tabs.push(tab);
    } else if (cleanPath && tab.path !== cleanPath) {
      tab.path = cleanPath;
    }
    state.active = id;
    render();
    persist();
  }

  function close(id) {
    const i = state.tabs.findIndex(t => t.id === id);
    if (i < 0 || state.tabs.length <= 1) return;
    const wasActive = id === activeId();
    state.tabs.splice(i, 1);
    state.views.delete(id);
    if (wasActive) {
      const next = state.tabs[i] || state.tabs[i - 1];
      state.active = next.id;
      render();
      persist();
      switchFile(next.id, next.path);
    } else {
      render();
      persist();
    }
  }

  // ------------------------------------------------------------ cursor and scroll of each tab

  function saveState() {
    const id = currentFileId;
    if (id && typeof editor !== 'undefined' && editor) state.views.set(id, editor.saveViewState());
  }

  function restoreState(id) {
    const v = state.views.get(id);
    if (v && editor) editor.restoreViewState(v);
  }

  // When switching tabs the text arrives from the server (collaboration room): restores the position when it syncs
  function expectRestore(id) { state.pendingRestore = state.views.has(id) ? id : null; }

  window.addEventListener('collab-synced', () => {
    if (state.pendingRestore && state.pendingRestore === currentFileId) {
      restoreState(state.pendingRestore);
      state.pendingRestore = null;
    }
  });

  // ------------------------------------------------------------ rename, delete and refresh the list

  // a file (or folder) changed path
  function pathChanged(oldPath, newPath) {
    let changed = false;
    state.tabs.forEach(t => {
      if (t.path === oldPath || t.path.startsWith(oldPath + '/')) { t.path = newPath + t.path.slice(oldPath.length); changed = true; }
    });
    if (changed) { render(); persist(); }
  }

  // file or folder deleted: closes the tabs; returns the tab that should stay active (or null)
  function removedPath(path, isDir) {
    const gone = t => t.path === path || (isDir && t.path.startsWith(path + '/'));
    const wasActive = state.tabs.some(t => gone(t) && t.id === activeId());
    const remaining = state.tabs.filter(t => !gone(t));
    if (remaining.length === state.tabs.length) return null;
    const idx = state.tabs.findIndex(gone);
    state.tabs = remaining;
    state.tabs.forEach(t => { if (!findTab(t.id)) state.views.delete(t.id); });
    let next = null;
    if (wasActive && remaining.length) next = remaining[Math.min(idx, remaining.length - 1)];
    if (next) state.active = next.id;
    render();
    persist();
    return wasActive ? next : null;
  }

  // file list updated (someone may have deleted or renamed): keeps only tabs that still exist
  function sync(entries) {
    const byId = new Map(entries.filter(e => !e.dir).map(e => [e.id, e]));
    const byPath = new Map(entries.filter(e => !e.dir).map(e => [e.path, e]));
    let changed = false;
    state.tabs = state.tabs.filter(t => {
      if (isLegacyHash(t.id) || isLegacyHash(t.path)) {
        changed = true;
        return false;
      }
      const e = byId.get(t.id) || byPath.get(t.path);
      if (!e) {
        if (t.id === activeId() && !isLegacyHash(t.id)) return true;
        changed = true;
        return false;
      }
      if (t.id !== e.id) {
        const wasActive = state.active === t.id;
        t.id = e.id;
        if (wasActive) state.active = e.id;
        changed = true;
      }
      if (e.path !== t.path) { t.path = e.path; changed = true; }
      return true;
    });
    if (isLegacyHash(state.active)) {
      state.active = state.tabs.length ? state.tabs[0].id : null;
      changed = true;
    }
    if (changed) { render(); persist(); }
  }

  // ------------------------------------------------------------ start

  function init() {
    const entries = (window.FT && FT.entries()) || [];
    const byId = new Map(entries.filter(e => !e.dir && e.text).map(e => [e.id, e]));
    const stored = loadStored();
    if (stored && Array.isArray(stored.tabs)) {
      state.tabs = stored.tabs.filter(t => byId.has(t.id)).map(t => ({ id: t.id, path: byId.get(t.id).path, preview: !!t.preview }));
    }
    // the file the page opened becomes a tab (a preview one, if it did not exist yet)
    let first = activeId();
    if (isLegacyHash(first)) {
      first = 'main.tex';
    }
    const firstEntry = byId.get(first);
    if (first && !findTab(first)) {
      const tabPath = firstEntry ? firstEntry.path : (first.includes('.') ? first : 'main.tex');
      const tab = { id: first, path: tabPath, preview: true };
      const previewIdx = state.tabs.findIndex(t => t.preview);
      if (previewIdx >= 0) state.tabs[previewIdx] = tab; else state.tabs.push(tab);
    }
    state.active = first;
    render();

    // editing the file pins the preview tab
    const hookEditor = () => {
      if (typeof editor === 'undefined' || !editor || state._hooked) return;
      state._hooked = true;
      const pinActive = () => { const t = findTab(currentFileId); if (t && t.preview) { t.preview = false; render(); persist(); } };
      // keys that change the text: characters, Backspace/Delete/Enter/Tab and Ctrl/Cmd + V, X, Z, Y
      editor.onKeyDown(ev => {
        const e = ev.browserEvent;
        const mod = e.ctrlKey || e.metaKey;
        const changes = mod ? ['v', 'x', 'z', 'y'].includes(String(e.key).toLowerCase()) : (!e.altKey && (e.key.length === 1 || ['Backspace', 'Delete', 'Enter', 'Tab'].includes(e.key)));
        if (changes) pinActive();
      });
      editor.onDidPaste(pinActive);

      // goes back to the last used tab, if the page opened another file
      const want = stored && stored.active;
      if (want && want !== currentFileId && byId.has(want) && findTab(want)) {
        state.active = want;
        render();
        switchFile(want, byId.get(want).path);
      }
    };
    if (typeof editor !== 'undefined' && editor) hookEditor(); else window.addEventListener('editor-ready', hookEditor, { once: true });
  }

  window.Tabs = { state, open, activate, pin, touch, close, saveState, restoreState, expectRestore, pathChanged, removedPath, sync, render };
  window.addEventListener('load', () => setTimeout(init, 0));
})();
