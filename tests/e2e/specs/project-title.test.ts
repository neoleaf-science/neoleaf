import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, DEMO_PROJECT, fake, newSession, type Session } from '../helpers';

// Display title of a project: kept in the repository description as "NeoLeaf: <title>", shown in the list with the repository name below.
describe('project display title', () => {
  let s: Session;
  const [OWNER, REPO] = DEMO_PROJECT.split('__');
  const dialogs: Array<{ type: string; message: string }> = [];
  let answers: Array<string | null> = [];   // what to answer to the next prompts/confirms (null = cancel)
  const row = () => s.page.locator(`#proj-row-${DEMO_PROJECT}`);
  beforeAll(async () => {
    s = await newSession();
    s.page.on('dialog', d => {
      dialogs.push({ type: d.type(), message: d.message() });
      const a = answers.length ? answers.shift()! : (d.type() === 'prompt' ? d.defaultValue() : '');
      if (a === null) d.dismiss(); else d.accept(d.type() === 'prompt' ? a : undefined);
    });
    fake.setDescription(OWNER, REPO, '');
    await s.page.goto(BASE_URL + '/');
  });
  afterAll(async () => { fake.setDescription(OWNER, REPO, ''); await s.context.close(); });

  test('without a title the list shows the repository name, and the pencil is there for the owner', async () => {
    expect(await row().locator('.pl-title-link').innerText()).toBe(REPO);
    expect(await row().locator('.pl-subname').isVisible()).toBe(false);
    expect(await row().locator('button[aria-label="Edit title"]').count()).toBe(1);
  });

  test('setting a title shows it with the repository name below, saves it as "NeoLeaf: title", and survives a reload', async () => {
    answers = ['  My   Thesis  '];
    await row().locator('button[aria-label="Edit title"]').click();
    await s.page.waitForFunction(id => document.querySelector(`#proj-row-${id} .pl-title-link`)!.textContent === 'My Thesis', DEMO_PROJECT, { timeout: 15000 });
    expect(await row().locator('.pl-subname').innerText()).toBe(REPO);
    expect(fake.description(OWNER, REPO)).toBe('NeoLeaf: My Thesis');
    expect(dialogs.at(-1)!.message).toContain('Project title');
    await s.page.reload();
    expect(await row().locator('.pl-title-link').innerText()).toBe('My Thesis');
    expect(await row().locator('.pl-subname').innerText()).toBe(REPO);
    expect(await row().getAttribute('data-title')).toBe('My Thesis');
  });

  test('the search finds a project by its title and by its repository name', async () => {
    for (const [q, visible] of [['thesis', true], [REPO, true], ['no-such-project-zzz', false]] as const) {
      await s.page.fill('#pl-search', q);
      await s.page.waitForFunction(([id, v]) => (document.getElementById('proj-row-' + id)!.style.display !== 'none') === v, [DEMO_PROJECT, visible] as [string, boolean], { timeout: 5000 });
    }
    await s.page.fill('#pl-search', '');
  });

  test('an empty title removes it', async () => {
    answers = [''];
    await row().locator('button[aria-label="Edit title"]').click();
    await s.page.waitForFunction(id => document.querySelector(`#proj-row-${id} .pl-title-link`)!.textContent !== 'My Thesis', DEMO_PROJECT, { timeout: 15000 });
    expect(await row().locator('.pl-title-link').innerText()).toBe(REPO);
    expect(fake.description(OWNER, REPO)).toBe('');
  });

  test('a description that belongs to the person is only replaced after a confirmation, and never shown as a title', async () => {
    fake.setDescription(OWNER, REPO, 'My own notes about this repository');
    await s.page.reload();
    expect(await row().locator('.pl-title-link').innerText()).toBe(REPO);   // not taken for a title
    // cancel the confirmation: nothing changes
    dialogs.length = 0;
    answers = ['Another title', null];
    await row().locator('button[aria-label="Edit title"]').click();
    await s.page.waitForFunction(() => true);
    await new Promise(r => setTimeout(r, 1500));
    expect(dialogs.map(d => d.type)).toEqual(['prompt', 'confirm']);
    expect(dialogs[1].message).toContain('already has a description');
    expect(fake.description(OWNER, REPO)).toBe('My own notes about this repository');
    // accept it: replaced
    answers = ['Another title', ''];
    await row().locator('button[aria-label="Edit title"]').click();
    await s.page.waitForFunction(id => document.querySelector(`#proj-row-${id} .pl-title-link`)!.textContent === 'Another title', DEMO_PROJECT, { timeout: 15000 });
    expect(fake.description(OWNER, REPO)).toBe('NeoLeaf: Another title');
  });

  test('the editor header and the page title show the display title (the repository name in the tooltip); without one, the name', async () => {
    const header = () => s.page.locator('.project-title');
    fake.setDescription(OWNER, REPO, 'NeoLeaf: My <b>Thesis</b> & more');
    await s.page.goto(`${BASE_URL}/project/${DEMO_PROJECT}`);
    await s.page.waitForSelector('.project-title');
    expect(await header().innerText()).toBe('My <b>Thesis</b> & more');           // text, never HTML
    expect(await header().getAttribute('title')).toBe(`My <b>Thesis</b> & more (${REPO})`);   // the whole title and the name
    expect(await s.page.title()).toBe('My <b>Thesis</b> & more - NeoLeaf Editor');
    expect(await s.page.locator('#download-pdf-btn').getAttribute('download')).toBe(REPO + '.pdf');   // the file keeps the repository name
    fake.setDescription(OWNER, REPO, 'My own notes, not a title');
    await s.page.goto(`${BASE_URL}/project/${DEMO_PROJECT}`);
    await s.page.waitForSelector('.project-title');
    expect(await header().innerText()).toBe(REPO);
    expect(await header().getAttribute('title')).toBe(REPO);
    expect(await s.page.title()).toBe(REPO + ' - NeoLeaf Editor');
    // a very long title stays on one line, cut with an ellipsis, with the whole text in the tooltip
    const long = 'A very long title '.repeat(4).trim();
    fake.setDescription(OWNER, REPO, 'NeoLeaf: ' + long);
    await s.page.setViewportSize({ width: 900, height: 700 });
    await s.page.goto(`${BASE_URL}/project/${DEMO_PROJECT}`);
    await s.page.waitForSelector('.project-title');
    const h = await s.page.evaluate(() => { const e = document.querySelector('.project-title') as HTMLElement; return { height: Math.round(e.getBoundingClientRect().height), cut: e.scrollWidth > e.clientWidth, tip: e.title }; });
    expect(h.height).toBeLessThan(40);
    expect(h.cut).toBe(true);
    expect(h.tip).toContain(long);
    fake.setDescription(OWNER, REPO, 'NeoLeaf: Another title');
  });

  test('a title that is too long is refused by the server', async () => {
    const r = await s.page.evaluate(async (id: string) => (await fetch(`/api/project/${id}/title`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x'.repeat(81) }) })).json(), DEMO_PROJECT);
    expect(r.error).toContain('at most 80 characters');
    expect(fake.description(OWNER, REPO)).toBe('NeoLeaf: Another title');
  });

  test('a person without admin access gets a clear message', async () => {
    const r = await s.page.evaluate(async () => (await fetch('/api/project/someone-else__no-such-repo/title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })).json());
    expect(r.error).toContain('admin access');
  });
});
