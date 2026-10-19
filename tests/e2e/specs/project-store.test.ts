import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fake, newSession, openProject, poll, testWorkDir, type Session } from '../helpers';

// Config, comments, milestones, extra packages, authorship and PDF live in the browser (.neoleaf/ of the local clone), through the
// `Project` object (static/js/project-store.js), not on the server.
describe('project data only in the browser (.neoleaf/)', () => {
  let s: Session;
  // runs an expression in the page: returns the value, or throws the error (message) that Project threw
  const run = (page: Session['page'], expr: string) => page.evaluate(async code => {
    try { return { ok: await (0, eval)(code) }; } catch (e: any) { return { err: String(e.message || e) }; }
  }, expr);
  const call = async (expr: string, page = s.page) => { const r = await run(page, expr) as any; if (r.err) throw new Error(r.err); return r.ok; };
  const fails = async (expr: string, page = s.page) => ((await run(page, expr)) as any).err as string | undefined;
  const git = (code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<any>;
  const P = 'demo__artigo-1';

  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('config: saved in .neoleaf/config.json of the local clone', async () => {
    expect((await call(`Project.config.save({ mainFile: 'main.tex', engine: 'wasm-xelatex', autoInstall: false, autoSync: true, autoSyncInterval: 7, scope: 'project' })`)).success).toBe(true);
    const d = await call(`Project.config.get()`);
    expect(d.config.engine).toBe('wasm-xelatex');
    expect(d.config.autoInstall).toBe(false);
    expect(d.config.autoSyncInterval).toBe(7);
    expect(d.texFiles).toContain('main.tex');
    expect(await git(`BrowserGit.readFile('.neoleaf/config.json')`)).toContain('wasm-xelatex');
    expect(await fails(`Project.config.save({ mainFile: '../x.tex', engine: 'wasm-xelatex', scope: 'project' })`)).toContain('Invalid main file');
    await call(`Project.config.save({ mainFile: 'main.tex', engine: 'wasm-texlive', autoInstall: true, scope: 'project' })`);
  });

  test('comments: add, reply, resolve and delete', async () => {
    let d = await call(`Project.comments.op({ op: 'add', file: 'main.tex', range: { sl: 1, sc: 1, el: 1, ec: 5 }, quote: 'abcd', text: 'first comment' })`);
    expect(d.threads.length).toBe(1);
    const id = d.threads[0].id;
    d = await call(`Project.comments.op({ op: 'reply', thread: '${id}', text: 'reply' })`);
    expect(d.threads[0].messages.length).toBe(2);
    d = await call(`Project.comments.op({ op: 'resolve', thread: '${id}', resolved: true })`);
    expect(d.threads[0].resolved).toBe(true);
    expect(await fails(`Project.comments.op({ op: 'add', file: 'main.tex', range: { sl: 0, sc: 1, el: 1, ec: 1 }, text: 'x' })`)).toBe('Invalid passage');
    expect(await git(`BrowserGit.readFile('.neoleaf/comments.json')`)).toContain('first comment');
    d = await call(`Project.comments.op({ op: 'delete', thread: '${id}' })`);
    expect(d.threads.length).toBe(0);
  });

  test('milestones: create, list, open and delete (files in .neoleaf/milestones)', async () => {
    const m = await call(`Project.milestones.create({ name: 'Version 1', note: 'before the review' })`);
    expect(m.name).toBe('Version 1');
    const list = await call(`Project.milestones.list()`);
    expect(list.map((x: any) => x.id)).toContain(m.id);
    const one = await call(`Project.milestones.get(${JSON.stringify(m.id)})`);
    expect(one.files.map((f: any) => f.name)).toContain('main.tex');
    expect(await git(`BrowserGit.getFs().pfs.readdir(BrowserGit.getDir() + '/.neoleaf/milestones')`)).toContain(m.id);
    await call(`Project.milestones.remove(${JSON.stringify(m.id)})`);
    expect((await call(`Project.milestones.list()`)).length).toBe(0);
  });

  test('extra packages: single file and zip, in the project and global', async () => {
    const up = await call(`Project.texmf.upload({ scope: 'project', name: 'mypackage.sty', content: btoa('\\\\ProvidesPackage{mypackage}\\n') })`);
    expect(up.kind).toBe('file');
    expect(await fails(`Project.texmf.upload({ scope: 'project', name: 'virus.exe', content: btoa('x') })`)).toContain('not allowed');
    // zip with a TDS tree: only tex/ goes in, flattened by name
    const zipB64 = await call(`(() => { const enc = new TextEncoder(); return Project.toB64(Zip.write([{ name: 'tex/latex/zz/zz.sty', bytes: enc.encode('\\\\ProvidesPackage{zz}') }, { name: 'doc/manual.tex', bytes: enc.encode('doc') }])); })()`);
    const z = await call(`Project.texmf.upload({ scope: 'global', name: 'zz.zip', content: ${JSON.stringify(zipB64)} })`);
    expect(z.kind).toBe('package');
    const list = await call(`Project.texmf.list()`);
    expect(list.project.map((i: any) => i.name)).toContain('mypackage.sty');
    expect(list.global.map((i: any) => i.name)).toContain('zz.zip');
    const names = await call(`Project.texmf.files(${JSON.stringify(z.id)}).then(fs => fs.map(f => f.name))`);
    expect(names).toEqual(['zz.sty']);
    const build = await call(`Project.build().then(b => b.texmf.map(i => i.name))`);
    expect(build).toEqual(expect.arrayContaining(['mypackage.sty', 'zz.zip']));
    await call(`Project.texmf.remove(${JSON.stringify(up.id)})`);
    await call(`Project.texmf.remove(${JSON.stringify(z.id)})`);
    const after = await call(`Project.texmf.list()`);
    expect(after.project.length + after.global.length).toBe(0);
  });

  test('authorship: what the person types becomes an entry in .neoleaf/history/', async () => {
    await poll(() => git('window.collabActive === true'), v => v === true, 20000);
    await git(`editor.setValue('% authorship-e2e\\n' + editor.getValue())`);
    const entries = await poll(() => call(`Project.history.list()`), r => (r || []).some((e: any) => e.added > 0), 15000);
    expect(entries[0].user.name).toBeTruthy();
    expect(entries[0].file).toBe('main.tex');
  });

  test('last PDF: kept in the browser after compiling (not on the server)', async () => {
    await s.page.click('#compile-btn');
    const meta = await poll(() => call(`Project.pdf.meta()`), m => m.available === true, 120000);
    expect(meta.engine).toMatch(/^wasm-/);
    const head = await call(`Project.pdf.file().then(b => new TextDecoder().decode(b.slice(0, 5)))`);
    expect(head).toBe('%PDF-');
    expect(await git(`BrowserGit.getFs().pfs.readdir(BrowserGit.getDir() + '/.neoleaf')`)).toContain('last.pdf');
  });

  test('the project page is only the shell: it brings no tree or text from the server', async () => {
    const html = await s.page.evaluate(async id => (await fetch(`/project/${id}`)).text(), P);
    expect(html).not.toContain('Meu Artigo no NeoLeaf');
    expect(html).not.toContain('references.bib');
    expect(html).toContain('JSON.parse("[]")');
    // and even so the editor opens the main file, coming from the browser clone
    expect(await git('currentFileId')).toBe('main.tex');
    expect(await git('editor.getValue().length > 50')).toBe(true);
  });

  test('line-by-line authorship (blame) and file history come from the browser Git', async () => {
    const blame = await s.page.evaluate(async () => (await (window as any).BrowserGit.blame('main.tex')) as any[]);
    const lines = (await git(`editor.getValue().split('\\n').length`)) as number;
    expect(blame.length).toBeGreaterThan(5);
    expect(Math.abs(blame.length - lines)).toBeLessThanOrEqual(2);
    expect(blame.every(b => typeof b.author === 'string' && b.author.length > 0)).toBe(true);
    const log = await s.page.evaluate(async () => (await (window as any).BrowserGit.fileLog('main.tex')).length);
    expect(log).toBeGreaterThanOrEqual(1);
  });

  test('export the source code (.zip): the ZIP is built in the browser', async () => {
    const [download] = await Promise.all([s.page.waitForEvent('download'), s.page.evaluate(() => (window as any).ExportMenu.downloadZip())]);
    expect(download.suggestedFilename()).toBe('artigo-1.zip');
    const file = path.join(testWorkDir(), 'export.zip');
    await download.saveAs(file);
    const names = spawnSync('python3', ['-c', 'import zipfile,sys;print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', file], { encoding: 'utf8' }).stdout.split('\n');
    expect(names).toContain('main.tex');
    expect(names).toContain('references.bib');
    expect(names.some(n => n.startsWith('.neoleaf'))).toBe(false);
  });

  test('automatically installed packages stay in the local cache, outside Git', async () => {
    await s.page.route('**/api/ctan/package', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ package: 'package-cache', files: [{ name: 'packagecache.sty', b64: Buffer.from('\\ProvidesPackage{packagecache}\n').toString('base64') }] }),
    }));
    const r = await call(`Project.texmf.import({ scope: 'cache', package: 'package-cache' }).then(x => x.item)`);
    expect(r.scope).toBe('cache');
    const list = await call(`Project.texmf.list()`);
    expect(list.project.map((i: any) => i.name)).toContain('package-cache.zip'); // shows in the list, so it can be removed
    expect(await call(`Project.build().then(b => b.texmf.map(i => i.name))`)).toContain('package-cache.zip'); // and goes into the build
    const changes = await s.page.evaluate(async () => (await (window as any).BrowserGit.status()).changes.map((c: any) => c.file));
    expect(changes.some((f: string) => f.includes('.neoleaf/cache') || f.includes('package-cache'))).toBe(false); // but it does not go in the push
    await call(`Project.texmf.remove(${JSON.stringify(r.id)})`);
    await s.page.unroute('**/api/ctan/package');
  });

  test('packages that old versions installed automatically move from .neoleaf/texmf to the cache', async () => {
    const s2 = await newSession();
    try {
      await openProject(s2.page);
      await s2.page.evaluate(async () => {
        const w = window as any;
        const zip = w.Zip.write([{ name: 'legacy.sty', bytes: new TextEncoder().encode('\\ProvidesPackage{legacy}') }]);
        await w.BrowserGit.writeFile('.neoleaf/texmf/legacy.zip', zip);
      });
      await new Promise(r => setTimeout(r, 2000)); // LightningFS writes to IndexedDB in the background
      await openProject(s2.page); // the migration runs on the first query of each page load
      const list = await call(`Project.texmf.list()`, s2.page);
      expect(list.project.find((i: any) => i.name === 'legacy.zip').scope).toBe('cache');
      const st = await s2.page.evaluate(async () => (await (window as any).BrowserGit.status()).changes.map((c: any) => c.file));
      expect(st.some((f: string) => f.includes('legacy'))).toBe(false);
    } finally { await s2.context.close(); }
  });

  test('the commit does not abort because of a file that vanished from disk', async () => {
    const s3 = await newSession();
    try {
      await openProject(s3.page);
      const ok = await s3.page.evaluate(async () => {
        const w = window as any;
        const bg = w.BrowserGit;
        await bg.writeFile('ghost.txt', 'x');
        const { fs } = bg.getFs();
        await w.git.add({ fs, dir: bg.getDir(), filepath: 'ghost.txt' });   // goes into the index...
        await bg.getFs().pfs.unlink(bg.getDir() + '/ghost.txt');             // ...and vanishes from disk
        await bg.writeFile('real.txt', 'y');
        await bg.commit('ghost file test');
        return (await bg.status()).uncommitted;
      });
      expect(ok).toBe(false);
    } finally { await s3.context.close(); }
  });

  test('the server stored none of this: neither on disk nor on GitHub (nothing was sent)', () => {
    expect(fs.existsSync(path.join(testWorkDir(), 'repos'))).toBe(false); // the server has no projects folder
    const noGithub = fake.tree('demo', 'artigo-1');
    for (const rel of ['.neoleaf/milestones', '.neoleaf/comments.json', '.neoleaf/texmf', '.neoleaf/history', '.neoleaf/last.pdf']) {
      expect(noGithub.some(f => f.startsWith(rel))).toBe(false); // it only goes to GitHub on push, which these tests do not do
    }
  });

  test('package cache from old versions (without images, e.g. beamer) is emptied once; afterwards it is kept', async () => {
    const key = `ld-texmf-cache-v-${P}`;
    const zip = 'new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])';
    const names = async () => (await call(`Project.texmf.list()`)).project.map((x: any) => x.name);
    await git(`BrowserGit.writeFile('.neoleaf/cache/texmf/old.zip', ${zip})`);
    await git(`localStorage.removeItem(${JSON.stringify(key)})`);
    expect(await names()).not.toContain('old.zip');
    expect(await git(`localStorage.getItem(${JSON.stringify(key)})`)).toBe('2');
    await git(`BrowserGit.writeFile('.neoleaf/cache/texmf/new.zip', ${zip})`);
    expect(await names()).toContain('new.zip');
    await call(`Project.texmf.remove('c:new.zip')`);
  });
});
