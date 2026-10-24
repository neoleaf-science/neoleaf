// Project import from a ZIP, in the browser: reads the ZIP, cleans the files, detects the main file and
// hands everything to the editor (Handoff), which commits and pushes. The server only creates the empty repository on GitHub.
(function () {
  'use strict';

  const MAX_ZIP = 200 * 1024 * 1024, MAX_FILES = 500, MAX_FILE = 50 * 1024 * 1024, MAX_TOTAL = 400 * 1024 * 1024, MAX_DEPTH = 6, MAX_NAME = 120;
  const JUNK = ['aux', 'log', 'out', 'toc', 'lof', 'lot', 'fls', 'fdb_latexmk', 'blg', 'nav', 'snm', 'vrb', 'bcf', 'run.xml'];
  const DEFAULT_GITIGNORE = '*.aux\n*.log\n*.out\n*.toc\n*.synctex.gz\n*.fls\n*.fdb_latexmk\n.neoleaf/last.*\n';
  const ext = n => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');

  function cleanSegment(seg) {
    const s = [...seg].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').trim();
    return !s || s.length > MAX_NAME || s === '.' || s === '..' ? null : s;
  }

  /** Reads the ZIP with the safety and cleanup rules. Returns { files: [{ path, bytes }], skipped: [] }. */
  async function extract(zipBytes) {
    const entries = await Zip.read(zipBytes, { maxEntries: MAX_FILES * 4, maxTotal: 400 * 1024 * 1024 });
    const raw = [];
    const skipped = [];
    let total = 0;
    for (const e of entries) {
      const name = e.name.replace(/\\/g, '/');
      if (name.startsWith('/')) { skipped.push(name); continue; }
      const segs = name.split('/').filter(Boolean);
      if (segs.some(s => s === '..' || s === '__MACOSX' || s.startsWith('.'))) { if (segs.includes('..')) skipped.push(name); continue; }
      const base = (segs[segs.length - 1] || '').toLowerCase();
      if (JUNK.some(x => base.endsWith('.' + x)) || base.endsWith('.synctex.gz') || base.endsWith('.synctex')) continue;
      const cleaned = segs.map(cleanSegment);
      if (cleaned.some(s => s === null)) { skipped.push(name); continue; }
      // the hidden-file rule again on the cleaned names (" .git" loses its space and would become ".git")
      if (cleaned.some(s => s.startsWith('.') || s.toLowerCase() === '__macosx')) continue;
      if (cleaned.length > MAX_DEPTH) { skipped.push(name); continue; }
      if (e.bytes.length > MAX_FILE) { skipped.push(`${name} (${T('larger than 50 MB')})`); continue; }
      total += e.bytes.length;
      if (total > MAX_TOTAL) throw new Error('The unpacked project exceeds 400 MB');
      if (raw.length >= MAX_FILES) throw new Error(`The zip has more than ${MAX_FILES} files`);
      raw.push({ segs: cleaned, bytes: e.bytes });
    }
    if (!raw.length) throw new Error('The zip contains no usable files');
    // everything inside a single folder (conference templates usually come this way): remove that folder
    if (raw.every(r => r.segs.length > 1) && raw.every(r => r.segs[0] === raw[0].segs[0])) raw.forEach(r => r.segs.shift());
    const seen = new Set();
    const files = [];
    for (const r of raw) {
      const path = r.segs.join('/');
      if (seen.has(path)) { skipped.push(`${path} (${T('duplicate')})`); continue; }
      seen.add(path);
      files.push({ path, bytes: r.bytes });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, skipped };
  }

  /** The main file: the .tex with \documentclass (preferring usual names and the root). */
  function detectMainFile(files) {
    const hasClass = bytes => new TextDecoder().decode(bytes).split('\n').some(l => !l.trimStart().startsWith('%') && l.includes('\\documentclass'));
    let cands = files.filter(f => ext(f.path) === 'tex' && hasClass(f.bytes)).map(f => f.path);
    if (!cands.length) cands = files.filter(f => ext(f.path) === 'tex').map(f => f.path);
    const preferred = ['main.tex', 'paper.tex', 'article.tex', 'ms.tex', 'root.tex', 'thesis.tex', 'tese.tex', 'document.tex'];
    const key = p => { const depth = p.split('/').length - 1; const rank = preferred.indexOf(p.split('/').pop()); return [depth, rank < 0 ? preferred.length : rank, p.length]; };
    cands.sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]; });
    return cands[0] || null;
  }

  async function createRepo(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.id) throw new Error(data.error || 'Unknown error');
    return data;
  }

  /** Dashboard: creates the empty repository and leaves the files ready for the editor. Returns the project id. */
  async function start(file, name) {
    if (file.size > MAX_ZIP) throw new Error('Zip too large (maximum 200 MB)');
    const { files, skipped } = await extract(new Uint8Array(await file.arrayBuffer()));
    const mainFile = detectMainFile(files);
    if (!mainFile) throw new Error('The zip has no .tex file');
    const data = await createRepo('/api/project/create-empty', { name });
    const all = files.slice();
    if (!all.some(f => f.path === '.gitignore')) all.push({ path: '.gitignore', bytes: new TextEncoder().encode(DEFAULT_GITIGNORE) });
    await Handoff.put(data.id, { files: all, message: 'feat: import project from ZIP', mainFile, preinstall: true, note: skipped.length ? `${skipped.length} ${T('file(s) skipped')}` : '' });
    return data.id;
  }

  /** Dashboard: new project from scratch (the server only creates the repository and returns the chosen template). */
  async function startNew(name, template) {
    const data = await createRepo('/api/project/create', { name, template });
    const enc = new TextEncoder();
    const typst = template === 'typst';
    await Handoff.put(data.id, { files: (data.files || []).map(f => ({ path: f.path, bytes: enc.encode(f.text) })), message: typst ? 'feat: initialize Typst project via NeoLeaf' : 'feat: initialize LaTeX project via NeoLeaf', mainFile: typst ? 'main.typ' : 'main.tex', engine: typst ? 'wasm-typst' : '', preinstall: false });
    return data.id;
  }

  /** Dashboard: new project from a catalog template (the server only relays the ZIP from the source registered by the administrator). */
  async function startFromModel(model, name) {
    const res = await fetch(`/api/templates/${encodeURIComponent(model.id)}/zip`);
    if (res.status === 403) throw new Error('Templates are available only when you sign in with GitHub.');
    if (!res.ok) throw new Error(res.status === 404 ? 'This template is no longer available' : 'Could not download the template right now. Try again in a moment.');
    let { files, skipped } = await extract(new Uint8Array(await res.arrayBuffer()));
    const sub = (model.subdir || '').replace(/^\/+|\/+$/g, '');
    if (sub) {
      files = files.filter(f => f.path.startsWith(sub + '/')).map(f => ({ path: f.path.slice(sub.length + 1), bytes: f.bytes }));
      if (!files.length) throw new Error('The template folder is empty or does not exist in this version');
    }
    const mainFile = (model.mainFile && files.some(f => f.path === model.mainFile)) ? model.mainFile : detectMainFile(files);
    if (!mainFile) throw new Error('The template has no .tex file');
    const data = await createRepo('/api/project/create-empty', { name });
    const all = files.slice();
    if (!all.some(f => f.path === '.gitignore')) all.push({ path: '.gitignore', bytes: new TextEncoder().encode(DEFAULT_GITIGNORE) });
    await Handoff.put(data.id, { files: all, message: `feat: create project from template ${model.name}`, mainFile, preinstall: true, note: '', engine: model.engine || '' });
    return data.id;
  }

  window.ProjectImport = { extract, detectMainFile, start, startNew, startFromModel, DEFAULT_GITIGNORE };
})();
