// File tree: drag and drop (move entries, drop files from the desktop).
// Part of the project file tree; shares its internals through window.__FT (see file-tree.js).

(function () {
  const { state, parentOf, saveExpanded } = __FT;

  function canDrop(srcEntry, targetDirPath) {
    if (!srcEntry) return false;
    const dest = targetDirPath || '';
    if (srcEntry.path === dest) return false;
    if (parentOf(srcEntry.path) === dest) return false;
    if (srcEntry.dir && (dest === srcEntry.path || dest.startsWith(srcEntry.path + '/'))) return false;
    return true;
  }

  function clearDropTargets() {
    document.querySelectorAll('.tree-drop-target').forEach(el => el.classList.remove('tree-drop-target'));
  }

  function setupDragSource(row, n) {
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', ev => {
      if (ev.target.closest('.tree-menu') || ev.target.closest('.tree-chevron')) {
        ev.preventDefault();
        return;
      }
      state.draggedEntry = n;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', n.path);
      try { ev.dataTransfer.setData('application/x-neoleaf-item', n.path); } catch (_) {}
      requestAnimationFrame(() => row.classList.add('tree-dragging'));
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('tree-dragging');
      state.draggedEntry = null;
      clearDropTargets();
    });
  }

  function setupFolderDropTarget(row, li, n) {
    let hoverTimer = null;
    const cancelTimer = () => { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } };

    row.addEventListener('dragover', ev => {
      if (state.draggedEntry) {
        if (!canDrop(state.draggedEntry, n.path)) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = 'move';
        row.classList.add('tree-drop-target');
        if (!state.expanded.has(n.path) && !hoverTimer) {
          hoverTimer = setTimeout(() => {
            const ch = li.querySelector(':scope > .tree-children');
            if (ch && ch.style.display === 'none') {
              ch.style.display = '';
              li.classList.add('open');
              state.expanded.add(n.path);
              saveExpanded();
            }
          }, 650);
        }
      } else if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files')) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = 'copy';
        row.classList.add('tree-drop-target');
      }
    });

    row.addEventListener('dragleave', ev => {
      cancelTimer();
      if (!row.contains(ev.relatedTarget)) {
        row.classList.remove('tree-drop-target');
      }
    });

    row.addEventListener('drop', async ev => {
      cancelTimer();
      ev.preventDefault();
      ev.stopPropagation();
      row.classList.remove('tree-drop-target');
      if (state.draggedEntry) {
        const item = state.draggedEntry;
        state.draggedEntry = null;
        if (canDrop(item, n.path)) {
          await __FT.moveEntry(item, n.path);
        }
      } else if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
        state.selectedDir = n.path;
        await __FT.upload(ev.dataTransfer.files);
      }
    });
  }

  function setupFileDropTarget(row, n) {
    const targetDir = parentOf(n.path);
    row.addEventListener('dragover', ev => {
      if (state.draggedEntry) {
        if (!canDrop(state.draggedEntry, targetDir)) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = 'move';
        row.classList.add('tree-drop-target');
      } else if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files')) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = 'copy';
        row.classList.add('tree-drop-target');
      }
    });

    row.addEventListener('dragleave', ev => {
      if (!row.contains(ev.relatedTarget)) {
        row.classList.remove('tree-drop-target');
      }
    });

    row.addEventListener('drop', async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      row.classList.remove('tree-drop-target');
      if (state.draggedEntry) {
        const item = state.draggedEntry;
        state.draggedEntry = null;
        if (canDrop(item, targetDir)) {
          await __FT.moveEntry(item, targetDir);
        }
      } else if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
        state.selectedDir = targetDir;
        await __FT.upload(ev.dataTransfer.files);
      }
    });
  }

  function setupTreeContainerDrop(ul) {
    if (!ul || ul._dndInit) return;
    ul._dndInit = true;
    ul.addEventListener('dragover', ev => {
      if (ev.target === ul || ev.target.classList.contains('tree-empty') || !ev.target.closest('.tree-row')) {
        if (state.draggedEntry) {
          if (!canDrop(state.draggedEntry, '')) return;
          ev.preventDefault();
          ev.dataTransfer.dropEffect = 'move';
          ul.classList.add('tree-drop-target');
        } else if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files')) {
          ev.preventDefault();
          ev.dataTransfer.dropEffect = 'copy';
          ul.classList.add('tree-drop-target');
        }
      }
    });

    ul.addEventListener('dragleave', ev => {
      if (!ul.contains(ev.relatedTarget)) {
        ul.classList.remove('tree-drop-target');
      }
    });

    ul.addEventListener('drop', async ev => {
      if (ev.target === ul || ev.target.classList.contains('tree-empty') || !ev.target.closest('.tree-row')) {
        ev.preventDefault();
        ul.classList.remove('tree-drop-target');
        if (state.draggedEntry) {
          const item = state.draggedEntry;
          state.draggedEntry = null;
          if (canDrop(item, '')) {
            await __FT.moveEntry(item, '');
          }
        } else if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
          state.selectedDir = '';
          await __FT.upload(ev.dataTransfer.files);
        }
      }
    });
  }

  Object.assign(__FT, { canDrop, setupDragSource, setupFolderDropTarget, setupFileDropTarget, setupTreeContainerDrop });
})();
