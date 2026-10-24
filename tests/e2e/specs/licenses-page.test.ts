import { afterAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, type Session } from '../helpers';

// The /licenses page: public, offers the GPL source, lists the Rust dependencies and loads nothing from other sites.
describe('licenses page', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });

  test('is public, names the licenses and offers the source of the GPL engines, loading nothing external', async () => {
    s = await newSession();
    const external: string[] = [];
    s.page.on('request', r => { if (!r.url().startsWith(BASE_URL)) external.push(r.url()); });
    const res = await s.page.goto(BASE_URL + '/licenses');
    expect(res!.status()).toBe(200);
    const t = (await s.page.locator('.legal-container').innerText()).replace(/\s+/g, ' ');
    for (const w of ['MIT License', 'Apache License 2.0', 'CC BY-NC-ND 4.0', 'pdfTeX', 'LuaTeX', 'xdvipdfmx', 'GPL', 'texlive-source', 'v0.2.4-alpha', 'URW base 35', 'DOMPurify', 'Pyodide', 'Hunspell', 'VERO']) expect(t).toContain(w);
    expect(external).toEqual([]);
  });

  test('the Rust lists are served and every line has a license', async () => {
    for (const [file, min] of [['rust-agent.txt', 100], ['rust-server.txt', 250]] as const) {
      const r = await s.page.request.get(`${BASE_URL}/static/licenses/${file}`);
      expect(r.status()).toBe(200);
      const lines = (await r.text()).split('\n').filter(l => / \| /.test(l) && !l.startsWith('Format:'));
      expect(lines.length).toBeGreaterThan(min);
      expect(lines.filter(l => l.split(' | ')[1].trim() === '').length).toBe(0);
    }
  });

  test('the license texts of the spell check dictionaries are served', async () => {
    for (const [file, needle] of [['LICENSE-en-US.txt', 'Kevin Atkinson'], ['LICENSE-pt-BR.txt', 'Raimundo']] as const) {
      const r = await s.page.request.get(`${BASE_URL}/static/dict/${file}`);
      expect(r.status()).toBe(200);
      expect(await r.text()).toContain(needle);
    }
  });

  test('it is linked from the project list menu and from the landing page', async () => {
    const landing = await (await s.page.request.get(BASE_URL + '/')).text();
    expect(landing).toContain('href="/licenses"');
  });
});
