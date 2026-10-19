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
  [['logs-container', 'logs', 'block'], ['comments-container', 'comments', 'block'], ['search-container', 'search', 'block'], ['refs-container', 'refs', 'block'], ['map-container', 'map', 'flex'], ['preview-container', 'preview', 'flex']].forEach(([id, k, disp]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = tab === k ? disp : 'none';
  });
  [['pdf', 'tab-pdf-btn'], ['comments', 'tab-comments-btn'], ['search', 'tab-search-btn'], ['refs', 'tab-refs-btn'], ['map', 'tab-map-btn'], ['preview', 'tab-preview-btn'], ['logs', 'tab-logs-btn']].forEach(([k, id]) => {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('active', tab === k);
  });
  if (tab === 'comments' && window.Comments) Comments.render();
  if (tab === 'search' && window.ProjectSearch) ProjectSearch.focus();
  if (tab === 'refs' && window.References) References.focus();
  if (tab === 'map' && window.Mindmap) Mindmap.render();
  if (tab === 'preview') { if (window.MdPreview) MdPreview.show(); if (window.MermaidPreview) MermaidPreview.show(); if (window.CsvPreview) CsvPreview.show(); if (window.PyUI) PyUI.show(); }
  const dl = document.getElementById('download-pdf-btn');
  if (dl) dl.style.display = tab === 'preview' ? 'none' : '';   // downloading a PDF makes no sense in the Markdown preview
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}
