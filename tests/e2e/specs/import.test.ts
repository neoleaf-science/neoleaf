import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BASE_URL, fake, newSession, openProject, type Session } from '../helpers';

function makeZip(): string {
  const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-zip-')), 'p.zip');
  const py = `import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
    z.writestr('sbqs2024.tex', r'\\documentclass{article}\\begin{document}SBQS\\end{document}')
    z.writestr('figures/diagram.png', bytes([137,80,78,71,13,10,26,10]))
`;
  const r = spawnSync('python3', ['-c', py, zip]);
  if (r.status !== 0) throw new Error('failed to create the zip');
  return zip;
}

describe('import and BrowserGit', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('BrowserGit stores and returns binaries without corrupting them', async () => {
    const ok = await s.page.evaluate(async () => {
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
      await (window as any).BrowserGit.writeFile('images/t.png', bytes);
      const all = await (window as any).BrowserGit.getAllTexAndAssetFiles();
      const back = all['images/t.png'];
      return back instanceof Uint8Array && back.length === bytes.length && back.every((b: number, i: number) => b === bytes[i]);
    });
    expect(ok).toBe(true);
  });

  test('project with __ in the repository name opens and receives the push (owner__repo id only splits at the first __)', async () => {
    const b64 = fs.readFileSync(makeZip()).toString('base64');
    await s.page.goto(BASE_URL + '/');
    await s.page.waitForFunction(() => !!(window as any).ProjectImport);
    const id = await s.page.evaluate(async content => {
      const bin = Uint8Array.from(atob(content), c => c.charCodeAt(0));
      return (window as any).ProjectImport.start(new File([bin], 'p.zip'), 'tese___test_smells__estudo');
    }, b64);
    expect(id).toBe('demo__tese___test_smells__estudo');
    await openProject(s.page, id);
    expect(await s.page.locator('.monaco-editor').count()).toBeGreaterThan(0);
    const tree = () => fake.tree('demo', 'tese___test_smells__estudo');
    for (let i = 0; i < 40 && !tree().includes('sbqs2024.tex'); i++) await new Promise(r => setTimeout(r, 500));
    expect(tree()).toContain('sbqs2024.tex');
  });

  test('suggested name when choosing the ZIP: lowercase, no accents, spaces become _', async () => {
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => (window as any).openImportModal());
    await s.page.setInputFiles('#imp-file', { name: 'Relatório Final Ação 2024.zip', mimeType: 'application/zip', buffer: Buffer.from(fs.readFileSync(makeZip())) });
    expect(await s.page.inputValue('#imp-name')).toBe('relatorio_final_acao_2024');
  });

  test('import ZIP in the browser: without README.md or main.tex, main file detected and pushed to the repository', async () => {
    const b64 = fs.readFileSync(makeZip()).toString('base64');
    await s.page.goto(BASE_URL + '/');
    await s.page.waitForFunction(() => !!(window as any).ProjectImport);
    const id = await s.page.evaluate(async content => {
      const bin = Uint8Array.from(atob(content), c => c.charCodeAt(0));
      return (window as any).ProjectImport.start(new File([bin], 'p.zip'), 'e2e-importado');
    }, b64);
    expect(id).toBe('demo__e2e-importado');
    await openProject(s.page, id);
    const listFiles = (): Promise<string[]> => s.page.evaluate(async () => Object.keys(await (window as any).BrowserGit.getAllTexAndAssetFiles()));
    let files: string[] = [];
    for (let i = 0; i < 60 && !files.includes('sbqs2024.tex'); i++) { files = await listFiles(); if (!files.includes('sbqs2024.tex')) await new Promise(r => setTimeout(r, 500)); }
    expect(files).toContain('sbqs2024.tex');
    expect(files.some(f => f.endsWith('README.md') || f.endsWith('main.tex'))).toBe(false);
    // the main file was detected and the editor opened that file
    expect(JSON.parse(await s.page.evaluate(() => (window as any).BrowserGit.readFile('.neoleaf/config.json'))).mainFile).toBe('sbqs2024.tex');
    expect(await s.page.evaluate(() => (globalThis as any).eval('currentFileId'))).toBe('sbqs2024.tex');
    // and the push reached the repository (the remote is the fake GitHub)
    const tree = () => fake.tree('demo', 'e2e-importado');
    for (let i = 0; i < 40 && !tree().includes('sbqs2024.tex'); i++) await new Promise(r => setTimeout(r, 500));
    expect(tree()).toContain('sbqs2024.tex');
    expect(tree()).toContain('figures/diagram.png');
    expect(tree()).toContain('.gitignore');
    expect(tree()).toContain('.neoleaf/config.json');
    // the initial commit carries the name of whoever imported, not a generic name
    const log = await s.page.evaluate(async () => (await (window as any).BrowserGit.fileLog('sbqs2024.tex')).map((c: any) => c.commit.author.name + '|' + c.commit.author.email));
    expect(log.length).toBeGreaterThan(0);
    expect(log[log.length - 1]).toMatch(/^Demo User\|\d+\+demo@users\.noreply\.github\.com$/);
  });

  test('new project from scratch: the template goes from the browser to the repository', async () => {
    await s.page.goto(BASE_URL + '/');
    await s.page.waitForFunction(() => !!(window as any).ProjectImport);
    const id = await s.page.evaluate(() => (window as any).ProjectImport.startNew('e2e-novo', 'article'));
    expect(id).toBe('demo__e2e-novo');
    await openProject(s.page, id);
    expect(await s.page.evaluate(() => (globalThis as any).eval('editor.getValue()'))).toContain('My Article on NeoLeaf');
    const show = (f: string) => fake.file('demo', 'e2e-novo', f);
    for (let i = 0; i < 40 && !show('main.tex'); i++) await new Promise(r => setTimeout(r, 500));
    expect(show('main.tex')).toContain('My Article on NeoLeaf');
    expect(show('README.md')).toContain('e2e-novo');
  });

  test('file in a subfolder keeps its content when opened', async () => {
    const txt = '# Subpasta\n\nNão pode sumir.';
    const got = await s.page.evaluate(async t => {
      await (window as any).BrowserGit.writeFile('docs/README.md', t);
      await (globalThis as any).switchFile('docs/README.md', 'README.md');
      await new Promise(r => setTimeout(r, 2000));
      return (globalThis as any).eval('editor.getValue()');
    }, txt);
    expect(got).toBe(txt);
  });
});
