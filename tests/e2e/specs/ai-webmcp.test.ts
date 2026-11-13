import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, poll, type Session } from '../helpers';

// Browser agents (WebMCP, docs/ai-assistant-plan.md): the page offers nine tools to an AI agent that runs in the person's browser,
// through document.modelContext. Off by default; nothing is registered unless the person allows it; the tools only read or make
// drafts (a click of the person applies them). The browser API is faked here: the init script keeps what the page registers.

const FAKE_API = () => {
  const reg = new Map<string, any>();
  (window as any).__wm = reg;
  (window as any).__wmLog = [];
  (document as any).modelContext = {
    async registerTool(tool: any, opts?: any) {
      (window as any).__wmLog.push('register ' + tool.name);
      reg.set(tool.name, tool);
      opts && opts.signal && opts.signal.addEventListener('abort', () => { reg.delete(tool.name); (window as any).__wmLog.push('unregister ' + tool.name); });
    },
  };
};

const OFFERED = ['add_comment', 'add_suggestion', 'compile', 'compile_log', 'list_comments', 'list_files', 'propose_file', 'read_file', 'search'];
const names = (s: Session): Promise<string[]> => s.page.evaluate(() => [...(window as any).__wm.keys()].sort());
const call = (s: Session, name: string, args: any): Promise<{ ok: boolean; value: string }> =>
  s.page.evaluate(async ({ name, args }) => {
    try { return { ok: true, value: String(await (window as any).__wm.get(name).execute(args)) }; } catch (e: any) { return { ok: false, value: String(e && e.message) }; }
  }, { name, args });

async function prepare(s: Session) {
  await s.page.evaluate(async () => {
    const bg = (window as any).BrowserGit;
    await bg.writeFile('sections/intro.tex', 'First line.\nThe quick brown fox.\nA fox and a fox.\nLast line.');
    await (window as any).FT.refreshFromBrowserGit();
  });
}

describe('without WebMCP in the browser', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('nothing is drawn and nothing breaks', async () => {
    await s.page.click('#tab-ai-btn');
    await s.page.waitForSelector('#ai-container .ai-card');
    expect(await s.page.locator('#ai-agent-card').count()).toBe(0);
    expect(await s.page.evaluate(() => (window as any).AIWebMCP.supported())).toBe(false);
    expect(s.errors).toEqual([]);
  });
});

