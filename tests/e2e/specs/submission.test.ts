import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { newSession, openProject, poll, type Session } from '../helpers';

// Prepare for submission: what the checks find, what goes into the ZIP, and the comments taken out of the .tex files.

let s: Session;
afterAll(async () => { await s?.context.close(); });

type F = { path: string; text?: string | null; size?: number };
const analyze = (files: F[], main: string, extra: any = {}) => s.page.evaluate(([fs, m, x]) => {
  const list = (fs as any[]).map(f => ({ path: f.path, text: f.text ?? null, size: f.size ?? (f.text ? f.text.length : 100) }));
  const r = (window as any).Submission.analyze({ files: list, main: m, bbl: (x as any).bbl || null, log: (x as any).log || null });
  return { used: [...r.used].sort(), unused: r.unused.sort(), problems: r.problems.map((p: any) => `${p.level}:${p.code}:${p.file}:${p.line}:${p.args.join('|')}`) };
}, [files, main, extra] as any);

const MAIN = [
  '\\documentclass{article}', '\\usepackage{mystyle}', '\\usepackage{todonotes}', '\\begin{document}',
  '%\\input{commented}', '\\input{sections/intro}', '\\includegraphics{figs/a}', '\\includegraphics[width=3cm]{figs/missing}',
  'See \\cite{k1,k2} and \\ref{sec:intro} and \\ref{nope}.', '\\begin{verbatim}', '\\input{inside-verbatim}', '\\end{verbatim}',
  '\\bibliographystyle{plain}', '\\bibliography{refs}', '\\end{document}', ''].join('\n');

