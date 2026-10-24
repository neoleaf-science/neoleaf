import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, COMMON, DEMO_PROJECT, fake, getBrowser, newSession, type Session } from '../helpers';
import { raw } from '../raw-http';

describe('Git proxy headers', () => {
  let s: Session;
  let sid = '';
  beforeAll(async () => {
    s = await newSession();
    await s.page.goto(BASE_URL + '/');
    sid = (await s.context.cookies()).find(c => c.name === 'latex_session')!.value;
  });
  afterAll(async () => { await s.context.close(); });

  const refs = '/api/git/demo/artigo-1/info/refs?service=git-upload-pack';

  test('a foreign Origin gets no CORS headers; the same origin keeps working', async () => {
    const evil = await raw('GET', refs, { sid, headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    expect(evil.headers['access-control-allow-credentials']).toBeUndefined();
    expect(String(evil.headers['vary'])).toContain('Origin');

    const pre = await raw('OPTIONS', refs, { headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();

    const own = await raw('GET', refs, { sid, headers: { origin: BASE_URL } });
    expect(own.status).toBe(200);
    expect(own.headers['access-control-allow-origin']).toBe(BASE_URL);
    expect(own.text).toContain('git-upload-pack');
    const noOrigin = await raw('GET', refs, { sid });
    expect(noOrigin.status).toBe(200);
    expect(noOrigin.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('every proxy response is no-store (success, upstream error and 401)', async () => {
    const ok = await raw('GET', refs, { sid });
    expect(ok.headers['cache-control']).toBe('no-store');
    const missing = await raw('GET', '/api/git/demo/does-not-exist/info/refs?service=git-upload-pack', { sid });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.headers['cache-control']).toBe('no-store');
    const anon = await raw('GET', refs);
    expect(anon.status).toBe(401);
    expect(anon.headers['cache-control']).toBe('no-store');
    const bad = await raw('GET', '/api/git/demo/artigo-1/info/refs?service=x', { sid });
    expect(bad.headers['cache-control']).toBe('no-store');
  });

  test('the browser clone through the proxy still works', async () => {
    const p = await newSession();
    await p.page.goto(BASE_URL + `/project/${DEMO_PROJECT}`);
    await p.page.waitForSelector('.monaco-editor');
    await p.page.waitForFunction(async () => { const bg = (window as any).BrowserGit; return !!bg && (await bg.isCloned()) && (await bg.listFiles()).length >= 2; }, null, { timeout: 60000 });
    await p.context.close();
  });
});

describe('CTAN rate limit', () => {
  test('answers 429 (with Retry-After) after 240 calls in a minute, per person: enough for a big template, not for abuse', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 242; i++) statuses.push((await raw('POST', '/api/ctan/resolve', { sid: COMMON.sid, body: { files: [] } })).status);
    expect(statuses.slice(0, 240).every(c => c === 200)).toBe(true);
    expect(statuses.slice(240).every(c => c === 429)).toBe(true);
    const limited = await raw('POST', '/api/ctan/package', { sid: COMMON.sid, body: { package: 'amsmath' } });
    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.text).error).toMatch(/Too many/);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // another person is not affected
    const s = await newSession();
    await s.page.goto(BASE_URL + '/');
    const other = (await s.context.cookies()).find(c => c.name === 'latex_session')!.value;
    expect((await raw('POST', '/api/ctan/resolve', { sid: other, body: { files: [] } })).status).toBe(200);
    await s.context.close();
  });

  test('the browser waits and tries again when the proxy says 429 or 503, instead of failing the package install', async () => {
    const s = await newSession();
    await s.page.goto(BASE_URL + `/project/${DEMO_PROJECT}`);
    await s.page.waitForFunction(async () => !!(window as any).Project && !!(window as any).Project.texmf);
    let calls = 0;
    await s.page.route('**/api/ctan/package', route => {
      calls++;
      if (calls <= 2) return route.fulfill({ status: calls === 1 ? 429 : 503, headers: { 'Retry-After': '1' }, contentType: 'application/json', body: JSON.stringify({ error: 'Too many package requests in a short time; wait a minute' }) });
      return route.continue();
    });
    await s.page.evaluate(() => { (window as any).__ctanRetryScale = 50; });   // the test does not wait whole seconds
    const r = await s.page.evaluate(async () => { try { const x = await (window as any).Project.texmf.import({ scope: 'project', package: 'amsmath' }); return { ok: true, files: x.files.length }; } catch (e: any) { return { ok: false, error: String(e.message || e) }; } });
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await s.context.close();
  });
});

describe('static files', () => {
  test('a missing font pack is 404 with no-store', async () => {
    const r = await raw('GET', '/static/texlive/fonts/nao-existe.tar.gz');
    expect(r.status).toBe(404);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});

describe('templates with a Codeberg session', () => {
  const SENTENCE = 'Templates are available only when you sign in with GitHub.';
  test('zip and check answer 403, the public list stays open, the dashboard says why', async () => {
    const ctx = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(BASE_URL + '/auth/login/codeberg');
    await page.waitForSelector('#proj-row-demo__artigo-1', { timeout: 30000 });

    const zip = await page.request.get(`${BASE_URL}/api/templates/qualquer/zip`);
    expect(zip.status()).toBe(403);
    expect(await zip.json()).toEqual({ error: SENTENCE });
    const check = await page.request.post(`${BASE_URL}/api/admin/templates/check`, { data: { id: 'x', name: 'x', source: 'demo/thesis-template' } });
    expect(check.status()).toBe(403);
    expect(await check.json()).toEqual({ error: SENTENCE });
    const list = await page.request.get(`${BASE_URL}/api/templates`);
    expect(list.status()).toBe(200);

    await page.evaluate(() => (window as any).openNewProjectModal());
    await page.waitForSelector('#tpl-gallery .tpl-meta');
    expect(await page.locator('#tpl-gallery').innerText()).toContain(SENTENCE);
    expect(await page.locator('#tpl-gallery .tpl-card').count()).toBe(4); // only the built-in ones
    await ctx.close();
  });

  test('GitHub sessions do not see the sentence', async () => {
    const s = await newSession();
    await s.page.goto(BASE_URL + '/');
    await s.page.waitForSelector('#pl-body');
    await s.page.evaluate(() => (window as any).openNewProjectModal());
    await s.page.waitForSelector('#tpl-gallery .tpl-card');
    expect(await s.page.locator('#tpl-gallery').innerText()).not.toContain(SENTENCE);
    expect(fake.requestLog.length).toBeGreaterThan(0);
    await s.context.close();
  });
});
