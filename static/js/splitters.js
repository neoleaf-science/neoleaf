// Adjustable divider bars between the panels: files | editor | PDF, and (on the side) files / outline (sections).
// Drag with the mouse (or use the arrow keys with the bar focused). Double-click resets to the default size.
// The widths are stored in the browser.

(function () {
  const KEY = 'ld-layout';
  const MIN_SIDEBAR = 160;
  const MAX_SIDEBAR = 560;
  const MIN_PREVIEW = 260;
  const MIN_EDITOR = 300;

  const main = document.querySelector('.main-container');
  const sidebar = document.querySelector('.sidebar');
  const preview = document.querySelector('.preview-pane');
  const splitSidebar = document.getElementById('split-sidebar');
  const splitPreview = document.getElementById('split-preview');
  if (!main || !sidebar || !preview || !splitSidebar || !splitPreview) return;

  const outline = document.getElementById('outline-list');
  const outlineTitle = document.getElementById('outline-title');
  const splitOutline = document.getElementById('split-outline');
  const MIN_OUTLINE = 60;
  const MIN_TREE = 100;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const handles = () => splitSidebar.offsetWidth + splitPreview.offsetWidth;

  function maxSidebar() {
    // leaves room for the editor and the PDF
    return clamp(main.clientWidth - MIN_EDITOR - (preview.style.width ? preview.offsetWidth : MIN_PREVIEW) - handles(), MIN_SIDEBAR, MAX_SIDEBAR);
  }

  function maxPreview() {
    return Math.max(MIN_PREVIEW, main.clientWidth - sidebar.offsetWidth - MIN_EDITOR - handles());
  }

  function setSidebar(w) {
    sidebar.style.width = clamp(Math.round(w), MIN_SIDEBAR, maxSidebar()) + 'px';
  }

  function setPreview(w) {
    preview.style.flex = 'none';
    preview.style.width = clamp(Math.round(w), MIN_PREVIEW, maxPreview()) + 'px';
  }

  // height of the sections list: what is left for the files never gets smaller than MIN_TREE
  function setOutline(h) {
    if (!outline) return;
    const tree = document.getElementById('file-tree');
    const treeTitle = sidebar.querySelector('.sidebar-section-title');
    const room = sidebar.clientHeight - (treeTitle ? treeTitle.offsetHeight : 0) - (outlineTitle ? outlineTitle.offsetHeight : 0) - (splitOutline ? splitOutline.offsetHeight : 0) - MIN_TREE;
    outline.style.maxHeight = 'none';
    outline.style.height = clamp(Math.round(h), MIN_OUTLINE, Math.max(MIN_OUTLINE, room)) + 'px';
    if (tree) tree.style.minHeight = MIN_TREE + 'px';
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        sidebar: sidebar.style.width ? sidebar.offsetWidth : null,
        preview: preview.style.width ? preview.offsetWidth : null,
        outline: outline && outline.style.height ? outline.offsetHeight : null
      }));
    } catch (_) {}
  }

  function load() {
    try {
      const l = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!l) return;
      if (l.sidebar) setSidebar(l.sidebar);
      if (l.preview) setPreview(l.preview);
      if (l.outline) setOutline(l.outline);
    } catch (_) {}
  }

  function reset(which) {
    if (which === 'outline') { if (outline) { outline.style.height = ''; outline.style.maxHeight = ''; } }
    else if (which === 'sidebar') sidebar.style.width = '';
    else { preview.style.flex = ''; preview.style.width = ''; }
    save();
  }

  // ------------------------------------------------------------ dragging

  function bind(handle, which) {
    handle.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      handle.setPointerCapture(ev.pointerId);
      document.body.classList.add('resizing');
      handle.classList.add('active');
      const rect = main.getBoundingClientRect();
      const move = e => {
        if (which === 'sidebar') setSidebar(e.clientX - rect.left);
        else setPreview(rect.right - e.clientX);
      };
      const up = e => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing');
        handle.classList.remove('active');
        save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });

    handle.addEventListener('dblclick', () => reset(which));

    // keyboard: arrows adjust, Home resets to the default
    handle.addEventListener('keydown', ev => {
      const step = ev.shiftKey ? 64 : 16;
      let delta = 0;
      if (ev.key === 'ArrowLeft') delta = -step;
      else if (ev.key === 'ArrowRight') delta = step;
      else if (ev.key === 'Home') { reset(which); ev.preventDefault(); return; }
      else return;
      ev.preventDefault();
      if (which === 'sidebar') setSidebar(sidebar.offsetWidth + delta);
      else setPreview(preview.offsetWidth - delta);   // the PDF bar grows the panel to the left
      save();
    });
  }

  // ---- horizontal bar (files / outline): dragging up enlarges the sections list
  function bindOutline(handle) {
    handle.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      handle.setPointerCapture(ev.pointerId);
      document.body.classList.add('resizing-h');
      handle.classList.add('active');
      const move = e => {
        const bottom = sidebar.getBoundingClientRect().bottom;
        setOutline(bottom - e.clientY - (outlineTitle ? outlineTitle.offsetHeight : 0) - handle.offsetHeight / 2);
      };
      const up = e => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing-h');
        handle.classList.remove('active');
        save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', () => { reset('outline'); save(); });
    handle.addEventListener('keydown', ev => {
      const step = ev.shiftKey ? 64 : 16;
      let delta = 0;
      if (ev.key === 'ArrowUp') delta = step;
      else if (ev.key === 'ArrowDown') delta = -step;
      else if (ev.key === 'Home') { reset('outline'); save(); ev.preventDefault(); return; }
      else return;
      ev.preventDefault();
      setOutline((outline ? outline.offsetHeight : 0) + delta);
      save();
    });
  }
  if (splitOutline && outline) bindOutline(splitOutline);

  bind(splitSidebar, 'sidebar');
  bind(splitPreview, 'preview');
  load();

  // smaller window: keeps the panels within the available space
  window.addEventListener('resize', () => {
    if (sidebar.style.width) setSidebar(sidebar.offsetWidth);
    if (preview.style.width) setPreview(preview.offsetWidth);
    if (outline && outline.style.height) setOutline(outline.offsetHeight);
  });
})();
