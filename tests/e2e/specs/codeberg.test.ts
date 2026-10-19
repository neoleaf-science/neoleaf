import { afterAll, describe, expect, test } from 'bun:test';
import { BASE_URL, DEMO_PROJECT, fake, getBrowser, openProject, poll } from '../helpers';

// Signing in with Codeberg (Forgejo). The fake server answers as Codeberg at /api/v1 (CODEBERG_URL points to it).
describe('Codeberg', () => {
  let ctx: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newContext']>>;
  let page: Awaited<ReturnType<typeof ctx.newPage>>;

  test('the home page offers "Sign in with Codeberg" and the full login leads to the dashboard', async () => {
    ctx = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 900 } });
    page = await ctx.newPage();
    await page.goto(BASE_URL + '/');
    expect(await page.locator('a[href="/auth/login/codeberg"]').count()).toBeGreaterThan(0);
    await page.goto(BASE_URL + '/auth/login/codeberg');
    await page.waitForSelector('#proj-row-demo__artigo-1', { timeout: 30000 });
  });

  test('the profile comes from Codeberg and the user page points to Codeberg', async () => {
    const body = await (await page.request.get(BASE_URL + '/api/user/profile')).json();
    expect(body.login).toBe('demo');
    expect(body.html_url).toBe(`${fake.url}/demo`);
  });

  test('the project opens through the Git proxy with Codeberg authentication (clone and files)', async () => {
    await openProject(page, DEMO_PROJECT);
    const files = await page.evaluate(async () => (await (window as any).BrowserGit.listFiles()).filter((f: any) => !f.is_folder).map((f: any) => f.path || f.name));
    expect(files.join(' ')).toContain('main.tex');
  });

  test('sharing: the collaborator joins directly (no invitation) and the role comes from Forgejo', async () => {
    const r = await (await page.request.post(`${BASE_URL}/api/project/${DEMO_PROJECT}/permissions`, { data: { email: 'colleague-cb', role: 'writer' } })).json();
    expect(r.error).toBeUndefined();
    const list = await poll(async () => (await (await page.request.get(`${BASE_URL}/api/project/${DEMO_PROJECT}/permissions`)).json()), v => JSON.stringify(v).includes('colleague-cb'));
    const perms = list.permissions || list;
    const colleague = perms.find((p: any) => p.id === 'colleague-cb');
    expect(colleague.role).toBe('writer');
    expect(perms.some((p: any) => p.kind === 'invitation')).toBe(false);
    await page.request.post(`${BASE_URL}/api/project/${DEMO_PROJECT}/permissions/colleague-cb/remove`, { data: {} });
  });

  test('tags: saving uses the Forgejo field', async () => {
    const r = await (await page.request.post(`${BASE_URL}/api/project/${DEMO_PROJECT}/topics`, { data: { topics: ['neoleaf', 'tese-cb'] } })).json();
    expect(r.error).toBeUndefined();
    expect(fake.topics('demo', 'artigo-1')).toContain('tese-cb');
    await page.request.post(`${BASE_URL}/api/project/${DEMO_PROJECT}/topics`, { data: { topics: ['neoleaf', 'demo', 'latex'] } });
  });

  test('downloading the ZIP uses the Forgejo archive (default branch)', async () => {
    const res = await page.request.get(`${BASE_URL}/api/project/${DEMO_PROJECT}/github-zip`);
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 2).toString()).toBe('PK');
  });

  test('create an empty repository on Codeberg', async () => {
    const r = await (await page.request.post(`${BASE_URL}/api/project/create-empty`, { data: { name: 'cb-empty' } })).json();
    expect(r.id).toBe('demo__cb-empty');
    expect(fake.repoExists('demo', 'cb-empty')).toBe(true);
    expect(fake.topics('demo', 'cb-empty')).toContain('neoleaf');
  });

  test('whoever signs in through Codeberg is never an administrator, even with the listed email', async () => {
    const res = await page.request.get(BASE_URL + '/admin', { maxRedirects: 0 });
    expect(res.status()).not.toBe(200);
  });

  afterAll(async () => ctx?.close());
});
