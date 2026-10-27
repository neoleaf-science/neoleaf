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
    const hints = {};   // what the project says about how it is built, read before the hidden files are dropped
    let total = 0;
    for (const e of entries) {
      const name = e.name.replace(/\\/g, '/');
      if (name.startsWith('/')) { skipped.push(name); continue; }
      if (/^(?:[^/]+\/)?\.?latexmkrc$/i.test(name) && e.bytes.length < 20000) hints.latexmkrc = new TextDecoder().decode(e.bytes);
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
    return { files, skipped, hints };
  }

  // "chapters" + "../main.tex" -> "main.tex"
  function joinPath(dir, rel) {
    const out = dir ? dir.split('/') : [];
    for (const seg of rel.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }
    return out.join('/');
  }
  const textOf = f => new TextDecoder().decode(f.bytes);
  // a line that is not a comment
  const live = text => text.split('\n').filter(l => !l.trimStart().startsWith('%')).join('\n');

  /** The main file: the one a `% !TeX root = ...` comment points to; else the .tex with \documentclass and \begin{document} (preferring usual names and the
   *  root of the project); a Typst project without .tex files has main.typ (or the first .typ). */
  function detectMainFile(files) {
    const tex = files.filter(f => ext(f.path) === 'tex');
    const texts = new Map(tex.map(f => [f.path, textOf(f)]));
    // "% !TeX root = main.tex" in the chapters: the file they all name is the main one
    const votes = new Map();
    for (const [p, t] of texts) {
      const m = /^[ \t]*%\s*!\s*T[eE]X\s+root\s*=\s*(\S+)/m.exec(t.slice(0, 4000));
      if (!m) continue;
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      const target = [joinPath('', m[1]), joinPath(dir, m[1])].find(x => texts.has(x));
      if (target) votes.set(target, (votes.get(target) || 0) + 1);
    }
    if (votes.size) return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    let cands = tex.filter(f => live(texts.get(f.path)).includes('\\documentclass')).map(f => f.path);
    if (!cands.length) cands = tex.map(f => f.path);
    const preferred = ['main.tex', 'paper.tex', 'article.tex', 'ms.tex', 'root.tex', 'thesis.tex', 'tese.tex', 'document.tex'];
    const key = p => {
      const depth = p.split('/').length - 1;
      const rank = preferred.indexOf(p.split('/').pop());
      const body = live(texts.get(p) || '').includes('\\begin{document}') ? 0 : 1;
      return [depth, body, rank < 0 ? preferred.length : rank, p.length];
    };
    cands.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
    if (cands[0]) return cands[0];
    const typ = files.filter(f => ext(f.path) === 'typ').map(f => f.path).sort((a, b) => (a.split('/').length - b.split('/').length) || (a === 'main.typ' ? -1 : b === 'main.typ' ? 1 : a.length - b.length));
    return typ[0] || null;
  }

  /** The compiler the project was written for: 'wasm-texlive' (pdfLaTeX), 'wasm-xelatex', 'wasm-lualatex' or 'wasm-typst'. Looks at a `% !TeX program` comment,
   *  the latexmkrc, and the packages and commands that only one engine has. */
  function detectEngine(files, main, hints) {
    if (main && ext(main) === 'typ') return 'wasm-typst';
    const byName = s => (/lua/i.test(s) ? 'wasm-lualatex' : /xe/i.test(s) ? 'wasm-xelatex' : /pdf/i.test(s) ? 'wasm-texlive' : null);
    const tex = files.filter(f => ['tex', 'sty', 'cls'].includes(ext(f.path)));
    const mainFile = tex.find(f => f.path === main);
    if (mainFile) {
      const m = /^[ \t]*%\s*!\s*T[eE]X\s+(?:TS-)?program\s*=\s*(\w+)/m.exec(textOf(mainFile).slice(0, 4000));
      const named = m && byName(m[1]);
      if (named) return named;
    }
    const rc = (hints && hints.latexmkrc) || '';
    if (/\$pdf_mode\s*=\s*5\b|\$pdflatex\s*=\s*['"][^'"]*xelatex/.test(rc)) return 'wasm-xelatex';
    if (/\$pdf_mode\s*=\s*4\b|\$pdflatex\s*=\s*['"][^'"]*lualatex/.test(rc)) return 'wasm-lualatex';
    let text = '';
    for (const f of tex) { if (text.length > 400000) break; text += '\n' + live(textOf(f)); }
    const uses = names => new RegExp('\\\\(?:usepackage|RequirePackage)\\s*(?:\\[[^\\]]*\\])?\\s*\\{[^}]*\\b(?:' + names + ')\\b[^}]*\\}').test(text);
    const lua = uses('luacode|luatexja|lualatex-math|luaotfload|luacolor|luatextra|selnolig|lua-ul|lua-visual-debug') || /\\directlua\b|\\RequireLuaTeX\b|\\documentclass(?:\[[^\]]*\])?\{ltj[a-z]+\}/.test(text);
    if (lua) return 'wasm-lualatex';
    const xe = uses('fontspec|unicode-math|polyglossia|xeCJK|xltxtra|xunicode|mathspec') || /\\RequireXeTeX\b/.test(text);
    return xe ? 'wasm-xelatex' : 'wasm-texlive';
  }
  const ENGINE_NAMES = { 'wasm-texlive': 'pdfLaTeX', 'wasm-xelatex': 'XeLaTeX', 'wasm-lualatex': 'LuaTeX', 'wasm-typst': 'Typst' };

  async function createRepo(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.id) throw new Error(data.error || 'Unknown error');
    return data;
  }

  /** Dashboard: creates the empty repository and leaves the files ready for the editor. Returns the project id. */
  async function start(file, name) {
    if (file.size > MAX_ZIP) throw new Error('Zip too large (maximum 200 MB)');
    const { files, skipped, hints } = await extract(new Uint8Array(await file.arrayBuffer()));
    const mainFile = detectMainFile(files);
    if (!mainFile) throw new Error('The zip has no .tex file');
    const engine = detectEngine(files, mainFile, hints);
    const data = await createRepo('/api/project/create-empty', { name });
    const all = files.slice();
    if (!all.some(f => f.path === '.gitignore')) all.push({ path: '.gitignore', bytes: new TextEncoder().encode(DEFAULT_GITIGNORE) });
    const note = [T('Main file: {0}', mainFile), T('Engine: {0}', ENGINE_NAMES[engine] || engine)];
    if (skipped.length) note.push(`${skipped.length} ${T('file(s) skipped')}`);
    await Handoff.put(data.id, { files: all, message: 'feat: import project from ZIP', mainFile, engine, preinstall: ext(mainFile) !== 'typ', note: note.join(' · ') });
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
    let { files, skipped, hints } = await extract(new Uint8Array(await res.arrayBuffer()));
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
    await Handoff.put(data.id, { files: all, message: `feat: create project from template ${model.name}`, mainFile, preinstall: true, note: '', engine: model.engine || detectEngine(files, mainFile, hints) });
    return data.id;
  }

  window.ProjectImport = { extract, detectMainFile, detectEngine, start, startNew, startFromModel, DEFAULT_GITIGNORE };
})();
