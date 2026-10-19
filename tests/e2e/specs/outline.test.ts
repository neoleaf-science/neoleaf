import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, type Session } from '../helpers';

describe('document structure from the main file', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); });
  afterAll(async () => { await s.context.close(); });

  test('parse: follows input/include/subfile, ignores comments and finds orphans', async () => {
    await openProject(s.page);
    const r = await s.page.evaluate(() => {
      const files: Record<string, string> = {
        'main.tex': '\\documentclass{article}\n\\begin{document}\n\\section{Start \\label{a}}\n\\input{sections/intro}\n% \\input{sections/commented}\n\\include{sections/metodo.tex}\n\\subfile{sections/fim}\n\\section[short]{Last}\n\\end{document}',
        'sections/intro.tex': '\\section{Introduction}\n\\subsection{Motivation \\texorpdfstring{$x$}{x}}\n\\input{sections/intro}',
        'sections/metodo.tex': '\\section*{Method}\n\\subsubsection{Detail}',
        'sections/fim.tex': '\\section{Conclusion}',
        'sections/commented.tex': '\\section{Hidden}',
        'standalone.tex': '\\section{Loose}',
      };
      return (window as any).LDOutline.parse(files, 'main.tex');
    });
    expect(r.items.map((i: any) => `${i.path}:${i.line}:${i.title}`)).toEqual([
      'main.tex:3:Start',
      'sections/intro.tex:1:Introduction',
      'sections/intro.tex:2:Motivation $x$',
      'sections/metodo.tex:1:Method',
      'sections/metodo.tex:2:Detail',
      'sections/fim.tex:1:Conclusion',
      'main.tex:8:Last',
    ]);
    expect(r.orphans.map((o: any) => o.path)).toEqual(['sections/commented.tex', 'standalone.tex']);
  });

  test('the panel shows the whole project and clicking opens the file of the section', async () => {
    await s.page.evaluate(async () => {
      const B = (window as any).BrowserGit;
      const main = '\\documentclass{article}\n\\begin{document}\n\\section{First}\n\\input{sections/b}\n\\end{document}\n';
      await B.writeFile('main.tex', main);
      (globalThis as any).eval('editor').setValue(main);
      await B.writeFile('sections/b.tex', '\\section{Inside B}\n\nTexto\n\\subsection{Sub of B}\n');
      await (window as any).FT.refreshFromBrowserGit();
    });
    await s.page.waitForFunction(() => [...document.querySelectorAll('#outline-list .ol-title')].some(e => e.textContent === 'Sub of B'), null, { timeout: 15000 });
    const titles = await s.page.$$eval('#outline-list .ol-title', els => els.map(e => e.textContent));
    expect(titles).toEqual(['First', 'Inside B', 'Sub of B']);
    await s.page.click('#outline-list .outline-item:has-text("Sub of B")');
    await s.page.waitForFunction(() => (globalThis as any).eval('currentFileId') === 'sections/b.tex', null, { timeout: 10000 });
    await s.page.waitForFunction(() => (globalThis as any).eval('editor').getPosition().lineNumber === 4, null, { timeout: 10000 });
  });
});
