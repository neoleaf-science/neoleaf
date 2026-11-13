import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, openProject, poll, type Session } from '../helpers';
import { startFakeAI, type FakeAI } from '../../fake-ai/server';

// AI assistant, step 5 (docs/ai-assistant-plan.md): the model can only make DRAFTS of comments and suggestions. Nothing changes until the
// person clicks Accept now (replaced in the editor, undoable, counted in the authorship log as accepted from the AI) or Keep (a normal
// thread of the project, marked as proposed by the AI). The provider is the fake one.

let ai: FakeAI;
let s: Session;
const tool = (id: string, name: string, input: unknown) => ({ type: 'tool_use' as const, id, name, input });
const text = (t: string) => ({ type: 'text' as const, text: t });
const ev = <T>(page: any, code: string) => page.evaluate((c: string) => (0, eval)(c), code) as Promise<T>;
const run = (name: string, input: any): Promise<{ content: string; isError: boolean }> => s.page.evaluate(({ name, input }) => (window as any).AITools.run({ name, input }), { name, input });
const drafts = (): Promise<any[]> => s.page.evaluate(() => (window as any).AITools.drafts());
const threads = (): Promise<any[]> => s.page.evaluate(async () => (await (window as any).Project.comments.load()).threads);

const idle = () => s.page.waitForFunction(() => !(window as any).AIChat.busy() && (document.getElementById('ai-send') as HTMLElement).style.display !== 'none', null, { timeout: 30000 });
async function ask(q: string) {
  const users = await s.page.locator('#ai-list .ai-user').count();
  await s.page.fill('#ai-input', q);
  await s.page.click('#ai-send');
  await poll(() => s.page.locator('#ai-list .ai-user').count(), n => n > users);   // the question starts a moment after the click
  await idle();
  await s.page.waitForTimeout(80);
}
const card = (n: number) => s.page.locator('#ai-list .ai-draft').nth(n);

beforeAll(async () => {
  ai = startFakeAI();
  s = await newSession();
  s.page.on('dialog', d => d.accept());
  await openProject(s.page);
  await s.page.evaluate(({ url, key }) => localStorage.setItem('neoleaf.ai.github.1', JSON.stringify({ consent: true, provider: 'anthropic', key, model: 'claude-test-1', name: 'Reviewer', baseUrl: url })), { url: ai.url, key: ai.key });
  await s.page.click('#tab-ai-btn');
  await s.page.waitForSelector('#ai-input');
  await s.page.evaluate(async () => {
    const bg = (window as any).BrowserGit;
    await bg.writeFile('sections/intro.tex', 'First line.\nThe quick brown fox.\nA fox and a fox.\nLast line.');
    await bg.writeFile('figures/plot.png', new Uint8Array([1, 2, 3]));
    await (window as any).FT.refreshFromBrowserGit();
  });
});
afterAll(async () => { await s.context.close(); ai.stop(); });

