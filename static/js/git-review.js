// =====================================================================
// Pull and push review: what comes from GitHub, what goes to GitHub and the automatic pull when opening the project.
// Uses BrowserGit.compare() (fetch + comparison of commits and trees); the diff is computed here, line by line.
// =====================================================================
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => escapeHtml(String(s == null ? '' : s));
  const tr = (s, ...a) => (typeof T === 'function' ? T(s, ...a) : s);

  // ---------------------------------------------------------------- line diff

  /** Diff operations: [{t: ' ' | '+' | '-', s: line}], with the common prefix and suffix trimmed and LCS in the middle. */
  function lineDiff(a, b) {
    const A = a === '' ? [] : a.split('\n'), B = b === '' ? [] : b.split('\n');
    let p = 0;
    while (p < A.length && p < B.length && A[p] === B[p]) p++;
    let ea = A.length, eb = B.length;
    while (ea > p && eb > p && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    const ma = A.slice(p, ea), mb = B.slice(p, eb);
    const ops = [];
    for (let i = 0; i < p; i++) ops.push({ t: ' ', s: A[i] });
    if (ma.length * mb.length > 4e6) {
      ma.forEach(s => ops.push({ t: '-', s }));
      mb.forEach(s => ops.push({ t: '+', s }));
    } else {
      const n = ma.length, m = mb.length, w = m + 1;
      const dp = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = ma[i] === mb[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (ma[i] === mb[j]) { ops.push({ t: ' ', s: ma[i] }); i++; j++; }
        else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push({ t: '-', s: ma[i++] });
        else ops.push({ t: '+', s: mb[j++] });
      }
      while (i < n) ops.push({ t: '-', s: ma[i++] });
      while (j < m) ops.push({ t: '+', s: mb[j++] });
    }
    for (let i = ea; i < A.length; i++) ops.push({ t: ' ', s: A[i] });
    return ops;
  }

  /** Only the changed lines with 3 of context; long equal stretches become "⋯ N identical lines". */
  function withContext(ops, ctx = 3) {
    const keep = new Array(ops.length).fill(false);
    ops.forEach((o, i) => {
      if (o.t === ' ') return;
      for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true;
    });
    const out = [];
    let skipped = 0;
    ops.forEach((o, i) => {
      if (keep[i]) {
        if (skipped) { out.push({ t: '…', s: `${skipped}` }); skipped = 0; }
        out.push(o);
      } else skipped++;
    });
    if (skipped) out.push({ t: '…', s: `${skipped}` });
    return out;
  }

  function decode(bytes) {
    if (bytes == null) return { missing: true, text: '' };
    const n = Math.min(bytes.length, 8000);
    for (let i = 0; i < n; i++) if (bytes[i] === 0) return { binary: true, text: '' };
    return { text: new TextDecoder().decode(bytes) };
  }

  const sameBytes = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

  // ---------------------------------------------------------------- data loading

  /** Describes each file (status, diff) for one of the sides: "incoming" (from GitHub) or "outgoing" (to GitHub). */
  async function describe(info, kind, paths) {
    const files = [];
    for (const p of paths) {
      const { oldBytes, newBytes } = await BrowserGit.changeSides(kind, p, info);
      if (oldBytes && newBytes && sameBytes(oldBytes, newBytes)) continue; // did not actually change
      const o = decode(oldBytes), n = decode(newBytes);
      const status = !oldBytes ? 'added' : !newBytes ? 'deleted' : 'modified';
      const f = { path: p, status, binary: !!(o.binary || n.binary), add: 0, del: 0, ops: [] };
      if (!f.binary) {
        f.ops = withContext(lineDiff(o.text, n.text));
        f.ops.forEach(x => { if (x.t === '+') f.add++; else if (x.t === '-') f.del++; });
      }
      files.push(f);
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return files;
  }

  async function localPaths(info) {
    const st = await BrowserGit.status();
    const set = new Set([...info.outgoing.files.map(f => f.path), ...st.changes.map(c => c.file)]);
    if (typeof isDirty !== 'undefined' && isDirty && typeof currentFileId !== 'undefined' && currentFileId) set.add(currentFileId);
    return set;
  }

  // ---------------------------------------------------------------- interface

  function ensureStyle() {
    if ($('git-review-style')) return;
    const st = document.createElement('style');
    st.id = 'git-review-style';
    st.textContent = `
      .gr-box { max-height: 52vh; overflow: auto; border: 1px solid var(--border); border-radius: 6px; margin: 10px 0; }
      .gr-sec { font-size: 12px; font-weight: 600; color: var(--muted); padding: 8px 10px 4px; text-transform: uppercase; letter-spacing: .4px; }
      .gr-commit { font-size: 12.5px; padding: 3px 10px; display: flex; gap: 8px; }
      .gr-commit code { color: var(--muted); }
      .gr-commit .gr-who { color: var(--muted); margin-left: auto; white-space: nowrap; }
      .gr-file { border-top: 1px solid var(--border); }
      .gr-file > summary { cursor: pointer; padding: 6px 10px; font-size: 12.5px; display: flex; gap: 8px; align-items: center; list-style: none; }
      .gr-file > summary::-webkit-details-marker { display: none; }
      .gr-path { font-family: monospace; word-break: break-all; }
      .gr-badge { font-size: 10.5px; padding: 1px 6px; border-radius: 8px; font-weight: 700; }
      .gr-added { background: rgba(63,185,80,.18); color: #3fb950; }
      .gr-deleted { background: rgba(248,81,73,.18); color: #f85149; }
      .gr-modified { background: rgba(88,166,255,.18); color: #58a6ff; }
      .gr-stat { margin-left: auto; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
      .gr-diff { font-family: monospace; font-size: 12px; line-height: 1.45; overflow-x: auto; background: rgba(0,0,0,.12); }
      .gr-line { white-space: pre; padding: 0 10px; min-width: max-content; }
      .gr-line.gr-p { background: rgba(63,185,80,.14); }
      .gr-line.gr-m { background: rgba(248,81,73,.14); }
      .gr-line.gr-gap { color: var(--muted); text-align: center; font-style: italic; background: rgba(255,255,255,.04); }
      .gr-warn { font-size: 12.5px; padding: 8px 10px; border-radius: 6px; background: rgba(210,153,34,.15); color: var(--warn, #d29922); margin: 8px 0; }
      .gr-empty { font-size: 13px; color: var(--muted); padding: 14px 10px; }
      .gr-banner { position: fixed; left: 0; right: 0; top: 0; z-index: 6000; background: #da3633; color: #fff; padding: 10px 16px; font-size: 13px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; box-shadow: 0 4px 18px rgba(0,0,0,.35); }
      .gr-banner.gr-info { background: #0969da; }
      .gr-banner button { background: #fff; color: #da3633; border: 0; border-radius: 6px; padding: 5px 12px; font-weight: 700; cursor: pointer; }
      .gr-unsent { position: fixed; left: 18px; bottom: 18px; z-index: 5000; max-width: 420px; background: var(--bg-secondary, #1e1e2e); color: var(--text-bright, #fff); border: 1px solid var(--warn, #d29922); border-radius: 8px; padding: 12px 14px; font-size: 13px; line-height: 1.45; box-shadow: 0 8px 28px rgba(0,0,0,.35); }
      .gr-unsent .gr-actions { display: flex; gap: 8px; margin-top: 10px; }
      .gr-toast { position: fixed; right: 18px; bottom: 18px; z-index: 5000; background: var(--bg-secondary, #1e1e2e); color: var(--text-bright, #fff); border: 1px solid var(--green, #3fb950); border-radius: 8px; padding: 10px 14px; font-size: 13px; box-shadow: 0 8px 28px rgba(0,0,0,.35); max-width: 360px; }
    `;
    document.head.append(st);
  }

  function ago(ts) {
    const d = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (d < 3600) return `${Math.max(1, Math.floor(d / 60))} min`;
    if (d < 86400) return `${Math.floor(d / 3600)} h`;
    return `${Math.floor(d / 86400)} d`;
  }

  const STATUS = { added: 'new', deleted: 'deleted', modified: 'modified' };

  function renderCommits(commits) {
    if (!commits.length) return '';
    return `<div class="gr-sec">${esc(tr('Commits'))} (${commits.length})</div>` + commits.map(c =>
      `<div class="gr-commit"><code>${esc(c.oid.slice(0, 7))}</code><span>${esc((c.message || '').split('\n')[0])}</span><span class="gr-who">${esc(c.author)} · ${esc(ago(c.time))}</span></div>`).join('');
  }

  function renderFiles(files, clash) {
    if (!files.length) return '';
    return `<div class="gr-sec">${esc(tr('Files'))} (${files.length})</div>` + files.map(f => {
      const body = f.binary
        ? `<div class="gr-empty">${esc(tr('Binary file: no text diff.'))}</div>`
        : `<div class="gr-diff">${f.ops.map(o => o.t === '…'
          ? `<div class="gr-line gr-gap">⋯ ${esc(o.s)} ${esc(tr('identical lines'))}</div>`
          : `<div class="gr-line ${o.t === '+' ? 'gr-p' : o.t === '-' ? 'gr-m' : ''}">${o.t === ' ' ? '&nbsp;' : o.t}${esc(o.s)}</div>`).join('')}</div>`;
      const warn = clash && clash.has(f.path) ? ` <span class="gr-badge gr-deleted">${esc(tr('you also changed'))}</span>` : '';
      return `<details class="gr-file" open><summary><span class="gr-badge gr-${f.status}">${esc(tr(STATUS[f.status]))}</span><span class="gr-path">${esc(f.path)}</span>${warn}` +
        `<span class="gr-stat">${f.binary ? '' : `+${f.add} −${f.del}`}</span></summary>${body}</details>`;
    }).join('');
  }

  // NeoLeaf internal files (comments, configuration): they come and go together, but are not "user changes"
  const isInternal = p => p.startsWith('.neoleaf/');

  function renderInto(el, { commits, files, clash, emptyText }) {
    const shown = files.filter(f => !isInternal(f.path));
    const internal = files.length - shown.length;
    if (!commits.length && !shown.length && !internal) { el.innerHTML = `<div class="gr-empty">${esc(emptyText)}</div>`; return; }
    const note = internal ? `<div class="gr-empty">${esc(tr('Includes'))} ${internal} ${esc(tr('internal NeoLeaf file(s) (comments and project settings).'))}</div>` : '';
    el.innerHTML = renderCommits(commits) + renderFiles(shown, clash) + note;
  }

  function neoToast(msg) {
    ensureStyle();
    let el = $('gr-toast');
    if (!el) { el = document.createElement('div'); el.id = 'gr-toast'; el.className = 'gr-toast'; document.body.append(el); }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(neoToast.t);
    neoToast.t = setTimeout(() => { el.style.display = 'none'; }, 7000);
  }

  async function compareSafe() {
    try { return await BrowserGit.compare(); }
    catch (_) { return await BrowserGit.compare({ fetch: false }); } // offline: compare with what was already downloaded
  }

  window.GitReview = { lineDiff, withContext, describe };
  window.neoToast = neoToast;
  // internals for the other parts (git-review-modals.js, git-review-open.js)
  window.__GR = { $, esc, tr, ensureStyle, renderInto, isInternal, compareSafe, describe, localPaths, neoToast };
})();
