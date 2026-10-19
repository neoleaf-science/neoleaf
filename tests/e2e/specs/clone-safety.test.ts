import { describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, openProject, poll } from '../helpers';

const ev = (page: any, code: string) => page.evaluate((c: string) => (0, eval)(c), code);

// The project lives in the browser: if the clone fails it must not become an empty repository, and what has not yet been
// pushed to GitHub must be remembered (the browser may wipe the data).
describe('safe clone and unsent work notice', () => {
  test('failed clone: shows the error, blocks editing, leaves no empty repository and allows retrying', async () => {
    const s = await newSession();
    try {
      await s.page.route('**/api/git/demo/artigo-1/info/refs*', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'test failure' }));
      await s.page.goto(`${BASE_URL}/project/demo__artigo-1`);
      await s.page.waitForSelector('#git-error-banner', { timeout: 30000 });
      expect(await s.page.textContent('#git-error-banner')).toContain('Could not open the project');
      expect(await ev(s.page, 'editor.getOption(monaco.editor.EditorOption.readOnly)')).toBe(true);
      expect(await ev(s.page, 'BrowserGit.isCloned()')).toBe(false); // no empty repository

      await s.page.unroute('**/api/git/demo/artigo-1/info/refs*');
      await s.page.click('#git-error-retry');
      await s.page.waitForFunction(() => (globalThis as any).eval('typeof currentFileId !== "undefined" && !!currentFileId'), null, { timeout: 30000 });
      expect(await ev(s.page, 'BrowserGit.isCloned()')).toBe(true);
      expect(await ev(s.page, `editor.getValue().includes('documentclass')`)).toBe(true);
      expect(await s.page.locator('#git-error-banner').count()).toBe(0);
    } finally { await s.context.close(); }
  });

  test('a clone stuck empty (from old versions) is redone, keeping a copy of the local files', async () => {
    const s = await newSession();
    try {
      await openProject(s.page);
      await ev(s.page, `BrowserGit.writeFile('local-only.txt', 'draft')`);
      // stuck state: HEAD points to a branch with no commit
      await s.page.evaluate(async () => {
        const w = window as any;
        await w.BrowserGit.getFs().pfs.writeFile(w.BrowserGit.getDir() + '/.git/HEAD', 'ref: refs/heads/preso\n');
      });
      await new Promise(r => setTimeout(r, 2000)); // storage writes in the background
      const [download] = await Promise.all([s.page.waitForEvent('download', { timeout: 40000 }), s.page.reload()]);
      expect(download.suggestedFilename()).toContain('-local-copy.zip');
      await s.page.waitForFunction(() => (globalThis as any).eval('typeof currentFileId !== "undefined" && !!currentFileId'), null, { timeout: 40000 });
      const info = await s.page.evaluate(async () => {
        const w = window as any;
        const { fs } = w.BrowserGit.getFs();
        const head = await w.git.resolveRef({ fs, dir: w.BrowserGit.getDir(), ref: 'HEAD' }).then(() => true).catch(() => false);
        return { head, files: (await w.BrowserGit.listFiles()).map((f: any) => f.path) };
      });
      expect(info.head).toBe(true);
      expect(info.files).toContain('references.bib');
    } finally { await s.context.close(); }
  });

  test('an empty .git skeleton (no HEAD) is not taken for a clone, and the next open downloads the project again', async () => {
    const s = await newSession();
    try {
      await openProject(s.page);
      // what a race left behind: .git with refs/ and objects/ but no HEAD, and no project files
      await s.page.evaluate(async () => {
        const w = window as any; const { pfs } = w.BrowserGit.getFs(); const dir = w.BrowserGit.getDir();
        await w.BrowserGit.wipe();
        await pfs.mkdir(dir + '/.git').catch(() => {});
        await pfs.mkdir(dir + '/.git/refs').catch(() => {});
        await pfs.mkdir(dir + '/.git/objects').catch(() => {});
      });
      expect(await s.page.evaluate(() => (window as any).BrowserGit.isCloned())).toBe(false);
      await new Promise(r => setTimeout(r, 2000)); // storage writes in the background
      await s.page.reload();
      await s.page.waitForFunction(() => (globalThis as any).eval('typeof currentFileId !== "undefined" && !!currentFileId'), null, { timeout: 40000 });
      const info = await s.page.evaluate(async () => {
        const w = window as any;
        const head = await w.git.resolveRef({ fs: w.BrowserGit.getFs().fs, dir: w.BrowserGit.getDir(), ref: 'HEAD' }).then(() => true).catch(() => false);
        return { head, files: (await w.BrowserGit.listFiles()).map((f: any) => f.path) };
      });
      expect(info.head).toBe(true);
      expect(info.files).toContain('references.bib');
    } finally { await s.context.close(); }
  });

  test('what has not been pushed is remembered (and goes away when pushed or postponed)', async () => {
    const s = await newSession();
    try {
      await openProject(s.page);
      await ev(s.page, `window.__unsentAfterMs = 0; window.__unsentRepeatMs = 60000;`);
      await ev(s.page, `BrowserGit.writeFile('local-only.txt', '1').then(() => BrowserGit.commit('local-only commit'))`); // ahead of GitHub
      await ev(s.page, 'checkGitStatus()');
      await s.page.waitForSelector('#gr-unsent', { timeout: 15000 });
      expect(await s.page.textContent('#gr-unsent')).toContain('1');
      expect(await s.page.getAttribute('#git-push-btn', 'title')).toContain('not yet pushed');
      await s.page.click('#gr-unsent-later');
      expect(await s.page.locator('#gr-unsent').count()).toBe(0);
      await ev(s.page, 'checkGitStatus()');
      expect(await s.page.locator('#gr-unsent').count()).toBe(0); // postponed: does not insist right after
      await ev(s.page, `window.__unsentRepeatMs = 0`);
      await ev(s.page, 'checkGitStatus()');
      await s.page.waitForSelector('#gr-unsent');
      await s.page.click('#gr-unsent-send');
      await s.page.waitForSelector('#git-push-modal', { state: 'visible' });
    } finally { await s.context.close(); }
  });

  test('asks the browser not to wipe the project data', async () => {
    const s = await newSession();
    try {
      await s.page.addInitScript(() => {
        Object.defineProperty(navigator, 'storage', {
          value: { persist: () => { (window as any).__persistCalled = true; return Promise.resolve(true); }, persisted: () => Promise.resolve(false), estimate: () => Promise.resolve({ usage: 1, quota: 100 }) },
        });
      });
      await openProject(s.page);
      await poll(() => ev(s.page, 'window.__persistCalled === true'), v => v === true, 20000);
      expect(await ev(s.page, 'window.__storagePersisted')).toBe(true);
    } finally { await s.context.close(); }
  });
});
