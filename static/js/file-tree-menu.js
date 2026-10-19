// File tree: item menu, move window and name window.
// Part of the project file tree; shares its internals through window.__FT (see file-tree.js).

(function () {
  const { state, $, parentOf, baseName } = __FT;

  // ------------------------------------------------------------ menu ⋮

  function closeMenu() {
    if (state.menu) { state.menu.remove(); state.menu = null; }
  }

  function openMenu(n, anchor, coords) {
    closeMenu();
    const items = [];
    if (n.dir) {
      items.push(['New file here', () => { state.selectedDir = n.path; __FT.newFile(); }]);
      items.push(['New folder here', () => { state.selectedDir = n.path; __FT.newFolder(); }]);
      items.push(['Upload files here', () => { state.selectedDir = n.path; $('tree-upload').click(); }]);
    } else {
      if (n.text) items.push(['Open', () => __FT.openEntry(n)]);
      else items.push([T('Preview'), () => __FT.preview(n)]);
      items.push(['Download', () => __FT.download(n)]);
      items.push(['Make a copy', () => __FT.duplicate(n)]);
    }
    items.push([T('Move...'), () => askMove(n)]);
    items.push(['Rename', () => __FT.rename(n)]);
    items.push(['Delete', () => __FT.remove(n), true]);

    const menu = h('div', { class: 'tree-popup' }, ...items.map(([label, fn, danger]) =>
      h('button', { class: 'tree-popup-item' + (danger ? ' danger' : ''), onclick: ev => { ev.stopPropagation(); closeMenu(); fn(); } }, label)));
    document.body.append(menu);
    if (coords) {
      menu.style.left = Math.min(coords.x, window.innerWidth - 190) + 'px';
      menu.style.top = Math.min(coords.y, window.innerHeight - menu.offsetHeight - 8) + 'px';
    } else if (anchor) {
      const r = anchor.getBoundingClientRect();
      menu.style.left = Math.min(r.left, window.innerWidth - 190) + 'px';
      menu.style.top = Math.min(r.bottom + 2, window.innerHeight - menu.offsetHeight - 8) + 'px';
    }
    state.menu = menu;
  }

  document.addEventListener('click', e => { if (state.menu && !state.menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); __FT.closePreview(); nameCancel(); moveCancel(); } });

  // ------------------------------------------------------------ move window

  function askMove(n) {
    const modal = $('move-modal');
    if (!modal) return;
    const select = $('move-select');
    select.textContent = '';
    const currentParent = parentOf(n.path);
    const name = baseName(n.path);

    const options = [];
    if (currentParent !== '') {
      options.push({ path: '', label: T('/ (Project root)') });
    }
    state.entries
      .filter(e => e.dir && e.path !== n.path && !e.path.startsWith(n.path + '/') && e.path !== currentParent)
      .sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }))
      .forEach(e => {
        options.push({ path: e.path, label: '/' + e.path });
      });

    if (!options.length) {
      alert(T('"{0}" has no other destination folders available.', name));
      return;
    }

    options.forEach(opt => {
      const o = h('option', { value: opt.path }, opt.label);
      select.append(o);
    });

    $('move-title').textContent = T(n.dir ? 'Move folder "{0}"' : 'Move file "{0}"', name);
    const errBox = $('move-error');
    if (errBox) { errBox.textContent = ''; errBox.style.display = 'none'; }
    modal.style.display = 'flex';
    select.focus();

    state.moveResolve = async targetPath => {
      if (targetPath !== null) {
        await __FT.moveEntry(n, targetPath);
      }
    };
  }

  function moveSubmit(ev) {
    ev.preventDefault();
    const select = $('move-select');
    const val = select ? select.value : '';
    const modal = $('move-modal');
    if (modal) modal.style.display = 'none';
    const r = state.moveResolve;
    state.moveResolve = null;
    if (r) r(val);
  }

  function moveCancel() {
    const modal = $('move-modal');
    if (modal) modal.style.display = 'none';
    const r = state.moveResolve;
    state.moveResolve = null;
    if (r) r(null);
  }

  // ------------------------------------------------------------ name window

  function ask(title, initial, okLabel) {
    return new Promise(resolve => {
      state.nameResolve = resolve;
      $('name-title').textContent = title;
      $('name-ok').textContent = okLabel || 'OK';
      const input = $('name-input');
      input.value = initial || '';
      showNameError('');
      $('name-modal').style.display = 'flex';
      input.focus();
      // selects only the name, without the extension
      const dot = input.value.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    });
  }

  function showNameError(msg) {
    const box = $('name-error');
    box.textContent = msg || '';
    box.style.display = msg ? 'block' : 'none';
  }

  function nameSubmit(ev) {
    ev.preventDefault();
    const v = $('name-input').value.trim();
    if (/[\/\\]/.test(v)) { showNameError('The name cannot contain slashes. Use "New folder" to create folders.'); return; }
    if (v.startsWith('.')) { showNameError('The name cannot start with a dot.'); return; }
    $('name-modal').style.display = 'none';
    const r = state.nameResolve; state.nameResolve = null;
    if (r) r(v);
  }

  function nameCancel() {
    if (!state.nameResolve) return;
    $('name-modal').style.display = 'none';
    const r = state.nameResolve; state.nameResolve = null;
    r(null);
  }

  Object.assign(__FT, { closeMenu, openMenu, askMove, ask, showNameError });
  Object.assign(window.FT, { nameSubmit, nameCancel, moveSubmit, moveCancel });
})();
