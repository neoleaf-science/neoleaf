import { afterAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, poll, type Session } from '../helpers';

// "Build the PDF on GitHub": the workflow text, and the button that opens GitHub's web editor with it filled in (NeoLeaf does not push workflow files).

let s: Session;
afterAll(async () => { await s?.context.close(); });

const build = (main: string, engine?: string) => s.page.evaluate(([m, e]) => (window as any).CIWorkflow.build(m, e), [main, engine] as any);

describe('CI workflow', () => {
  test('pdfLaTeX: pinned actions, the main file, and the PDF as an artifact', async () => {
    s = await newSession();
    await openProject(s.page);
    const y = await build('main.tex');
    expect(y).toContain('name: Build PDF');
    expect(y).toContain('permissions:\n  contents: read');
    expect(y).toMatch(/uses: actions\/checkout@[0-9a-f]{40} # v/);
    expect(y).toMatch(/uses: xu-cheng\/latex-action@[0-9a-f]{40} # /);
    expect(y).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40} # v/);
    expect(y).toContain('root_file: main.tex');
    expect(y).toContain('path: main.pdf');
    expect(y).not.toContain('latexmk_use');
    expect(y).not.toContain('work_in_root_file_dir');
  }, 120000);

  test('XeLaTeX and LuaLaTeX set the engine, a main file in a folder works from there, Typst uses its own setup', async () => {
    expect(await build('main.tex', 'wasm-xelatex')).toContain('latexmk_use_xelatex: true');
    expect(await build('main.tex', 'wasm-lualatex')).toContain('latexmk_use_lualatex: true');
    const sub = await build('paper/thesis.tex');
    expect(sub).toContain('root_file: paper/thesis.tex');
    expect(sub).toContain('work_in_root_file_dir: true');
    expect(sub).toContain('path: paper/thesis.pdf');
    const typ = await build('main.typ', 'wasm-typst');
    expect(typ).toMatch(/uses: typst-community\/setup-typst@[0-9a-f]{40} # v/);
    expect(typ).toContain('run: typst compile main.typ main.pdf');
    expect(typ).not.toContain('latex-action');
  }, 60000);

  test('a main file name that could change the YAML is refused', async () => {
    for (const bad of ['my paper.tex', 'a: b.tex', 'x".tex', '../main.tex', '-x.tex', 'a\nb.tex', '']) {
      const r = await s.page.evaluate(m => { try { (window as any).CIWorkflow.build(m, 'wasm-texlive'); return 'built'; } catch (e: any) { return 'refused'; } }, bad);
      expect(r).toBe('refused');
    }
  }, 60000);

  test('the address opens the new-file page of the repository with the file name and the text filled in', async () => {
    const r = await s.page.evaluate(() => {
      const C = (window as any).CIWorkflow;
      const text = C.build('main.tex', 'wasm-texlive');
      const url = new URL(C.githubUrl('some-owner', 'my.repo', 'feature/x', text));
      return { origin: url.origin, path: url.pathname, name: url.searchParams.get('filename'), same: url.searchParams.get('value') === text };
    });
    expect(r).toEqual({ origin: 'https://github.com', path: '/some-owner/my.repo/new/feature%2Fx', name: '.github/workflows/build-pdf.yml', same: true });
  }, 60000);

  test('the settings window has the button: it opens GitHub, and is off once the workflow is in the project', async () => {
    await s.context.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>github</body></html>' }));
    await s.page.evaluate(() => (globalThis as any).eval('openProject()'));
    await s.page.waitForSelector('#cfg-ci-open', { state: 'visible' });
    expect(await s.page.isDisabled('#cfg-ci-open')).toBe(false);
    const [popup] = await Promise.all([s.context.waitForEvent('page'), s.page.click('#cfg-ci-open')]);
    const url = new URL(popup.url());
    expect(url.origin + url.pathname).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/new\/main$/);
    expect(url.searchParams.get('filename')).toBe('.github/workflows/build-pdf.yml');
    expect(url.searchParams.get('value')).toContain('root_file: main.tex');
    await popup.close();
    expect(await s.page.textContent('#cfg-ci-msg')).toContain('commit it there');
    // the file is already in the project: nothing to add
    await s.page.evaluate(async () => { await (window as any).BrowserGit.writeFile('.github/workflows/build-pdf.yml', 'name: Build PDF\n'); });
    await s.page.evaluate(() => (globalThis as any).eval('closeProject()'));
    await s.page.evaluate(() => (globalThis as any).eval('openProject()'));
    await poll(() => s.page.isDisabled('#cfg-ci-open'), d => d === true, 10000);
    expect(await s.page.textContent('#cfg-ci-msg')).toContain('already in the project');
  }, 90000);
});
