import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, openProject, type Session } from '../helpers';
import { startFakeAI, type Block, type FakeAI } from '../../fake-ai/server';

// AI assistant, step 2 (docs/ai-assistant-plan.md): the two provider dialects, against a fake provider that answers what the test
// scripts and records what the browser sent. No real provider is called here; what only a real one proves (its CORS answer to a real
// request, its real stream) is checked by hand with a real key.

let ai: FakeAI;
let s: Session;
const toOrigin: string[] = []; // everything the page sent to the NeoLeaf server

const settings = (dialect: 'anthropic' | 'openai', over: Record<string, unknown> = {}) => ({ dialect, baseUrl: ai.url, key: ai.key, model: dialect === 'anthropic' ? 'claude-test-1' : 'gpt-test-1', name: 'T', ...over });
const TOOLS = [{ name: 'read_file', description: 'Reads a file', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } }];

/** Runs one or more turns in the page. `steps`: what to add to the conversation before each send. */
async function talk(st: any, steps: ({ user: string } | { results: { id: string; content: string; isError?: boolean }[] })[], opt: { system?: string; tools?: boolean; abortAfterFirstText?: boolean } = {}) {
  return s.page.evaluate(async ({ st, steps, opt, TOOLS }) => {
    const P = (window as any).AIProviders;
    const conv = P.newConversation(st);
    const out: any = { turns: [], waits: [], chunks: [] as string[] };
    try {
      for (const step of steps) {
        if (step.user !== undefined) P.addUser(conv, step.user); else P.addToolResults(conv, step.results);
        const ctl = new AbortController();
        out.turns.push(await P.send(st, conv, {
          system: opt.system, tools: opt.tools ? TOOLS : [], signal: ctl.signal,
          onText: (t: string) => { out.chunks.push(t); if (opt.abortAfterFirstText) ctl.abort(); },
          onWait: (w: number) => out.waits.push(w),
        }));
      }
    } catch (e: any) {
      out.error = { kind: e.kind, status: e.status, message: e.message, shown: P.describe(e), isAIError: e instanceof P.AIError };
    }
    out.messages = conv.messages;
    return out;
  }, { st, steps, opt, TOOLS } as any);
}

beforeAll(async () => {
  ai = startFakeAI();
  s = await newSession();
  s.page.on('request', r => { if (r.url().startsWith(BASE_URL)) toOrigin.push([r.url(), JSON.stringify(r.headers()), r.postData() || ''].join('\n')); });
  await openProject(s.page);
});
afterAll(async () => { await s.context.close(); ai.stop(); });

const last = () => ai.requests[ai.requests.length - 1];
const posts = () => ai.requests.filter(r => r.method === 'POST');

