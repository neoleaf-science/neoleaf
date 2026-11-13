// AI assistant, the providers (docs/ai-assistant-plan.md). Two dialects cover almost every provider: Anthropic's Messages API and the
// OpenAI-compatible chat completions (OpenAI, OpenRouter, Gemini's compatible endpoint, local servers). Every request here goes from
// this browser straight to the address in the person's settings, with the person's own key; nothing goes through the NeoLeaf server.
// Plain `fetch` on purpose: the editor has no bundler, so there is no SDK to lean on.
//
// A conversation is kept in the provider's own message format (`conv.messages`) and is append only: the assistant's turn is stored
// exactly as it arrived (every block, thinking included) and sent back unchanged, which the current Anthropic models require.
// Depends on globals: T().
(function () {
  const ANTHROPIC_VERSION = '2026-10-21';
  const RETRY_STATUS = [429, 500, 502, 503, 504, 529];
  const MAX_RETRIES = 2;
  const MAX_WAIT_S = 20;

  /** kind: auth | billing | model | busy | network | request | server | aborted | stream */
  class AIError extends Error {
    constructor(kind, message, status) { super(message || kind); this.name = 'AIError'; this.kind = kind; this.status = status || 0; }
  }

  // the key must never show up in a message, even if a server echoes it back
  const scrub = (text, s) => (s && s.key ? String(text).split(s.key).join('***') : String(text)).slice(0, 600);

  function describe(e) {
    if (!(e instanceof AIError)) return (e && e.message) || String(e);
    switch (e.kind) {
      case 'auth': return T('The provider refused the key. Check that it was pasted whole and is still valid.');
      case 'billing': return T('The provider reports a billing problem or no credit on your account.');
      case 'model': return T('The provider does not know this model, or your account cannot use it.');
      case 'busy': return T('The provider is busy or limiting requests. Try again in a moment.');
      case 'network': return T('Could not reach the provider. Check your connection and the server address.');
      case 'server': return T('The provider had an internal error ({0}). Try again.', e.status);
      case 'aborted': return T('Stopped.');
      case 'stream': return T('The answer was cut off before it ended. Try again.');
      default: return T('The provider refused the request: {0}', e.message);
    }
  }

  // ------------------------------------------------------------ HTTP
  function headersFor(s, json) {
    const hd = json ? { 'Content-Type': 'application/json' } : {};
    if (s.dialect === 'anthropic') {
      hd['x-api-key'] = s.key;
      hd['anthropic-version'] = ANTHROPIC_VERSION;
      hd['anthropic-dangerous-direct-browser-access'] = 'true';   // Anthropic's opt-in for calls made from a browser with the person's own key
    } else {
      hd.Authorization = 'Bearer ' + s.key;
    }
    return hd;
  }

  const sleep = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new AIError('aborted')); }, { once: true });
  });

  async function errorOf(res, s) {
    let msg = '';
    try {
      const body = await res.text();
      try { const j = JSON.parse(body); msg = (j.error && (j.error.message || j.error)) || j.message || body; } catch (_) { msg = body; }
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch (_) {}
    msg = scrub(msg || res.statusText || '', s);
    const st = res.status;
    const kind = st === 401 || st === 403 ? 'auth' : st === 402 ? 'billing' : st === 404 ? 'model' : st === 429 || st === 529 ? 'busy' : st >= 500 ? 'server' : 'request';
    return new AIError(kind, msg, st);
  }

  /** fetch with the provider's headers; waits and tries again when the provider is busy (it says for how long in Retry-After). */
  async function call(s, path, init, opt) {
    const signal = opt && opt.signal;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(s.baseUrl + path, { ...init, headers: headersFor(s, !!init.body), signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      } catch (e) {
        if (signal && signal.aborted) throw new AIError('aborted');
        throw new AIError('network', scrub((e && e.message) || e, s));
      }
      if (res.ok) return res;
      const err = await errorOf(res, s);
      if (!RETRY_STATUS.includes(res.status) || attempt >= MAX_RETRIES) throw err;
      const ra = parseFloat(res.headers.get('retry-after'));
      const wait = Math.min(MAX_WAIT_S, ra > 0 ? ra : 2 * (attempt + 1));
      if (opt && opt.onWait) opt.onWait(wait);
      await sleep(wait * 1000, signal);
    }
  }

  /** Reads a server-sent event stream, calling `onData` with the text of each `data:` field. */
  async function sse(res, s, signal, onData) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const flush = chunk => {
      for (const line of chunk.split(/\r?\n/)) if (line.startsWith('data:')) onData(line.slice(5).trim());
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
          flush(chunk);
        }
      }
      if (buf.trim()) flush(buf);
    } catch (e) {
      if (e instanceof AIError) throw e;
      if (signal && signal.aborted) throw new AIError('aborted');
      throw new AIError('stream', scrub((e && e.message) || e, s));
    }
  }

  const parseJson = text => { try { return { ok: true, value: JSON.parse(text) }; } catch (_) { return { ok: false, value: null }; } };
  const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

  // ------------------------------------------------------------ models
  const caps = {};   // Anthropic: the output ceiling of each model, as the provider reports it

  async function listModels(s, opt) {
    const out = [];
    if (s.dialect === 'anthropic') {
      let after = '';
      for (let page = 0; page < 10; page++) {
        const j = await (await call(s, '/v1/models?limit=1000' + (after ? '&after_id=' + encodeURIComponent(after) : ''), { method: 'GET' }, opt)).json();
        for (const m of j.data || []) if (m && typeof m.id === 'string') { out.push({ id: m.id, label: m.display_name || m.id }); if (m.max_tokens > 0) caps[s.baseUrl + '|' + m.id] = m.max_tokens; }
        if (!j.has_more || !j.last_id) break;
        after = j.last_id;
      }
    } else {
      const j = await (await call(s, '/models', { method: 'GET' }, opt)).json();
      for (const m of j.data || []) if (m && typeof m.id === 'string') out.push({ id: m.id.replace(/^models\//, ''), label: m.id.replace(/^models\//, '') });
    }
    return out;
  }

  /** How many output tokens to allow: the model's own ceiling when the provider tells it, never more than 32000. */
  async function outputCap(s, opt) {
    const k = s.baseUrl + '|' + s.model;
    if (!(k in caps)) {
      caps[k] = 0;
      try {
        const j = await (await call(s, '/v1/models/' + encodeURIComponent(s.model), { method: 'GET' }, opt)).json();
        if (j.max_tokens > 0) caps[k] = j.max_tokens;
      } catch (e) { if (e.kind === 'aborted') throw e; }
    }
    return caps[k] ? Math.min(32000, caps[k]) : 16000;
  }

  // ------------------------------------------------------------ conversation (append only)
  const newConversation = s => ({ dialect: s.dialect, messages: [] });

  function addUser(conv, text) {
    const last = conv.messages[conv.messages.length - 1];
    // Anthropic wants the roles to alternate: a question that follows tool answers (a question that was stopped half way) joins
    // that same, still unanswered, message instead of starting a second one
    if (conv.dialect === 'anthropic' && last && last.role === 'user') {
      if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content }];
      last.content.push({ type: 'text', text });
    } else conv.messages.push({ role: 'user', content: text });
  }

  /** results: [{ id, content, isError }]. Every tool call of the turn gets its result, all in one go. */
  function addToolResults(conv, results) {
    if (conv.dialect === 'anthropic') {
      conv.messages.push({ role: 'user', content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: String(r.content), ...(r.isError ? { is_error: true } : {}) })) });
    } else {
      for (const r of results) conv.messages.push({ role: 'tool', tool_call_id: r.id, content: String(r.content) });
    }
  }

  // ------------------------------------------------------------ Anthropic
  const ANTHROPIC_STOP = { end_turn: 'end', stop_sequence: 'end', tool_use: 'tools', max_tokens: 'max_tokens', refusal: 'refusal', pause_turn: 'pause', model_context_window_exceeded: 'context' };

  async function sendAnthropic(s, conv, o) {
    const body = { model: s.model, max_tokens: await outputCap(s, o), stream: true, messages: conv.messages, cache_control: { type: 'ephemeral' } };
    // the system prompt and the tools are the same in every step of a question: marked so the provider bills them as a cache read
    if (o.system) body.system = [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }];
    if (o.tools && o.tools.length) body.tools = o.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.schema }));
    const res = await call(s, '/v1/messages', { method: 'POST', body: JSON.stringify(body) }, o);

    const blocks = [], json = {}, invalid = {};
    let stop = null, model = s.model;
    const usage = { input: 0, output: 0, cached: 0 };
    await sse(res, s, o.signal, data => {
      const p = parseJson(data);
      if (!p.ok || !isObject(p.value)) return;
      const ev = p.value;
      if (ev.type === 'message_start' && ev.message) {
        model = ev.message.model || model;
        const u = ev.message.usage || {};
        usage.cached = u.cache_read_input_tokens || 0;
        usage.input = (u.input_tokens || 0) + usage.cached + (u.cache_creation_input_tokens || 0);
      } else if (ev.type === 'content_block_start' && isObject(ev.content_block)) {
        blocks[ev.index] = JSON.parse(JSON.stringify(ev.content_block));
        if (ev.content_block.type === 'tool_use') json[ev.index] = '';
      } else if (ev.type === 'content_block_delta' && blocks[ev.index] && isObject(ev.delta)) {
        const b = blocks[ev.index], d = ev.delta;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; if (o.onText) o.onText(d.text); }
        else if (d.type === 'input_json_delta') json[ev.index] += d.partial_json || '';
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') b.signature = d.signature;
        else if (d.type === 'citations_delta') (b.citations = b.citations || []).push(d.citation);
      } else if (ev.type === 'content_block_stop' && blocks[ev.index] && blocks[ev.index].type === 'tool_use') {
        const parsed = json[ev.index] ? parseJson(json[ev.index]) : { ok: true, value: {} };
        if (parsed.ok && isObject(parsed.value)) blocks[ev.index].input = parsed.value;
        else { blocks[ev.index].input = {}; invalid[ev.index] = true; }
      } else if (ev.type === 'message_delta') {
        if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
        if (ev.usage && ev.usage.output_tokens) usage.output = ev.usage.output_tokens;
      } else if (ev.type === 'error') {
        const er = ev.error || {};
        throw new AIError(er.type === 'overloaded_error' || er.type === 'rate_limit_error' ? 'busy' : 'server', scrub(er.message || er.type || '', s), 0);
      }
    });
    if (!stop) throw new AIError('stream');

    const content = blocks.filter(Boolean);
    const turn = {
      text: content.filter(b => b.type === 'text').map(b => b.text).join(''),
      toolCalls: content.map((b, i) => (b.type === 'tool_use' ? { id: b.id, name: b.name, input: b.input, invalid: !!invalid[blocks.indexOf(b)] } : null)).filter(Boolean),
      stop: ANTHROPIC_STOP[stop] || 'end', usage, model,
    };
    // only a turn that ended properly joins the conversation: a cut or refused one would leave tool calls without results
    if ((turn.stop === 'end' || turn.stop === 'tools' || turn.stop === 'pause') && content.length) conv.messages.push({ role: 'assistant', content });
    return turn;
  }

  // ------------------------------------------------------------ OpenAI-compatible
  const OPENAI_STOP = { stop: 'end', tool_calls: 'tools', function_call: 'tools', length: 'max_tokens', content_filter: 'refusal' };

  async function sendOpenAI(s, conv, o) {
    const body = { model: s.model, stream: true, stream_options: { include_usage: true }, messages: (o.system ? [{ role: 'system', content: o.system }] : []).concat(conv.messages) };
    if (o.tools && o.tools.length) body.tools = o.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
    let res;
    try {
      res = await call(s, '/chat/completions', { method: 'POST', body: JSON.stringify(body) }, o);
    } catch (e) {
      // some compatible servers do not know `stream_options`: the usage numbers are then simply not reported
      if (!(e instanceof AIError) || e.kind !== 'request' || !/stream_options/i.test(e.message)) throw e;
      delete body.stream_options;
      res = await call(s, '/chat/completions', { method: 'POST', body: JSON.stringify(body) }, o);
    }

    let text = '', stop = null, model = s.model, ended = false;
    const calls = [];
    const usage = { input: 0, output: 0, cached: 0 };
    await sse(res, s, o.signal, data => {
      if (data === '[DONE]') { ended = true; return; }
      const p = parseJson(data);
      if (!p.ok || !isObject(p.value)) return;
      const ev = p.value;
      if (ev.error) throw new AIError('server', scrub(ev.error.message || JSON.stringify(ev.error), s), 0);
      if (ev.model) model = ev.model;
      if (ev.usage) {
        usage.input = ev.usage.prompt_tokens || 0;
        usage.output = ev.usage.completion_tokens || 0;
        usage.cached = (ev.usage.prompt_tokens_details && ev.usage.prompt_tokens_details.cached_tokens) || 0;
      }
      const ch = ev.choices && ev.choices[0];
      if (!ch) return;
      const d = ch.delta || {};
      if (typeof d.content === 'string' && d.content) { text += d.content; if (o.onText) o.onText(d.content); }
      for (const tc of d.tool_calls || []) {
        const i = Number.isInteger(tc.index) ? tc.index : calls.length ? calls.length - 1 : 0;
        // fields the provider adds to a tool call (Gemini's thought signature, for one) are kept and sent back as they came
        const c = calls[i] || (calls[i] = { ...tc, type: 'function', function: { name: '', arguments: '' } });
        delete c.index;
        if (tc.id) c.id = tc.id;
        if (tc.function) {
          if (tc.function.name) c.function.name += tc.function.name;
          if (typeof tc.function.arguments === 'string') c.function.arguments += tc.function.arguments;
        }
      }
      if (ch.finish_reason) stop = ch.finish_reason;
    });
    if (!stop && !ended) throw new AIError('stream');

    const toolCalls = calls.filter(Boolean);
    toolCalls.forEach((c, i) => { if (!c.id) c.id = 'call_' + i + '_' + Math.random().toString(36).slice(2, 10); });
    const turn = {
      text,
      toolCalls: toolCalls.map(c => {
        const parsed = c.function.arguments ? parseJson(c.function.arguments) : { ok: true, value: {} };
        const good = parsed.ok && isObject(parsed.value);
        return { id: c.id, name: c.function.name, input: good ? parsed.value : {}, invalid: !good };
      }),
      stop: toolCalls.length ? 'tools' : OPENAI_STOP[stop] || 'end', usage, model,
    };
    if (turn.stop === 'end' || turn.stop === 'tools') {
      const msg = { role: 'assistant', content: text || null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      conv.messages.push(msg);
    }
    return turn;
  }

  /**
   * One turn of the model. `conv` (from newConversation) gains the assistant's turn when it ended properly.
   * o: { system, tools: [{ name, description, schema }], signal, onText(text), onWait(seconds) }
   * Returns { text, toolCalls: [{ id, name, input, invalid }], stop: end | tools | max_tokens | refusal | pause | context, usage, model }.
   */
  function send(s, conv, o) {
    if (conv.dialect !== s.dialect) return Promise.reject(new AIError('request', 'The conversation belongs to another kind of provider'));
    return s.dialect === 'anthropic' ? sendAnthropic(s, conv, o || {}) : sendOpenAI(s, conv, o || {});
  }

  window.AIProviders = { AIError, describe, listModels, newConversation, addUser, addToolResults, send };
})();
