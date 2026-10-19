import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, fake, newSession, poll, type Session } from '../helpers';

// Project that takes long to download (large repository) or cannot be prepared: the screen explains what is happening,
// instead of only saying "The local project is not available in this browser".
describe('opening a slow or failing project', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const errorOf = (call: string) => ev<string>(`${call}.then(() => 'no error').catch(e => e.message)`);

  beforeAll(async () => {
    fake.seedRepo('demo', 'slow', { 'main.tex': '\\documentclass{article}\n\\begin{document}Oi\n\\end{document}\n', 'a.txt': 'a' }, ['neoleaf']);
    fake.seedRepo('demo', 'broken', { 'main.tex': '\\documentclass{article}\n\\begin{document}Oi\n\\end{document}\n' }, ['neoleaf']);
    s = await newSession();
  });
  afterAll(async () => { await s.context.close(); });

  test('while downloading: notice with the progress and an error saying "still being downloaded"; when it finishes, everything works', async () => {
    await s.page.addInitScript(() => { (window as any).__projectWaitMs = 1500; });   // short wait, only for the test
    let release: () => void = () => {};
    const hold = new Promise<void>(r => { release = r; });
    await s.page.route(/\/api\/git\/demo\/slow\/git-upload-pack/, async route => { await hold; await route.continue(); });
    await s.page.goto(`${BASE_URL}/project/demo__slow`);
    await s.page.waitForSelector('.monaco-editor');
    await s.page.waitForSelector('#clone-progress-banner', { timeout: 30000 });
    expect(await s.page.locator('#clone-progress-banner').textContent()).toContain('Downloading the project to the browser');
    expect(await errorOf('Project.texts()')).toContain('still being downloaded');
    expect(await s.page.locator('#git-error-banner').count()).toBe(0);   // not a failure: it is just slow
    release();
    await s.page.waitForSelector('#clone-progress-banner', { state: 'detached', timeout: 60000 });
    await poll(() => errorOf('Project.texts()'), v => v === 'no error', 30000);
    expect(await ev<boolean>('!!window.__cloning')).toBe(false);
  });

  test('failure to prepare storage: notice with the reason (before, only the vague error showed)', async () => {
    await s.page.addInitScript(() => {
      (window as any).__projectWaitMs = 1500;
      let bg: any;
      Object.defineProperty(window, 'BrowserGit', {
        configurable: true,
        get() { return bg; },
        set(v) { bg = v; if (v) v.isCloned = async () => { throw new Error('IndexedDB blocked by the browser'); }; },
      });
    });
    await s.page.goto(`${BASE_URL}/project/demo__broken`);
    await s.page.waitForSelector('#git-error-banner', { timeout: 30000 });
    const notice = (await s.page.locator('#git-error-banner').textContent()) || '';
    expect(notice).toContain('I could not prepare the project in this browser');
    expect(notice).toContain('IndexedDB blocked by the browser');
    expect(notice).toContain('private window');
    expect(await s.page.locator('#git-error-retry').count()).toBe(1);
    // and the actions that depend on the project say to look at the notice
    expect(await errorOf('Project.texts()')).toContain('see the notice at the top of the screen');
  });
});
