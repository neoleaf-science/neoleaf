import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, getBrowser, newSession, type Session } from '../helpers';

// GitHub token refused (401 Bad credentials): instead of staying on an error screen, the session is cleared and the person goes to the login.
describe('expired session', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); });
  afterAll(async () => { await s.context.close(); });

  test('/auth/logout?expired=1 clears the session and goes back to the login with the notice', async () => {
    const anon = await (await getBrowser()).newContext({ locale: 'en-US' });
    const normal = await anon.request.get(`${BASE_URL}/auth/logout`, { maxRedirects: 0 });
    expect(normal.status()).toBe(303);
    expect(normal.headers()['location']).toBe('/');
    const expired = await anon.request.get(`${BASE_URL}/auth/logout?expired=1`, { maxRedirects: 0 });
    expect(expired.headers()['location']).toBe('/?expired=1');
    const page = await anon.newPage();
    await page.goto(`${BASE_URL}/?expired=1`);
    expect(await page.locator('#session-expired').textContent()).toContain('Your GitHub session expired');
    // the notice sits below the navigation bar: it does not cover it, and the sign-in button stays clickable
    const geo = await page.evaluate(() => {
      const nav = document.querySelector('.nl-navbar')!.getBoundingClientRect();
      const banner = document.getElementById('session-expired')!.getBoundingClientRect();
      const login = document.querySelector('.nl-navbar a[href="/auth/login"]') as HTMLElement | null;
      const r = login?.getBoundingClientRect();
      const top = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return { navBottom: nav.bottom, bannerTop: banner.top, loginReachable: !!login && !!top && login.contains(top), hasLogin: !!login };
    });
    expect(geo.bannerTop).toBeGreaterThanOrEqual(geo.navBottom - 1);
    if (geo.hasLogin) expect(geo.loginReachable).toBe(true);
    // the notice can be closed
    await page.click('#session-expired button');
    expect(await page.locator('#session-expired').count()).toBe(0);
    await page.goto(`${BASE_URL}/`);
    expect(await page.locator('#session-expired').count()).toBe(0);
    await anon.close();
  });

  test('an API call with auth_expired takes the dashboard to the login and ends the session', async () => {
    const { page } = s;
    await page.goto(`${BASE_URL}/`);
    await page.waitForSelector('#pl-body');
    await page.route('**/api/project/demo__artigo-1/topics', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ error: 'GitHub returned 401 Unauthorized: Bad credentials', auth_expired: true }),
    }));
    await page.evaluate(() => { fetch('/api/project/demo__artigo-1/topics', { method: 'POST' }); });
    await page.waitForURL(/\/\?expired=1$/);
    expect(await page.locator('#session-expired').count()).toBe(1);
    // the session was really ended on the server
    const profile = await page.evaluate(async () => (await fetch('/api/user/profile')).json());
    expect(profile.error).toBeTruthy();
  });

  test('common API errors do not drop the session', async () => {
    const s2 = await newSession();
    await s2.page.goto(`${BASE_URL}/`);
    await s2.page.waitForSelector('#pl-body');
    const r = await s2.page.evaluate(async () => (await fetch('/api/project/demo__does-not-exist-xyz/permissions')).json());
    await Bun.sleep(400);
    expect(new URL(s2.page.url()).pathname).toBe('/');
    expect(await s2.page.locator('#session-expired').count()).toBe(0);
    expect(typeof r).toBe('object');
    await s2.context.close();
  });
});
