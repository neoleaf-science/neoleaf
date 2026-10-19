import { describe, expect, test } from 'bun:test';
import { BASE_URL, getBrowser, newSession } from '../helpers';

// Demo mode no longer exists: no project is kept on the server, not even a fake one.
describe('no demo mode and no projects on the server', () => {
  test('/demo-login does not exist and the landing page offers no demo', async () => {
    const anon = await (await getBrowser()).newContext();
    const r = await anon.request.get(`${BASE_URL}/demo-login`, { maxRedirects: 0 });
    expect(r.status()).toBe(404);
    const home = await (await anon.request.get(`${BASE_URL}/`)).text();
    expect(home).not.toContain('demo-login');
    expect(home).not.toContain('Demo Mode');
    await anon.close();
  });

  test('the Git proxy requires a session (no open proxy to GitHub)', async () => {
    const anon = await (await getBrowser()).newContext();
    const r = await anon.request.get(`${BASE_URL}/api/git/demo/artigo-1/info/refs?service=git-upload-pack`);
    expect(r.status()).toBe(401);
    await anon.close();
  });

  test('the Git proxy respects GitHub access: whoever has no access to the repository cannot clone', async () => {
    const ctx = await (await getBrowser()).newContext();
    await ctx.addCookies([{ name: 'latex_session', value: 'e2e-victim-session-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', url: BASE_URL }]);
    const r = await ctx.request.get(`${BASE_URL}/api/git/demo/artigo-1/info/refs?service=git-upload-pack`);
    expect(r.status()).toBe(404); // the repository belongs to user `demo`; `student-e2e` has no access
    await ctx.close();
  });

  test('whoever has access clones normally', async () => {
    const s = await newSession();
    const r = await s.page.request.get(`${BASE_URL}/api/git/demo/artigo-1/info/refs?service=git-upload-pack`);
    expect(r.status()).toBe(200);
    await s.context.close();
  });
});