describe('AI proposals: what the model may propose', () => {
  test('a proposal is checked against the file as it is on the screen, and becomes a draft with its exact position', async () => {
    await s.page.evaluate(() => (window as any).AITools.begin());
    const r = await run('add_suggestion', { path: 'sections/intro.tex', quote: 'quick brown', replacement: 'swift red', text: 'More vivid.' });
    expect(r.isError).toBe(false);
    expect(r.content).toBe('Draft suggestion saved for sections/intro.tex, line 2. The person will review it; nothing was changed.');
    const c = await run('add_comment', { path: 'sections/intro.tex', quote: 'Last line.', text: 'Say more here.' });
    expect(c.isError).toBe(false);
    expect(await drafts()).toEqual([
      { id: 'd1', kind: 'suggestion', file: 'sections/intro.tex', quote: 'quick brown', replacement: 'swift red', text: 'More vivid.', range: { sl: 2, sc: 5, el: 2, ec: 16 }, status: 'pending' },
      { id: 'd2', kind: 'comment', file: 'sections/intro.tex', quote: 'Last line.', replacement: '', text: 'Say more here.', range: { sl: 4, sc: 1, el: 4, ec: 11 }, status: 'pending' },
    ]);
    // nothing was written: the file, the editor and the comments are as they were
    expect(await s.page.evaluate(() => (window as any).BrowserGit.readFile('sections/intro.tex'))).toBe('First line.\nThe quick brown fox.\nA fox and a fox.\nLast line.');
    expect(await threads()).toEqual([]);
  });

  test('a quote that is missing, ambiguous, empty or too long is refused with a way out; so is a path outside the project', async () => {
    await s.page.evaluate(() => (window as any).AITools.begin());
    expect((await run('add_suggestion', { path: 'sections/intro.tex', quote: 'a slow turtle', replacement: 'x' })).content).toContain('was not found');
    expect((await run('add_suggestion', { path: 'sections/intro.tex', quote: 'fox', replacement: 'x' })).content).toContain('appears more than once');
    expect((await run('add_suggestion', { path: 'sections/intro.tex', quote: '   ', replacement: 'x' })).content).toContain('The quote is empty');
    expect((await run('add_suggestion', { path: 'sections/intro.tex', quote: 'Last line.', replacement: 'Last line.' })).content).toContain('nothing to change');
    expect((await run('add_comment', { path: 'sections/intro.tex', quote: 'Last line.', text: '' })).content).toContain('needs its text');
    expect((await run('add_suggestion', { path: 'sections/intro.tex', quote: 'Last line.', replacement: 'x'.repeat(4001) })).content).toContain('longer than 4000');
    expect((await run('add_comment', { path: '.neoleaf/config.json', quote: 'mainFile', text: 'x' })).content).toContain('There is no file');
    expect((await run('add_comment', { path: '../x.tex', quote: 'a', text: 'x' })).content).toContain('There is no file');
    expect((await run('add_comment', { path: 'figures/plot.png', quote: 'a', text: 'x' })).content).toContain('not a text file');
    expect((await run('add_suggestion', { path: 'sections/intro.tex', quote: 'Last line.' })).content).toContain('missing argument "replacement"');
    expect(await drafts()).toEqual([]);
    // a quote with multi-line text and the same passage proposed twice
    expect((await run('add_suggestion', { path: 'sections/intro.tex', quote: 'First line.\nThe quick', replacement: 'Opening.\nThe quick' })).isError).toBe(false);
    expect((await run('add_suggestion', { path: 'sections/intro.tex', quote: 'First line.\nThe quick', replacement: 'Other' })).content).toContain('already has a proposal');
    expect((await drafts())[0].range).toEqual({ sl: 1, sc: 1, el: 2, ec: 10 });
  });

  test('at most 20 proposals per question', async () => {
    await s.page.evaluate(() => (window as any).AITools.begin());
    await s.page.evaluate(async () => (window as any).BrowserGit.writeFile('many.tex', Array.from({ length: 30 }, (_, i) => `unique-line-${String(i).padStart(2, '0')}`).join('\n')));
    for (let i = 0; i < 20; i++) expect((await run('add_comment', { path: 'many.tex', quote: `unique-line-${String(i).padStart(2, '0')}`, text: 'x' })).isError).toBe(false);
    const over = await run('add_comment', { path: 'many.tex', quote: 'unique-line-25', text: 'x' });
    expect(over.isError).toBe(true);
    expect(over.content).toContain('At most 20 proposals');
    expect((await drafts()).length).toBe(20);
  });
});