describe('submission analysis', () => {
  test('follows the inputs, graphics, bibliography and local packages, and finds what is missing or undefined', async () => {
    s = await newSession();
    await openProject(s.page);
    const r = await analyze([
      { path: 'main.tex', text: MAIN },
      { path: 'sections/intro.tex', text: '\\section{Intro}\\label{sec:intro}\n\\todo{fix this}\n\\input{sections/sub}\n' },
      { path: 'sections/sub.tex', text: '\\label{sec:intro}\n' },
      { path: 'mystyle.sty', text: '\\RequirePackage{xcolor}\n' },
      { path: 'figs/a.png', size: 5000 }, { path: 'figs/unused.png', size: 5000 },
      { path: 'refs.bib', text: '@article{k1, title={A}}\n' },
      { path: 'notes.txt', text: 'x' }, { path: 'extra.tex', text: '\\section{Extra}' }, { path: 'main.pdf', size: 9 }, { path: 'README.md', text: 'x' },
    ], 'main.tex');
    expect(r.used).toEqual(['figs/a.png', 'main.tex', 'mystyle.sty', 'refs.bib', 'sections/intro.tex', 'sections/sub.tex']);
    expect(r.unused).toEqual(['extra.tex', 'figs/unused.png', 'notes.txt']);   // the PDF and the README are not worth listing
    expect(r.problems).toContain('error:file-missing:main.tex:8:figs/missing');
    expect(r.problems).toContain('error:ref-undefined:main.tex:9:nope');
    expect(r.problems).toContain('error:cite-undefined:main.tex:9:k2');
    expect(r.problems.some(p => p.startsWith('warning:label-duplicate:sections/sub.tex:1:sec:intro'))).toBe(true);
    expect(r.problems).toContain('warning:todo:sections/intro.tex:2:todo');
    expect(r.problems).toContain('warning:draft-package:main.tex:3:todonotes');
    expect(r.problems).toContain('warning:bbl-missing:main.tex:0:');
    expect(r.problems.some(p => /commented|inside-verbatim/.test(p))).toBe(false); // a commented \input and a listing do not count
    expect(r.problems.some(p => p.includes('k1') || p.includes(':ref-undefined:main.tex:9:sec'))).toBe(false);
    expect(r.problems[0].startsWith('error:')).toBe(true); // errors first
  }, 120000);

  test('a .bbl (from the last compilation) satisfies the citations and the missing-.bbl warning', async () => {
    const r = await analyze([{ path: 'main.tex', text: '\\documentclass{article}\\begin{document}\\cite{a,b}\\bibliography{refs}\\end{document}' }, { path: 'refs.bib', text: '' }], 'main.tex', { bbl: '\\bibitem{a} A\n\\bibitem[X]{b} B\n' });
    expect(r.problems.filter(p => /cite|bbl/.test(p))).toEqual([]);
  }, 30000);

  test('a main file in a folder reads its inputs from that folder; \\graphicspath is followed', async () => {
    const r = await analyze([
      { path: 'paper/main.tex', text: '\\documentclass{article}\\graphicspath{{images/}}\\begin{document}\\input{chapters/a}\\includegraphics{pic}\\end{document}' },
      { path: 'paper/chapters/a.tex', text: 'A' }, { path: 'paper/images/pic.pdf', size: 10 },
    ], 'paper/main.tex');
    expect(r.used).toEqual(['paper/chapters/a.tex', 'paper/images/pic.pdf', 'paper/main.tex']);
    expect(r.problems.filter(p => p.startsWith('error'))).toEqual([]);
  }, 30000);

  test('names that match only in another case, paths outside the project and a missing main file are errors', async () => {
    const r = await analyze([{ path: 'main.tex', text: '\\documentclass{article}\\begin{document}\\includegraphics{Fig}\\input{/etc/passwd}\\input{../up}\\end{document}' }, { path: 'fig.png', size: 3 }], 'main.tex');
    expect(r.problems).toContain('error:case-mismatch:main.tex:1:Fig|fig.png');
    expect(r.problems).toContain('error:absolute-path:main.tex:1:/etc/passwd');
    expect(r.problems).toContain('error:absolute-path:main.tex:1:../up');
    const m = await analyze([{ path: 'other.tex', text: 'x' }], 'main.tex');
    expect(m.problems).toEqual(['error:main-missing:main.tex:0:main.tex']);
  }, 30000);

  test('file names, sizes and packages that submission systems reject are warned about', async () => {
    const r = await analyze([
      { path: 'main.tex', text: '\\documentclass{article}\\usepackage{minted}\\begin{document}\\includegraphics{my figure}\\end{document}' },
      { path: 'my figure.png', size: 12 * 1024 * 1024 },
    ], 'main.tex');
    expect(r.problems).toContain('warning:package-problem:main.tex:1:minted|needs shell-escape');
    expect(r.problems).toContain('warning:file-name:my figure.png:0:my figure.png');
    expect(r.problems).toContain('warning:file-large:my figure.png:0:12.0');
  }, 30000);

  test('the log of the last compilation says whether the PDF is sound', async () => {
    const files = [{ path: 'main.tex', text: '\\documentclass{article}\\begin{document}x\\end{document}' }];
    const ok = await analyze(files, 'main.tex', { log: 'This is pdfTeX\nOutput written on main.pdf (1 page).\n' });
    expect(ok.problems).toEqual([]);
    const bad = await analyze(files, 'main.tex', { log: "LaTeX Warning: Reference `fig:a' on page 1 undefined on input line 4.\nLaTeX Warning: Citation `knuth' on page 1 undefined on input line 5.\nLaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.\nMissing character: There is no ā in font cmr10!\nOverfull \\hbox (23.5pt too wide) in paragraph at lines 3--4\n" });
    expect(bad.problems).toContain('error:pdf-refs::0:fig:a');
    expect(bad.problems).toContain('error:pdf-cites::0:knuth');
    expect(bad.problems).toContain('warning:pdf-rerun::0:');
    expect(bad.problems).toContain('warning:pdf-glyphs::0:ā');
    expect(bad.problems).toContain('info:pdf-overfull::0:1');
    const failed = await analyze(files, 'main.tex', { log: '! LaTeX Error: Command \\lhead already defined.\n' });
    expect(failed.problems).toContain('error:pdf-failed::0:');
    expect((await analyze(files, 'main.tex')).problems).toEqual(['info:pdf-not-checked::0:']);
  }, 30000);
});

