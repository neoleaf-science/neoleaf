// Local AI apps (docs/mcp-bridge.md). AI apps that speak MCP (Claude Code and Claude Desktop, Codex, VS Code, Antigravity...) cannot reach a
// page by themselves. tools/mcp-bridge/neoleaf-mcp.mjs runs on the person's computer and listens only on 127.0.0.1; this file connects the
// editor tab to it. The tab asks the bridge for work with a long poll, runs each call with the same tools a browser agent has
// (ai-webmcp.js, which keeps the budget, the project switch and the drafts), and sends the answer back. Nothing goes to the NeoLeaf server.
//
// Off by default and per account (`neoleaf.ai.bridge.<account>` in localStorage: the bridge address and the token the bridge gave when
// the person typed its pairing code; removed with every `neoleaf.ai.` entry when signing out). The person starts it with a button and a
// code that the bridge prints on their computer, so a page or a program that does not have the code cannot attach itself. The tools only
// read, compile, or make drafts: an app cannot change a file; the person applies the drafts in the AI tab.
// Depends on globals: h(), T(), AIWebMCP (ai-webmcp.js, loaded after this file and used only when a call arrives).
(function () {
  const box = document.getElementById('ai-container');
  if (!box) return;
  const KEY = 'neoleaf.ai.bridge.' + (box.dataset.account || '');
  const DEFAULT_URL = 'http://127.0.0.1:47480';
  const st = { run: 0, state: 'off', error: '', calls: 0, el: null, ctl: null };

  const read = () => { try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d && typeof d === 'object' ? d : null; } catch (_) { return null; } };
  const write = d => { try { if (d) localStorage.setItem(KEY, JSON.stringify(d)); else localStorage.removeItem(KEY); return true; } catch (_) { return false; } };
  const isOn = () => !!(read() && read().token);

  /** Only this computer: the bridge never runs anywhere else. */
  function validUrl(u) {
    try { const x = new URL(u); return x.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(x.hostname) && !x.username && !x.password && !x.hash; } catch (_) { return false; }
  }

  async function api(cfg, path, init, signal) {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + path, { ...init, signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { ...(init && init.body ? { 'content-type': 'application/json' } : {}), ...(cfg.token ? { authorization: 'Bearer ' + cfg.token } : {}) } });
    if (res.status === 401) { const e = new Error('unpaired'); e.unpaired = true; throw e; }
    if (!res.ok) throw new Error('bridge answered ' + res.status);
    return res.json();
  }

  function setState(state, error) { st.state = state; st.error = error || ''; paint(); }

  /** The loop that keeps the tab connected: publishes the tools, then waits for calls. */
  async function loop(id) {
    const cfg = read();
    if (!cfg || !cfg.token) return;
    let announced = false, failures = 0;
    while (st.run === id) {
      try {
        if (!announced) {
          await api(cfg, '/page/tools', { method: 'POST', body: JSON.stringify({ project: window.projectId || '', tools: window.AIWebMCP ? AIWebMCP.defs() : [] }) });
          announced = true; failures = 0; setState('connected');
        }
        st.ctl = new AbortController();
        const r = await api(cfg, '/page/poll', { method: 'GET' }, st.ctl.signal);
        failures = 0;
        if (r && r.call) {
          let out;
          try { out = { content: String(await AIWebMCP.run(r.call.name, r.call.input, 'bridge')), isError: false }; } catch (e) { out = { content: String((e && e.message) || e), isError: true }; }
          st.calls++;
          await api(cfg, '/page/result', { method: 'POST', body: JSON.stringify({ id: r.call.id, ...out }) });
          paint();
        }
      } catch (e) {
        if (st.run !== id) return;
        if (e && e.unpaired) { write(null); st.run++; setState('off', T('The bridge does not know this tab any more. Pair again with the new code.')); return; }
        if (e && e.name === 'AbortError') continue;
        announced = false;
        failures++;
        setState('waiting', T('Could not reach the bridge on this computer. Is it running?'));
        await new Promise(res => setTimeout(res, Math.min(15000, 2000 * failures)));
      }
    }
  }

  function start() { st.run++; const id = st.run; setState('waiting'); loop(id); }
  function stop(forget) {
    st.run++;
    if (st.ctl) { try { st.ctl.abort(); } catch (_) {} }
    const cfg = read();
    if (cfg && cfg.token) api(cfg, '/page/bye', { method: 'POST', body: '{}' }).catch(() => {});
    if (forget) write(null);
    setState('off');
  }

  async function pair(url, code) {
    if (!validUrl(url)) throw new Error(T('The bridge address must be on this computer (http://127.0.0.1).'));
    if (!/^\d{6}$/.test(code)) throw new Error(T('The pairing code has 6 digits.'));
    let r;
    try { r = await api({ url }, '/page/pair', { method: 'POST', body: JSON.stringify({ code }) }); } catch (e) { throw new Error(T('Could not pair: the bridge is not running, or the code is wrong.')); }
    if (!write({ url, token: r.token })) throw new Error(T('Could not save in this browser.'));
    start();
  }

  // ------------------------------------------------------------ the card in the AI tab
  const label = () => st.state === 'connected' ? T('Connected. Calls from AI apps in this session: {0}.', st.calls) : st.state === 'waiting' ? T('Waiting for the bridge...') : '';
  function card() {
    const on = isOn();
    const children = [h('h3', { class: 'ai-title' }, T('Local AI apps (MCP bridge)')),
      h('p', { class: 'ai-p' }, T('Lets AI apps on this computer (Claude Code or Claude Desktop, Codex, VS Code, Antigravity and others) read this project, compile it and propose changes. They reach it through a small program on your computer that you start yourself (tools/mcp-bridge/neoleaf-mcp.mjs). They cannot change a file: what they propose appears here and only your click applies it.'))];
    if (on) {
      children.push(h('div', { class: 'ai-meta', id: 'ai-bridge-state' }, label()));
      if (st.error) children.push(h('div', { class: 'ai-error' }, st.error));
      children.push(h('div', { class: 'ai-actions' }, h('button', { class: 'btn cmt-btn', id: 'ai-bridge-stop', type: 'button', onclick: () => { stop(true); } }, T('Disconnect the bridge'))));
    } else {
      const url = h('input', { class: 'form-control', id: 'ai-bridge-url', type: 'text', autocomplete: 'off', spellcheck: 'false', value: DEFAULT_URL });
      const code = h('input', { class: 'form-control', id: 'ai-bridge-code', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '6', placeholder: '000000' });
      const msg = h('div', { class: 'ai-error', id: 'ai-bridge-msg' }, st.error);
      const go = h('button', { class: 'btn btn-primary', id: 'ai-bridge-pair', type: 'button' }, T('Pair with the bridge'));
      go.addEventListener('click', async () => {
        if (!window.confirm(T('Allow AI apps on this computer to read this project and propose changes? What they read goes to the app you use, under its terms, and not through NeoLeaf.'))) return;
        go.disabled = true; msg.textContent = '';
        try { await pair(url.value.trim(), code.value.trim()); } catch (e) { msg.textContent = (e && e.message) || String(e); go.disabled = false; }
      });
      children.push(h('label', { class: 'ai-field' }, h('span', {}, T('Bridge address')), url),
        h('label', { class: 'ai-field' }, h('span', {}, T('Pairing code (printed by the bridge)')), code), msg, h('div', { class: 'ai-actions' }, go));
    }
    return h('div', { class: 'ai-card', id: 'ai-bridge-card' }, ...children);
  }

  let repaintHook = null;
  function paint() { if (repaintHook) repaintHook(); }

  window.AIBridge = { card, isOn, onChange: fn => { repaintHook = fn; }, calls: () => st.calls };
  if (isOn()) start();
})();
