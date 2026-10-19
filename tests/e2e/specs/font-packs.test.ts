import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, type Session } from '../helpers';

// The psnfss pack (Times, Helvetica, Courier, Palatino) no longer ships the IBM Courier files (pcr*8a.pfb), see LICENSES.md:
// \usepackage{courier} must still compile, using the URW copy (ucr*).
const DOC = '\\\\documentclass{article}\\\\usepackage[T1]{fontenc}\\\\usepackage{courier}\\\\usepackage{mathptmx}\\\\usepackage{helvet}\\\\usepackage{palatino}\\\\begin{document}\\\\texttt{Courier from URW} \\\\textsf{Helvetica} \\\\textrm{Times}\\\\end{document}';

describe('PostScript font packs (psnfss, URW)', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); }, 120000);
  afterAll(async () => { await s.context.close(); });

  test('courier, helvet, mathptmx and palatino compile without the IBM Courier files', async () => {
    await s.page.evaluate(c => (globalThis as any).eval(`editor.setValue('${c}')`), DOC);
    await s.page.evaluate(() => { const w = window as any; const o = w.renderCompileResult; w.renderCompileResult = (x: any) => { w.__res = x; return o(x); }; w.__res = null; });
    await s.page.click('#compile-btn');
    await s.page.waitForFunction(() => !!(window as any).__res, null, { timeout: 240000 });
    const res = await s.page.evaluate(() => (window as any).__res);
    expect(res.success).toBe(true);
    await s.page.waitForSelector('#pdf-viewer canvas', { timeout: 60000 });
  }, 300000);
});
