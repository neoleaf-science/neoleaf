import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, demoRemoteFile, newSession, openProject, poll, type Session } from '../helpers';

// In the demo, Git is served by the workspace's local repository (src/demo_git.rs), not by the GitHub proxy.
describe('Git in the browser (demo)', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('the clone really works (history and repository files)', async () => {
    const info = await s.page.evaluate(async () => {
      const w = window as any;
      const { fs } = w.BrowserGit.getFs();
      const log = await w.git.log({ fs, dir: w.BrowserGit.getDir() });
      const files = (await w.BrowserGit.listFiles()).map((f: any) => f.path);
      return { commits: log.length, files };
    });
    expect(info.commits).toBeGreaterThan(0);
    expect(info.files).toContain('main.tex');
    expect(info.files).toContain('references.bib');
  });

  test('browser commit + push reach the server repository', async () => {
    const marker = `% push-e2e-${Date.now()}`;
    await s.page.evaluate(async m => {
      const bg = (window as any).BrowserGit;
      const cur = await bg.readFile('references.bib');
      await bg.writeFile('references.bib', cur + '\n' + m + '\n');
      await bg.commit('test: push e2e');
      await bg.push();
    }, marker);
    const server = await poll(
      async () => demoRemoteFile('demo__artigo-1', 'references.bib'),
      c => c.includes(marker),
      15000,
    );
    expect(server).toContain(marker);
  });

  test('the Git endpoint rejects visitors and invalid names', async () => {
    const anon = await (await import('../helpers')).getBrowser().then(b => b.newContext());
    const r1 = await anon.request.get(`${BASE_URL}/api/git/demo/artigo-1/info/refs?service=git-upload-pack`);
    expect(r1.status()).not.toBe(200); // without a session it falls to the GitHub proxy, which requires credentials
    await anon.close();
    const r2 = await s.page.request.get(`${BASE_URL}/api/git/demo/..%2F..%2Fetc/info/refs?service=git-upload-pack`);
    expect(r2.status()).not.toBe(200);
    const r3 = await s.page.request.get(`${BASE_URL}/api/git/outro/inexistente/info/refs?service=git-upload-pack`);
    expect(r3.status()).toBe(404);
  });
});

