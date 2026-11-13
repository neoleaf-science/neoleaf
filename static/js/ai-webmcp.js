// Browser agents (WebMCP, docs/ai-assistant-plan.md). WebMCP is a proposed web standard (Chrome origin trial) with which a page offers
// tools to an AI agent that runs in the person's browser: an assistant built into the browser, or an extension. This file registers
// five reading tools (list_files, read_file, search, compile_log, list_comments) and two that only make DRAFTS (add_comment,
// add_suggestion), the same ones the in-page assistant has (ai-tools.js, own instance: the two never share a budget or drafts).
// There is no tool that writes a file: a draft appears as a card in the AI tab and only the person's click applies or keeps it.
//
// Off by default and per account (`neoleaf.ai.webmcp.<account>` in localStorage, removed with every `neoleaf.ai.` entry when signing
// out). Nothing is registered unless the browser offers `document.modelContext` (the current API; `navigator.modelContext` is the old
// one, used only when the new one is absent), so on other browsers this file does nothing and draws nothing. The text an agent
// reads goes to that agent, which NeoLeaf does not choose and cannot see; an extension that can run scripts in this page can call
// the same tools. The project switch (`ai: "off"`) is checked on every call. Depends on globals: h(), T(), AITools, AIChat, AISettings.
(function () {
  const box = document.getElementById('ai-container');
  if (!box) return;
  const KEY = 'neoleaf.ai.webmcp.' + (box.dataset.account || '');
  const AGENT = { name: 'Browser agent', model: 'WebMCP' };   // how its proposals are marked (always with the AI mark)
  const IDLE_MS = 60000;                                         // a new burst of calls starts a new reading budget
  // which tools are offered, and what they say about themselves (the browser and the agent use these hints)
  const OFFERED = {
    list_files: { readOnly: true }, read_file: { readOnly: true }, search: { readOnly: true }, compile_log: { readOnly: true }, list_comments: { readOnly: true },
    add_comment: { readOnly: false }, add_suggestion: { readOnly: false },
  };

  const tools = AITools.create();
  const st = { ctl: null, items: [], taken: 0, last: 0, calls: 0, el: null };

  const context = () => document.modelContext || (navigator && navigator.modelContext) || null;
  const supported = () => { const c = context(); return !!c && typeof c.registerTool === 'function'; };
  const isOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };
  const setOn = on => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); return true; } catch (_) { return false; } };

  /** Moves the drafts the tools made into the list the person sees. */
  function collect() {
    const all = tools.drafts();
    for (const d of all.slice(st.taken)) st.items.push(d);
    st.taken = all.length;
    badge();
    paint();
  }

  /** A number on the AI tab while proposals wait for a decision. */
  function badge() {
    const b = document.getElementById('tab-ai-btn');
    if (!b) return;
    const n = st.items.filter(d => d.status === 'pending').length;
    if (n) b.setAttribute('data-badge', String(n)); else b.removeAttribute('data-badge');
  }

  async function execute(name, args) {
    if (!isOn()) throw new Error('Browser agents are not allowed by the person in this browser.');
    if (!(await AISettings.allowedInProject())) throw new Error('This project does not allow AI tools. Nothing was read.');
    if (Date.now() - st.last > IDLE_MS) { tools.begin(); st.taken = 0; }
    st.last = Date.now();
    const r = await tools.run({ name, input: args && typeof args === 'object' ? args : {} });
    st.calls++;
    collect();
    if (r.isError) throw new Error(r.content);
    return r.content;
  }

  function unregister() {
    if (st.ctl) { try { st.ctl.abort(); } catch (_) {} st.ctl = null; }
  }

  async function register() {
    unregister();
    if (!supported() || !isOn()) return;
    const c = context();
    const ctl = new AbortController();
    st.ctl = ctl;
    for (const d of tools.defs()) {
      const o = OFFERED[d.name];
      if (!o) continue;
      try {
        await c.registerTool({
          name: d.name, description: d.description, inputSchema: d.schema,
          // what is read can contain text written by anyone (co-authors, pasted material): the agent must treat it as data
          annotations: { readOnlyHint: o.readOnly, untrustedContentHint: o.readOnly, consequentialHint: false },
          execute: args => execute(d.name, args),
        }, { signal: ctl.signal });
      } catch (_) { /* a tool the browser refused is simply not offered */ }
    }
  }

  // ------------------------------------------------------------ the card in the AI tab
  function paint() {
    if (!st.el) return;
    if (!supported()) { st.el.replaceChildren(); st.el.style.display = 'none'; return; }
    st.el.style.display = '';
    const on = isOn();
    const toggle = h('button', { class: on ? 'btn cmt-btn' : 'btn btn-primary', id: 'ai-agent-toggle', type: 'button' }, on ? T('Stop allowing browser agents') : T('Allow browser agents'));
    toggle.addEventListener('click', () => {
      if (on) { setOn(false); unregister(); paint(); return; }
      if (!window.confirm(T('Allow AI agents of your browser to read this project\'s files and propose comments and suggestions? What they read goes to the agent you use, under its terms, and not through NeoLeaf. Extensions that can see this page could use the same tools.'))) return;
      setOn(true);
      register();
      paint();
    });
    const card = h('div', { class: 'ai-card', id: 'ai-agent-card' },
      h('h3', { class: 'ai-title' }, T('Browser agents (WebMCP)')),
      h('p', { class: 'ai-p' }, T('Lets an AI agent of your browser (an assistant built into the browser, or an extension) read this project and propose comments and suggestions. It cannot change a file: what it proposes appears here, and only your click applies it.')),
      h('div', { class: 'ai-actions' }, toggle),
      on ? h('div', { class: 'ai-meta', id: 'ai-agent-state' }, T('Browser agents are allowed. Tool calls in this session: {0}.', st.calls)) : '');
    const repaint = () => { badge(); paint(); };
    const list = st.items.length ? h('div', { class: 'ai-list', id: 'ai-agent-drafts' },
      h('div', { class: 'ai-who' }, h('b', {}, T('Proposals from a browser agent')), ' ', h('span', { class: 'ai-badge', title: AGENT.model }, T('AI'))),
      ...st.items.map(d => AIChat.draftCard(AGENT, d, repaint))) : '';
    st.el.replaceChildren(card, list);
  }

  /** Called by ai-settings.js each time the panel is drawn: the element is kept across draws. */
  function mount(el) { st.el = el; paint(); }

  window.AIWebMCP = { mount, supported, isOn, register, calls: () => st.calls, proposals: () => st.items.map(d => ({ ...d })) };
  register();
})();
