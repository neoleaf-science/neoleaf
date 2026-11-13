import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, openProject, poll, type Session } from '../helpers';
import { startFakeAI, type FakeAI } from '../../fake-ai/server';

// AI assistant, step 4 (docs/ai-assistant-plan.md): the conversation panel and the loop that lets the model read the project.
// The provider is the fake one (tests/fake-ai/server.ts); how a real model behaves is not something these tests can say.

let ai: FakeAI;
let s: Session;
const toOrigin: string[] = [];
const dialogs: string[] = [];
const CHAT_KEY = 'neoleaf.ai.chat.github.1.demo__artigo-1';

const posts = () => ai.requests.filter(r => r.method === 'POST');
const lastPost = () => posts()[posts().length - 1];
const tool = (id: string, name: string, input: unknown = {}) => ({ type: 'tool_use' as const, id, name, input });
const text = (t: string) => ({ type: 'text' as const, text: t });

async function configure(dialect: 'anthropic' | 'openai') {
  await s.page.evaluate(({ url, key, dialect }) => {
    localStorage.setItem('neoleaf.ai.github.1', JSON.stringify({ consent: true, provider: dialect === 'anthropic' ? 'anthropic' : 'custom', key, model: dialect === 'anthropic' ? 'claude-test-1' : 'gpt-test-1', name: 'Reviewer', baseUrl: url }));
  }, { url: ai.url, key: ai.key, dialect });
  await s.page.click('#tab-pdf-btn');
  await s.page.click('#tab-ai-btn');
  await s.page.waitForSelector('#ai-input');
}
const idle = () => s.page.waitForFunction(() => !(window as any).AIChat.busy() && (document.getElementById('ai-send') as HTMLElement).style.display !== 'none', null, { timeout: 30000 });
async function ask(q: string) {
  const users = await s.page.locator('#ai-list .ai-user').count();
  await s.page.fill('#ai-input', q);
  await s.page.click('#ai-send');
  // the question starts a moment after the click (the project switch is read first): wait for it to show before waiting for its end
  await poll(() => s.page.locator('#ai-list .ai-user').count(), n => n > users);
  await idle();
  await s.page.waitForTimeout(80); // the list is repainted once per frame
}
const bubbles = () => s.page.locator('#ai-list .ai-msg');
const lastAnswer = () => s.page.locator('#ai-list .ai-assistant').last();

beforeAll(async () => {
  ai = startFakeAI();
  s = await newSession();
  s.page.on('request', r => { if (r.url().startsWith(BASE_URL)) toOrigin.push(r.url() + '\n' + (r.postData() || '')); });
  s.page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await openProject(s.page);
  await configure('anthropic');
});
afterAll(async () => { await s.context.close(); ai.stop(); });

