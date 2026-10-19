// Project download menu: source code as ZIP and the .bbl of the last compilation.
(function () {
  const $ = id => document.getElementById(id);

  function close() { const m = $('dl-menu'); if (m) m.remove(); }

  function save(url, name) {
    const a = document.createElement('a');
    a.href = url; a.download = name || '';
    document.body.append(a); a.click(); a.remove();
  }

  async function downloadBbl() {
    close();
    try {
      const bbl = await Project.pdf.bbl();
      if (!bbl) { alert(T('There is no .bbl yet: compile a project that uses BibTeX (\\bibliography) with the browser engine.')); return; }
      const url = URL.createObjectURL(new Blob([bbl], { type: 'text/plain;charset=utf-8' }));
      const main = ((window.projectConfig && projectConfig.mainFile) || 'main.tex').split('/').pop().replace(/\.tex$/i, '');
      save(url, main + '.bbl');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { alert(T('Connection failure: {0}', e.message)); }
  }

  async function downloadZip() {
    close();
    try {
      // nothing to push: GitHub's own ZIP (the server only relays it, without storing); with local changes or if
      // GitHub does not respond: builds the ZIP here in the browser, with the files of the local clone
      const st = typeof gitStatusState !== 'undefined' ? gitStatusState : null;
      const clean = !!st && !(st.uncommitted_changes > 0) && !(st.ahead > 0) && !(typeof isDirty !== 'undefined' && isDirty);
      let r = null;
      if (clean) { try { r = await fetch(`/api/project/${projectId}/github-zip`); } catch (_) { r = null; } }
      let blob, name = 'project.zip';
      if (r && r.ok) {
        const cd = r.headers.get('Content-Disposition') || '';
        name = (/filename="([^"]+)"/.exec(cd) || [])[1] || name;
        blob = await r.blob();
      } else {
        ({ blob, name } = await Project.exportZip());
      }
      const url = URL.createObjectURL(blob);
      save(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { alert(T('Connection failure: {0}', e.message)); }
  }

  function toggle(ev) {
    ev.stopPropagation();
    if ($('dl-menu')) { close(); return; }
    const btn = ev.currentTarget, r = btn.getBoundingClientRect();
    const item = (label, fn) => h('button', { class: 'tree-popup-item', onclick: ev2 => { ev2.stopPropagation(); fn(); } }, label);
    const menu = h('div', { id: 'dl-menu', class: 'tree-popup dl-menu', style: `top:${r.bottom + 4}px;right:${Math.max(8, innerWidth - r.right)}px` },
      item('📦 ' + T('Source code (.zip)'), downloadZip), item('📄 ' + T('Bibliography (.bbl)'), downloadBbl));
    document.body.append(menu);
  }

  document.addEventListener('click', close);
  window.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
  window.ExportMenu = { toggle, downloadZip, downloadBbl };
})();