// Automatic pull on open and modals for what comes in and goes out (two people on the same demo project).
describe('Git: automatic pull and pull/push review', () => {
  let a: Session, b: Session;
  const stamp = Date.now();
  const pushFrom = async (who: Session, marker: string) => {
    await who.page.evaluate(async m => {
      const bg = (window as any).BrowserGit;
      const cur = await bg.readFile('references.bib');
      await bg.writeFile('references.bib', cur + '\n' + m + '\n');
      await bg.commit('test: ' + m);
      await bg.push();
    }, marker);
  };
  const bibText = (who: Session) => who.page.evaluate(async () => (await (window as any).BrowserGit.readFile('references.bib')) as string);

  beforeAll(async () => {
    a = await newSession(); b = await newSession();
    await openProject(a.page); await openProject(b.page);
  });
  afterAll(async () => { await a.context.close(); await b.context.close(); });

  test('the Pull button shows how many commits arrive and the modal lists commit, file and diff', async () => {
    const m1 = `% auto-pull-1-${stamp}`;
    await pushFrom(b, m1);
    await a.page.evaluate(() => (window as any).checkGitStatus());
    await a.page.waitForSelector('#git-pull-btn', { state: 'visible' });
    expect(await a.page.textContent('#git-pull-label')).toContain('(1)');
    await a.page.click('#git-pull-btn');
    await a.page.waitForSelector('#git-pull-modal', { state: 'visible' });
    await poll(() => a.page.textContent('#git-pull-changes'), t => !!t && t.includes('references.bib') && t.includes(m1), 15000);
    expect(await a.page.textContent('#git-pull-changes')).toContain('test: ' + m1);
    expect(await a.page.isEnabled('#btn-pull-submit')).toBe(true);
    await a.page.click('#git-pull-modal button:has-text("Cancel")');
  });

  test('on opening the project, what arrived on GitHub is pulled automatically and announced', async () => {
    const m1 = `% auto-pull-1-${stamp}`;
    await openProject(a.page);
    await poll(() => bibText(a), t => t.includes(m1), 20000);
    await a.page.waitForSelector('#gr-toast', { state: 'visible' });
    expect(await a.page.textContent('#gr-toast')).toContain('Updated from GitHub');
  });

  test('news in a file you also changed: does not pull, warns; the push modal shows what goes up', async () => {
    const m2 = `% auto-pull-2-${stamp}`, mine = `% my-change-${stamp}`;
    await pushFrom(b, m2);
    await a.page.evaluate(async t => {
      const bg = (window as any).BrowserGit;
      await bg.writeFile('references.bib', (await bg.readFile('references.bib')) + '\n' + t + '\n');
    }, mine);
    await openProject(a.page);
    await a.page.waitForSelector('#gr-toast', { state: 'visible' });
    await poll(() => a.page.textContent('#gr-toast'), t => !!t && t.includes('also changed'), 20000);
    expect(await bibText(a)).not.toContain(m2);
    expect(await bibText(a)).toContain(mine);

    await a.page.evaluate(() => (window as any).openGitPushModal());
    await poll(() => a.page.textContent('#git-push-changes'), t => !!t && t.includes('references.bib') && t.includes(mine), 15000);
    expect(await a.page.isVisible('#git-push-behind')).toBe(true);
    await a.page.click('#btn-push-cancel');

    // the pull modal warns about the possible conflict
    await a.page.click('#git-pull-btn');
    await poll(() => a.page.textContent('#git-pull-warn'), t => !!t && t.includes('references.bib'), 15000);
    expect(await a.page.textContent('#git-pull-changes')).toContain(m2);
  });
});

describe('Git: reset (GitHub overwrites the local copy)', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('the modal lists what will be lost and the reset leaves the project equal to the remote', async () => {
    const mine = `% only-exists-locally-${Date.now()}`;
    const remoteBib = await s.page.evaluate(async () => (await (window as any).BrowserGit.readFile('references.bib')) as string);
    await s.page.evaluate(async m => {
      const bg = (window as any).BrowserGit;
      await bg.writeFile('references.bib', (await bg.readFile('references.bib')) + '\n' + m + '\n');
      await bg.commit('local-only commit'); // ahead of GitHub
      await bg.writeFile('local-notes.tex', 'local draft\n'); // new file, not on GitHub
    }, mine);

    await s.page.click('#git-reset-btn');
    await s.page.waitForSelector('#git-reset-modal', { state: 'visible' });
    await poll(() => s.page.textContent('#git-reset-changes'), t => !!t && t.includes('references.bib') && t.includes(mine) && t.includes('local-only commit'), 15000);
    expect(await s.page.textContent('#git-reset-changes')).toContain('local-notes.tex');

    const reloaded = s.page.waitForEvent('load');
    await s.page.click('#btn-reset-submit');
    await reloaded;
    await s.page.waitForSelector('.monaco-editor');
    await poll(() => s.page.evaluate(async () => {
      const bg = (window as any).BrowserGit;
      try { return !!bg && (await bg.isCloned()) ? ((await bg.readFile('references.bib')) as string) : null; } catch (_) { return null; }
    }), t => t !== null, 30000);
    const after = await s.page.evaluate(async () => {
      const bg = (window as any).BrowserGit;
      const files = (await bg.listFiles()).map((f: any) => f.path);
      const st = await bg.status();
      return { bib: (await bg.readFile('references.bib')) as string, files, dirty: st.uncommitted, cmp: await bg.compare() };
    });
    expect(after.bib).not.toContain(mine);
    expect(after.bib.trim()).toBe(remoteBib.trim());
    expect(after.files).not.toContain('local-notes.tex');
    expect(after.dirty).toBe(false);
    expect(after.cmp.ahead).toBe(0);
  });
});
