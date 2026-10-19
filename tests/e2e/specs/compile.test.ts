import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, openProject, type Session } from '../helpers';

describe('compilation in the browser (WASM)', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('compiles the demo article and shows the PDF', async () => {
    await s.page.click('#compile-btn');
    await s.page.waitForFunction(() => {
      const empty = document.getElementById('pdf-empty');
      const canvas = document.querySelector('#pdf-viewer canvas');
      return !!canvas && (!empty || getComputedStyle(empty).display === 'none');
    }, null, { timeout: 120000 });
    // the page info is filled in a moment after the first canvas is drawn
    await s.page.waitForFunction(() => (document.getElementById('pdf-info')?.textContent || '').trim() !== '', null, { timeout: 30000 });
    const info = await s.page.locator('#pdf-info').textContent();
    expect((info ?? '').trim()).not.toBe('');
  });

  test('the PDF download button is available after compiling', async () => {
    const href = await s.page.evaluate(() => (globalThis as any).eval('window.PdfView && PdfView.blobUrl()'));
    expect(String(href)).toStartWith('blob:');
  });

  test('a LaTeX error appears in the diagnostics', async () => {
    await s.page.evaluate(() => (globalThis as any).eval(`editor.setValue('\\\\documentclass{article}\\\\begin{document}\\\\undefinedcmd\\\\end{document}')`));
    await s.page.click('#compile-btn');
    await s.page.waitForFunction(() => document.querySelectorAll('#diagnostics-list > *').length > 0 && /Error|Undefined|undefined/i.test(document.getElementById('diagnostics-list')!.textContent || ''), null, { timeout: 120000 });
  });
});

describe('copying the compiler log', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await s.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL }); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('the Copy log button puts the raw output on the clipboard and announces it', async () => {
    await s.page.click('#compile-btn');
    await s.page.waitForFunction(() => (document.getElementById('raw-log')?.textContent || '').length > 50, null, { timeout: 120000 });
    await s.page.evaluate(() => (document.getElementById('copy-log-btn') as HTMLButtonElement).click());
    await s.page.waitForFunction(() => document.getElementById('copy-log-btn')!.textContent === 'Copied!');
    const clip = await s.page.evaluate(() => navigator.clipboard.readText());
    const raw = await s.page.evaluate(() => document.getElementById('raw-log')!.textContent || '');
    expect(clip).toBe(raw);
    expect(clip.length).toBeGreaterThan(50);
  });
});

// Text symbols (©, °) use Computer Modern's TS1 font, which only exists as a bitmap: it cannot be generated in WebAssembly.
// NeoLeaf recompiles by itself with Latin Modern (lmodern), which has a vector version.
describe('text symbols (TS1) in the browser', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('\\textcopyright with textcomp compiles (falls back to Latin Modern) and the user text is not changed', async () => {
    const src = '\\\\documentclass{article}\\\\usepackage{textcomp}\\\\begin{document}Text \\\\textcopyright\\\\ 2026, 20\\\\textdegree C.\\\\end{document}';
    await s.page.evaluate(code => (globalThis as any).eval(`editor.setValue('${code}')`), src);
    await s.page.evaluate(() => { const w = window as any; const o = w.renderCompileResult; w.__res = null; w.renderCompileResult = (x: any) => { w.__res = x; return o(x); }; });
    await s.page.click('#compile-btn');
    await s.page.waitForFunction(() => !!(window as any).__res, null, { timeout: 180000 });
    const res = await s.page.evaluate(() => { const x = (window as any).__res; return { success: !!x.success, log: String(x.log || '').slice(-300) }; });
    expect(res.log).not.toContain('not found');
    expect(res.success).toBe(true);
    expect(await (globalThis as any).Promise.resolve(s.page.evaluate(() => (globalThis as any).eval('editor.getValue()')))).not.toContain('lmodern');
  });
});
