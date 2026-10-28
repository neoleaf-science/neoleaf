// `Project` (part 2): extra LaTeX packages (texmf) and early installation from CTAN. Shares internals through window.__PS
// (see project-store.js) and adds `Project.texmf`.
(function () {
  'use strict';
  const { dec, ext, fromB64, git, pfs, dir, readText, projectFiles, loadConfig, remove, TEXMF_ALLOWED } = window.__PS;
  // ---------------------------------------------------------------- extra packages (texmf)


  const MAX_TEXMF_FILE = 10 * 1024 * 1024, MAX_TEXMF_TOTAL = 60 * 1024 * 1024, MAX_TEXMF_UPLOAD = 20 * 1024 * 1024;
  const isZipName = n => /\.zip$/i.test(n);

  function safeBasename(name) {
    const base = String(name).split(/[\\/]/).pop();
    if (!base || base.startsWith('.') || base.length > 100 || !/^[A-Za-z0-9._+-]+$/.test(base)) return null;
    return base;
  }

  // project: .neoleaf/texmf/ (versioned in Git); global: its own folder in browser storage (this person only)
  const GLOBAL_TEXMF = '/global-texmf';
  // folders per scope: "project" (the user's, versioned), "cache" (installed automatically from CTAN, local only, outside Git) and "global"
  const scopeRel = scope => (scope === 'cache' ? '.neoleaf/cache/texmf' : '.neoleaf/texmf');
  const scopeDir = scope => (scope === 'global' ? GLOBAL_TEXMF : `${dir()}/${scopeRel(scope)}`);
  const PREFIX = { global: 'g', cache: 'c', project: 'p' };
  const normScope = s => (s === 'global' ? 'global' : s === 'cache' ? 'cache' : 'project');

  async function texmfNames(scope) {
    try { return await pfs().readdir(scopeDir(scope)); } catch (_) { return []; }
  }
  async function texmfRead(scope, name) {
    return scope === 'global' ? new Uint8Array(await pfs().readFile(`${GLOBAL_TEXMF}/${name}`)) : await BrowserGit.readFile(`${scopeRel(scope)}/${name}`, 'uint8array');
  }
  async function texmfWrite(scope, name, bytes) {
    if (scope === 'global') { try { await pfs().mkdir(GLOBAL_TEXMF); } catch (_) {} await pfs().writeFile(`${GLOBAL_TEXMF}/${name}`, bytes); }
    else await BrowserGit.writeFile(`${scopeRel(scope)}/${name}`, bytes);
  }
  async function texmfRemove(scope, name) {
    try { await pfs().unlink(`${scopeDir(scope)}/${name}`); } catch (_) {}
  }
  async function texmfItems(scope) {
    const out = [];
    for (const name of await texmfNames(scope)) {
      let size = 0;
      try { size = (await pfs().stat(`${scopeDir(scope)}/${name}`)).size; } catch (_) {}
      out.push({ id: `${PREFIX[scope]}:${name}`, name, scope, size, md5: null, kind: isZipName(name) ? 'package' : 'file' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  const parseItemId = id => { const m = /^([pgc]):(.+)$/.exec(id); return m ? { scope: m[1] === 'g' ? 'global' : m[1] === 'c' ? 'cache' : 'project', name: m[2] } : null; };

  // Packages that earlier versions installed automatically stayed in .neoleaf/texmf without ever being pushed to Git:
  // they move to the local cache, so they do not become dozens of files to push.
  let migrated = false;
  // The cache of automatically installed packages from old versions stored the packages without the images (beamer was missing
  // beamericonbook.pdf and did not compile, and since the files were already in the cache they were never downloaded again). Once per project
  // in this browser, it empties the cache so the packages come again, complete. Bump CACHE_V when the cache format changes.
  const CACHE_V = '2';
  async function ensureCacheVersion() {
    const key = 'ld-texmf-cache-v-' + (typeof projectId !== 'undefined' ? projectId : '');
    try {
      if (localStorage.getItem(key) === CACHE_V) return;
      for (const name of await texmfNames('cache')) await texmfRemove('cache', name);
      localStorage.setItem(key, CACHE_V);
    } catch (_) {}
  }

  async function migrateTexmf() {
    await ensureCacheVersion();
    if (migrated) return;
    migrated = true;
    try {
      const st = await BrowserGit.status();
      for (const c of st.changes) {
        if (c.isNew && c.file.startsWith('.neoleaf/texmf/') && isZipName(c.file)) {
          const name = c.file.split('/').pop();
          const bytes = await BrowserGit.readFile(c.file, 'uint8array').catch(() => null);
          if (!bytes) continue;
          await texmfWrite('cache', name, bytes);
          await remove(c.file);
        }
      }
    } catch (_) {}
  }

  // a package's BibTeX option file (abntex2-options.bib): abntex2cite adds it to every \bibliography; other .bib files in bibtex/bib/ are examples
  const isOptionBib = p => p.startsWith('bibtex/bib/') && p.toLowerCase().endsWith('-options.bib');

  /** Picks, among a zip's files, only those LaTeX reads (flattened by name), as the server used to do. */
  function sanitizeZipEntries(entries) {
    const isTds = entries.some(e => e.name.startsWith('tex/'));
    const seen = new Set();
    const out = [];
    let total = 0;
    for (const e of entries) {
      const path = e.name.replace(/\\/g, '/');
      if (path.startsWith('/') || path.split('/').some(seg => seg === '..' || seg.startsWith('.'))) continue;
      if (isTds && !path.startsWith('tex/') && !(path.startsWith('bibtex/bst/') && path.endsWith('.bst')) && !isOptionBib(path) && !path.startsWith('fonts/')) continue;
      if (!isTds && path.toLowerCase().split('/').some(seg => ['doc', 'docs', 'example', 'examples', 'source', 'test', 'tests'].includes(seg))) continue;
      const base = safeBasename(path);
      if (!base) continue;
      const x = ext(base);
      if ((!TEXMF_ALLOWED.includes(x) && !(isTds && isOptionBib(path))) || (x === 'tex' && !isTds)) continue;
      if (['pdf', 'png', 'jpg', 'jpeg'].includes(x) && !(isTds && path.startsWith('tex/'))) continue;   // images only from tex/ (beamer icons); in ordinary zips PDF is manual
      if (e.bytes.length > MAX_TEXMF_FILE || seen.has(base)) continue;
      seen.add(base);
      total += e.bytes.length;
      if (total > MAX_TEXMF_TOTAL) throw new Error('Package too large');
      out.push({ name: base, bytes: e.bytes });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Expanded content of an item: zips become several files; loose files, one. */
  async function texmfExpand(item) {
    const bytes = await texmfRead(item.scope, item.name);
    if (isZipName(item.name)) {
      const out = [];
      for (const e of await Zip.read(bytes)) {
        const base = safeBasename(e.name);
        if (base && TEXMF_ALLOWED.includes(ext(base)) && e.bytes.length <= MAX_TEXMF_FILE) out.push({ name: base, bytes: e.bytes });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    const base = safeBasename(item.name);
    if (!base || !TEXMF_ALLOWED.includes(ext(base))) throw new Error('File not allowed');
    return [{ name: base, bytes }];
  }

  async function texmfUpload(p) {
    const bytes = fromB64(p.content || '');
    if (bytes.length > MAX_TEXMF_UPLOAD) throw new Error(`File too large (maximum ${MAX_TEXMF_UPLOAD / 1048576} MB)`);
    const base = safeBasename(p.name || '');
    if (!base) throw new Error('Invalid file name (use letters, numbers, dot, hyphen, _)');
    const scope = normScope(p.scope);
    let stored = bytes;
    if (isZipName(base)) {
      const files = sanitizeZipEntries(await Zip.read(bytes));
      if (!files.length) throw new Error('The zip contains no usable LaTeX files (.sty, .cls, .otf, .ttf, .ldf, .def, .fd...)');
      stored = Zip.write(files);
    } else {
      if (!TEXMF_ALLOWED.includes(ext(base))) throw new Error(`File type not allowed (.${ext(base)}). Accepted: ${TEXMF_ALLOWED.join(', ')}`);
      if (bytes.length > MAX_TEXMF_FILE) throw new Error(`File too large (maximum ${MAX_TEXMF_FILE / 1048576} MB per file)`);
    }
    await texmfWrite(scope, base, stored);
    return { id: `${PREFIX[scope]}:${base}`, name: base, scope, size: stored.length, md5: null, kind: isZipName(base) ? 'package' : 'file' };
  }

  // The server only downloads the package from CTAN/TeX Live and returns it (the browser cannot reach it because of CORS); nothing is stored there.
  async function ctan(path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      // a limited or busy server (429, 503) means "wait a little": failing here would show up as a missing file in the LaTeX log
      if ((res.status === 429 || res.status === 503) && attempt < 6) {
        const wait = Math.min(30, parseInt(res.headers.get('Retry-After') || '5', 10) || 5);
        await new Promise(r => setTimeout(r, wait * (window.__ctanRetryScale === undefined ? 1000 : window.__ctanRetryScale)));
        continue;
      }
      const data = await res.json().catch(() => ({ error: 'Invalid response from the server' }));
      if (data.error) throw new Error(data.error);
      return data;
    }
  }

  async function texmfStorePackage(scope, pkg, files) {
    const name = `${pkg}.zip`;
    const packed = Zip.write(files);
    await texmfWrite(scope, name, packed);
    return { id: `${PREFIX[scope]}:${name}`, name, scope, size: packed.length, md5: null, kind: 'package' };
  }

  async function texmfImport(p) {
    const scope = normScope(p.scope);
    const data = await ctan('/api/ctan/package', p.file ? { file: p.file } : { package: p.package });
    const files = data.files.map(f => ({ name: f.name, bytes: fromB64(f.b64) }));
    return { item: await texmfStorePackage(scope, data.package, files), files };
  }

  // ---- early installation: reads what the project declares and downloads the missing packages at once

  const reCls = /\\(?:documentclass|LoadClass|LoadClassWithOptions)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  const reBibStyle = /\\bibliographystyle\s*\{([^}]*)\}/g;
  const rePkg = /\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
  const validName = n => !!n && n.length <= 60 && /^[A-Za-z0-9_.+-]+$/.test(n);
  const stripComments = src => src.replace(/(^|[^\\])%.*$/gm, '$1');

  function scanDependencies(source) {
    const text = stripComments(source);
    const out = [];
    const add = f => { if (!out.includes(f)) out.push(f); };
    for (const m of text.matchAll(reCls)) { const n = m[1].trim().split('/').pop().replace(/\.cls$/, '').trim(); if (validName(n)) add(`${n}.cls`); }
    for (const m of text.matchAll(reBibStyle)) { const n = m[1].trim().split('/').pop().replace(/\.bst$/, '').trim(); if (validName(n)) add(`${n}.bst`); }
    for (const m of text.matchAll(rePkg)) {
      const opts = m[1] || '';
      for (const raw of m[2].split(',')) {
        const n = raw.trim().split('/').pop().replace(/\.sty$/, '').trim();
        if (!validName(n)) continue;
        if (n === 'babel') {
          for (const o of opts.split(',').map(x => x.trim())) {
            const lang = o.replace(/^main=/, '');
            if (validName(lang) && !lang.includes('=')) add(`${lang}.ldf`);
          }
        }
        add(`${n}.sty`);
      }
    }
    return out;
  }

  // packages that only work with LuaLaTeX/XeLaTeX: the browser's default compiler is pdfLaTeX
  function engineSpecific(file) {
    const base = file.replace(/\.[^.]+$/, '').toLowerCase();
    return base.startsWith('lua') || base.startsWith('xe') || ['fontspec', 'unicode-math', 'polyglossia', 'xunicode', 'xltxtra', 'mathspec', 'lualatex-math'].includes(base);
  }

  async function preinstall() {
    const cfg = await loadConfig();
    if (!cfg.autoInstall) return { installed: [], failed: [], skipped: true };
    const report = { installed: [], failed: [] };
    const started = Date.now();
    const MAX_PACKAGES = 80, MAX_ROUNDS = 6, BUDGET = 240000;

    await migrateTexmf();
    const items = [...(await texmfItems('project')), ...(await texmfItems('cache')), ...(await texmfItems('global'))];
    const donePkgs = new Set(items.filter(i => i.kind === 'package').map(i => i.name.replace(/\.zip$/i, '')));
    const have = new Set(items.filter(i => i.kind === 'file').map(i => i.name));
    const files = await projectFiles();
    for (const f of files) have.add(f.path.split('/').pop());

    let queue = [];
    for (const f of files) {
      if (/\.(tex|sty|cls)$/i.test(f.path)) queue.push(...scanDependencies((await readText(f.path)) || ''));
    }

    const seenFiles = new Set();
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (!queue.length || Date.now() - started > BUDGET || donePkgs.size >= MAX_PACKAGES) break;
      const candidates = [];
      for (const f of queue.splice(0)) {
        if (have.has(f) || engineSpecific(f) || seenFiles.has(f)) continue;
        seenFiles.add(f);
        candidates.push(f);
      }
      if (!candidates.length) continue;
      let resolved;
      try { resolved = (await ctan('/api/ctan/resolve', { files: candidates.slice(0, 200) })).results; }
      catch (e) { report.failed.push(`TeX Live index unavailable (${e.message})`); return report; }
      const wanted = [];
      for (const r of resolved) {
        if (r.base) { have.add(r.file); continue; }      // the browser compiler already ships it
        if (r.package && !donePkgs.has(r.package)) { donePkgs.add(r.package); wanted.push(r.package); }
      }
      wanted.length = Math.min(wanted.length, Math.max(0, MAX_PACKAGES - report.installed.length));
      if (!wanted.length) continue;
      // 4 packages at a time
      for (let i = 0; i < wanted.length; i += 4) {
        const results = await Promise.all(wanted.slice(i, i + 4).map(async pkg => {
          try { const r = await texmfImport({ scope: 'cache', package: pkg }); return { pkg, files: r.files }; }
          catch (e) { return { pkg, error: e.message }; }
        }));
        for (const r of results) {
          if (r.error) { report.failed.push(`${r.pkg}: ${r.error}`); continue; }
          report.installed.push(r.pkg);
          for (const f of r.files) {
            have.add(f.name);
            if (/\.(sty|cls|def)$/i.test(f.name)) queue.push(...scanDependencies(dec.decode(f.bytes)));
          }
        }
      }
    }
    return report;
  }

  window.__PS.texmfItems = texmfItems;
  window.__PS.migrateTexmf = migrateTexmf;
  Object.assign(window.Project, {
    texmf: {
      /** { project: [...], global: [...] }: "project" includes the automatically installed ones (cache). */
      async list() {
        await git(); await migrateTexmf();
        return { project: [...(await texmfItems('project')), ...(await texmfItems('cache'))], global: await texmfItems('global') };
      },
      async upload(p) { await git(); return texmfUpload(p); },
      /** Downloads a package from CTAN (through the server proxy). { scope, package } or { scope, file }. Returns { item, files }. */
      async import(p) { await git(); return texmfImport(p); },
      async remove(id) {
        await git();
        const it = parseItemId(decodeURIComponent(id));
        if (!it) throw new Error('Invalid item');
        await texmfRemove(it.scope, it.name);
      },
      /** The files of an item: [{ name, bytes }]. */
      async files(id) {
        await git();
        const it = parseItemId(decodeURIComponent(id));
        if (!it) throw new Error('Invalid item');
        return texmfExpand({ ...it, kind: isZipName(it.name) ? 'package' : 'file' });
      },
      async preinstall() { await git(); return preinstall(); },
    }
  });
})();