describe('taking the comments out', () => {
  test('a line that is only a comment goes, a comment after text keeps a % so the line still joins, verbatim and \\% stay', async () => {
    const out = await s.page.evaluate(() => (window as any).Submission.stripComments([
      '% a full line comment', 'Text 50\\% sure % trailing note', 'Joined%', 'line', '\\begin{verbatim}', '% stays in verbatim', '\\end{verbatim}', 'Code \\verb|%x| here % gone', '   % indented comment', 'Last', ''].join('\n')));
    expect(out).toBe(['Text 50\\% sure %', 'Joined%', 'line', '\\begin{verbatim}', '% stays in verbatim', '\\end{verbatim}', 'Code \\verb|%x| here %', 'Last', ''].join('\n'));
  }, 30000);
});

describe('the window and the ZIP', () => {
  test('the window lists the problems, offers the used files and builds a ZIP with only those, comments taken out', async () => {
    await s.page.evaluate(async () => {
      const bg = (window as any).BrowserGit;
      const mainText = '\\documentclass{article}\n\\begin{document}\n% private note to self\nHello \\input{chap} % trailing\n\\includegraphics{pic}\n\\ref{missing}\n\\end{document}\n';
      await bg.writeFile('main.tex', mainText);
      (globalThis as any).eval('editor').setValue(mainText); // the file that is open is read from the editor
      await bg.writeFile('chap.tex', 'Chapter % secret\n');
      await bg.writeFile('pic.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      await bg.writeFile('old-draft.tex', 'unused\n');
      await bg.writeFile('.neoleaf/config.json', JSON.stringify({ version: 1, mainFile: 'main.tex', engine: 'wasm-texlive' }));
    });
    await s.page.evaluate(() => { (globalThis as any).eval("projectConfig.mainFile = 'main.tex'"); (window as any).Submission.open(); });
    await s.page.waitForSelector('#sub-modal .sub-row');
    const rows = await s.page.$$eval('#sub-modal .sub-row', rs => rs.map(r => r.textContent || ''));
    expect(rows.some(r => r.includes('Reference "missing" has no'))).toBe(true);
    const checked = await s.page.$$eval('#sub-modal input[data-path]', cs => cs.map(c => ({ p: (c as HTMLInputElement).dataset.path, on: (c as HTMLInputElement).checked })));
    expect(checked.filter(c => c.on).map(c => c.p).sort()).toEqual(['chap.tex', 'main.tex', 'pic.png']);
    expect(checked.find(c => c.p === 'old-draft.tex')?.on).toBe(false);
    const [dl] = await Promise.all([s.page.waitForEvent('download'), s.page.click('#sub-download')]);
    const file = await dl.path();
    expect(dl.suggestedFilename()).toMatch(/-submission\.zip$/);
    const py = `import zipfile,sys,json
z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:z.read(n).decode('latin1') for n in z.namelist()}))`;
    const r = spawnSync('python3', ['-c', py, file!], { encoding: 'utf8' });
    const zip = JSON.parse(r.stdout);
    expect(Object.keys(zip).sort()).toEqual(['chap.tex', 'main.tex', 'pic.png']);
    expect(zip['main.tex']).not.toContain('private note');
    expect(zip['main.tex']).toContain('Hello \\input{chap} %');
    expect(zip['main.tex']).not.toContain('trailing');
    expect(zip['chap.tex']).toBe('Chapter %\n');
  }, 120000);

  test('turning the comment removal off keeps the files as they are, and an unused file can be added', async () => {
    const out = await s.page.evaluate(async () => {
      const S = (window as any).Submission;
      const z = await S.buildZip({ paths: ['main.tex', 'old-draft.tex'], comments: false, bbl: null });
      const files = await (window as any).Zip.read(new Uint8Array(await z.blob.arrayBuffer()));
      return files.map((f: any) => f.name + ':' + new TextDecoder().decode(f.bytes).includes('private note'));
    });
    expect(out).toEqual(['main.tex:true', 'old-draft.tex:false']);
  }, 60000);
});