describe('with WebMCP in the browser', () => {
  let s: Session;
  const dialogs: string[] = [];
  beforeAll(async () => {
    s = await newSession();
    await s.context.addInitScript(FAKE_API);
    s.page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await openProject(s.page);
    await prepare(s);
    await s.page.click('#tab-ai-btn');
    await s.page.waitForSelector('#ai-agent-card');
  });
  afterAll(async () => { await s.context.close(); });

  test('it is off by default: the card offers it and no tool is registered', async () => {
    expect(await s.page.locator('#ai-agent-toggle').innerText()).toBe('Allow browser agents');
    expect(await names(s)).toEqual([]);
    expect(await s.page.evaluate(() => (window as any).__wmLog)).toEqual([]);
  });

  test('allowing it asks first, then registers exactly the nine tools, with honest hints', async () => {
    await s.page.click('#ai-agent-toggle');
    await poll(() => names(s), n => n.length === 9);
    expect(dialogs.some(d => d.includes('not through NeoLeaf') && d.includes('Extensions'))).toBe(true);
    expect(await names(s)).toEqual(OFFERED);
    const tools = await s.page.evaluate(() => Object.fromEntries([...(window as any).__wm].map(([k, t]: any) => [k, { a: t.annotations, schema: t.inputSchema.type, d: !!t.description }])));
    for (const n of ['list_files', 'read_file', 'search', 'compile_log', 'list_comments']) {
      expect(tools[n].a).toEqual({ readOnlyHint: true, untrustedContentHint: true, consequentialHint: false });
    }
    for (const n of ['add_comment', 'add_suggestion', 'propose_file', 'compile']) expect(tools[n].a).toEqual({ readOnlyHint: false, untrustedContentHint: false, consequentialHint: false });
    expect(Object.values(tools).every((t: any) => t.schema === 'object' && t.d)).toBe(true);
    expect(await s.page.evaluate(() => localStorage.getItem('neoleaf.ai.webmcp.github.1'))).toBe('1');
    expect(await s.page.locator('#ai-agent-toggle').innerText()).toBe('Stop allowing browser agents');
  });

  test('the reading tools read the project, and refuse what is not in it', async () => {
    const list = await call(s, 'list_files', {});
    expect(list.ok).toBe(true);
    expect(list.value).toContain('sections/intro.tex');
    const read = await call(s, 'read_file', { path: 'sections/intro.tex', from_line: 2, to_line: 3 });
    expect(read.value).toContain('The quick brown fox.');
    expect(read.value).toContain('lines 2 to 3 of 4');
    expect((await call(s, 'search', { text: 'fox' })).value).toContain('sections/intro.tex:2:');
    expect((await call(s, 'compile_log', {})).ok).toBe(true);
    expect((await call(s, 'list_comments', {})).ok).toBe(true);
    const bad = await call(s, 'read_file', { path: '../../etc/passwd' });
    expect(bad.ok).toBe(false);
    expect(bad.value).toContain('There is no file');
    expect((await call(s, 'read_file', { path: '.neoleaf/config.json' })).ok).toBe(false);
    expect((await call(s, 'read_file', { path: 'sections/intro.tex', extra: 1 })).value).toContain('unknown argument');
  });

  test('a proposal is only a draft: the file does not change, a card and a badge appear', async () => {
    const before = await s.page.evaluate(() => (window as any).BrowserGit.readFile('sections/intro.tex'));
    const r = await call(s, 'add_suggestion', { path: 'sections/intro.tex', quote: 'quick brown', replacement: 'swift red', text: 'More vivid.' });
    expect(r.ok).toBe(true);
    expect(r.value).toContain('nothing was changed');
    await s.page.waitForSelector('#ai-agent-drafts .ai-draft');
    expect(await s.page.evaluate(() => (window as any).BrowserGit.readFile('sections/intro.tex'))).toBe(before);
    expect(await s.page.getAttribute('#tab-ai-btn', 'data-badge')).toBe('1');
    expect(await s.page.locator('#ai-agent-drafts .ai-badge').first().innerText()).toBe('AI');
    expect(await s.page.locator('#ai-agent-drafts .cmt-del').innerText()).toContain('quick brown');
    // the conversation of the in-page assistant has its own tools and drafts
    expect(await s.page.evaluate(() => (window as any).AITools.drafts().length)).toBe(0);
  });

  test('Accept now applies it in the editor (undoable) and clears the badge', async () => {
    await s.page.locator('#ai-agent-drafts [data-act="accept"]').click();   // the file is opened by the same code that accepts a suggestion
    await poll(() => s.page.locator('#ai-agent-drafts .ai-draft').first().getAttribute('data-status'), v => v === 'accepted', 15000);
    expect(await s.page.evaluate(() => (0, eval)('editor.getValue()'))).toContain('The swift red fox.');
    expect(await s.page.getAttribute('#tab-ai-btn', 'data-badge')).toBeNull();
  });

  test('Keep makes a normal comment, written in the name of the agent with the AI mark', async () => {
    const r = await call(s, 'add_comment', { path: 'sections/intro.tex', quote: 'Last line.', text: 'Say more here.' });
    expect(r.ok).toBe(true);
    await poll(() => s.page.locator('#ai-agent-drafts .ai-draft').count(), n => n === 2);
    await s.page.locator('#ai-agent-drafts .ai-draft').nth(1).locator('[data-act="keep"]').click();
    await poll(() => s.page.locator('#ai-agent-drafts .ai-draft').nth(1).getAttribute('data-status'), v => v === 'kept');
    const th = await s.page.evaluate(async () => (await (window as any).Project.comments.load()).threads);
    const t = th.find((x: any) => x.quote === 'Last line.');
    expect(t.ai).toEqual({ name: 'Browser agent', model: 'WebMCP' });
    expect(t.messages[0].author.name).toBe('Browser agent · AI');
  });

  test('the budget of a burst is limited, like the assistant\'s', async () => {
    await s.page.evaluate(async () => {
      await (window as any).BrowserGit.writeFile('many.tex', Array.from({ length: 25 }, (_, i) => 'row-' + String(i).padStart(3, '0')).join('\n'));
      await (window as any).FT.refreshFromBrowserGit();
    });
    // two drafts were made earlier in this burst (less than a minute ago), so 18 more fit
    for (let i = 0; i < 18; i++) expect((await call(s, 'add_comment', { path: 'many.tex', quote: 'row-' + String(i).padStart(3, '0'), text: 'c' + i })).ok).toBe(true);
    const over = await call(s, 'add_comment', { path: 'many.tex', quote: 'row-024', text: 'one too many' });
    expect(over.ok).toBe(false);
    expect(over.value).toContain('At most 20');
  });

  test('turning the project switch off stops every tool, and no file is read', async () => {
    await s.page.evaluate(async () => { const { config } = await (window as any).Project.config.get(); await (window as any).Project.config.save({ ...config, ai: 'off' }); });
    const r = await call(s, 'read_file', { path: 'sections/intro.tex' });
    expect(r.ok).toBe(false);
    expect(r.value).toContain('does not allow');
    await s.page.evaluate(async () => { const { config } = await (window as any).Project.config.get(); await (window as any).Project.config.save({ ...config, ai: 'on' }); });
  });

  test('it stays allowed after a reload (the tools are registered again), and stopping removes them', async () => {
    await openProject(s.page);
    await poll(() => names(s), n => n.length === 9, 20000);
    await s.page.click('#tab-ai-btn');
    await s.page.waitForSelector('#ai-agent-toggle');
    await s.page.click('#ai-agent-toggle');
    await poll(() => names(s), n => n.length === 0);
    expect(await s.page.evaluate(() => localStorage.getItem('neoleaf.ai.webmcp.github.1'))).toBeNull();
    expect((await call(s, 'list_files', {})).ok).toBe(false);
    expect(s.errors).toEqual([]);
  });
});
