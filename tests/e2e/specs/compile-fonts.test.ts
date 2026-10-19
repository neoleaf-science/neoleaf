import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { newSession, openProject, type Session } from '../helpers';

// Extra packages that ship their own font files (for example roboto) are written flat in the project folder. The engine finds them
// only when its font search paths include "." and, for Type 1 fonts, when the package's .map file is loaded.
const WORKER = path.resolve(import.meta.dir, '../../../static/texlive/worker.js');

describe('fonts that come with extra packages (browser engines)', () => {
  test('the engine font search paths include the project folder, like TEXINPUTS', () => {
    const src = fs.readFileSync(WORKER, 'utf8');
    for (const name of ['TFMFONTS', 'VFFONTS', 'T1FONTS', 'ENCFONTS', 'TEXFONTMAPS', 'OPENTYPEFONTS', 'TRUETYPEFONTS']) {
      expect(src).toContain(`${name}=.;/texmf-dist/`);
      expect(src).not.toMatch(new RegExp(`-cnf-line=${name}=/texmf-dist`));
    }
  });

  test('the engine scripts are requested with the build version, so a release is never served from the browser cache', async () => {
    const s = await newSession();
    try {
      const urls: string[] = [];
      s.page.on('request', r => { if (/\/static\/texlive\/(texlive|worker)\.js/.test(r.url())) urls.push(r.url()); });
      await openProject(s.page);
      await s.page.click('#compile-btn');
      await s.page.waitForFunction(() => !!document.querySelector('#pdf-viewer canvas'), null, { timeout: 180000 });
      expect(urls.some(u => /\/static\/texlive\/texlive\.js\?v=\w+/.test(u))).toBe(true);
      expect(urls.some(u => /\/static\/texlive\/worker\.js\?v=\w+/.test(u))).toBe(true);
    } finally { await s.context.close(); }
  }, 240000);

  describe('the .map files of the project are loaded with \\pdfmapfile', () => {
    let s: Session;
    beforeAll(async () => { s = await newSession(); await openProject(s.page); });
    afterAll(async () => { await s.context.close(); });
    const prefix = (names: string[]) => s.page.evaluate(n => (globalThis as any).eval(`pdfMapPrefix(new Map(${JSON.stringify(n.map(x => [x, 1]))}))`), names);

    test('one entry per .map file, in a stable order, and nothing without them', async () => {
      expect(await prefix(['main.tex', 'refs.bib'])).toBe('');
      expect(await prefix(['zeta.map', 'main.tex', 'roboto.map'])).toBe('\\pdfmapfile{+roboto.map}\\pdfmapfile{+zeta.map}');
    });

    test('names with odd characters are ignored', async () => {
      expect(await prefix(['a b.map', 'x}y.map', 'sub/dir.map'])).toBe('');
    });
  });

  // Needs the internet (downloads the roboto package from the TeX Live mirror, slow): E2E_NET=1 bun test specs/compile-fonts.test.ts
  describe.skipIf(!process.env.E2E_NET)('roboto from the TeX Live mirror', () => {
    let s: Session;
    beforeAll(async () => { s = await newSession(); await openProject(s.page); });
    afterAll(async () => { await s.context.close(); });

    test('a document with roboto compiles to a PDF', async () => {
      const doc = '\\\\documentclass{article}\\\\usepackage[T1]{fontenc}\\\\usepackage[sfdefault]{roboto}\\\\begin{document}Roboto text. \\\\textbf{Bold}\\\\end{document}';
      await s.page.evaluate(c => (globalThis as any).eval(`editor.setValue('${c}')`), doc);
      await s.page.evaluate(() => { const w = window as any; const o = w.renderCompileResult; w.__res = null; w.renderCompileResult = (x: any) => { w.__res = x; return o(x); }; });
      await s.page.click('#compile-btn');
      await s.page.waitForFunction(() => !!(window as any).__res, null, { timeout: 900000 });
      const r = await s.page.evaluate(() => { const x = (window as any).__res; return { success: x.success, pdf: (x.pdfBytes || []).length, log: String(x.log || '').slice(-600) }; });
      expect(r.success).toBe(true);
      expect(r.pdf).toBeGreaterThan(5000);
    }, 1000000);
  });
});
