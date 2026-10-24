// Project file tree (side panel): folders that open and close, icons by type, open file
// highlighted, action bar (new file, new folder, upload) and ⋮ menu (rename, delete, download...).
//
// Depends on page globals: projectId, initialTree, currentFileId, switchFile(), editor, monaco, LD, h().

(function () {
  const $ = id => document.getElementById(id);
  const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];

  const ICONS = {
    chevron: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    file: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    book: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>',
    kebab: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>'
  };

  const state = {
    entries: [],
    expanded: new Set(),
    selectedDir: '',       // destination folder of "new file / new folder / upload"
    menu: null,
    nameResolve: null,
    moveResolve: null,
    draggedEntry: null
  };

  const isLegacyHash = s => typeof s === 'string' && s.length > 25 && !s.includes('.') && !s.includes('/');
  const storeKey = () => 'ld-tree-' + projectId;
  // open file: the editor's, or the page's initial one while the editor is still loading
  const activeId = () => {
    const id = currentFileId || (typeof activeFileId !== 'undefined' ? activeFileId : null);
    return isLegacyHash(id) ? 'main.tex' : id;
  };

  function loadExpanded() {
    try { return new Set(JSON.parse(localStorage.getItem(storeKey()) || '[]')); } catch (_) { return new Set(); }
  }

  function saveExpanded() {
    try { localStorage.setItem(storeKey(), JSON.stringify([...state.expanded])); } catch (_) {}
  }

  const ext = name => (String(name).split('.').pop() || '').toLowerCase();
  const baseName = path => path.split('/').pop();
  const parentOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

  function iconFor(entry) {
    if (entry.dir) return ICONS.folder;
    const e = ext(entry.path);
    if (e === 'bib') return ICONS.book;
    if (IMG_EXT.includes(e) || e === 'pdf') return ICONS.image;
    return ICONS.file;
  }

  // ------------------------------------------------------------ tree

  function buildTree(entries) {
    const root = { path: '', children: [] };
    const dirs = new Map([['', root]]);
    const sorted = [...entries].sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    for (const e of sorted) {
      const node = { ...e, name: baseName(e.path), children: [] };
      if (e.dir) dirs.set(e.path, node);
      (dirs.get(parentOf(e.path)) || root).children.push(node);
    }
    const order = (a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) : (a.dir ? -1 : 1));
    const sortRec = n => { n.children.sort(order); n.children.forEach(sortRec); };
    sortRec(root);
    return root;
  }

  function entryById(id) { return state.entries.find(e => e.id === id); }
  function entryByPath(path) { return state.entries.find(e => e.path === path); }

  function render() {
    const ul = $('file-tree');
    ul.textContent = '';
    const root = buildTree(state.entries);
    const draw = (nodes, container, depth) => {
      nodes.forEach(n => container.append(n.dir ? folderItem(n, depth) : fileItem(n, depth)));
    };
    draw(root.children, ul, 0);
    if (!state.entries.length) ul.append(h('li', { class: 'tree-empty' }, 'No files. Use the buttons above to create or upload.'));
  }

  function rowChildren(n, depth, withChevron) {
    return [
      h('span', { class: 'tree-chevron' + (withChevron ? '' : ' hidden') }),
      h('span', { class: 'tree-icon' }),
      h('span', { class: 'tree-name', title: n.path }, n.name),
      h('button', { class: 'tree-menu', title: 'More actions', onclick: ev => { ev.stopPropagation(); __FT.openMenu(n, ev.currentTarget); } })
    ];
  }

  function withSvg(span, svg) { span.innerHTML = svg; return span; }

  function folderItem(n, depth) {
    const open = state.expanded.has(n.path);
    const li = h('li', { class: 'tree-dir' + (open ? ' open' : '') + (state.selectedDir === n.path ? ' selected' : ''), 'data-name': n.path, 'data-id': n.id, 'data-dir': '1' });
    const row = h('div', { class: 'tree-row', style: `padding-left:${8 + depth * 16}px` });
    const [chev, icon, name, menu] = rowChildren(n, depth, true);
    withSvg(chev, ICONS.chevron); withSvg(icon, ICONS.folder); withSvg(menu, ICONS.kebab);
    row.append(chev, icon, name, menu);
    row.addEventListener('click', () => toggleDir(n.path));
    row.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); __FT.openMenu(n, menu, { x: ev.clientX, y: ev.clientY }); });
    __FT.setupDragSource(row, n);
    __FT.setupFolderDropTarget(row, li, n);
    li.append(row);
    const children = h('ul', { class: 'tree-children' });
    n.children.forEach(c => children.append(c.dir ? folderItem(c, depth + 1) : fileItem(c, depth + 1)));
    if (!open) children.style.display = 'none';
    li.append(children);
    return li;
  }

  function fileItem(n, depth) {
    const active = n.id === activeId();
    const li = h('li', { class: 'tree-file' + (active ? ' active' : ''), 'data-name': n.path, 'data-id': n.id });
    const row = h('div', { class: 'tree-row', style: `padding-left:${8 + depth * 16}px` });
    const [chev, icon, name, menu] = rowChildren(n, depth, false);
    withSvg(icon, iconFor(n)); withSvg(menu, ICONS.kebab);
    row.append(chev, icon, name, menu);
    row.addEventListener('click', () => openEntry(n));
    // double click: opens in a pinned tab
    row.addEventListener('dblclick', () => { if (n.text && window.Tabs) Tabs.open(n, { pin: true }); });
    row.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); __FT.openMenu(n, menu, { x: ev.clientX, y: ev.clientY }); });
    __FT.setupDragSource(row, n);
    __FT.setupFileDropTarget(row, n);
    li.append(row);
    return li;
  }

  function toggleDir(path) {
    if (state.expanded.has(path)) state.expanded.delete(path); else state.expanded.add(path);
    state.selectedDir = path;
    saveExpanded();
    render();
  }

  function expandAncestors(path) {
    let p = parentOf(path);
    while (p) { state.expanded.add(p); p = parentOf(p); }
  }

  // Opens the item: text in the editor; image and PDF in a preview; the rest can only be downloaded
  function openEntry(n) {
    state.selectedDir = parentOf(n.path);
    if (/\.ipynb$/i.test(n.path) && window.NotebookView) { NotebookView.open(n.path); return; }   // Jupyter notebook: its own window (notebook.js)
    if (n.text) { if (window.Tabs) Tabs.open(n, { pin: false }); else switchFile(n.id, n.path); return; }
    __FT.preview(n);
  }

  async function refreshFromBrowserGit() {
    if (!window.BrowserGit || !(await BrowserGit.isCloned())) return false;
    try {
      const items = await BrowserGit.listFiles();
      state.entries = items.map(f => {
        const isText = !f.is_folder && (
          f.name.endsWith('.tex') || f.name.endsWith('.mkiv') || f.name.endsWith('.mkxl') || f.name.endsWith('.bib') || f.name.endsWith('.cls') ||
          f.name.endsWith('.sty') || f.name.endsWith('.txt') || f.name.endsWith('.md') || f.name.endsWith('.markdown') || f.name.endsWith('.mmd') || f.name.endsWith('.mermaid') || f.name.endsWith('.csv') || f.name.endsWith('.tsv') || f.name.endsWith('.py') ||
          f.name.endsWith('.json') || f.name.endsWith('.bst') || /\.(typ|yaml|yml|toml|xml)$/i.test(f.name)
        );
        return {
          id: f.path,
          path: f.path,
          dir: f.is_folder,
          text: isText,
          mime: f.is_folder ? 'folder' : (isText ? 'text/plain' : 'application/octet-stream')
        };
      });
      const dirs = new Set(state.entries.filter(e => e.dir).map(e => e.path));
      state.expanded = new Set([...state.expanded].filter(p => dirs.has(p)));
      const cur = entryById(activeId());
      if (cur) expandAncestors(cur.path);
      render();
      if (window.Tabs) Tabs.sync(state.entries);
      window.dispatchEvent(new CustomEvent('tree-refreshed'));
      return true;
    } catch (e) {
      console.warn('Error reading the BrowserGit tree:', e);
      return false;
    }
  }

  async function refresh() {
    await refreshFromBrowserGit();
  }
  // ------------------------------------------------------------ highlight of the open file

  function markActive(fileId) {
    const e = entryById(fileId);
    if (e) { expandAncestors(e.path); state.selectedDir = parentOf(e.path); saveExpanded(); }
    document.querySelectorAll('#file-tree li.tree-file').forEach(li => li.classList.toggle('active', li.dataset.id === fileId));
    if (e && !document.querySelector('#file-tree li.tree-file.active')) render();
  }

  // ------------------------------------------------------------ start

  function init() {
    const raw = (typeof initialTree !== 'undefined' ? initialTree : []) || [];
    state.entries = raw.map(e => {
      if (e && e.path && (!e.id || isLegacyHash(e.id))) {
        return { ...e, id: e.path };
      }
      return e;
    });
    state.expanded = loadExpanded();
    const cur = entryById(activeId());
    if (cur) { expandAncestors(cur.path); state.selectedDir = parentOf(cur.path); }
    render();
    __FT.setupTreeContainerDrop($('file-tree'));

    // refreshes when the tab regains focus and every 30 s (other people may create files)
    window.addEventListener('focus', () => refresh().catch(() => {}));
    setInterval(() => { if (document.visibilityState === 'visible' && !state.nameResolve && !state.moveResolve && !state.menu) refresh().catch(() => {}); }, 30000);
  }

  function openPath(path) { const n = entryByPath(path); if (n) openEntry(n); }
  window.FT = { openPath, init, render, refresh, refreshFromBrowserGit, markActive, entries: () => state.entries };
  // the other parts (file-tree-dnd/menu/ops.js) add their functions to __FT and to FT
  window.__FT = { state, $, IMG_EXT, ICONS, isLegacyHash, activeId, saveExpanded, ext, baseName, parentOf, entryById, entryByPath, expandAncestors, refresh, render, openEntry };
  // after the page defined `initialTree` and `activeFileId`
  window.addEventListener('load', init);
})();
