import { afterAll, describe, expect, test } from 'bun:test';
import { BASE_URL, getBrowser, newSession } from '../helpers';

describe('authentication and dashboard', () => {
  const s = newSession();
  afterAll(async () => (await s).context.close());

  test('the session leads to the dashboard with the sample project', async () => {
    const { page } = await s;
    await page.goto(BASE_URL + '/');
    await page.waitForSelector('#proj-row-demo__artigo-1');
    expect(await page.title()).toContain('Projects');
  });

  test('signing in with GitHub (full OAuth, on the fake GitHub) leads to the dashboard', async () => {
    const ctx = await (await getBrowser()).newContext();
    const page = await ctx.newPage();
    await page.goto(BASE_URL + '/auth/login');
    await page.waitForSelector('#proj-row-demo__artigo-1', { timeout: 30000 });
    const body = await (await page.request.get(BASE_URL + '/api/user/profile')).json();
    expect(body.login).toBe('demo');
    await ctx.close();
  });

  test('the API profile responds for the logged-in user', async () => {
    const { page } = await s;
    const body = await (await page.request.get(BASE_URL + '/api/user/profile')).json();
    expect(body.error).toBeUndefined();
    expect(body.login).toBe('demo');
  });

  test('a visitor without a session cannot access the projects API', async () => {
    const { page, context } = await s;
    await context.clearCookies();
    const body = await (await page.request.get(BASE_URL + '/api/user/profile')).json();
    expect(body.error).toBeTruthy();
  });

  test('logout ends the session', async () => {
    const { page } = await newSession();
    await page.goto(BASE_URL + '/auth/logout');
    const body = await (await page.request.get(BASE_URL + '/api/user/profile')).json();
    expect(body.error).toBeTruthy();
  });
});
