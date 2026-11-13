// AI assistant, settings (docs/ai-assistant-plan.md). The person picks a provider and pastes their own API key; every call goes from this
// browser straight to that provider and nothing about it (key, questions, answers, project text) ever goes to the NeoLeaf server.
// This file only keeps the settings and the consent; it makes no request. It is loaded only when the server offers the assistant.
// The settings are kept per signed-in account (`neoleaf.ai.<provider>.<numeric id>` in localStorage): a session can end by itself
// without deleting anything, so a key that was not tied to an account would be found by the next person who signs in on this browser.
// Sign out and "Delete all local data" remove every `neoleaf.ai.` entry (storage-manager.js).
// Depends on globals: h(), T(), Project, AIProviders, AIChat (ai-chat.js) and AIWebMCP (ai-webmcp.js), both loaded after this file.
(function () {
  const box = () => document.getElementById('ai-container');
  if (!box()) return;
  const ACCOUNT = box().dataset.account || '';
  const KEY = 'neoleaf.ai.' + ACCOUNT;
  const MAX_NAME = 40;
  const AUTO = 'neoleaf.ai.auto.' + ACCOUNT;   // session only: closing the tab turns it off
  const autoApply = () => { try { return sessionStorage.getItem(AUTO) === '1'; } catch (_) { return false; } };

  // `dialect` is which API the provider speaks; `url` is where it lives (editable for "Other")
  const PROVIDERS = [
    { id: 'anthropic', label: 'Anthropic (Claude)', dialect: 'anthropic', url: 'https://api.anthropic.com' },
    { id: 'openai', label: 'OpenAI', dialect: 'openai', url: 'https://api.openai.com/v1' },
    { id: 'gemini', label: 'Google Gemini', dialect: 'openai', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    { id: 'openrouter', label: 'OpenRouter', dialect: 'openai', url: 'https://openrouter.ai/api/v1' },
    // local models: no key, the server runs on this computer (it must allow this site's address, CORS)
    { id: 'ollama', label: 'Ollama (local model)', dialect: 'openai', url: 'http://localhost:11434/v1', local: true },
    { id: 'lmstudio', label: 'LM Studio (local model)', dialect: 'openai', url: 'http://localhost:1234/v1', local: true },
    { id: 'custom', label: null, dialect: 'openai', url: '' },
  ];
  const providerOf = id => PROVIDERS.find(p => p.id === id) || null;
  const labelOf = p => p.label || T('Other (OpenAI-compatible)');

  // `draft` is what the person typed in the form and did not save yet: a refused field must not erase the others
  const st = { editing: false, error: '', projectOff: null, draft: null };

  // ------------------------------------------------------------ storage
  function read() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      return d && typeof d === 'object' ? d : {};
    } catch (_) { return {}; }
  }
  function write(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch (_) { return false; }
  }

  /** http only for this machine (a local model, the tests); everything else must be https. */
  function validUrl(u) {
    let url;
    try { url = new URL(u); } catch (_) { return false; }
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  }
  const oneLine = s => !/[\u0000-\u001f\u007f]/.test(s);

  /** The settings when the assistant is ready to be used, otherwise null. */
  function get() {
    const d = read();
    const p = providerOf(d.provider);
    if (!d.consent || !p || (!p.local && (typeof d.key !== 'string' || !d.key)) || typeof d.model !== 'string' || !d.model) return null;
    const baseUrl = (typeof d.baseUrl === 'string' && validUrl(d.baseUrl) ? d.baseUrl : p.url).replace(/\/+$/, '');
    if (!baseUrl) return null;
    const name = typeof d.name === 'string' && d.name.trim() && oneLine(d.name) ? d.name.trim().slice(0, MAX_NAME) : d.model;
    return { provider: p.id, dialect: p.dialect, baseUrl, key: typeof d.key === 'string' ? d.key : '', model: d.model, name };
  }

  function forget() {
    try { localStorage.removeItem(KEY); } catch (_) {}
    st.editing = false; st.error = ''; st.draft = null;
    render();
  }

  // ------------------------------------------------------------ the project switch (`ai: "off"` in .neoleaf/config.json)
  async function loadProjectSwitch() {
    try { st.projectOff = (await Project.config.get()).config.ai === 'off'; } catch (_) { st.projectOff = null; }
  }
  async function setProjectSwitch(off) {
    try {
      const { config } = await Project.config.get();
      await Project.config.save({ ...config, ai: off ? 'off' : 'on' });
      st.projectOff = off;
      if (typeof checkGitStatus === 'function') checkGitStatus();
    } catch (e) { alert((e && e.message) || e); }
    render();
  }

  // ------------------------------------------------------------ views
  const p = (...c) => h('p', { class: 'ai-p' }, ...c);

  function noticeView() {
    return h('div', { class: 'ai-card', id: 'ai-notice' },
      h('h3', { class: 'ai-title' }, T('AI assistant')),
      p(T('The assistant works with your own account at an AI provider. You choose the provider and paste your API key.')),
      p(T('When you ask something, the text of the project files the assistant reads is sent from this browser straight to that provider, under the provider\'s terms. It does not pass through NeoLeaf.')),
      p(T('The key is kept only in this browser, for your account, and is removed when you sign out. Prefer a key made only for NeoLeaf, with a spending limit at the provider.')),
      p(T('Using the provider is charged to your account there.')),
      p(T('The assistant never changes a file by itself: it comments and suggests, and you accept or reject. You may allow it to apply its edits without asking, in this tab only.')),
      p(T('In a shared project your co-authors\' text is sent too. Anyone in the project can turn the assistant off for everyone.')),
      h('div', { class: 'ai-actions' },
        h('button', { class: 'btn btn-primary', id: 'ai-consent', onclick: () => { write({ ...read(), consent: true }); st.editing = true; render(); } }, T('I understand, continue'))));
  }

  function formView() {
    const d = st.draft || read();
    const sel = h('select', { class: 'form-control', id: 'ai-provider' }, ...PROVIDERS.map(pr => h('option', { value: pr.id, selected: pr.id === (d.provider || 'anthropic') }, labelOf(pr))));
    const key = h('input', { class: 'form-control', id: 'ai-key', type: 'password', autocomplete: 'off', spellcheck: 'false', value: d.key || '' });
    const model = h('input', { class: 'form-control', id: 'ai-model', type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '120', list: 'ai-model-list', value: d.model || '' });
    // the model names come from the provider itself (asked with the key that was typed), never from a list written here
    const list = h('datalist', { id: 'ai-model-list' });
    const listMsg = h('small', { class: 'ai-hint', id: 'ai-models-msg' });
    const listBtn = h('button', { class: 'btn cmt-btn', id: 'ai-models-btn', type: 'button' }, T('List the models'));
    listBtn.addEventListener('click', async () => {
      const pr = providerOf(sel.value);
      const base = (pr.url || url.value.trim()).replace(/\/+$/, '');
      if (!pr.local && !key.value.trim()) { listMsg.textContent = T('Paste the API key.'); return; }
      if (!validUrl(base)) { listMsg.textContent = T('The server address must start with https://'); return; }
      listBtn.disabled = true;
      listMsg.textContent = '';
      try {
        const found = await AIProviders.listModels({ dialect: pr.dialect, baseUrl: base, key: key.value.trim() });
        list.replaceChildren(...found.map(m => h('option', { value: m.id, label: m.label })));
        listMsg.textContent = T('{0} models found. Choose one in the Model field.', found.length);
      } catch (e) {
        listMsg.textContent = T('Could not list the models: {0}', AIProviders.describe(e));
      } finally { listBtn.disabled = false; }
    });
    const name = h('input', { class: 'form-control', id: 'ai-name', type: 'text', autocomplete: 'off', maxlength: String(MAX_NAME), value: d.name || '' });
    const url = h('input', { class: 'form-control', id: 'ai-url', type: 'url', autocomplete: 'off', spellcheck: 'false', value: d.baseUrl || '' });
    const urlRow = h('label', { class: 'ai-field', id: 'ai-url-row' }, h('span', {}, T('Server address')), url);
    const keyRow = h('label', { class: 'ai-field', id: 'ai-key-row' }, h('span', {}, T('API key')), key);
    const localHint = h('div', { class: 'ai-hint', id: 'ai-local-hint' }, T('A local model needs no key. The program must be running on this computer and must allow this site\'s address (CORS), for example with OLLAMA_ORIGINS for Ollama.'));
    const syncUrl = () => {
      const pr = providerOf(sel.value);
      urlRow.style.display = pr.url ? 'none' : '';
      if (pr.url) url.value = '';
      keyRow.style.display = pr.local ? 'none' : '';
      localHint.style.display = pr.local ? '' : 'none';
    };
    sel.addEventListener('change', syncUrl);
    syncUrl();

    const save = () => {
      const pr = providerOf(sel.value);
      const k = key.value.trim(), m = model.value.trim(), n = name.value.trim(), u = url.value.trim();
      st.draft = { provider: pr.id, key: k, model: m, name: n, baseUrl: u };
      if (!k && !pr.local) st.error = T('Paste the API key.');
      else if (!m || !oneLine(m)) st.error = T('Write the model name.');
      else if (!pr.url && !validUrl(u)) st.error = T('The server address must start with https://');
      else if ([...n].length > MAX_NAME || !oneLine(n)) st.error = T('The name can have up to 40 characters, on one line.');
      else {
        st.error = '';
        if (!write({ consent: true, provider: pr.id, key: k, model: m, name: n, baseUrl: pr.url ? '' : u })) st.error = T('Could not save in this browser.');
        else { st.editing = false; st.draft = null; }
      }
      render();
    };

    return h('div', { class: 'ai-card', id: 'ai-form' },
      h('h3', { class: 'ai-title' }, T('AI assistant')),
      h('label', { class: 'ai-field' }, h('span', {}, T('Provider')), sel),
      urlRow,
      keyRow, localHint,
      h('label', { class: 'ai-field' }, h('span', {}, T('Model')), model, list),
      h('div', { class: 'ai-field' }, listBtn, ' ', listMsg),
      h('label', { class: 'ai-field' }, h('span', {}, T('Name of the assistant (optional)')), name,
        h('small', { class: 'ai-hint' }, T('Shown in comments and suggestions, always with the AI mark. Empty: the model name.'))),
      st.error ? h('div', { class: 'ai-error', id: 'ai-error' }, st.error) : '',
      h('div', { class: 'ai-actions' },
        h('button', { class: 'btn btn-primary', id: 'ai-save', onclick: save }, T('Save')),
        get() ? h('button', { class: 'btn', onclick: () => { st.editing = false; st.error = ''; st.draft = null; render(); } }, T('Cancel')) : ''));
  }

  function readyView(s) {
    // one short question with no project text, to see that the key, the model and the address work
    const out = h('div', { class: 'ai-meta', id: 'ai-test-out' });
    const testBtn = h('button', { class: 'btn cmt-btn', id: 'ai-test', type: 'button' }, T('Test the connection'));
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      out.textContent = T('Asking the provider...');
      const conv = AIProviders.newConversation(s);
      AIProviders.addUser(conv, 'Reply with the single word: ok');
      try {
        const turn = await AIProviders.send(s, conv, {});
        out.textContent = T('The provider answered: {0}', turn.text.trim().slice(0, 200) || '(' + turn.stop + ')') + ' · ' + turn.model;
      } catch (e) {
        out.textContent = AIProviders.describe(e);
      } finally { testBtn.disabled = false; }
    });
    const auto = h('input', { type: 'checkbox', id: 'ai-auto-apply', checked: autoApply() });
    auto.addEventListener('change', () => {
      if (auto.checked && !window.confirm(T('The assistant will change your files as soon as it proposes a change, without asking. You can undo each change with Ctrl+Z. Continue?'))) { auto.checked = false; return; }
      try { if (auto.checked) sessionStorage.setItem(AUTO, '1'); else sessionStorage.removeItem(AUTO); } catch (_) { auto.checked = false; }
    });
    return h('div', { class: 'ai-card', id: 'ai-ready' },
      h('div', { class: 'ai-who' }, h('b', { id: 'ai-ready-name' }, s.name), ' ', h('span', { class: 'ai-badge', title: s.model }, T('AI'))),
      h('div', { class: 'ai-meta' }, labelOf(providerOf(s.provider)) + ' · ' + s.model),
      h('div', { class: 'ai-actions' },
        testBtn,
        h('button', { class: 'btn cmt-btn', id: 'ai-change', onclick: () => { st.editing = true; render(); } }, T('Change settings')),
        h('button', { class: 'btn cmt-btn', id: 'ai-forget', onclick: () => { if (window.confirm(T('Forget the key saved in this browser?'))) forget(); } }, T('Forget the key')),
        h('label', { class: 'ai-field', style: 'margin:0' }, auto, ' ', T('Apply the assistant\'s edits without asking (this tab only)')),
        h('button', { class: 'btn cmt-btn', id: 'ai-project-off', onclick: () => { if (window.confirm(T('Turn the AI assistant off in this project, for everyone? The setting is saved in the project and reaches the others with the next push.'))) setProjectSwitch(true); } }, T('Do not allow the assistant in this project'))),
      out);
  }

  function projectOffView() {
    return h('div', { class: 'ai-card', id: 'ai-project-off-notice' },
      h('h3', { class: 'ai-title' }, T('This project does not allow the AI assistant.')),
      p(T('Someone in the project turned it off in the project settings. Nothing is sent to any provider.')),
      h('div', { class: 'ai-actions' }, h('button', { class: 'btn cmt-btn', id: 'ai-project-on', onclick: () => setProjectSwitch(false) }, T('Allow it again'))));
  }

  function render() {
    const el = box();
    if (!el) return;
    const d = read(), s = get();
    let view;
    if (st.projectOff) view = projectOffView();
    else if (!d.consent) view = noticeView();
    else if (st.editing || !s) view = formView();
    else view = readyView(s);
    // the conversation lives in #ai-chat (ai-chat.js), which is kept across renders of the settings
    const chat = document.getElementById('ai-chat') || h('div', { id: 'ai-chat' });
    const chatOn = !!s && !st.editing && !st.projectOff;
    chat.style.display = chatOn ? '' : 'none';
    // browser agents (ai-webmcp.js): their own card, which needs no key of ours and is kept across renders like the chat
    const agent = document.getElementById('ai-agent') || h('div', { id: 'ai-agent' });
    el.replaceChildren(view, agent, chat);
    if (st.projectOff) agent.style.display = 'none';
    else if (window.AIWebMCP) AIWebMCP.mount(agent);
    if (chatOn && window.AIChat) AIChat.mount(chat, s);
  }

  async function show() {
    render();
    await loadProjectSwitch();
    render();
  }

  window.AISettings = { get, show, forget, autoApply, account: () => ACCOUNT, allowedInProject: async () => { await loadProjectSwitch(); return st.projectOff === false; } };
})();
