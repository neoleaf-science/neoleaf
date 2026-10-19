import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, type Session } from '../helpers';

// Editor functions that feed the browser BibTeX and the log messages.
describe('BibTeX in the browser: .aux fixes, hints and downloads', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  const call = <T>(expr: string): Promise<T> => s.page.evaluate(e => (globalThis as any).eval(e), expr);

  test('\\bibliography{refs.bib} (with extension) does not become refs.bib.bib', async () => {
    const out = await call<string>(`bibtexAux('\\\\bibdata{refs.bib,outro,./ja/relativo.bib}\\n\\\\bibstyle{plain}')`);
    expect(out).toContain('\\bibdata{./refs,./outro,./ja/relativo}');
    expect(out).not.toContain('.bib.bib');
    expect(out).toContain('\\bibstyle{./plain}');
  });

  test('the BibTeX entry-string-size warning produces a hint that suggests the local agent', async () => {
    const hints = await call<string[]>(`hintsFromLog("Warning--you've exceeded 100, the entry-string-size, for entry touvron2023llama")`);
    expect(hints.join(' ')).toContain('local agent');
    expect(hints.join(' ')).toContain('100 characters');
    expect(await call<string[]>(`hintsFromLog('all good')`)).toEqual([]);
  });

  test('proprietary font hints apply to the agent too', async () => {
    const h = await call<string[]>(`fontHintsFromLog('The font "Times New Roman" cannot be found; The font "Arial" cannot be found')`);
    expect(h.length).toBe(2);
    expect(h[0]).toContain('TeX Gyre Termes');
    expect(h[1]).toContain('TeX Gyre Heros');
  });

  test('fetchRetry retries on network failure and 5xx, but not on 404', async () => {
    const r = await s.page.evaluate(async () => {
      const real = window.fetch;
      let n = 0;
      (window as any).fetch = async (u: string) => {
        if (!/^\/(flaky|missing|error500)$/.test(u)) return real(u); // the agent probe etc. does not count
        n++;
        if (u.includes('flaky')) { if (n < 3) throw new TypeError('Failed to fetch'); return new Response('ok'); }
        if (u.includes('error500')) return new Response('x', { status: 500 });
        return new Response('nada', { status: 404 });
      };
      const out: Record<string, unknown> = {};
      try {
        n = 0; out.flaky = (await (globalThis as any).eval(`fetchRetry('/flaky')`)).status; out.flakyAttempts = n;
        n = 0; out.n404 = (await (globalThis as any).eval(`fetchRetry('/missing')`)).status; out.n404Attempts = n;
        n = 0; try { await (globalThis as any).eval(`fetchRetry('/error500')`); } catch (e: any) { out.error500 = String(e.message); } out.n500Attempts = n;
      } finally { window.fetch = real; }
      return out;
    });
    expect(r).toEqual({ flaky: 200, flakyAttempts: 3, n404: 404, n404Attempts: 1, error500: 'HTTP 500', n500Attempts: 3 });
  });
});
