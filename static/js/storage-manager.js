// "Storage" tab of the user modal: how much of the browser's storage is used, the compiler cache (with a button to
// clear it) and the list of projects kept in this browser (with a button to remove each local copy).
// Several people can use the same browser, so the list shows only the copies of the account that is signed in (the others
// are only counted, never named). "Delete all local data" and "Sign out" empty everything this site keeps in the browser;
// the language, theme and mascot choices stay.
// Works on every page that has the modal. It reuses BrowserGit's file system in the editor and opens its own
// LightningFS (same database) elsewhere. Nothing here talks to the server.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const tr = (s, ...a) => (typeof T === 'function' ? T(s, ...a) : s.replace(/\{(\d+)\}/g, (m, i) => a[+i]));

  function fmt(bytes) {
    if (!isFinite(bytes) || bytes < 0) return '?';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + ' MB';
    return (bytes / 1073741824).toFixed(1) + ' GB';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  /** The LightningFS the projects live in: the editor's own instance when there is one. */
  async function getFs() {
    if (window.BrowserGit && BrowserGit.getFs) {
      const f = BrowserGit.getFs();
      if (f && f.pfs) return f;
    }
    if (!window.__upmFs) {
      if (!window.LightningFS) await loadScript('/static/vendor/lightning-fs.min.js');
      window.__upmFs = new window.LightningFS('neoleaf-git', { wipe: false });
    }
    return { fs: window.__upmFs, pfs: window.__upmFs.promises };
  }

  async function estimate() {
    try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (_) { return null; }
  }

  // ---------------------------------------------------------------- projects

  /** The account that is signed in (written into the modal by the server). */
  function account() {
    const m = $('user-profile-modal');
    return { login: ((m && m.dataset.accountLogin) || '').toLowerCase(), provider: (m && m.dataset.accountProvider) || 'github' };
  }

  async function readMeta(pfs, dirOwner, repo) {
    try { return JSON.parse(await pfs.readFile('/meta/' + encodeURIComponent(`${dirOwner}/${repo}`) + '.json', 'utf8')); } catch (_) { return null; }
  }

  /** Every copy in this browser; `mine` says whether the signed-in account opened it. */
  async function listProjects(pfs) {
    const me = account();
    const out = [];
    let owners = [];
    try { owners = await pfs.readdir('/repos'); } catch (_) { return out; }
    for (const o of owners) {
      let repos = [];
      try { repos = await pfs.readdir('/repos/' + o); } catch (_) { continue; }
      // `<provider>.<owner>` for every provider but GitHub (a GitHub login never has a dot; the provider id never does either)
      const dot = o.indexOf('.');
      const provider = dot > 0 && /^[a-z][a-z0-9-]*$/.test(o.slice(0, dot)) ? o.slice(0, dot) : 'github';
      const ownerLogin = provider === 'github' ? o : o.slice(dot + 1);
      for (const r of repos) {
        const meta = await readMeta(pfs, o, r);
        // the account that opened it; for copies from before this was recorded, the owner of the repository
        const who = meta ? { login: String(meta.login).toLowerCase(), provider: meta.provider } : { login: ownerLogin.toLowerCase(), provider };
        out.push({ dir: `/repos/${o}/${r}`, owner: o, repo: r, provider, name: `${ownerLogin}/${r}`, size: null, mine: !!me.login && who.login === me.login && who.provider === me.provider });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function dirSize(pfs, dir) {
    let total = 0;
    let names = [];
    try { names = await pfs.readdir(dir); } catch (_) { return 0; }
    for (const n of names) {
      const p = `${dir}/${n}`;
      let st;
      try { st = await pfs.stat(p); } catch (_) { continue; }
      total += st.isDirectory() ? await dirSize(pfs, p) : (st.size || 0);
    }
    return total;
  }

  async function rmTree(pfs, dir) {
    let names = [];
    try { names = await pfs.readdir(dir); } catch (_) { return; }
    for (const n of names) {
      const p = `${dir}/${n}`;
      let st;
      try { st = await pfs.stat(p); } catch (_) { continue; }
      if (st.isDirectory()) { await rmTree(pfs, p); await pfs.rmdir(p); } else { await pfs.unlink(p); }
    }
  }

  /** What exists only in this copy: { unknown } or { unsent: true|false }. Offline: compares with the last known state of GitHub. */
  async function unsentInfo(fsx, dir) {
    try {
      if (!window.git) await loadScript('/static/vendor/isomorphic-git.min.js');
      const { fs, pfs } = fsx;
      try { await pfs.stat(dir + '/.git/HEAD'); } catch (_) { return { unsent: false }; }   // no clone: nothing to lose
      const rows = await window.git.statusMatrix({ fs, dir });
      if (rows.some(r => !(r[1] === 1 && r[2] === 1 && r[3] === 1))) return { unsent: true };
      const branch = await window.git.currentBranch({ fs, dir });
      const head = await window.git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null);
      const remote = branch ? await window.git.resolveRef({ fs, dir, ref: 'refs/remotes/origin/' + branch }).catch(() => null) : null;
      if (head && remote && head !== remote) return { unsent: true };
      if (head && !remote) return { unsent: true };   // never pushed or fetched: nothing is known to be on the server
      return { unsent: false };
    } catch (_) {
      return { unknown: true };
    }
  }

  function isOpenNow(p) {
    try { return !!(window.BrowserGit && BrowserGit.getDir && BrowserGit.getDir() === p.dir); } catch (_) { return false; }
  }

  async function removeProject(p) {
    const fsx = await getFs();
    const info = await unsentInfo(fsx, p.dir);
    let msg = tr('Remove the local copy of {0}? Nothing is deleted on GitHub: opening the project downloads it again.', p.name);
    if (info.unsent) msg += '\n\n' + tr('WARNING: this copy has changes that are not on GitHub. They exist only in this browser and will be lost.');
    else if (info.unknown) msg += '\n\n' + tr('Could not check whether it has unsent changes. Make sure it was pushed to GitHub before removing it.');
    if (!window.confirm(msg)) return false;
    let removed = false;
    try {
      await rmTree(fsx.pfs, p.dir);
      await fsx.pfs.rmdir(p.dir);
      try { await fsx.pfs.rmdir('/repos/' + p.owner); } catch (_) { /* the owner folder still has other projects */ }
      await fsx.pfs.unlink('/meta/' + encodeURIComponent(`${p.owner}/${p.repo}`) + '.json').catch(() => {});
      // LightningFS saves its index a moment later: write it now, or leaving the page right away leaves a half-removed copy
      if (fsx.pfs.flush) await fsx.pfs.flush();
      toast(tr('Local copy removed.'));
      removed = true;
    } catch (e) {
      toast(tr('Could not remove the local copy: {0}', (e && e.message) || e));
    }
    refresh();
    return removed;
  }

  // ---------------------------------------------------------------- compiler cache

  async function cacheInfo() {
    if (typeof caches === 'undefined') return { files: 0, supported: false };
    let files = 0;
    try {
      for (const k of await caches.keys()) files += (await (await caches.open(k)).keys()).length;
    } catch (_) {}
    return { files, supported: true };
  }

  async function clearCache() {
    const info = await cacheInfo();
    if (!info.files) { toast(tr('Nothing to clear.')); return; }
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (_) {}
    toast(tr('Compiler cache cleared.'));
    refresh();
  }

  function toast(msg) {
    if (typeof window.neoToast === 'function') window.neoToast(msg); else alert(msg);
  }

  // ---------------------------------------------------------------- screen

  function setBar(est) {
    const text = $('upm-st-text'), used = $('upm-st-used'), bar = $('upm-st-bar');
    if (!est || !est.quota) {
      if (text) text.textContent = tr('The browser does not report its storage.');
      if (used) used.style.width = '0%';
      return;
    }
    const pct = Math.min(100, (est.usage / est.quota) * 100);
    if (text) text.textContent = tr('{0} used of {1} ({2}%)', fmt(est.usage), fmt(est.quota), pct < 10 ? pct.toFixed(1) : Math.round(pct));
    if (used) {
      used.style.width = Math.max(pct, est.usage > 0 ? 1 : 0) + '%';
      used.style.background = pct >= 80 ? '#da3633' : pct >= 60 ? '#d29922' : '#238636';
    }
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    const u = $('upm-st-used-txt'), f = $('upm-st-free-txt');
    if (u) u.textContent = tr('Used: {0}', fmt(est.usage));
    if (f) f.textContent = tr('Free: {0}', fmt(Math.max(0, est.quota - est.usage)));
    const d = est.usageDetails;
    const br = $('upm-st-break');
    if (br) {
      br.textContent = d && (d.indexedDB != null || d.caches != null)
        ? [d.indexedDB != null ? tr('Projects and files: {0}', fmt(d.indexedDB)) : '', d.caches != null ? tr('Compiler cache: {0}', fmt(d.caches)) : ''].filter(Boolean).join('  |  ')
        : '';
    }
  }

  async function setPersist() {
    const el = $('upm-st-persist'), btn = $('upm-st-persist-btn');
    if (!el) return;
    let ok = null;
    try { ok = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (_) {}
    if (ok === null) { el.textContent = ''; if (btn) btn.style.display = 'none'; return; }
    el.textContent = ok ? tr('Protected: the browser will not delete this data on its own.') : tr('Not protected: the browser may delete this data when the disk is full.');
    if (btn) btn.style.display = ok ? 'none' : '';
  }

  function renderList(items) {
    const list = $('upm-st-list');
    if (!list) return;
    list.textContent = '';
    if (!items.length) {
      const e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:var(--muted,#8b949e);padding:6px 0;';
      e.textContent = tr('No projects are stored in this browser.');
      list.appendChild(e);
      return;
    }
    for (const p of items) {
      const row = document.createElement('div');
      row.className = 'upm-st-row';
      row.dataset.dir = p.dir;
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-color,#30363d);font-size:13px;';
      const name = document.createElement('span');
      name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      name.textContent = p.name;
      name.title = p.name;
      row.appendChild(name);
      if (p.provider !== 'github') {
        const b = document.createElement('span');
        b.textContent = p.provider === 'codeberg' ? 'Codeberg' : p.provider;
        b.style.cssText = 'font-size:10px;background:rgba(33,133,208,.18);color:#58a6ff;padding:1px 6px;border-radius:8px;';
        row.appendChild(b);
      }
      const size = document.createElement('span');
      size.className = 'upm-st-size';
      size.style.cssText = 'color:var(--muted,#8b949e);font-size:12px;min-width:56px;text-align:right;';
      size.textContent = p.size == null ? tr('Calculating...') : fmt(p.size);
      row.appendChild(size);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn upm-st-remove';
      btn.style.cssText = 'font-size:12px;padding:3px 9px;';
      if (isOpenNow(p)) {
        btn.textContent = tr('open now');
        btn.disabled = true;
      } else {
        btn.textContent = tr('Remove');
        btn.addEventListener('click', () => removeProject(p));
      }
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  let running = 0;
  async function refresh() {
    const my = ++running;
    setBar(await estimate());
    setPersist();
    const ci = await cacheInfo();
    const cl = $('upm-st-cache-info'), cb = $('upm-st-cache-btn');
    if (cl) cl.textContent = ci.supported ? tr('Compiler cache: {0} saved file(s)', ci.files) : '';
    if (cb) cb.disabled = !ci.files;
    let items = [];
    try {
      const fsx = await getFs();
      items = await listProjects(fsx.pfs);
      const mine = items.filter(p => p.mine);
      renderList(mine);
      for (const p of items) {                       // sizes one at a time: a big clone does not freeze the screen
        p.size = await dirSize(fsx.pfs, p.dir);
        if (my !== running) return;
        if (p.mine) {
          const row = document.querySelector(`.upm-st-row[data-dir="${CSS.escape(p.dir)}"] .upm-st-size`);
          if (row) row.textContent = fmt(p.size);
        }
      }
      const others = items.filter(p => !p.mine);
      const el = $('upm-st-others');
      if (el) el.textContent = others.length ? tr('{0} project(s) from other accounts in this browser are not listed ({1}).', others.length, fmt(others.reduce((a, p) => a + (p.size || 0), 0))) : '';
    } catch (_) {
      renderList(items.filter(p => p.mine));
    }
  }

  // ---------------------------------------------------------------- everything this site keeps in the browser

  /** Top-level folders of the file system other than the projects, with something in them (the extra packages). */
  async function globalFiles(pfs) {
    let n = 0;
    try { n = (await pfs.readdir('/global-texmf')).length; } catch (_) {}
    return n;
  }

  /** Copies (of every account) with work that is not on the Git provider: { mine: [names], others: n, packages: n }. */
  async function atRisk() {
    const fsx = await getFs();
    const items = await listProjects(fsx.pfs);
    const mine = [];
    let others = 0;
    for (const p of items) {
      const info = await unsentInfo(fsx, p.dir);
      if (!info.unsent && !info.unknown) continue;   // when it cannot be checked, it counts as at risk
      if (p.mine) mine.push(p.name); else others++;
    }
    return { mine, others, packages: await globalFiles(fsx.pfs) };
  }

  /** Deletes the projects, their notes, the extra packages, the compiler cache and the handoff data of this browser. */
  async function wipeAll() {
    const fsx = await getFs();
    for (let pass = 0; pass < 3; pass++) {
      let names = [];
      try { names = await fsx.pfs.readdir('/'); } catch (_) {}
      for (const n of names) {
        const p = '/' + n;
        let st;
        try { st = await fsx.pfs.stat(p); } catch (_) { continue; }
        if (st.isDirectory()) { await rmTree(fsx.pfs, p); await fsx.pfs.rmdir(p); } else { await fsx.pfs.unlink(p); }
      }
      if (fsx.pfs.flush) await fsx.pfs.flush();
      let left = [];
      try { left = await fsx.pfs.readdir('/'); } catch (_) {}
      if (!left.length) break;
      if (pass === 2) throw new Error(tr('the browser storage is busy'));
      await new Promise(r => setTimeout(r, 200));
    }
    try { if (typeof caches !== 'undefined') for (const k of await caches.keys()) await caches.delete(k); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    try {   // projects created or imported in this browser that were not opened yet
      await Promise.race([new Promise(res => { const r = indexedDB.deleteDatabase('neoleaf-handoff'); r.onsuccess = r.onerror = r.onblocked = () => res(); }), new Promise(res => setTimeout(res, 1500))]);
    } catch (_) {}
  }

  function riskText(risk) {
    let msg = '';
    if (risk.mine.length) msg += tr('These copies have changes that are not on GitHub or Codeberg and will be lost:\n{0}', risk.mine.map(n => '  - ' + n).join('\n')) + '\n';
    if (risk.others) msg += tr('{0} copy(ies) of other accounts also have changes that are not on GitHub or Codeberg.', risk.others) + '\n';
    if (risk.packages) msg += tr('The extra packages you uploaded for all projects exist only in this browser and will be deleted.') + '\n';
    return msg;
  }

  async function clearAll() {
    const btn = $('upm-st-clear-all');
    if (btn) btn.disabled = true;
    try {
      const risk = await atRisk();
      let msg = tr('Delete ALL local data of NeoLeaf in this browser, for every account? Nothing is deleted on GitHub or Codeberg.');
      const extra = riskText(risk);
      if (extra) msg += '\n\n' + extra;
      if (!window.confirm(msg)) return;
      await wipeAll();
      toast(tr('All local data deleted.'));
      if (typeof projectOwner !== 'undefined' && projectOwner) location.href = '/'; else refresh();   // the open project is gone: back to the list
    } catch (e) {
      toast(tr('Could not delete the local data: {0}', (e && e.message) || e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /** Sign out: deletes everything this site keeps in the browser (asking only when there is work that would be lost). */
  async function signOut(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    const go = () => { location.href = '/auth/logout'; };
    const btn = $('upm-btn-logout');
    if (btn) { btn.style.pointerEvents = 'none'; btn.style.opacity = '0.6'; }
    try {
      const risk = await atRisk();
      const extra = riskText(risk);
      if (extra && !window.confirm(tr('Signing out deletes all NeoLeaf data stored in this browser.') + '\n\n' + extra + '\n' + tr('Sign out and delete it?'))) {
        if (btn) { btn.style.pointerEvents = ''; btn.style.opacity = ''; }
        return false;
      }
      await wipeAll();
    } catch (e) {
      if (!window.confirm(tr('Could not delete the local data of this browser: {0}', (e && e.message) || e) + '\n\n' + tr('Sign out anyway?'))) {
        if (btn) { btn.style.pointerEvents = ''; btn.style.opacity = ''; }
        return false;
      }
    }
    go();
    return false;
  }

  // ---------------------------------------------------------------- the project list: which projects are in this browser

  /** The local folder of a project id (`owner__repo`) for the signed-in account. */
  function localDirOf(id) {
    const i = id.indexOf('__');
    if (i < 0) return null;
    const prov = account().provider;
    const prefix = prov && prov !== 'github' ? prov + '.' : '';
    const owner = id.slice(0, i), repo = id.slice(i + 2);
    return { dir: `/repos/${prefix}${owner}/${repo}`, owner: prefix + owner, repo, name: `${owner}/${repo}` };
  }

  function paintLocalCell(it) {
    const cell = it.cell;
    cell.textContent = '';
    const span = (cls, text, title) => { const e = document.createElement('span'); e.className = cls; e.textContent = text; if (title) e.title = title; cell.appendChild(e); return e; };
    if (!it.local) { span('pl-local-no', tr('Not in this browser')); return; }
    span('pl-local-yes', '● ' + tr('In this browser'));
    if (it.size != null) span('pl-local-size', fmt(it.size));
    if (it.unsent) span('pl-local-unsent', tr('Unsent changes'));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn pl-local-clear';
    btn.textContent = tr('Clear');
    btn.title = tr('Remove the local copy from this browser. Nothing is deleted on GitHub or Codeberg.');
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();   // the row itself opens the project
      if (await removeProject(it.p)) { it.local = false; it.size = null; it.unsent = false; paintLocalCell(it); }
    });
    cell.appendChild(btn);
  }

  let markRun = 0;
  /** Fills the "Local copy" column of the dashboard: in this browser or not, how big, and whether it has work that is not on the provider. */
  async function markProjectList() {
    const rows = Array.from(document.querySelectorAll('.pl-row[data-id]')).filter(r => r.dataset.deleted !== 'true');
    if (!rows.length) return;
    let fsx;
    try { fsx = await getFs(); } catch (_) { return; }
    const run = ++markRun;
    const items = [];
    for (const row of rows) {                       // fast: does the folder exist and hold a clone?
      const cell = row.querySelector('.pl-local'), p = localDirOf(row.dataset.id);
      if (!cell || !p) continue;
      const local = await fsx.pfs.stat(p.dir + '/.git/HEAD').then(() => true).catch(() => false);
      const it = { row, cell, p, local, size: null, unsent: false };
      items.push(it);
      paintLocalCell(it);
    }
    for (const it of items.filter(i => i.local)) {  // slower, one at a time: sizes, then the unsent-work check
      it.size = await dirSize(fsx.pfs, it.p.dir);
      if (run !== markRun) return;
      if (it.local) paintLocalCell(it);
    }
    for (const it of items.filter(i => i.local)) {
      const info = await unsentInfo(fsx, it.p.dir);
      if (run !== markRun) return;
      it.unsent = !!info.unsent;
      if (it.local) paintLocalCell(it);
    }
  }

  function showTab(name) {
    for (const t of ['profile', 'storage']) {
      const pane = $('upm-pane-' + t), btn = $('upm-tab-btn-' + t);
      if (pane) pane.style.display = t === name ? 'flex' : 'none';
      if (btn) btn.setAttribute('aria-selected', t === name ? 'true' : 'false');
    }
    if (name === 'storage') refresh();
  }

  async function askPersist() {
    try { await navigator.storage.persist(); } catch (_) {}
    setPersist();
  }

  window.StorageManager = { refresh, showTab, clearCache, askPersist, clearAll, signOut, markProjectList, fmt };
  if (document.querySelector('.pl-table')) markProjectList();   // the dashboard marks its own rows
  window.upmShowTab = showTab;
})();
