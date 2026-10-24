// =====================================================================
// `Project`: the project data, in the browser (local clone, BrowserGit). The server stores no project at all.
//
// Direct functions (no network) for what lives in `.neoleaf/` and for assembling the project at compile time. They all wait for the
// local clone to be ready and throw `Error` with a readable message when something cannot be done.
//
// Where the data lives (all inside the repository, versioned in Git, except what is "local"):
//   .neoleaf/config.json            project configuration
//   .neoleaf/comments.json          comments and suggestions (only exists when there are comments)
//   .neoleaf/history/<person>.json  authorship (one file per person, no Git conflicts)
//   .neoleaf/milestones/*.json      milestones
//   .neoleaf/texmf/                 extra packages uploaded by the person
//   .neoleaf/cache/texmf/           packages downloaded automatically from CTAN (local only, outside Git)
//   .neoleaf/last.*                 last PDF (ignored by Git, local only)
// Preferences and the "global" configuration live in localStorage; global extra packages, in browser storage.
// =====================================================================
(function () {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const TEXT_EXT = ['tex', 'bib', 'sty', 'cls', 'clo', 'bst', 'txt', 'cfg', 'def', 'ldf', 'fd', 'bbx', 'cbx', 'lbx', 'md', 'markdown', 'mmd', 'mermaid', 'dbx', 'ins', 'dtx', 'ist', 'bbl', 'csv', 'tsv', 'py', 'json', 'sto', 'ltx', 'rtx', 'mkiv', 'mkxl', 'mkvi'];
  const ASSET_EXT = ['png', 'jpg', 'jpeg', 'pdf', 'eps', 'otf', 'ttf', 'ttc', 'pfb', 'pfa', 'afm', 'tfm', 'vf', 'woff', 'woff2'];
  const MAX_FILES = 300, MAX_TEXT = 1024 * 1024, MAX_ASSET = 15 * 1024 * 1024;
  const MAX_MILESTONE = 3 * 1024 * 1024, MAX_HISTORY = 2000, MAX_PDF = 9 * 1024 * 1024;
  const MAX_THREADS = 500, MAX_COMMENT_TEXT = 4000;

  // ---------------------------------------------------------------- utilities

  const ext = n => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');
  const isText = n => TEXT_EXT.includes(ext(n));
  const isAsset = n => ASSET_EXT.includes(ext(n));
  const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const shortId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** Waits for the local clone to be ready (the project loading resolves this). */
  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });
  async function git() {
    const ok = await Promise.race([ready, new Promise(r => setTimeout(() => r(false), window.__projectWaitMs || 90000))]);
    if (!ok && window.__cloning) {   // still downloading (large repository): say so instead of looking like a defect
      throw new Error('The project is still being downloaded to the browser' + (window.__cloneProgress ? ' (' + window.__cloneProgress + ')' : '') + '. Wait for it to finish and try again.');
    }
    if (!ok && window.__cloneFailed) throw new Error('The project was not downloaded: see the notice at the top of the screen and use "Try again".');
    if (!ok || !window.BrowserGit || !(await BrowserGit.isCloned())) throw new Error('The local project is not available in this browser.');
    return BrowserGit;
  }
  const pfs = () => BrowserGit.getFs().pfs;
  const dir = () => BrowserGit.getDir();

  async function readText(path) {
    try { return await BrowserGit.readFile(path, 'utf8'); } catch (_) { return null; }
  }
  async function readJson(path) {
    const t = await readText(path);
    if (!t) return null;
    try { return JSON.parse(t); } catch (_) { return null; }
  }
  async function writeJson(path, obj, pretty = true) {
    await BrowserGit.writeFile(path, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
  }
  async function exists(path) {
    try { await pfs().stat(`${dir()}/${path}`); return true; } catch (_) { return false; }
  }
  async function remove(path) {
    try { await pfs().unlink(`${dir()}/${path}`); } catch (_) {}
  }

  /** Project files (without the .neoleaf folder), at most MAX_FILES: [{ path, name, size }]. */
  async function projectFiles() {
    const all = await BrowserGit.listFiles();
    return all.filter(f => !f.is_folder).slice(0, MAX_FILES);
  }

  function author() {
    const u = (typeof currentUser !== 'undefined' && currentUser) || {};
    const login = u.login || u.name || 'usuario';
    return { name: u.name || login, email: u.email || `${login}@users.noreply.github.com` };
  }

  // ---------------------------------------------------------------- preferences and configuration

  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  const validEngine = e => /^wasm-(texlive|xelatex|lualatex)$/.test(e) || /^agent-[a-z]{1,24}$/.test(e);
  function validMainFile(n) {
    return typeof n === 'string' && n.length > 0 && n.length <= 200 && /\.(tex|mkiv|mkxl)$/.test(n) && !n.includes('\\') && !n.startsWith('/')
      && n.split('/').every(s => s && s !== '..' && !s.startsWith('.'));
  }
  const DEFAULT_CONFIG = { mainFile: 'main.tex', engine: 'wasm-texlive', autoInstall: true, autoSync: false, autoSyncInterval: 5, spellCheck: true, spellLanguage: 'auto' };

  async function loadConfig() {
    const cfg = { ...DEFAULT_CONFIG, ...lsGet('neoleaf.globalConfig', {}), ...((await readJson('.neoleaf/config.json')) || {}) };
    if (!validEngine(cfg.engine)) cfg.engine = DEFAULT_CONFIG.engine;
    if (!validMainFile(cfg.mainFile)) cfg.mainFile = DEFAULT_CONFIG.mainFile;
    if (typeof cfg.spellCheck !== 'boolean') cfg.spellCheck = DEFAULT_CONFIG.spellCheck;
    if (!['auto', 'pt-BR', 'en-US'].includes(cfg.spellLanguage)) cfg.spellLanguage = DEFAULT_CONFIG.spellLanguage;
    return cfg;
  }

  async function saveConfig(p) {
    if (!validEngine(p.engine)) throw new Error('Invalid compilation engine');
    if (!validMainFile(p.mainFile)) throw new Error('Invalid main file (use a .tex, .mkiv or .mkxl file)');
    const cfg = {
      version: 1, mainFile: p.mainFile, engine: p.engine, autoInstall: p.autoInstall !== false,
      autoSync: !!p.autoSync, autoSyncInterval: Math.max(1, Math.min(1440, parseInt(p.autoSyncInterval, 10) || 5)),
      spellCheck: p.spellCheck !== false,
      spellLanguage: ['auto', 'pt-BR', 'en-US'].includes(p.spellLanguage) ? p.spellLanguage : 'auto',
    };
    if (p.scope === 'global') lsSet('neoleaf.globalConfig', { engine: cfg.engine, autoInstall: cfg.autoInstall, autoSync: cfg.autoSync, autoSyncInterval: cfg.autoSyncInterval, spellCheck: cfg.spellCheck, spellLanguage: cfg.spellLanguage });
    else await writeJson('.neoleaf/config.json', cfg);
    return { success: true };
  }

  // ---------------------------------------------------------------- comments

  function cleanText(v, max, required) {
    const s = (typeof v === 'string' ? v : '').replace(/\s+$/, '');
    if (required && !s.trim()) throw new Error('Write the text');
    if ([...s].length > max) throw new Error(`Text too long (maximum ${max} characters)`);
    return s;
  }
  const sameAuthor = (a, b) => !!(a && a.email) && a.email === (b && b.email);

  /** Applies an operation to the comments document (add, reply, resolve, decide, delete). */
  function applyCommentOp(doc, me, op) {
    if (!Array.isArray(doc.threads)) doc.threads = [];
    const now = nowIso();
    const kind = op.op || '';
    if (kind === 'add') {
      if (doc.threads.length >= MAX_THREADS) throw new Error('Too many comments in this project (maximum 500)');
      const file = op.file || '';
      if (!file || [...file].length > 300) throw new Error('Invalid file');
      const tk = op.kind === 'suggestion' ? 'suggestion' : 'comment';
      const r = op.range || {};
      const nums = ['sl', 'sc', 'el', 'ec'].map(k => (Number.isInteger(r[k]) ? r[k] : -1));
      if (nums.some(n => n < 1 || n > 10000000)) throw new Error('Invalid passage');
      const quote = cleanText(op.quote, 2000, false);
      const text = cleanText(op.text, MAX_COMMENT_TEXT, tk === 'comment');
      const thread = {
        id: shortId(), file, kind: tk, createdAt: now, author: me, resolved: false,
        range: { sl: nums[0], sc: nums[1], el: nums[2], ec: nums[3] }, quote,
        messages: text.trim() ? [{ id: shortId(), author: me, text, at: now }] : [],
      };
      if (tk === 'suggestion') {
        if (!quote) throw new Error('Select the passage to be changed');
        thread.suggestion = { replacement: cleanText(op.replacement, MAX_COMMENT_TEXT, false), status: 'pending' };
      }
      doc.threads.push(thread);
    } else {
      const idx = doc.threads.findIndex(t => t.id === op.thread);
      if (idx < 0) throw new Error('Comment not found');
      const t = doc.threads[idx];
      if (kind === 'reply') {
        const text = cleanText(op.text, MAX_COMMENT_TEXT, true);
        if (t.messages.length >= 200) throw new Error('Conversation too long');
        t.messages.push({ id: shortId(), author: me, text, at: now });
      } else if (kind === 'resolve') {
        const resolved = op.resolved !== false;
        t.resolved = resolved;
        t.resolvedBy = resolved ? me : null;
      } else if (kind === 'decide') {
        const status = op.status === 'accepted' ? 'accepted' : op.status === 'rejected' ? 'rejected' : null;
        if (!status) throw new Error('Invalid decision');
        if (!t.suggestion || t.suggestion.status !== 'pending') throw new Error('This suggestion has already been decided');
        t.suggestion.status = status; t.suggestion.by = me; t.suggestion.at = now; t.resolved = true;
      } else if (kind === 'delete') {
        if (!sameAuthor(t.author, me)) throw new Error('Only the author can delete');
        doc.threads.splice(idx, 1);
      } else throw new Error('Invalid operation');
    }
    doc.rev = (doc.rev || 0) + 1;
  }

  async function commentsLoad() {
    const d = await readJson('.neoleaf/comments.json');
    return d && Array.isArray(d.threads) ? d : { rev: 0, threads: [] };
  }

  // ---------------------------------------------------------------- authorship

  /** Adds an entry to the authorship log (called by live editing, for what THIS person wrote). */
  async function recordAuthorship(entry) {
    try {
      await git();
      // one file per person: two collaborators never edit the same authorship file (no Git conflict)
      const me = author();
      const path = `.neoleaf/history/${me.email.replace(/[^A-Za-z0-9._@+-]/g, '_')}.json`;
      const hist = (await readJson(path)) || { version: 1, entries: [] };
      hist.entries.push({ time: nowIso(), since: entry.since || nowIso(), fileId: entry.fileId, file: entry.file, user: me, added: entry.added, removed: entry.removed, preview: entry.preview || '' });
      if (hist.entries.length > MAX_HISTORY) hist.entries.splice(0, hist.entries.length - MAX_HISTORY);
      await writeJson(path, hist, false);
    } catch (_) { /* no local clone: nothing is recorded */ }
  }

  /** Authorship entries of everyone (most recent first): `history/*.json` and the old `history.json`. */
  async function historyEntries() {
    const all = [];
    const old = await readJson('.neoleaf/history.json');
    if (old && Array.isArray(old.entries)) all.push(...old.entries);
    let names = [];
    try { names = await pfs().readdir(`${dir()}/.neoleaf/history`); } catch (_) {}
    for (const n of names.filter(x => x.endsWith('.json'))) {
      const h = await readJson(`.neoleaf/history/${n}`);
      if (h && Array.isArray(h.entries)) all.push(...h.entries);
    }
    return all.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  }

  // ---------------------------------------------------------------- milestones

  const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  async function textSnapshot() {
    const files = [];
    let total = 0;
    for (const f of await projectFiles()) {
      if (!isText(f.path) || (f.size || 0) > MAX_TEXT) continue;
      const live = (typeof currentFileId !== 'undefined' && f.path === currentFileId && typeof editor !== 'undefined' && editor) ? editor.getValue() : await readText(f.path);
      if (live === null) continue;
      total += live.length;
      files.push({ name: f.path, id: f.path, content: live });
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { files, total };
  }

  async function milestonesList() {
    const base = `${dir()}/.neoleaf/milestones`;
    let names = [];
    try { names = await pfs().readdir(base); } catch (_) { return []; }
    const out = [];
    for (const n of names.filter(x => x.endsWith('.json'))) {
      const m = await readJson(`.neoleaf/milestones/${n}`);
      if (!m || !m.name) continue;
      let size = 0;
      try { size = (await pfs().stat(`${base}/${n}`)).size; } catch (_) {}
      out.push({ id: n, name: m.name, note: m.note || '', author: m.author, createdAt: m.createdAt || '', size });
    }
    return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  async function milestoneCreate(p) {
    const name = (p.name || '').trim();
    if (!name || name.length > 100) throw new Error('Give the milestone a name (up to 100 characters)');
    const note = (p.note || '').trim().slice(0, 500);
    const snap = await textSnapshot();
    if (snap.total > MAX_MILESTONE) throw new Error('Project too large for a milestone (maximum 3 MB of text)');
    const createdAt = nowIso();
    const body = { version: 1, name, note, author: author(), createdAt, files: snap.files };
    const id = `${Math.floor(Date.now() / 1000)}-${slug(name) || 'marco'}.json`;
    await writeJson(`.neoleaf/milestones/${id}`, body, false);
    return { id, name, note, author: body.author, createdAt, size: JSON.stringify(body).length };
  }

  // ---------------------------------------------------------------- last PDF (local only)

  async function pdfSave(p) {
    const bytes = fromB64(p.content || '');
    const head = dec.decode(bytes.subarray(0, 5));
    if (head !== '%PDF-') throw new Error('The file is not a PDF');
    if (bytes.length > MAX_PDF) throw new Error('PDF too large to store (maximum 9 MB)');
    const meta = { savedAt: nowIso(), mainFile: String(p.mainFile || 'main.tex').slice(0, 200), engine: validEngine(p.engine) ? p.engine : 'wasm-texlive', by: author(), size: bytes.length };
    // the data first and the PDF last: whoever asks "is there a PDF?" never sees the PDF without its data
    await writeJson('.neoleaf/last.json', meta, false);
    await BrowserGit.writeFile('.neoleaf/last.pdf', bytes);
    const sync = p.synctex ? fromB64(p.synctex) : null;
    if (sync && sync[0] === 0x1f && sync[1] === 0x8b && sync.length <= 6 * 1024 * 1024) await BrowserGit.writeFile('.neoleaf/last.synctex.gz', sync); else await remove('.neoleaf/last.synctex.gz');
    const bbl = p.bbl ? fromB64(p.bbl) : null;
    if (bbl && bbl.length && bbl.length <= 2 * 1024 * 1024) await BrowserGit.writeFile('.neoleaf/last.bbl', bbl); else await remove('.neoleaf/last.bbl');
    return meta;
  }

  async function pdfMeta() {
    if (!(await exists('.neoleaf/last.pdf'))) return { available: false };
    const info = (await readJson('.neoleaf/last.json')) || {};
    const saved = info.savedAt ? Date.parse(info.savedAt) : 0;
    let stale = false;
    if (saved > 0) {
      // stale: some text was changed after the PDF (10 s slack: the autosave arrives later)
      for (const f of await projectFiles()) {
        if (!isText(f.path)) continue;
        try { if ((await pfs().stat(`${dir()}/${f.path}`)).mtimeMs > saved + 10000) { stale = true; break; } } catch (_) {}
      }
    }
    return { ...info, available: true, stale };
  }

  const TEXMF_ALLOWED = ['sty', 'cls', 'clo', 'ldf', 'def', 'fd', 'cfg', 'dfu', 'bbx', 'cbx', 'lbx', 'sto', 'ltx', 'rtx', 'bst', 'tex', 'otf', 'ttf', 'ttc', 'pfb', 'pfa', 'afm', 'tfm', 'vf', 'map', 'enc', 'woff', 'woff2', 'pdf', 'png', 'jpg', 'jpeg'];

  // ---------------------------------------------------------------- public API

  const bytesOrNull = path => BrowserGit.readFile(path, 'uint8array').catch(() => null);
  const idOf = id => decodeURIComponent(String(id)).replace(/[^A-Za-z0-9._-]/g, '');

  const Project = {
    /** Project loading signals when the local clone is ready (or that it cannot be used). */
    ready: () => resolveReady(true),
    failReady: () => resolveReady(false),

    loadConfig,
    toB64,
    fromB64,
    applyCommentOp,
    recordAuthorship,

    config: {
      /** { config, texFiles } */
      async get() { await git(); return { config: await loadConfig(), texFiles: (await projectFiles()).map(f => f.path).filter(p => /\.(tex|mkiv|mkxl)$/.test(p)) }; },
      async save(p) { await git(); return saveConfig(p); },
    },

    comments: {
      async load() { await git(); return commentsLoad(); },
      /** Applies an operation (add, reply, resolve, decide, delete) and returns the updated document. */
      async op(op) {
        await git();
        const doc = await commentsLoad();
        applyCommentOp(doc, author(), op);
        await writeJson('.neoleaf/comments.json', doc);
        return doc;
      },
    },

    history: {
      /** Authorship entries (most recent first), optionally only for one file. */
      async list(file) { await git(); return (await historyEntries()).filter(e => !file || e.fileId === file).slice(0, 300); },
    },

    milestones: {
      async list() { await git(); return milestonesList(); },
      async create(p) { await git(); return milestoneCreate(p); },
      async get(id) {
        await git();
        const d = await readJson(`.neoleaf/milestones/${idOf(id)}`);
        if (!d) throw new Error('Milestone not found');
        return d;
      },
      async remove(id) { await git(); await remove(`.neoleaf/milestones/${idOf(id)}`); },
    },

    pdf: {
      async meta() { await git(); return pdfMeta(); },
      async save(p) { await git(); return pdfSave(p); },
      async file() { await git(); return bytesOrNull('.neoleaf/last.pdf'); },
      async synctex() { await git(); return bytesOrNull('.neoleaf/last.synctex.gz'); },
      async bbl() { await git(); return bytesOrNull('.neoleaf/last.bbl'); },
    },

  };

  // the other parts (project-store-texmf.js, project-store-build.js) add their functions to __PS and to Project
  window.Project = Project;
  window.__PS = { dec, ext, isText, isAsset, fromB64, git, pfs, dir, readText, projectFiles, loadConfig, remove, bytesOrNull, TEXMF_ALLOWED, MAX_TEXT, MAX_ASSET };
})();