describe('AI proposals: the cards and the three choices', () => {
  test('the model\'s drafts appear under its answer; nothing is changed yet', async () => {
    ai.queue('anthropic',
      { blocks: [text('Two ideas.'), tool('p1', 'add_suggestion', { path: 'sections/intro.tex', quote: 'quick brown', replacement: 'swift red', text: 'More vivid.' }), tool('p2', 'add_comment', { path: 'sections/intro.tex', quote: 'Last line.', text: 'Say more here.' }), tool('p3', 'add_suggestion', { path: 'sections/intro.tex', quote: 'fox', replacement: 'x' })] },
      { blocks: [text('I proposed two changes.')] });
    await ask('improve the intro');
    expect(await s.page.locator('#ai-list .ai-draft').count()).toBe(2);
    const a = card(0), b = card(1);
    expect(await a.locator('.cmt-where').innerText()).toBe('✏️ sections/intro.tex:2');
    expect(await a.locator('.cmt-del').innerText()).toBe('− quick brown');
    expect(await a.locator('.cmt-add').innerText()).toBe('+ swift red');
    expect(await a.locator('button').allInnerTexts()).toEqual(['✔ Accept now', 'Keep as suggestion', 'Discard']);
    expect(await b.locator('.cmt-where').innerText()).toBe('💬 sections/intro.tex:4');
    expect(await b.locator('button').allInnerTexts()).toEqual(['Keep as comment', 'Discard']);
    // the ambiguous third proposal was refused, and the model was told why
    const body = ai.requests[ai.requests.length - 1].body;
    const results = body.messages[body.messages.length - 1].content;
    expect(results.map((r: any) => r.tool_use_id)).toEqual(['p1', 'p2', 'p3']);
    expect(results[0].is_error).toBeUndefined();
    expect(results[2]).toMatchObject({ is_error: true });
    expect(results[2].content).toContain('appears more than once');
    expect(await threads()).toEqual([]);
    expect(await s.page.evaluate(() => (window as any).BrowserGit.readFile('sections/intro.tex'))).toContain('quick brown');
  });

  test('Keep makes a normal thread of the project: the person is its author, the AI mark and the model are on it, the first message is in the assistant\'s name', async () => {
    await card(1).locator('[data-act=keep]').click();
    await s.page.waitForFunction(() => document.querySelectorAll('#ai-list .ai-draft')[1]?.getAttribute('data-status') === 'kept');
    const t = (await threads())[0];
    expect(t).toMatchObject({ file: 'sections/intro.tex', kind: 'comment', resolved: false, ai: { name: 'Reviewer', model: 'claude-test-1' } });
    expect(t.author).toMatchObject({ name: 'Demo User' });
    expect(t.author.email).toContain('@');
    expect(t.messages[0].author).toEqual({ name: 'Reviewer · AI', email: '', ai: true });
    expect(t.messages[0].text).toBe('Say more here.');
    expect(await card(1).locator('.ai-verdict').innerText()).toContain('Kept as a comment');
    expect(await card(1).locator('button').count()).toBe(0);
    // in the Comments tab it carries the grey mark, with the model on hover, and the person can delete it (they are its author)
    await s.page.click('#tab-comments-btn');
    const mark = s.page.locator('.cmt-card .ai-badge');
    expect(await mark.count()).toBe(1);
    expect(await mark.getAttribute('title')).toBe('claude-test-1');
    expect(await s.page.locator('.cmt-card .cmt-author').innerText()).toBe('Reviewer · AI');
    expect(await s.page.locator('.cmt-card .cmt-del-btn').count()).toBe(1);
    // it was saved in the project file, which is what a push would send
    expect(JSON.parse(await s.page.evaluate(() => (window as any).BrowserGit.readFile('.neoleaf/comments.json'))).threads[0].ai.model).toBe('claude-test-1');
    await s.page.click('#tab-ai-btn');
  });

  test('Accept now replaces the passage in the editor; Ctrl+Z brings it back; the log counts it as accepted from the AI, not as typed', async () => {
    await ev(s.page, `LD.smart.goTo('sections/intro.tex', 1)`);
    await poll(() => ev<string>(s.page, 'currentFileId'), v => v === 'sections/intro.tex', 15000);
    await poll(() => ev<boolean>(s.page, 'window.collabActive === true'), v => v === true, 20000);
    await card(0).locator('[data-act=accept]').click();
    await s.page.waitForFunction(() => document.querySelectorAll('#ai-list .ai-draft')[0]?.getAttribute('data-status') === 'accepted');
    expect(await ev<string>(s.page, 'editor.getValue()')).toBe('First line.\nThe swift red fox.\nA fox and a fox.\nLast line.');
    expect(await card(0).locator('.ai-verdict').innerText()).toBe('Accepted');
    // no thread was created by accepting now
    expect((await threads()).length).toBe(1);
    // undo
    await ev(s.page, `editor.focus(); editor.trigger('test', 'undo', null)`);
    expect(await ev<string>(s.page, 'editor.getValue()')).toContain('quick brown');
    await ev(s.page, `editor.trigger('test', 'redo', null)`);
    expect(await ev<string>(s.page, 'editor.getValue()')).toContain('swift red');
    // the authorship log: the AI part is its own entry in this person's file, marked, and the text is not counted as typed
    const entries = await poll(() => s.page.evaluate(async () => (await (window as any).Project.history.list(null)) as any[]), es => es.some(e => e.ai), 20000);
    const mine = entries.filter(e => e.ai);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]).toMatchObject({ ai: { name: 'Reviewer', model: 'claude-test-1' }, file: 'intro.tex' });
    expect(mine[0].user.name).toBe('Demo User');
    expect(entries.filter(e => !e.ai).every(e => !(e.preview || '').includes('swift red'))).toBe(true);
  });

  test('the authorship list shows it on its own line, with the AI mark', async () => {
    const html = await s.page.evaluate(async () => {
      const w = window as any;
      const box = document.getElementById('au-list') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'au-list' }));
      const all = (document.getElementById('au-all') as HTMLInputElement) || document.body.appendChild(Object.assign(document.createElement('input'), { id: 'au-all', type: 'checkbox' }));
      all.checked = true;
      await w.loadAuthorship();
      return box.innerHTML;
    });
    expect(html).toContain('ai-badge');
    expect(html).toContain('accepted from AI: Reviewer');
  });

  test('a draft that went stale is not applied: the passage changed after it was proposed', async () => {
    ai.queue('anthropic', { blocks: [tool('q1', 'add_suggestion', { path: 'sections/intro.tex', quote: 'Last line.', replacement: 'The end.' })] }, { blocks: [text('done')] });
    await ask('suggest an ending');
    const n = await s.page.locator('#ai-list .ai-draft').count();
    await ev(s.page, `editor.setValue(editor.getValue().replace('Last line.', 'Something else entirely.'))`);
    await s.page.locator('#ai-list .ai-draft').nth(n - 1).locator('[data-act=accept]').click();
    await poll(() => s.page.locator('#ai-list .ai-draft').nth(n - 1).locator('.ai-note').innerText(), t => /changed since/.test(t));
    expect(await ev<string>(s.page, 'editor.getValue()')).toContain('Something else entirely.');
    expect(await s.page.locator('#ai-list .ai-draft').nth(n - 1).getAttribute('data-status')).toBe('pending');
    await s.page.locator('#ai-list .ai-draft').nth(n - 1).locator('[data-act=discard]').click();
    await poll(() => s.page.locator('#ai-list .ai-draft').nth(n - 1).getAttribute('data-status'), v => v === 'discarded');
  });

  test('the decisions survive a reload', async () => {
    await openProject(s.page);
    await s.page.click('#tab-ai-btn');
    await s.page.waitForSelector('#ai-list .ai-draft');
    expect(await s.page.locator('#ai-list .ai-draft').evaluateAll(els => els.map(e => e.getAttribute('data-status')))).toEqual(['accepted', 'kept', 'discarded']);
  });

  test('the 500 thread ceiling is reported on the card, not crashed into', async () => {
    await s.page.evaluate(async () => {
      const bg = (window as any).BrowserGit;
      const threads = Array.from({ length: 500 }, (_, i) => ({ id: 't' + i, file: 'main.tex', kind: 'comment', createdAt: '2026-01-01T00:00:00Z', author: { name: 'x', email: 'x@x' }, resolved: true, range: { sl: 1, sc: 1, el: 1, ec: 2 }, quote: '', messages: [] }));
      await bg.writeFile('.neoleaf/comments.json', JSON.stringify({ rev: 1, threads }));
    });
    ai.queue('anthropic', { blocks: [tool('r1', 'add_comment', { path: 'sections/intro.tex', quote: 'First line.', text: 'full' })] }, { blocks: [text('done')] });
    await ask('one more comment');
    const last = s.page.locator('#ai-list .ai-draft').last();
    await last.locator('[data-act=keep]').click();
    await poll(() => last.locator('.ai-note').innerText(), t => /Too many comments/.test(t));
    expect(await last.getAttribute('data-status')).toBe('pending');
    expect((await threads()).length).toBe(500);
  });

  test('the editor text is intact where the person did not accept anything', async () => {
    expect(await s.page.evaluate(() => (window as any).BrowserGit.readFile('main.tex'))).toContain('\\documentclass{article}');
  });

  test('no unhandled console errors', () => {
    expect(s.errors).toEqual([]);
  });
});