describe('AI providers: Anthropic dialect', () => {
  test('a text answer is streamed piece by piece, with the right headers and nothing the current API rejects', async () => {
    ai.queue('anthropic', { blocks: [{ type: 'text', text: 'Hello from the fake provider.' }], usage: { input: 100, cached: 40, output: 9 } });
    const r = await talk(settings('anthropic'), [{ user: 'hi' }], { system: 'You are a test.' });
    expect(r.error).toBeUndefined();
    expect(r.turns[0]).toEqual({ text: 'Hello from the fake provider.', toolCalls: [], stop: 'end', usage: { input: 140, output: 9, cached: 40 }, model: 'claude-test-1' });
    expect(r.chunks.length).toBeGreaterThan(1);
    expect(r.chunks.join('')).toBe('Hello from the fake provider.');
    const q = last();
    expect(q.path).toBe('/v1/messages');
    expect(q.headers['x-api-key']).toBe(ai.key);
    expect(q.headers['anthropic-version']).toBe('2026-10-21');
    expect(q.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(q.headers['cookie']).toBeUndefined();
    expect(q.headers['referer']).toBeUndefined();
    expect(q.body.stream).toBe(true);
    expect(q.body.system).toEqual([{ type: 'text', text: 'You are a test.', cache_control: { type: 'ephemeral' } }]);
    expect(q.body.cache_control).toEqual({ type: 'ephemeral' });
    expect(q.body.max_tokens).toBe(32000); // the model allows 64000; never more than 32000
    for (const gone of ['temperature', 'top_p', 'top_k', 'tool_choice', 'thinking']) expect(q.body[gone]).toBeUndefined();
    expect(q.body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    // the turn joined the conversation
    expect(r.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Hello from the fake provider.' }] });
  });

  test('the output ceiling follows what the provider says about the model', async () => {
    ai.queue('anthropic', { blocks: [{ type: 'text', text: 'ok' }] }, { blocks: [{ type: 'text', text: 'ok' }] });
    await talk(settings('anthropic', { model: 'claude-test-small' }), [{ user: 'hi' }]);
    expect(last().body.max_tokens).toBe(8192);
    await talk(settings('anthropic', { model: 'a-model-the-list-does-not-have' }), [{ user: 'hi' }]);
    expect(last().body.max_tokens).toBe(16000);
  });

  test('two tool calls in one turn: the assistant turn goes back unchanged, thinking included, and both results in one message', async () => {
    const blocks: Block[] = [
      { type: 'thinking', thinking: 'I should read two files before answering.', signature: 'sig-AbC123==' },
      { type: 'text', text: 'Let me look.' },
      { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'main.tex' } },
      { type: 'tool_use', id: 'toolu_2', name: 'read_file', input: { path: 'refs "quoted" \\ é.bib' } },
    ];
    ai.queue('anthropic', { blocks }, { blocks: [{ type: 'text', text: 'Done.' }] });
    const r = await talk(settings('anthropic'), [{ user: 'check the files' }, { results: [{ id: 'toolu_1', content: 'file one' }, { id: 'toolu_2', content: 'no such file', isError: true }] }], { tools: true });
    expect(r.error).toBeUndefined();
    expect(r.turns[0].stop).toBe('tools');
    expect(r.turns[0].text).toBe('Let me look.');
    expect(r.turns[0].toolCalls).toEqual([
      { id: 'toolu_1', name: 'read_file', input: { path: 'main.tex' }, invalid: false },
      { id: 'toolu_2', name: 'read_file', input: { path: 'refs "quoted" \\ é.bib' }, invalid: false },
    ]);
    expect(r.turns[1]).toMatchObject({ text: 'Done.', stop: 'end' });
    const q = last();
    expect(q.body.tools).toEqual([{ name: 'read_file', description: 'Reads a file', input_schema: TOOLS[0].schema }]);
    expect(q.body.messages.length).toBe(3);
    // exactly what the provider sent, block by block and byte by byte
    expect(JSON.stringify(q.body.messages[1])).toBe(JSON.stringify({ role: 'assistant', content: blocks }));
    expect(q.body.messages[2]).toEqual({ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file one' },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: 'no such file', is_error: true },
    ] });
  });

  test('a tool call whose arguments are not valid JSON is marked, not run with made-up arguments', async () => {
    ai.queue('anthropic', { blocks: [{ type: 'tool_use', id: 'toolu_x', name: 'read_file', input: {}, rawInput: '{"path": "main' }] });
    const r = await talk(settings('anthropic'), [{ user: 'x' }], { tools: true });
    expect(r.turns[0].toolCalls).toEqual([{ id: 'toolu_x', name: 'read_file', input: {}, invalid: true }]);
  });

  test('a refusal and an answer cut by the output limit are reported and do not join the conversation', async () => {
    ai.queue('anthropic', { blocks: [], stop: 'refusal' }, { blocks: [{ type: 'text', text: 'half an ans' }], stop: 'max_tokens' }, { blocks: [], stop: 'pause_turn' });
    const a = await talk(settings('anthropic'), [{ user: 'x' }]);
    expect(a.turns[0].stop).toBe('refusal');
    expect(a.messages.length).toBe(1);
    const b = await talk(settings('anthropic'), [{ user: 'x' }]);
    expect(b.turns[0]).toMatchObject({ stop: 'max_tokens', text: 'half an ans' });
    expect(b.messages.length).toBe(1);
    expect((await talk(settings('anthropic'), [{ user: 'x' }])).turns[0].stop).toBe('pause');
  });

  test('a busy provider is waited for as long as it asks, then the request is sent again', async () => {
    const before = posts().length;
    ai.queue('anthropic', { status: 429, error: 'slow down', headers: { 'Retry-After': '1' } }, { status: 529, error: 'overloaded', headers: { 'Retry-After': '1' } }, { blocks: [{ type: 'text', text: 'now it works' }] });
    const r = await talk(settings('anthropic'), [{ user: 'x' }]);
    expect(r.error).toBeUndefined();
    expect(r.turns[0].text).toBe('now it works');
    expect(r.waits).toEqual([1, 1]);
    expect(posts().length - before).toBe(3);
  });

  test('it gives up after two retries', async () => {
    ai.queue('anthropic', ...[1, 2, 3].map(() => ({ status: 429, error: 'slow down', headers: { 'Retry-After': '0.2' } })));
    const r = await talk(settings('anthropic'), [{ user: 'x' }]);
    expect(r.error).toMatchObject({ kind: 'busy', status: 429, isAIError: true });
    expect(r.waits.length).toBe(2);
  });

  test('a refused key is explained, and the key never appears in the message', async () => {
    const r = await talk(settings('anthropic', { key: 'sk-WRONG-key-987654321' }), [{ user: 'x' }]);
    expect(r.error).toMatchObject({ kind: 'auth', status: 401 });
    expect(r.error.message).toContain('***');
    expect(r.error.message).not.toContain('sk-WRONG-key-987654321');
    expect(r.error.shown).toContain('refused the key');
  });

  test('other refusals carry the provider\'s own words; an unknown address is a connection problem', async () => {
    ai.queue('anthropic', { status: 400, error: 'messages: roles must alternate' }, { status: 402, error: 'no credit' }, { status: 404, error: 'model: nope' }, { status: 500, error: 'boom' }, { status: 500, error: 'boom' }, { status: 500, error: 'boom' });
    expect((await talk(settings('anthropic'), [{ user: 'x' }])).error).toMatchObject({ kind: 'request', shown: 'The provider refused the request: messages: roles must alternate' });
    expect((await talk(settings('anthropic'), [{ user: 'x' }])).error.kind).toBe('billing');
    expect((await talk(settings('anthropic'), [{ user: 'x' }])).error.kind).toBe('model');
    expect((await talk(settings('anthropic'), [{ user: 'x' }])).error).toMatchObject({ kind: 'server', status: 500 });
    const dead = await talk(settings('anthropic', { baseUrl: 'http://127.0.0.1:9' }), [{ user: 'x' }]);
    expect(dead.error.kind).toBe('network');
  });

  test('stopping in the middle of a stream ends the request, and a stream that ends early is an error, not an answer', async () => {
    ai.queue('anthropic', { blocks: [{ type: 'text', text: 'one two three four five six' }], slow: 150 });
    const r = await talk(settings('anthropic'), [{ user: 'x' }], { abortAfterFirstText: true });
    expect(r.error).toMatchObject({ kind: 'aborted', shown: 'Stopped.' });
    expect(r.chunks.length).toBe(1);
    expect(r.messages.length).toBe(1);
    ai.queue('anthropic', { blocks: [{ type: 'text', text: 'this never ends' }], cut: true });
    const c = await talk(settings('anthropic'), [{ user: 'x' }]);
    expect(c.error.kind).toBe('stream');
    expect(c.messages.length).toBe(1);
  });

  test('the model list comes from the provider', async () => {
    const list = await s.page.evaluate(st => (window as any).AIProviders.listModels(st), settings('anthropic'));
    expect(list).toEqual([{ id: 'claude-test-1', label: 'Claude Test 1' }, { id: 'claude-test-small', label: 'Claude Test Small' }]);
  });
});

describe('AI providers: OpenAI-compatible dialect', () => {
  test('a text answer is streamed, the system prompt goes first and the key in the Authorization header', async () => {
    ai.queue('openai', { text: 'Hello from the compatible one.', usage: { input: 50, cached: 10, output: 6 } });
    const r = await talk(settings('openai'), [{ user: 'hi' }], { system: 'You are a test.' });
    expect(r.error).toBeUndefined();
    expect(r.turns[0]).toEqual({ text: 'Hello from the compatible one.', toolCalls: [], stop: 'end', usage: { input: 50, output: 6, cached: 10 }, model: 'gpt-test-1' });
    expect(r.chunks.join('')).toBe('Hello from the compatible one.');
    const q = last();
    expect(q.path).toBe('/chat/completions');
    expect(q.headers['authorization']).toBe('Bearer ' + ai.key);
    expect(q.headers['x-api-key']).toBeUndefined();
    expect(q.body.messages).toEqual([{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'hi' }]);
    expect(q.body.stream_options).toEqual({ include_usage: true });
    expect(q.body.temperature).toBeUndefined();
    // the system prompt is added when sending; it is not part of the stored conversation
    expect(r.messages).toEqual([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello from the compatible one.' }]);
  });

  test('tool calls: arguments are joined from the pieces, extra fields go back as they came, a missing id gets one, each result is its own message', async () => {
    ai.queue('openai', { calls: [
      { id: 'call_a', name: 'read_file', args: '{"path":"main.tex"}', extra: { extra_content: { google: { thought_signature: 'SIG==' } } } },
      { name: 'read_file', args: '{"path":"b.tex"}' },
    ] });
    const first = await talk(settings('openai'), [{ user: 'check' }], { tools: true });
    const calls = first.turns[0].toolCalls;
    expect(first.turns[0].stop).toBe('tools');
    expect(calls[0]).toEqual({ id: 'call_a', name: 'read_file', input: { path: 'main.tex' }, invalid: false });
    expect(calls[1]).toMatchObject({ name: 'read_file', input: { path: 'b.tex' }, invalid: false });
    expect(calls[1].id).toMatch(/^call_1_/);
    expect(first.messages[1]).toEqual({ role: 'assistant', content: null, tool_calls: [
      { id: 'call_a', type: 'function', extra_content: { google: { thought_signature: 'SIG==' } }, function: { name: 'read_file', arguments: '{"path":"main.tex"}' } },
      { id: calls[1].id, type: 'function', function: { name: 'read_file', arguments: '{"path":"b.tex"}' } },
    ] });
    expect(last().body.tools).toEqual([{ type: 'function', function: { name: 'read_file', description: 'Reads a file', parameters: TOOLS[0].schema } }]);

    // the whole round trip in one conversation
    ai.queue('openai', { calls: [{ id: 'call_z', name: 'read_file', args: '{"path":"z.tex"}' }] }, { text: 'Done.' });
    const r = await talk(settings('openai'), [{ user: 'check' }, { results: [{ id: 'call_z', content: 'zzz' }] }], { tools: true });
    expect(r.turns[1].text).toBe('Done.');
    expect(last().body.messages.slice(-2)).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_z', type: 'function', function: { name: 'read_file', arguments: '{"path":"z.tex"}' } }] },
      { role: 'tool', tool_call_id: 'call_z', content: 'zzz' },
    ]);
  });

  test('a server that does not know stream_options is asked again without it', async () => {
    const before = posts().length;
    ai.queue('openai', { status: 400, error: 'Unknown parameter: stream_options' }, { text: 'fine' });
    const r = await talk(settings('openai'), [{ user: 'x' }]);
    expect(r.turns[0].text).toBe('fine');
    expect(posts().length - before).toBe(2);
    expect(last().body.stream_options).toBeUndefined();
  });

  test('the output limit and a content filter are reported; a refused key too', async () => {
    ai.queue('openai', { text: 'half', stop: 'length' }, { text: '', stop: 'content_filter' });
    expect((await talk(settings('openai'), [{ user: 'x' }])).turns[0].stop).toBe('max_tokens');
    expect((await talk(settings('openai'), [{ user: 'x' }])).turns[0].stop).toBe('refusal');
    expect((await talk(settings('openai', { key: 'nope' }), [{ user: 'x' }])).error.kind).toBe('auth');
  });

  test('the model list comes from the provider (Gemini\'s "models/" prefix is dropped)', async () => {
    const list = await s.page.evaluate(st => (window as any).AIProviders.listModels(st), settings('openai'));
    expect(list.map((m: any) => m.id)).toEqual(['gpt-test-1', 'gemini-test']);
  });

  test('a conversation is not sent to another kind of provider', async () => {
    const r = await s.page.evaluate(async ({ a, o }) => {
      const P = (window as any).AIProviders;
      const conv = P.newConversation(a);
      P.addUser(conv, 'x');
      try { await P.send(o, conv, {}); return 'sent'; } catch (e: any) { return e.kind; }
    }, { a: settings('anthropic'), o: settings('openai') });
    expect(r).toBe('request');
  });
});

describe('AI providers: in the settings', () => {
  test('"List the models" fills the choices from the provider, and "Test the connection" shows its answer', async () => {
    await s.page.click('#tab-ai-btn');
    await s.page.click('#ai-consent');
    await s.page.selectOption('#ai-provider', 'custom');
    await s.page.fill('#ai-url', ai.url);
    await s.page.click('#ai-models-btn');
    expect(await s.page.locator('#ai-models-msg').innerText()).toContain('API key');
    await s.page.fill('#ai-key', 'a-wrong-key');
    await s.page.click('#ai-models-btn');
    await s.page.waitForFunction(() => (document.getElementById('ai-models-msg')?.textContent || '').includes('refused the key'));
    await s.page.fill('#ai-key', ai.key);
    await s.page.click('#ai-models-btn');
    await s.page.waitForFunction(() => (document.getElementById('ai-models-msg')?.textContent || '').startsWith('2 models found'));
    expect(await s.page.locator('#ai-model-list option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value))).toEqual(['gpt-test-1', 'gemini-test']);
    await s.page.fill('#ai-model', 'gpt-test-1');
    await s.page.click('#ai-save');
    await s.page.waitForSelector('#ai-ready');
    ai.queue('openai', { text: 'ok' });
    await s.page.click('#ai-test');
    await s.page.waitForFunction(() => (document.getElementById('ai-test-out')?.textContent || '').includes('The provider answered: ok'));
    expect(last().body.messages).toEqual([{ role: 'user', content: 'Reply with the single word: ok' }]);
    ai.queue('openai', { status: 402, error: 'no credit' });
    await s.page.click('#ai-test');
    await s.page.waitForFunction(() => (document.getElementById('ai-test-out')?.textContent || '').includes('billing'));
  });

  test('the key and the questions went to the provider only, never to the NeoLeaf server', () => {
    expect(ai.requests.length).toBeGreaterThan(20);
    expect(toOrigin.filter(r => r.includes(ai.key) || r.includes('check the files') || r.includes('Reply with the single word'))).toEqual([]);
  });

  test('no unhandled console errors', () => {
    expect(s.errors).toEqual([]);
  });
});
