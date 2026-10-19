import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BASE_URL, COMMON, fake, getBrowser, newSession, readSessionsFile, testWorkDir, type Session } from '../helpers';

type Ctx = Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newContext']>>;

/** Signs in through the fake provider without loading any page afterwards (so nothing renews the token behind our back). */
async function signIn(ctx: Ctx, loginPath: string) {
  let url = BASE_URL + loginPath;
  for (let i = 0; i < 5; i++) {
    const r = await ctx.request.get(url, { maxRedirects: 0 });
    const loc = r.headers()['location'];
    if (!loc || loc === '/') return;
    url = new URL(loc, url).toString();
  }
}

const profile = async (ctx: Ctx) => (await ctx.request.get(BASE_URL + '/api/user/profile')).json();

describe('sessions, administrators and headers', () => {
  let admin: Session;
  beforeAll(async () => { admin = await newSession(); });
  afterAll(async () => { await admin.context.close(); fake.oauth.refreshMode = 'ok'; fake.oauth.signInExpiresIn = undefined; });

  test('a regular person opening /admin is refused without seeing the owner e-mail', async () => {
    const ctx = await (await getBrowser()).newContext();
    await ctx.addCookies([{ name: 'latex_session', value: COMMON.sid, url: BASE_URL }]);
    const res = await ctx.request.get(BASE_URL + '/admin', { maxRedirects: 0 });
    expect(res.status()).toBe(403);
    const body = await res.text();
    expect(body).not.toContain('tassiovirginio');
    expect(body).not.toContain('@gmail.com');
    expect(body).toContain('only for the administrators');
    await ctx.close();
  });

  test('pages and plain responses carry X-Content-Type-Options: nosniff', async () => {
    const home = await fetch(BASE_URL + '/', { redirect: 'manual' });
    expect(home.headers.get('x-content-type-options')).toBe('nosniff');
    const denied = await fetch(BASE_URL + '/admin', { redirect: 'manual', headers: { Cookie: `latex_session=${COMMON.sid}` } });
    expect(denied.status).toBe(403);
    expect(denied.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('logout works with GET and with POST, and the cookie is removed with the same Path and flags', async () => {
    for (const method of ['get', 'post'] as const) {
      const ctx = await (await getBrowser()).newContext();
      await signIn(ctx, '/auth/login');
      expect((await profile(ctx)).login).toBe('demo');
      const res = await ctx.request[method](BASE_URL + '/auth/logout', { maxRedirects: 0 });
      expect(res.status()).toBe(303);
      expect(res.headers()['location']).toBe('/');
      const setCookie = res.headers()['set-cookie'] || '';
      expect(setCookie).toContain('latex_session=');
      expect(setCookie).toMatch(/Path=\//i);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toMatch(/Max-Age=0|Expires=/i);
      expect((await profile(ctx)).error).toBe('Not signed in');
      await ctx.close();
    }
  });

  test('sessions.json is encrypted: no token or login appears in the raw file, and it opens with the key', async () => {
    await (await admin.context.request.get(BASE_URL + '/api/user/profile')).json(); // makes sure a session was stored
    const raw = fs.readFileSync(path.join(testWorkDir(), 'sessions.json'));
    expect(raw.subarray(0, 4).toString()).toBe('NLS1');
    expect(raw.includes('fake-demo')).toBe(false);
    expect(raw.includes('access_token')).toBe(false);
    expect(readSessionsFile()).toContain('fake-demo');
  });

  test('the profile endpoint reads the provider once, not on every call, and does not rewrite sessions.json when nothing changed', async () => {
    const { context } = admin;
    const first = await (await context.request.get(BASE_URL + '/api/user/profile')).json();
    expect(first.login).toBe('demo');
    const file = path.join(testWorkDir(), 'sessions.json');
    const upstream = () => fake.requestLog.filter(l => l === 'GET /user').length;
    const callsBefore = upstream();
    const mtimeBefore = fs.statSync(file).mtimeMs;
    await new Promise(r => setTimeout(r, 100));
    for (let i = 0; i < 4; i++) expect((await (await context.request.get(BASE_URL + '/api/user/profile')).json()).login).toBe('demo');
    expect(upstream()).toBe(callsBefore);
    expect(fs.statSync(file).mtimeMs).toBe(mtimeBefore);
  });

  test('the blocklist accepts a Codeberg login with "_" and "." and refuses it for GitHub', async () => {
    const { page } = admin;
    const block = async (provider: string, login: string) => (await page.request.post(BASE_URL + '/api/admin/users/block', { data: { login, provider, reason: 'test' } })).json();
    const gh = await block('github', 'ana_cb.test');
    expect(gh.error).toContain('Invalid login');
    const cb = await block('codeberg', 'ana_cb.test');
    expect(cb.error).toBeUndefined();
    expect(cb.success).toBe(true);
    const un = await (await page.request.post(BASE_URL + '/api/admin/users/unblock', { data: { login: 'ana_cb.test', provider: 'codeberg' } })).json();
    expect(un.success).toBe(true);
  });

  describe('Codeberg token renewal', () => {
    test('two requests at once after the token expired both succeed, with a single refresh, and keep the session', async () => {
      fake.oauth.signInExpiresIn = 1; // the token is already due when the person arrives
      const ctx = await (await getBrowser()).newContext();
      await signIn(ctx, '/auth/login/codeberg');
      const accepted = fake.oauth.refreshAccepted;
      const requests = fake.oauth.refreshRequests;
      const [a, b, c] = await Promise.all([profile(ctx), profile(ctx), profile(ctx)]);
      for (const p of [a, b, c]) {
        expect(p.error).toBeUndefined();
        expect(p.login).toBe('demo');
      }
      expect(fake.oauth.refreshRequests - requests).toBe(1);
      expect(fake.oauth.refreshAccepted - accepted).toBe(1);
      expect((await profile(ctx)).login).toBe('demo');
      expect(fake.oauth.refreshRequests - requests).toBe(1); // the new token lasts an hour: nothing more to renew
      await ctx.close();
    });

    test('a 503 from the refresh endpoint does not delete the session: the next request, after recovery, renews it', async () => {
      fake.oauth.signInExpiresIn = 1;
      const ctx = await (await getBrowser()).newContext();
      await signIn(ctx, '/auth/login/codeberg');
      fake.oauth.refreshMode = '503';
      expect((await profile(ctx)).error).toBe('Not signed in'); // for this request only
      const file = readSessionsFile();
      expect(file).toContain('rt-demo-0-'); // the session and its refresh token are still stored
      fake.oauth.refreshMode = 'ok';
      expect((await profile(ctx)).login).toBe('demo');
      await ctx.close();
    });

    test('a refresh token the provider definitively refuses ends the session', async () => {
      fake.oauth.signInExpiresIn = 1;
      const ctx = await (await getBrowser()).newContext();
      await signIn(ctx, '/auth/login/codeberg');
      fake.oauth.refreshMode = 'revoked';
      expect((await profile(ctx)).error).toBe('Not signed in');
      fake.oauth.refreshMode = 'ok';
      expect((await profile(ctx)).error).toBe('Not signed in'); // gone for good
      await ctx.close();
    });
  });
});
