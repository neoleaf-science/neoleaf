import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { newSession, openProject, type Session } from '../helpers';

// biblatex with the default backend (Biber) compiling in the browser: Biber 2.19 in WebAssembly runs between the pdfLaTeX passes.
// Needs the files in static/texlive/biber (mise run biber) and network access to fetch biblatex from TeX Live 2023.
const HAVE = fs.existsSync(path.resolve(import.meta.dir, '../../../static/texlive/biber/emscripten/biber.wasm'));

describe.skipIf(!HAVE)('biblatex + Biber in the browser (WASM)', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('Biber runs between the passes and the citations resolve', async () => {
    const r = await s.page.evaluate(async () => {
      const B = (window as any).BrowserGit;
      const main = '\\documentclass{article}\n\\usepackage[backend=biber,style=authoryear]{biblatex}\n\\addbibresource{refs.bib}\n\\begin{document}\nSee \\textcite{knuth84} e \\parencite{lamport94}.\n\\printbibliography\n\\end{document}\n';
      await B.writeFile('main.tex', main);
      (globalThis as any).eval('editor').setValue(main);
      await B.writeFile('refs.bib', '@book{knuth84, author={Donald Knuth}, title={The TeXbook}, publisher={Addison-Wesley}, year={1984}}\n@book{lamport94, author={Leslie Lamport}, title={LaTeX: A Document Preparation System}, publisher={Addison-Wesley}, year={1994}}\n');
      // as on project creation: first install the packages the project declares (biblatex and dependencies, from TeX Live 2023)
      await (window as any).Project.texmf.preinstall();
      const res = await (globalThis as any).eval('compileWithWasm')();
      return { success: res.success, log: String(res.log), bbl: res.bblBytes ? new TextDecoder().decode(res.bblBytes) : '', diag: res.diagnostics };
    });
    if (!r.success) console.log(r.log.slice(-1500));
    expect(r.success).toBe(true);
    expect(r.log).toContain('===== Biber =====');
    expect(r.bbl).toContain('\\entry{knuth84}');
    expect(r.bbl).toContain('\\entry{lamport94}');
    const lastPass = r.log.split(/===== Pass /).pop()!;
    expect(lastPass).not.toMatch(/Citation .* undefined|There were undefined/);
  }, 280000);
});