describe('AI proposals: with live editing', () => {
  test('what one person accepts reaches the other person in the same file, and the other sees no AI text counted as typed', async () => {
    const a = await newSession(), b = await newSession();
    try {
      a.page.on('dialog', d => d.accept());
      for (const x of [a, b]) {
        await x.page.addInitScript(({ url, key }) => localStorage.setItem('neoleaf.ai.github.1', JSON.stringify({ consent: true, provider: 'anthropic', key, model: 'claude-test-1', name: 'Reviewer', baseUrl: url })), { url: ai.url, key: ai.key });
        await openProject(x.page);
        await poll(() => ev<boolean>(x.page, 'window.collabActive === true'), v => v === true, 20000);
      }
      await a.page.click('#tab-ai-btn');
      await a.page.waitForSelector('#ai-input');
      const quote = (await ev<string>(a.page, 'editor.getValue()')).split('\n').find(l => l.startsWith('\\title{'))!;
      ai.queue('anthropic', { blocks: [tool('l1', 'add_suggestion', { path: 'main.tex', quote, replacement: '\\title{Proposed by the assistant}' })] }, { blocks: [text('done')] });
      await a.page.fill('#ai-input', 'new title');
      await a.page.click('#ai-send');
      await a.page.waitForSelector('#ai-list .ai-draft [data-act=accept]');
      await a.page.click('#ai-list .ai-draft [data-act=accept]');
      await poll(() => ev<string>(b.page, 'editor.getValue()'), v => v.includes('\\title{Proposed by the assistant}'), 20000);
      expect(await ev<string>(a.page, 'editor.getValue()')).toContain('\\title{Proposed by the assistant}');
      // person B did not type it, and person A's log marks it as the AI's
      const mine = await poll(() => a.page.evaluate(async () => (await (window as any).Project.history.list(null)) as any[]), es => es.some(e => e.ai), 20000);
      expect(mine.find(e => e.ai).preview).toContain('Proposed by the assistant');
    } finally { await a.context.close(); await b.context.close(); }
  });
});
