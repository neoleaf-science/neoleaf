// Status indicator, panel tabs and small UI helpers.
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// Update status dot and text
function updateStatus(state, text) {
  const dot = document.getElementById('status-dot');
  const textEl = document.getElementById('status-text');
  if (!dot || !textEl) return;

  dot.className = 'status-dot';
  if (state === 'saving') dot.classList.add('saving');
  if (state === 'error') dot.classList.add('error');

  textEl.innerText = text;
}

// Document structure: from the main file, following \input/\include (static/js/outline.js)
function updateDocumentOutline() {
  if (window.LDOutline) LDOutline.schedule();
}

function switchTab(tab) {
  pdfTab = tab;
  updatePdfEmpty();
  const pdfFrame = document.getElementById('pdf-viewer');
  if (pdfFrame) pdfFrame.style.display = tab === 'pdf' ? (pdfFrame.dataset.ready ? 'flex' : 'block') : 'none';
  [['logs-container', 'logs', 'block'], ['comments-container', 'comments', 'block'], ['search-container', 'search', 'block'], ['refs-container', 'refs', 'block'], ['map-container', 'map', 'flex'], ['preview-container', 'preview', 'flex'], ['ai-container', 'ai', 'block']].forEach(([id, k, disp]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = tab === k ? disp : 'none';
  });
  [['pdf', 'tab-pdf-btn'], ['comments', 'tab-comments-btn'], ['search', 'tab-search-btn'], ['refs', 'tab-refs-btn'], ['map', 'tab-map-btn'], ['preview', 'tab-preview-btn'], ['ai', 'tab-ai-btn'], ['logs', 'tab-logs-btn']].forEach(([k, id]) => {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('active', tab === k);
  });
  if (tab === 'comments' && window.Comments) Comments.render();
  if (tab === 'search' && window.ProjectSearch) ProjectSearch.focus();
  if (tab === 'refs' && window.References) References.focus();
  if (tab === 'map' && window.Mindmap) Mindmap.render();
  if (tab === 'ai' && window.AISettings) AISettings.show();
  if (tab === 'preview') { if (window.MdPreview) MdPreview.show(); if (window.MermaidPreview) MermaidPreview.show(); if (window.CsvPreview) CsvPreview.show(); if (window.PyUI) PyUI.show(); }
  const dl = document.getElementById('download-pdf-btn');
  if (dl) dl.style.display = tab === 'preview' ? 'none' : '';   // downloading a PDF makes no sense in the Markdown preview
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}


// Display title of the project (the pencil in the header, owner only): the same route and rules as the pencil of the projects list.
// It is saved in the repository description as "NeoLeaf: <title>"; the repository, its address and every local copy stay as they are.
async function editProjectTitle() {
  const el = document.getElementById('project-title');
  if (!el) return;
  const typed = prompt('Project title, shown only in NeoLeaf lists (saved in the repository description as "NeoLeaf: title"). Leave it empty to remove it.', el.dataset.title || '');
  if (typed === null) return;
  const send = async overwrite => (await fetch('/api/project/' + encodeURIComponent(projectId) + '/title', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: typed, overwrite })
  })).json();
  try {
    let r = await send(false);
    if (r.needs_overwrite) {
      if (!confirm('The repository already has a description that is not a NeoLeaf title. Replace it with this title?')) return;
      r = await send(true);
    }
    if (r.error) { alert(T('Could not change the title: {0}', T(r.error))); return; }
    const title = r.title || '';
    el.dataset.title = title;
    el.textContent = title || el.dataset.repo;
    el.title = title ? title + ' (' + el.dataset.repo + ')' : el.dataset.repo;
    document.title = (title || el.dataset.repo) + ' - NeoLeaf Editor';
    if (typeof neoToast === 'function') neoToast(title ? T('Title saved.') : T('Title removed.'));
  } catch (e) {
    alert(T('Could not change the title: {0}', (e && e.message) || e));
  }
}