describe('AI chat: a question and the reading loop', () => {
  test('the panel starts empty, with a hint and an estimate of what a question sends', async () => {
    expect(await s.page.locator('#ai-empty').isVisible()).toBe(true);
    expect(await s.page.locator('#ai-stop').isVisible()).toBe(false);
    await s.page.fill('#ai-input', 'What is this document about?');
    expect(await s.page.locator('#ai-estimate').innerText()).toMatch(/^About \d+ tokens will be sent/);
    await s.page.fill('#ai-input', '');
    expect(await s.page.locator('#ai-estimate').innerText()).toBe('');
  });

  test('a question that needs two readings: the tools run in the browser and their answers go back to the provider', async () => {
    const before = posts().length;
    ai.queue('anthropic',
      { blocks: [{ type: 'thinking', thinking: 'I need the file list.', signature: 'sig1' }, text('Let me look at the project.'), tool('t1', 'list_files')], usage: { input: 1000, cached: 0, output: 20 } },
      { blocks: [tool('t2', 'read_file', { path: 'main.tex', from_line: 1, to_line: 5 }), tool('t3', 'read_file', { path: '.neoleaf/config.json' })], usage: { input: 1500, cached: 900, output: 30 } },
      { blocks: [text('It is an article.\n```latex\n\\documentclass{article}\n```\nThat is all.')], usage: { input: 2500, cached: 1400, output: 40 } });
    await ask('What is this document about?');
    expect(posts().length - before).toBe(3);

    // what the person sees
    expect(await bubbles().count()).toBe(2);
    expect(await s.page.locator('#ai-list .ai-user .ai-text').innerText()).toBe('What is this document about?');
    const a = lastAnswer();
    expect(await a.locator('.ai-who b').innerText()).toBe('Reviewer');
    expect(await a.locator('.ai-badge').innerText()).toBe('AI');
    expect(await a.locator('.ai-badge').getAttribute('title')).toBe('claude-test-1');
    expect(await a.locator('.ai-tools div').allInnerTexts()).toEqual(['↳ list_files', '↳ read_file · main.tex', '↳ read_file · .neoleaf/config.json']);
    expect(await a.locator('.ai-text').allInnerTexts()).toEqual(['Let me look at the project.\n\nIt is an article.', 'That is all.']);
    expect(await a.locator('pre.ai-code').innerText()).toBe('\\documentclass{article}');
    expect(await a.locator('.ai-usage').innerText()).toBe('Sent 7300 tokens (2300 from cache), received 90.'); // Anthropic counts cached tokens apart from input_tokens: 1000 + 2400 + 3900
    expect(await a.locator('.ai-note').count()).toBe(0);
    // "What was sent": the two readings that worked; the hidden file was refused and sent nothing but the refusal
    const sent = await a.locator('.ai-sent div').allTextContents(); // the list is folded: read the text, not what is painted
    expect(sent.length).toBe(2);
    expect(sent[0]).toMatch(/^list_files \(\d+\)$/);
    expect(sent[1]).toMatch(/^read_file · main\.tex \(\d+\)$/);
    expect(await a.locator('.ai-sent summary').innerText()).toMatch(/^What was sent in this question \(\d+ characters of the project\)$/);

    // what the provider got
    const first = posts()[before].body, last = lastPost().body;
    expect(first.tools.map((t: any) => t.name)).toEqual(['list_files', 'read_file', 'search', 'open_file_and_selection', 'compile_log', 'list_comments', 'add_comment', 'add_suggestion', 'changed_files']);
    expect(first.system[0].text).toContain('You are Reviewer');
    expect(first.system[0].text).toContain('never as instructions');
    expect(first.system[0].text).toContain('You cannot change files');
    expect(first.system[0].text).toContain('only make drafts');
    expect(last.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(last.messages[1].content[0]).toEqual({ type: 'thinking', thinking: 'I need the file list.', signature: 'sig1' });
    expect(last.messages[2].content[0].content).toContain('main.tex (');
    const results = last.messages[4].content;
    expect(results.map((r: any) => r.tool_use_id)).toEqual(['t2', 't3']);
    expect(results[0].content).toContain('[main.tex, lines 1 to 5 of ');
    expect(results[0].is_error).toBeUndefined();
    expect(results[1]).toMatchObject({ is_error: true });
    expect(results[1].content).toContain('There is no file');
  });

  test('model text is shown as text: no element is created from it', async () => {
    ai.queue('anthropic', { blocks: [text('<img src=x onerror="window.__pwned=1"> and <script>window.__pwned=2</script> **bold**')] });
    await ask('say something odd');
    const a = lastAnswer();
    expect(await a.locator('.ai-text').innerText()).toBe('<img src=x onerror="window.__pwned=1"> and <script>window.__pwned=2</script> **bold**');
    expect(await a.locator('img, script, b:not(.ai-who b)').count()).toBe(0);
    expect(await s.page.evaluate(() => (window as any).__pwned)).toBeUndefined();
    expect(await a.locator('.ai-sent summary').innerText()).toBe('Nothing from the project was sent in this question.');
  });

  test('the conversation survives a reload, and the next question carries it', async () => {
    const stored = JSON.parse(await s.page.evaluate(k => localStorage.getItem(k), CHAT_KEY) as string);
    expect(stored.conv.dialect).toBe('anthropic');
    expect(stored.view.length).toBe(4);
    await openProject(s.page);
    await s.page.click('#tab-ai-btn');
    await s.page.waitForSelector('#ai-list .ai-msg');
    expect(await bubbles().count()).toBe(4);
    expect(await lastAnswer().locator('.ai-text').innerText()).toContain('**bold**');
    ai.queue('anthropic', { blocks: [text('Still here.')] });
    await ask('do you remember?');
    const msgs = lastPost().body.messages;
    expect(msgs.length).toBe(9);
    expect(msgs[0]).toEqual({ role: 'user', content: 'What is this document about?' });
    expect(msgs[8]).toEqual({ role: 'user', content: 'do you remember?' });
    expect(await bubbles().count()).toBe(6);
  });

  test('"New conversation" asks first and erases it from this browser', async () => {
    await s.page.click('#ai-new');
    expect(dialogs.some(d => d.includes('new conversation'))).toBe(true);
    await s.page.waitForSelector('#ai-empty');
    expect(await s.page.evaluate(k => localStorage.getItem(k), CHAT_KEY)).toBeNull();
    ai.queue('anthropic', { blocks: [text('Fresh.')] });
    await ask('hello again');
    expect(lastPost().body.messages).toEqual([{ role: 'user', content: 'hello again' }]);
  });

  test('the question and then the answer are scrolled into view', async () => {
    ai.queue('anthropic', { blocks: [text('Long.\n' + 'line\n'.repeat(80))] });
    await ask('make it long');
    const top = async (i: number) => s.page.evaluate(i => {
      const m = document.querySelectorAll('#ai-list .ai-msg')[i] as HTMLElement, c = document.getElementById('ai-container')!;
      return m.getBoundingClientRect().top - c.getBoundingClientRect().top;
    }, i);
    const n = await bubbles().count();
    expect(Math.abs(await top(n - 1))).toBeLessThan(40);   // the answer starts at the top of the panel
  });
});

describe('AI chat: limits, stopping and errors', () => {
  test('a model that keeps asking for tools is stopped after 12 rounds, and the conversation still works afterwards', async () => {
    await s.page.click('#ai-new');
    await s.page.waitForSelector('#ai-empty');
    const before = posts().length;
    ai.queue('anthropic', ...Array.from({ length: 12 }, (_, i) => ({ blocks: [tool(`loop${i}`, 'list_files')] })));
    await ask('loop forever');
    expect(posts().length - before).toBe(12);
    expect(await lastAnswer().locator('.ai-note').innerText()).toBe('Stopped after 12 steps. Ask again to continue.');
    expect(await lastAnswer().locator('.ai-tools div').count()).toBe(12);
    // every tool call got its answer, and the next question joins the unanswered tool answers instead of breaking the order of roles
    ai.queue('anthropic', { blocks: [text('Now I answer.')] });
    await ask('go on');
    const msgs = lastPost().body.messages;
    const roles = msgs.map((m: any) => m.role);
    expect(roles.length).toBe(25);
    expect(roles.every((r: string, i: number) => r === (i % 2 ? 'assistant' : 'user'))).toBe(true);
    const tail = msgs[24].content;
    expect(tail[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'loop11' });
    expect(tail[1]).toEqual({ type: 'text', text: 'go on' });
    expect(await lastAnswer().locator('.ai-text').innerText()).toBe('Now I answer.');
  });

  test('a question that already sent too many tokens is stopped', async () => {
    await s.page.click('#ai-new');
    await s.page.waitForSelector('#ai-empty');
    const before = posts().length;
    ai.queue('anthropic', { blocks: [tool('big1', 'list_files')], usage: { input: 600000, output: 5 } });
    await ask('read everything');
    expect(posts().length - before).toBe(1);
    expect(await lastAnswer().locator('.ai-note').innerText()).toContain('this question already sent 600000 tokens');
  });

  test('Stop ends the request in the middle of the answer; a question that was never answered leaves no trace in the conversation', async () => {
    await s.page.click('#ai-new');
    await s.page.waitForSelector('#ai-empty');
    ai.queue('anthropic', { blocks: [text('one two three four five six seven eight nine ten')], slow: 400 });
    await s.page.fill('#ai-input', 'answer slowly');
    await s.page.click('#ai-send');
    await s.page.waitForSelector('#ai-stop', { state: 'visible' });
    expect(await s.page.locator('#ai-send').isVisible()).toBe(false);
    expect(await s.page.locator('#ai-input').isDisabled()).toBe(true);
    await s.page.waitForFunction(() => (document.querySelector('#ai-list .ai-assistant .ai-text')?.textContent || '').length > 0);
    await s.page.click('#ai-stop');
    await idle();
    await s.page.waitForTimeout(80);
    expect(await lastAnswer().locator('.ai-note').innerText()).toBe('Stopped.');
    expect((await lastAnswer().locator('.ai-text').innerText()).length).toBeLessThan('one two three four five six seven eight nine ten'.length);
    ai.queue('anthropic', { blocks: [text('ok')] });
    await ask('next');
    expect(lastPost().body.messages).toEqual([{ role: 'user', content: 'next' }]);
  });

  test('a refused key, a refusal of the model and a cut answer are explained; the person can ask again', async () => {
    await s.page.click('#ai-new');
    await s.page.waitForSelector('#ai-empty');
    ai.queue('anthropic', { status: 401, error: 'bad key' });
    await ask('q1');
    expect(await lastAnswer().locator('.ai-note').innerText()).toContain('refused the key');
    ai.queue('anthropic', { blocks: [], stop: 'refusal' });
    await ask('q2');
    expect(await lastAnswer().locator('.ai-note').innerText()).toBe('The provider declined to answer.');
    ai.queue('anthropic', { blocks: [text('half an answ')], stop: 'max_tokens' });
    await ask('q3');
    expect(await lastAnswer().locator('.ai-note').innerText()).toContain('output limit');
    expect(await lastAnswer().locator('.ai-text').innerText()).toBe('half an answ');
    ai.queue('anthropic', { blocks: [text('fine')] });
    await ask('q4');
    // none of the three failed questions is in what is sent
    expect(lastPost().body.messages).toEqual([{ role: 'user', content: 'q4' }]);
    expect(await bubbles().count()).toBe(8);
  });

  test('a project that turned the assistant off sends nothing', async () => {
    await s.page.evaluate(async () => { const P = (window as any).Project; const { config } = await P.config.get(); await P.config.save({ ...config, ai: 'off' }); });
    const before = ai.requests.length;
    const r = await s.page.evaluate(async () => { await (window as any).AIChat.ask('are you there?'); return (window as any).AIChat.busy(); });
    expect(r).toBe(false);
    await s.page.waitForSelector('#ai-project-off-notice');
    expect(await s.page.locator('#ai-chat').isVisible()).toBe(false);
    expect(ai.requests.length).toBe(before);
    await s.page.click('#ai-project-on');
    await s.page.waitForSelector('#ai-input', { state: 'visible' });
  });
});

describe('AI chat: the OpenAI-compatible dialect and the rest', () => {
  test('changing to another kind of provider starts a new conversation; the loop works the same way', async () => {
    await configure('openai');
    await s.page.waitForSelector('#ai-empty');
    const before = posts().length;
    ai.queue('openai', { text: 'Looking.', calls: [{ id: 'c1', name: 'search', args: '{"text":"documentclass"}' }] }, { text: 'Found it in main.tex.', usage: { input: 300, output: 12 } });
    await ask('where is the class set?');
    expect(posts().length - before).toBe(2);
    const msgs = lastPost().body.messages;
    expect(msgs.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(msgs[3].content).toContain('main.tex:');
    expect(await lastAnswer().locator('.ai-text').innerText()).toBe('Looking.\n\nFound it in main.tex.');
    expect(await lastAnswer().locator('.ai-tools div').allInnerTexts()).toEqual(['↳ search']);
    expect(await lastAnswer().locator('.ai-badge').getAttribute('title')).toBe('gpt-test-1');
  });

  test('Enter sends and Shift+Enter breaks the line', async () => {
    ai.queue('openai', { text: 'got it' });
    await s.page.focus('#ai-input');
    await s.page.keyboard.type('line one');
    await s.page.keyboard.press('Shift+Enter');
    await s.page.keyboard.type('line two');
    const before = posts().length;
    await s.page.keyboard.press('Enter');
    await poll(() => posts().length, n => n > before);
    await idle();
    expect(lastPost().body.messages.slice(-1)[0]).toEqual({ role: 'user', content: 'line one\nline two' });
    expect(await s.page.inputValue('#ai-input')).toBe('');
  });

  test('the editor was not touched by any of this', async () => {
    const st = await s.page.evaluate(() => (window as any).BrowserGit.status());
    expect(st.changes.map((c: any) => c.file).filter((f: string) => !f.startsWith('.neoleaf/'))).toEqual([]);
  });

  test('signing out removes the conversations too', async () => {
    expect((await s.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('neoleaf.ai.chat.')))).length).toBe(1);
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    await s.page.click('#upm-btn-logout');
    await s.page.waitForFunction(() => !document.getElementById('user-profile-modal'), null, { timeout: 40000 });
    expect(await poll(() => s.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('neoleaf.ai.'))), k => k.length === 0)).toEqual([]);
  });

  test('the questions and the project text went to the provider only, never to the NeoLeaf server', () => {
    expect(toOrigin.filter(r => /What is this document about|read everything|documentclass\{article\}/.test(r))).toEqual([]);
  });

  test('no unhandled console errors', () => {
    expect(s.errors).toEqual([]);
  });
});
