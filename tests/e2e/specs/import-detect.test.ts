import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BASE_URL, newSession, openProject, type Session } from '../helpers';

// What the importer works out from the files of a ZIP: the main file and the compiler the project was written for.

let s: Session;
beforeAll(async () => { s = await newSession(); await s.page.goto(BASE_URL + '/'); await s.page.waitForFunction(() => !!(window as any).ProjectImport); });
afterAll(async () => { await s.context.close(); });

type F = Record<string, string>;
const main = (files: F) => s.page.evaluate(fs => (window as any).ProjectImport.detectMainFile(Object.entries(fs).map(([path, t]) => ({ path, bytes: new TextEncoder().encode(t as string) }))), files);
const engine = (files: F, mainFile: string, hints: any = {}) => s.page.evaluate(([fs, m, h]) => (window as any).ProjectImport.detectEngine(Object.entries(fs as F).map(([path, t]) => ({ path, bytes: new TextEncoder().encode(t as string) })), m, h), [files, mainFile, hints] as any);

const DOC = (pre = '') => `\\documentclass{article}\n${pre}\\begin{document}\nHi\n\\end{document}\n`;

describe('import: main file', () => {
  test('a chapter that says "% !TeX root" points to the main file, even from a subfolder', async () => {
    expect(await main({ 'thesis/ch1.tex': '%!TEX root = ../book.tex\nText\n', 'thesis/ch2.tex': '% !TeX root = ../book.tex\nText\n', 'book.tex': DOC(), 'main.tex': DOC() })).toBe('book.tex');
  });
  test('the file with the document body wins over a preamble that also has \\documentclass', async () => {
    expect(await main({ 'a.tex': '\\documentclass{article}\n\\usepackage{x}\n', 'b.tex': DOC() })).toBe('b.tex');
  });
  test('a commented \\documentclass does not count, and usual names win', async () => {
    expect(await main({ 'old.tex': '%\\documentclass{article}\nText\n', 'paper.tex': DOC(), 'zzz.tex': DOC() })).toBe('paper.tex');
  });
  test('a project written in Typst has main.typ (or the first .typ) as main file', async () => {
    expect(await main({ 'lib.typ': '#let x = 1', 'main.typ': '= Title', 'refs.bib': '' })).toBe('main.typ');
    expect(await main({ 'notes.md': 'x' })).toBeNull();
  });
});

describe('import: engine', () => {
  test('fontspec and its relatives mean XeLaTeX, luacode and \\directlua mean LuaLaTeX, plain mean pdfLaTeX', async () => {
    expect(await engine({ 'main.tex': DOC('\\usepackage[no-math]{fontspec}\n') }, 'main.tex')).toBe('wasm-xelatex');
    expect(await engine({ 'main.tex': DOC('\\usepackage{polyglossia}\n') }, 'main.tex')).toBe('wasm-xelatex');
    expect(await engine({ 'main.tex': DOC('\\usepackage{luacode}\n') }, 'main.tex')).toBe('wasm-lualatex');
    expect(await engine({ 'main.tex': DOC('\\usepackage{fontspec}\n\\directlua{tex.print(1)}\n') }, 'main.tex')).toBe('wasm-lualatex');
    expect(await engine({ 'main.tex': DOC('\\usepackage{amsmath}\n') }, 'main.tex')).toBe('wasm-texlive');
  });
  test('a package in a comment does not count, one in an included file does', async () => {
    expect(await engine({ 'main.tex': DOC('% \\usepackage{fontspec}\n') }, 'main.tex')).toBe('wasm-texlive');
    expect(await engine({ 'main.tex': DOC('\\input{pre}\n'), 'pre.tex': '\\usepackage{unicode-math}\n' }, 'main.tex')).toBe('wasm-xelatex');
  });
  test('"% !TeX program" and the latexmkrc say it outright', async () => {
    expect(await engine({ 'main.tex': '% !TeX program = lualatex\n' + DOC() }, 'main.tex')).toBe('wasm-lualatex');
    expect(await engine({ 'main.tex': '%!TEX TS-program = xelatex\n' + DOC() }, 'main.tex')).toBe('wasm-xelatex');
    expect(await engine({ 'main.tex': DOC() }, 'main.tex', { latexmkrc: '$pdf_mode = 5;\n' })).toBe('wasm-xelatex');
    expect(await engine({ 'main.tex': DOC() }, 'main.tex', { latexmkrc: '$pdf_mode = 4;\n' })).toBe('wasm-lualatex');
  });
  test('a Typst main file means the Typst engine', async () => {
    expect(await engine({ 'main.typ': '= A' }, 'main.typ')).toBe('wasm-typst');
  });
});

describe('import: reading the ZIP', () => {
  test('the hidden latexmkrc is read for hints and is not imported', async () => {
    const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-zip-')), 'p.zip');
    const py = `import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
    z.writestr('main.tex', r'\\documentclass{article}\\begin{document}x\\end{document}')
    z.writestr('.latexmkrc', '$pdf_mode = 5;\\n')
`;
    expect(spawnSync('python3', ['-c', py, zip]).status).toBe(0);
    const b64 = fs.readFileSync(zip).toString('base64');
    const r = await s.page.evaluate(async content => {
      const bin = Uint8Array.from(atob(content), c => c.charCodeAt(0));
      const x = await (window as any).ProjectImport.extract(bin);
      return { files: x.files.map((f: any) => f.path), hints: x.hints };
    }, b64);
    expect(r.files).toEqual(['main.tex']);
    expect(r.hints.latexmkrc).toContain('pdf_mode');
  });

  test('importing a XeLaTeX project sets the engine and the main file in the project settings', async () => {
    const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-zip-')), 'p.zip');
    const py = `import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
    z.writestr('chapters/one.tex', '%!TEX root = ../thesis.tex\\nText\\n')
    z.writestr('thesis.tex', r'\\documentclass{book}\\usepackage{fontspec}\\begin{document}\\input{chapters/one}\\end{document}')
`;
    expect(spawnSync('python3', ['-c', py, zip]).status).toBe(0);
    const b64 = fs.readFileSync(zip).toString('base64');
    const id = await s.page.evaluate(async content => {
      const bin = Uint8Array.from(atob(content), c => c.charCodeAt(0));
      return (window as any).ProjectImport.start(new File([bin], 'p.zip'), 'e2e-xelatex');
    }, b64);
    await openProject(s.page, id);
    let cfg: any = null;
    for (let i = 0; i < 60 && !(cfg && cfg.engine === 'wasm-xelatex'); i++) {
      cfg = JSON.parse(await s.page.evaluate(async () => { try { return await (window as any).BrowserGit.readFile('.neoleaf/config.json'); } catch (_) { return '{}'; } }));
      if (!(cfg && cfg.engine === 'wasm-xelatex')) await new Promise(r => setTimeout(r, 500));
    }
    expect(cfg.mainFile).toBe('thesis.tex');
    expect(cfg.engine).toBe('wasm-xelatex');
  }, 120000);
});
