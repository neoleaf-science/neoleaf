// Local agent (neoleaf-agent): compiles with this machine's TeX Live / Tectonic. Looks for the agent on 127.0.0.1 and, if it
// is running, adds its compilers to the engine selector. Depends on globals from the editor scripts.
(function () {
  // default agent port; `ld-agent-base` (loopback only) lets you point to another one, useful in tests and development
  const BASE = (() => {
    try {
      const u = new URL(localStorage.getItem('ld-agent-base') || '');
      if (['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return u.origin;
    } catch (_) { /* no override */ }
    return 'http://127.0.0.1:47474';
  })();
  const KEY = 'ld-agent-token';
  const st = { online: false, engines: [], version: '', paired: false, update: '' };
  let engineTouched = false;

  const token = () => { try { return localStorage.getItem(KEY) || ''; } catch (_) { return ''; } };

  async function call(path, body, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 4000);
    try {
      const headers = { Authorization: 'Bearer ' + token() };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const r = await fetch(BASE + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
      const data = await r.json().catch(() => ({}));
      return { status: r.status, data };
    } finally { clearTimeout(timer); }
  }

  // Authenticated call: if the agent says the stored code is not valid (401), clear it, ask again and retry once
  async function authedCall(path, body, ms) {
    let r = await call(path, body, ms);
    if (r.status === 401) {
      try { localStorage.removeItem(KEY); } catch (_) {}
      st.paired = false;
      await ensureToken();
      r = await call(path, body, ms);
    }
    return r;
  }

  async function probe() {
    try {
      const { data } = await call('/v1/status', undefined, 1500);
      st.online = data && data.agent === 'neoleaf-agent';
      st.engines = (data && data.engines) || [];
      st.paired = !!(data && data.paired);
      st.version = (data && data.version) || '';
      st.update = (data && data.update && data.update.available) || '';
    } catch (_) {
      st.online = false; st.engines = []; st.paired = false;
    }
    syncOptions();
    updateHint();
  }

  // Adds (or removes) the agent's compilers in the selector
  function syncOptions() {
    const sel = document.getElementById('engine-select');
    if (!sel) return;
    const had = sel.value;
    [...sel.options].filter(o => o.value.startsWith('agent-')).forEach(o => o.remove());
    if (st.online) {
      st.engines.forEach(e => {
        const o = document.createElement('option');
        o.value = e.id;
        o.textContent = '💻 ' + T('Local') + ' (' + e.name + ')';
        o.title = e.version || '';
        sel.appendChild(o);
      });
    }
    window.availableEngines = [...[...sel.options].map(o => o.value)];
    sel.style.display = sel.options.length > 1 ? '' : 'none';
    // never pick a local engine because of what the repository says (.neoleaf/config.json is data from whoever wrote it):
    // running on the agent is a choice made on this machine
    if (had && [...sel.options].some(o => o.value === had)) sel.value = had;
    else sel.value = 'wasm-texlive';
    const cfg = document.getElementById('cfg-engine');                  // Project window
    if (cfg) {
      [...cfg.options].filter(o => o.value.startsWith('agent-')).forEach(o => o.remove());
      if (st.online) st.engines.forEach(e => { const o = document.createElement('option'); o.value = e.id; o.textContent = '💻 ' + T('Local') + ' (' + e.name + ')'; cfg.appendChild(o); });
    }
  }

  function updateHint() {
    const el = document.getElementById('agent-hint');
    if (!el) return;
    el.innerHTML = '';
    if (st.online) {
      const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const engines = st.engines.map(e => esc(e.name)).join(', ') || (T('no LaTeX compiler found on this machine') + `: ${T('to install TinyTeX, run')} <code>neoleaf-agent install-tinytex</code> ${T('or use the agent icon in the tray')}`);
      el.innerHTML = `<span style="color:var(--green);font-weight:600;">● ${T('Local agent connected (v{0}):', esc(st.version))}</span> ${engines}. <a href="/agent" target="_blank" style="color:var(--link);margin-left:6px;">${T('Learn more')}</a>${st.update ? `<div style="margin-top:4px;color:var(--muted);">⬆ ${T('Agent update available')} (v${esc(st.update)}): <code>neoleaf-agent update</code></div>` : ''}`;
    } else {
      el.innerHTML = `<div style="margin-top:6px;line-height:1.6;">
        <span style="color:var(--muted);">⚡ <strong>WebAssembly</strong>: ${T('100% in-browser compilation (private, nothing to install).')}</span><br>
        <span style="color:var(--muted);">💻 <strong>Local Agent</strong>: ${T('To compile with this machine\'s TeX Live / Tectonic:')}</span>
        <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <a href="/static/agent/neoleaf-agent-linux-x86_64" class="btn" style="padding:3px 8px;font-size:11px;background:var(--bg-tertiary);border-color:var(--border-strong);text-decoration:none;" download="neoleaf-agent-linux-x86_64">⬇ ${T('Download agent (Linux)')}</a>
          <a href="/agent" target="_blank" style="font-size:11px;color:var(--link);">${T('How it works')}</a>
        </div>
      </div>`;
    }
  }

  // ---------------------------------------------------------------- pairing
  async function ensureToken() {
    if (token()) {
      const { data } = await call('/v1/status', undefined, 3000);
      if (data && data.paired) return token();
    }
    // the agent copies the code to the clipboard and shows it in a system notification
    let sent = null;
    try { const r = await call('/v1/pair/request', {}, 5000); if (r.status === 200) sent = r.data; } catch (_) { /* old agent: no notification */ }
    const msg = sent && (sent.notified || sent.clipboard)
      ? T('The local agent sent the pairing code to your system\'s notification area{0}. Type or paste the code here:', sent.clipboard ? T(' and copied it to the clipboard (Ctrl+V)') : '')
      : T('Local agent pairing code (shown in the terminal where it is running; or run: neoleaf-agent code):');
    const typed = prompt(msg);
    if (!typed) throw new Error(T('Pairing cancelled.'));
    // accepts the code pasted in any form (with "Code:", spaces, lowercase, no hyphens...)
    const up = typed.toUpperCase();
    const grouped = up.match(/(?:^|[^A-Z0-9])([A-Z0-9]{4})[-\s]([A-Z0-9]{4})[-\s]([A-Z0-9]{4})(?![A-Z0-9])/);   // XXXX-XXXX-XXXX in the middle of a text
    const flat = up.replace(/[^A-Z0-9]/g, '');
    const code = grouped ? `${grouped[1]}-${grouped[2]}-${grouped[3]}` : flat.length === 12 ? flat.replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3') : up.trim();
    // the agent exchanges the code (single use, 5 min) for a token for this browser only; old agents have no /v1/pair/confirm
    let conf;
    try { conf = await call('/v1/pair/confirm', { code }, 5000); } catch (e) {
      throw new Error(T('Could not talk to the local agent: {0}', String(e && e.message || e)));
    }
    if (conf.status === 200 && conf.data && conf.data.token) {
      try { localStorage.setItem(KEY, conf.data.token); } catch (_) {}
      st.paired = true;
      return conf.data.token;
    }
    if (conf.status !== 404) {
      const why = { expired: 'The code expired (valid for 5 minutes): try again to get a new one.', locked: 'Too many wrong attempts: try again to get a new code.', too_many: 'Too many browsers are paired: revoke one with neoleaf-agent revoke.' }[conf.data && conf.data.reason];
      throw new Error(why ? T(why) : T('Invalid pairing code. It has 12 letters and numbers (XXXX-XXXX-XXXX); to see it again, run: neoleaf-agent code'));
    }
    try { localStorage.setItem(KEY, code); } catch (_) {}
    let paired = false;
    try {
      const { data } = await call('/v1/status', undefined, 4000);
      paired = !!(data && data.paired);
    } catch (e) {
      try { localStorage.removeItem(KEY); } catch (_) {}
      throw new Error(T('Could not talk to the local agent: {0}', String(e && e.message || e)));
    }
    if (!paired) {
      try { localStorage.removeItem(KEY); } catch (_) {}
      throw new Error(T('Invalid pairing code. It has 12 letters and numbers (XXXX-XXXX-XXXX); to see it again, run: neoleaf-agent code'));
    }
    st.paired = true;
    return token();
  }

  async function sha256hex(bytes) {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function b64OfBytes(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

// ---------------------------------------------------------------- compilation
// fontspec (and classes that load it) only runs on XeLaTeX/LuaLaTeX
  const UNICODE_ENGINE_RE = /requires (?:either )?XeTeX or\s+(?:\([A-Za-z]+\)\s+)?LuaTeX|cannot-use-pdftex|File [`']fontspec\.sty' not found/i;
  const needsUnicodeEngine = log => UNICODE_ENGINE_RE.test(log || '');
  const UNICODE_ENGINES = [['agent-xelatex', 'XeLaTeX'], ['agent-lualatex', 'LuaLaTeX']];

  async function compileOnAgent(engineId, opts) {
    if (!st.online) await probe();
    if (!st.online) throw new Error(T('The local agent is not running.'));
    await ensureToken();
    updateStatus('saving', 'Sending the project to the local agent...');
    const { files, main, texmfOnly } = await gatherProject();
    const enc = new TextEncoder();
    const entries = [], bytesBy = new Map();
    for (const [path, content] of files) {
      if (texmfOnly.has(path)) continue;            // the project's TeX Live 2023 packages: the machine already has its own
      const bytes = typeof content === 'string' ? enc.encode(content) : content;
      const sha = await sha256hex(bytes);
      entries.push({ path, sha256: sha });
      bytesBy.set(sha, bytes);
    }
    // only what the agent does not have yet is sent
    const prep = await authedCall('/v1/prepare', { files: entries });
    if (prep.status !== 200) throw new Error(`${prep.data.error || 'failed to prepare the upload'} (local agent, HTTP ${prep.status})`);
    let batch = [], size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const r = await authedCall('/v1/blobs', { blobs: batch }, 120000);
      if (r.status !== 200) throw new Error(r.data.error || 'failed to upload files');
      batch = []; size = 0;
    };
    for (const sha of prep.data.need || []) {
      const bytes = bytesBy.get(sha);
      if (!bytes) continue;
      batch.push({ sha256: sha, b64: b64OfBytes(bytes) });
      size += bytes.length;
      if (size > 12 * 1024 * 1024) await flush();
    }
    await flush();

    updateStatus('saving', 'Compiling in the local agent...');
    const r = await authedCall('/v1/compile', { project: projectId, engine: engineId, mainFile: main, files: entries, installMissing: projectConfig.autoInstall !== false }, 600000);
    if (r.status !== 200) throw new Error(r.data.error || 'local compilation failed');
    const res = r.data;
    const result = {
      success: !!res.success,
      pdf_base64: res.pdf_base64 || null,
      log: res.log || '',
      engine_used: res.engine_used,
      mainFile: res.mainFile,
      diagnostics: parseLogToDiagnostics(res.log || '')
    };
    if (res.synctex_base64) result.synctexBytes = base64ToBytes(res.synctex_base64);
    if (res.bbl_base64) result.bblBytes = base64ToBytes(res.bbl_base64);
    // pdfLaTeX cannot run fontspec: if the agent has XeLaTeX/LuaLaTeX, recompile with it (this time only; the selector choice does not change)
    if (!result.success && !(opts && opts.retried) && engineId === 'agent-pdflatex' && needsUnicodeEngine(result.log)) {
      const alt = UNICODE_ENGINES.find(([id]) => st.engines.some(e => e.id === id));
      if (alt) {
        updateStatus('saving', `${T('The document uses fontspec: recompiling with')} ${alt[1]}...`);
        return compileOnAgent(alt[0], { retried: true, note: `${T('The document uses fontspec, which does not run on pdfLaTeX: recompiled with')} ${alt[1]}. ${T('To avoid this next time, choose that engine in the selector above.')}` });
      }
      result.log = `${T('Tip: this project uses fontspec, which requires XeLaTeX or LuaLaTeX; the agent found neither. Install them or choose "⚡ Browser (XeLaTeX / WebAssembly)".')}\n\n${result.log}`;
    }
    if (!result.success && typeof fontHintsFromLog === 'function') {
      const hints = fontHintsFromLog(result.log);
      if (hints.length) result.log = `${hints.join('\n')}\n\n${result.log}`;
    }
    if (opts && opts.note) result.log = `${opts.note}\n\n${result.log}`;
    const inst = (res.installed && res.installed.length) ? ` · ${T('installed')}: ${res.installed.join(', ')}` : '';
    updateStatus(result.success ? 'saved' : 'error', result.success ? `Compiled successfully (${result.engine_used}, ${(res.ms / 1000).toFixed(1)}s)${inst}` : 'Compilation error');
    renderCompileResult(result);
    if (result.success) persistLastPdf(result, engineId);
    return result;
  }
  window.compileOnAgent = compileOnAgent;

  window.LDAgent = { probe, syncOptions, state: st, needsUnicodeEngine };

  document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('engine-select');
    if (sel) sel.addEventListener('change', () => { engineTouched = true; });
    probe();
    // look again when returning to the tab and from time to time (slower while the agent is not found)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') probe(); });
    setInterval(() => { if (document.visibilityState === 'visible' && st.online) probe(); }, 20000);
    setInterval(() => { if (document.visibilityState === 'visible' && !st.online) probe(); }, 60000);
  });
})();
