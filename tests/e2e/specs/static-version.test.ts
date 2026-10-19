import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, DEMO_PROJECT, getBrowser, newSession, type Session } from '../helpers';

// Cloudflare keeps the .js files for 4 hours in the browser even with `no-cache` at the origin: page URLs carry ?v=<deploy>.
describe('static files with a version in the URL', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); });
  afterAll(async () => { await s.context.close(); });

  const html = async (url: string, page = s.page) => (await page.request.get(BASE_URL + url)).text();

  test('dashboard, editor and landing page use /static/js/*.js?v=... and the file is still served', async () => {
    for (const url of ['/', `/project/${DEMO_PROJECT}`]) {
      const h = await html(url);
      const refs = [...h.matchAll(/(?:src|href)="(\/static\/(?:js|css)\/[^"]+)"/g)].map(m => m[1]);
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.every(r => /\?v=\d+$/.test(r))).toBe(true);
    }
    const anon = await (await getBrowser()).newContext();
    const home = await (await anon.request.get(BASE_URL + '/')).text();
    expect([...home.matchAll(/(?:src|href)="(\/static\/(?:js|css)\/[^"]+)"/g)].every(m => /\?v=\d+$/.test(m[1]))).toBe(true);
    await anon.close();
    const h = await html(`/project/${DEMO_PROJECT}`);
    const ref = h.match(/"(\/static\/js\/project-store\.js\?v=\d+)"/)![1];
    const r = await s.page.request.get(BASE_URL + ref);
    expect(r.status()).toBe(200);
    expect(await r.text()).toContain('TEXMF_ALLOWED');
  });
});
