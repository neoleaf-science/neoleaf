import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, DEMO_PROJECT, newSession, openProject, poll, type Session } from '../helpers';

// The "Local copy" column of the project list: is the project in this browser, how big, does it have unsent work, and a Clear button.
describe('project list: local copy', () => {
  let s: Session;
  const dialogs: string[] = [];
  let mode: 'accept' | 'dismiss' = 'accept';
  const cell = () => s.page.locator(`#proj-row-${DEMO_PROJECT} .pl-local`);
  const openAndWait = async () => {
    await openProject(s.page);
    await s.page.waitForFunction(() => (globalThis as any).eval('typeof currentFileId !== "undefined" && !!currentFileId'), null, { timeout: 40000 });
    await new Promise(r => setTimeout(r, 2000));   // the clone is written in the background
  };
  beforeAll(async () => {
    s = await newSession();
    s.page.on('dialog', d => { dialogs.push(d.message()); if (mode === 'dismiss') d.dismiss(); else d.accept(); });
  });
  afterAll(async () => { await s.context.close(); });

  test('a project that was never opened here is marked as not in this browser', async () => {
    await s.page.goto(BASE_URL + '/');
    expect(await s.page.locator('th.pl-th', { hasText: 'Local copy' }).count()).toBe(1);
    await poll(() => cell().innerText(), t => /Not in this browser/.test(String(t)), 15000);
    expect(await cell().locator('.pl-local-clear').count()).toBe(0);
  });

  test('after opening it, the list says it is in this browser, with its size and a Clear button', async () => {
    await openAndWait();
    await s.page.goto(BASE_URL + '/');
    await poll(() => cell().innerText(), t => /In this browser/.test(String(t)), 15000);
    await poll(() => cell().locator('.pl-local-size').count(), n => n === 1, 15000);
    expect(await cell().locator('.pl-local-size').innerText()).toMatch(/\d+(\.\d)? (B|KB|MB)/);
    expect(await cell().locator('.pl-local-unsent').count()).toBe(0);   // a clean copy: nothing waiting to be sent
    expect(await cell().locator('.pl-local-clear').isVisible()).toBe(true);
  });

  test('a copy with work that is not on GitHub says so', async () => {
    await openAndWait();
    await s.page.evaluate(async () => { await (window as any).BrowserGit.writeFile('only-here.txt', 'draft'); });
    await new Promise(r => setTimeout(r, 1500));
    await s.page.goto(BASE_URL + '/');
    await poll(() => cell().locator('.pl-local-unsent').count(), n => n === 1, 20000);
    expect(await cell().locator('.pl-local-unsent').innerText()).toContain('Unsent changes');
  });

  test('Clear asks first (and warns about the unsent work); cancelling keeps the copy, confirming removes it', async () => {
    dialogs.length = 0;
    mode = 'dismiss';
    await cell().locator('.pl-local-clear').click();
    await poll(() => dialogs.length, n => n > 0, 15000);
    mode = 'accept';
    expect(dialogs[0]).toContain('Remove the local copy of demo/' + DEMO_PROJECT.split('__')[1]);
    expect(dialogs[0]).toContain('WARNING: this copy has changes that are not on GitHub');
    expect(await cell().innerText()).toContain('In this browser');   // cancelled: still there
    await cell().locator('.pl-local-clear').click();
    await poll(() => cell().innerText(), t => /Not in this browser/.test(String(t)), 20000);
    expect(await cell().locator('.pl-local-clear').count()).toBe(0);
    // and it is really gone: the storage tab has nothing to list
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    await s.page.click('#upm-tab-btn-storage');
    await poll(() => s.page.textContent('#upm-st-list'), t => /No projects are stored in this browser/.test(String(t)), 15000);
  });

  test('the column is translated', async () => {
    await s.page.evaluate(() => (window as any).LDI18n.setLang('pt'));
    expect(await s.page.locator('th.pl-th', { hasText: 'Cópia local' }).count()).toBe(1);
    await poll(() => cell().innerText(), t => /Fora deste navegador/.test(String(t)), 5000);
    await s.page.evaluate(() => (window as any).LDI18n.setLang('en'));
  });
});
