// A fake AI provider for the tests: it answers like Anthropic's Messages API (/v1/messages, /v1/models) and like an OpenAI-compatible
// server (/chat/completions, /models), with answers the test scripts in advance. It records every request, so a test can check what
// the browser really sent (the key, the conversation, the tools). It only runs in the tests; nothing real is ever called.

export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; rawInput?: string };

export interface Reply {
  /** an HTTP error instead of an answer */
  status?: number;
  headers?: Record<string, string>;
  error?: string;
  /** Anthropic: the content blocks of the answer; OpenAI: `text` and `calls` */
  blocks?: Block[];
  text?: string;
  calls?: { id?: string; name: string; args: string; extra?: Record<string, unknown> }[];
  stop?: string;
  /** milliseconds between two events of the stream (to stop it in the middle) */
  slow?: number;
  /** end the stream without the closing events */
  cut?: boolean;
  usage?: { input?: number; output?: number; cached?: number };
}

export interface Recorded { method: string; path: string; headers: Record<string, string>; body: any }

export interface FakeAI {
  url: string;
  key: string;
  requests: Recorded[];
  queue(dialect: 'anthropic' | 'openai', ...replies: Reply[]): void;
  models: { anthropic: { id: string; display_name: string; max_tokens: number }[]; openai: { id: string }[] };
  stop(): void;
}

const CORS = (req: Request) => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') || '*',
  'Access-Control-Expose-Headers': 'Retry-After',
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const chunks = (s: string, n = 3) => { const size = Math.max(1, Math.ceil(s.length / n)); const out: string[] = []; for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size)); return out.length ? out : ['']; };

function anthropicEvents(r: Reply, model: string): object[] {
  const ev: object[] = [{ type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: r.usage?.input ?? 12, cache_read_input_tokens: r.usage?.cached ?? 0, cache_creation_input_tokens: 0 } } }];
  (r.blocks || []).forEach((b, index) => {
    if (b.type === 'text') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      for (const c of chunks(b.text)) ev.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: c } });
    } else if (b.type === 'thinking') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      for (const c of chunks(b.thinking)) ev.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: c } });
      ev.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature } });
    } else {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      for (const c of chunks(b.rawInput ?? JSON.stringify(b.input))) ev.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: c } });
    }
    ev.push({ type: 'ping' }, { type: 'content_block_stop', index });
  });
  if (!r.cut) {
    ev.push({ type: 'message_delta', delta: { stop_reason: r.stop ?? ((r.blocks || []).some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn') }, usage: { output_tokens: r.usage?.output ?? 7 } });
    ev.push({ type: 'message_stop' });
  }
  return ev;
}

function openaiEvents(r: Reply, model: string): (object | string)[] {
  const base = { id: 'chatcmpl-fake', object: 'chat.completion.chunk', model };
  const ev: (object | string)[] = [{ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }];
  for (const c of chunks(r.text || '')) if (c) ev.push({ ...base, choices: [{ index: 0, delta: { content: c }, finish_reason: null }] });
  (r.calls || []).forEach((call, index) => {
    const parts = chunks(call.args);
    ev.push({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index, ...(call.id === undefined ? {} : { id: call.id }), type: 'function', ...(call.extra || {}), function: { name: call.name, arguments: parts[0] } }] }, finish_reason: null }] });
    for (const c of parts.slice(1)) ev.push({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: c } }] }, finish_reason: null }] });
  });
  if (!r.cut) {
    ev.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: r.stop ?? ((r.calls || []).length ? 'tool_calls' : 'stop') }] });
    ev.push({ ...base, choices: [], usage: { prompt_tokens: r.usage?.input ?? 12, completion_tokens: r.usage?.output ?? 7, prompt_tokens_details: { cached_tokens: r.usage?.cached ?? 0 } } });
    ev.push('[DONE]');
  }
  return ev;
}

function stream(events: (object | string)[], slow: number, named: boolean, cors: Record<string, string>): Response {
  const enc = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream({
    async start(ctrl) {
      for (const e of events) {
        if (cancelled) return;
        const data = typeof e === 'string' ? e : JSON.stringify(e);
        const name = named && typeof e !== 'string' ? `event: ${(e as any).type}\n` : '';
        try { ctrl.enqueue(enc.encode(`${name}data: ${data}\n\n`)); } catch (_) { return; }
        if (slow) await sleep(slow);
      }
      try { ctrl.close(); } catch (_) {}
    },
    cancel() { cancelled = true; },
  });
  return new Response(body, { headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
}

export function startFakeAI(opt: { port?: number; key?: string } = {}): FakeAI {
  const key = opt.key ?? 'fake-ai-key-123';
  const queues: Record<string, Reply[]> = { anthropic: [], openai: [] };
  const requests: Recorded[] = [];
  const models = {
    anthropic: [{ id: 'claude-test-1', display_name: 'Claude Test 1', max_tokens: 64000 }, { id: 'claude-test-small', display_name: 'Claude Test Small', max_tokens: 8192 }],
    openai: [{ id: 'gpt-test-1' }, { id: 'models/gemini-test' }],
  };

  const server = Bun.serve({
    port: opt.port ?? 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const cors = CORS(req);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const url = new URL(req.url);
      const path = url.pathname;
      const anthropic = path.startsWith('/v1/');
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => { headers[k] = v; });
      let body: any = null;
      if (req.method === 'POST') { try { body = await req.json(); } catch (_) { body = null; } }
      requests.push({ method: req.method, path: path + url.search, headers, body });

      const json = (status: number, data: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });
      const fail = (status: number, message: string, extra: Record<string, string> = {}) =>
        anthropic ? json(status, { type: 'error', error: { type: status === 401 ? 'authentication_error' : 'invalid_request_error', message } }, extra) : json(status, { error: { message, type: 'invalid_request_error' } }, extra);

      const sent = anthropic ? headers['x-api-key'] : (headers['authorization'] || '').replace(/^Bearer /, '');
      // a real provider repeats part of a bad key in its message; the fake repeats all of it, to check that the browser hides it
      if (sent !== key) return fail(401, `invalid key ${sent}`);
      if (anthropic && headers['anthropic-dangerous-direct-browser-access'] !== 'true') return fail(400, 'browser access header missing');

      if (req.method === 'GET' && path === '/v1/models') return json(200, { data: models.anthropic, has_more: false, first_id: null, last_id: null });
      if (req.method === 'GET' && path.startsWith('/v1/models/')) {
        const m = models.anthropic.find(x => x.id === decodeURIComponent(path.slice('/v1/models/'.length)));
        return m ? json(200, m) : fail(404, 'model not found');
      }
      if (req.method === 'GET' && path === '/models') return json(200, { object: 'list', data: models.openai });

      const dialect = path === '/v1/messages' ? 'anthropic' : path === '/chat/completions' ? 'openai' : null;
      if (req.method !== 'POST' || !dialect) return fail(404, 'no such endpoint');
      const r = queues[dialect].shift();
      if (!r) return fail(500, 'the test queued no answer for this request');
      if (r.status) return fail(r.status, r.error || 'error', r.headers || {});
      const model = (body && body.model) || 'unknown';
      return dialect === 'anthropic' ? stream(anthropicEvents(r, model), r.slow || 0, true, cors) : stream(openaiEvents(r, model), r.slow || 0, false, cors);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    key,
    requests,
    models,
    queue(dialect, ...replies) { queues[dialect].push(...replies); },
    stop() { server.stop(true); },
  };
}
