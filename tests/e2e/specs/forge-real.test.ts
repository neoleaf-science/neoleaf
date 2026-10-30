import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getBrowser } from '../helpers';

// NeoLeaf against a REAL Forgejo or Gitea (in Docker), not the fake server. Opt in with E2E_FORGE_REAL=forgejo or gitea after
//   scripts/dev_forge.sh up forgejo|gitea        (FORGE_TOKEN_TTL=90 makes the OAuth token expire in 90 s, to test the renewal)
// Without the variable these tests are skipped, so the normal suite never needs Docker.

const KIND = process.env.E2E_FORGE_REAL as 'forgejo' | 'gitea' | undefined;
const PORT = Number(process.env.NEOLEAF_PORT || 3022);
const BASE = `http://127.0.0.1:${PORT}`;
const APP = path.resolve(import.meta.dir, '../../..');
const SCRIPT = path.join(APP, 'scripts/dev_forge.sh');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const run = KIND ? describe : describe.skip;

let st: any = {};
let dir = '';
let child: ChildProcess | null = null;
const project = `real-${Date.now().toString(36)}`;
const id = `alice__${project}`;

const basic = (u: { login: string; password: string }) => 'Basic ' + Buffer.from(`${u.login}:${u.password}`).toString('base64');
/** A call to the forge's own API as `alice` (to look at what NeoLeaf did there). */
const forge = (p: string, init: RequestInit = {}) => fetch(`${st.url}/api/v1${p}`, { ...init, headers: { Authorization: basic(st.alice), 'Content-Type': 'application/json', ...(init.headers || {}) } });

beforeAll(async () => {
  if (!KIND) return;
  const r = spawnSync(SCRIPT, ['state', KIND], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`run scripts/dev_forge.sh up ${KIND} first`);
  st = JSON.parse(r.stdout);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-real-'));
  fs.writeFileSync(path.join(dir, 'neoleaf.toml'), `
[brand]
name = "Real ${KIND}"
[providers.git-real]
kind = "${KIND}"
url = "${st.url}"
label = "Sign in with the real ${KIND}"
enabled = true
client_id = "${st.client_id}"
client_secret_env = "REAL_SECRET"
`);
  child = spawn('cargo', ['run', '--quiet'], {
    cwd: APP,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NEOLEAF_CONFIG: path.join(dir, 'neoleaf.toml'),
      REAL_SECRET: st.client_secret,
      REDIRECT_URI: `${BASE}/auth/callback`,
      SESSIONS_FILE: path.join(dir, 'sessions.json'),
      SESSION_KEY: Buffer.alloc(32, 5).toString('base64'),
      BLOCKLIST_FILE: path.join(dir, 'blocked.json'),
      TEMPLATES_FILE: path.join(dir, 'templates.json'),
      NEOLEAF_WORKSPACE_DIR: path.join(dir, 'repos'),
      TL_CACHE_DIR: path.join(dir, 'tlcache'),
    },
    stdio: 'ignore',
    detached: true,
  });
  const end = Date.now() + 180000;
  for (;;) {
    try { if ((await fetch(BASE + '/', { redirect: 'manual' })).status < 500) break; } catch (_) {}
    if (Date.now() > end) throw new Error('NeoLeaf did not start');
    await sleep(300);
  }
}, 300000);

afterAll(() => {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {} }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

run(`NeoLeaf with a real ${KIND}`, () => {
  let ctx: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newContext']>>;
  let page: Awaited<ReturnType<typeof ctx.newPage>>;

  test('signing in goes through the real login and authorization pages and ends on the dashboard', async () => {
    ctx = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.addInitScript(() => { try { localStorage.setItem('ld-lang', 'en'); } catch (_) {} });
    await page.goto(BASE + '/');
    expect(await page.locator('a[href="/auth/login/git-real"]').count()).toBe(1);
    await page.goto(BASE + '/auth/login/git-real');
    await page.waitForSelector('input[name=user_name]');
    await page.fill('input[name=user_name]', st.alice.login);
    await page.fill('input[name=password]', st.alice.password);
    await page.locator('button', { hasText: 'Sign in' }).last().click();
    // the authorization page shows only the first time an account lets this application in; after that the server skips it
    const grant = page.locator('button[name=granted][value=true]');
    await Promise.race([grant.waitFor({ timeout: 30000 }).then(() => grant.click()).catch(() => {}), page.waitForURL(url => url.origin === BASE, { timeout: 30000 }).catch(() => {})]);
    await page.waitForURL(url => url.origin === BASE, { timeout: 30000 });
    await page.waitForSelector('#user-profile-modal', { state: 'attached', timeout: 30000 });
    const me = await (await page.request.get(BASE + '/api/user/profile')).json();
    expect(me.login).toBe('alice');
    expect(me.html_url).toBe(`${st.url}/alice`);
  }, 120000);

  test('a new project creates the repository on the server with the template files and the neoleaf tag', async () => {
    await page.goto(BASE + '/');
    await page.evaluate(() => (window as any).openNewProjectModal());
    await page.fill('#proj-name', project);
    await page.click('#btn-create-submit');
    await page.waitForURL(new RegExp(`/project/${id}`), { timeout: 60000 });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      ok = (await forge(`/repos/alice/${project}/contents/main.tex`)).status === 200;
      if (!ok) await sleep(500);
    }
    expect(ok).toBe(true);
    const repo = await (await forge(`/repos/alice/${project}`)).json();
    expect(repo.topics || []).toContain('neoleaf');
  }, 120000);

  test('the project opens through the Git proxy; its local copy is in the provider folder', async () => {
    await page.goto(`${BASE}/project/${id}`);
    await page.waitForSelector('.monaco-editor');
    await page.waitForFunction(async () => {
      const bg = (window as any).BrowserGit;
      return !!bg && (await bg.isCloned()) && (await bg.listFiles()).filter((f: any) => !f.is_folder).length >= 1;
    }, null, { timeout: 60000 });
    const dirs = await page.evaluate(async () => new (window as any).LightningFS('neoleaf-git').promises.readdir('/repos'));
    expect(dirs).toContain('git-real.alice');
  }, 120000);

  test('a commit made in the browser is pushed with the OAuth token and appears on the server', async () => {
    const msg = `test: real push ${Date.now()}`;
    await page.evaluate(async (m: string) => {
      const bg = (window as any).BrowserGit;
      await bg.writeFile('pushed-from-browser.txt', 'hello from NeoLeaf');
      await bg.commit(m);
      await bg.push();
    }, msg);
    const commits = await (await forge(`/repos/alice/${project}/commits?limit=3`)).json();
    expect(commits[0].commit.message.trim()).toBe(msg);
    expect((await forge(`/repos/alice/${project}/contents/pushed-from-browser.txt`)).status).toBe(200);
  }, 60000);

  test('pull brings in a change made on the server', async () => {
    const put = await forge(`/repos/alice/${project}/contents/from-server.txt`, { method: 'POST', body: JSON.stringify({ content: Buffer.from('server side').toString('base64'), message: 'server commit' }) });
    expect(put.status).toBeLessThan(300);
    const got = await page.evaluate(async () => {
      const bg = (window as any).BrowserGit;
      await bg.pull();
      return bg.readFile('from-server.txt');
    });
    expect(got).toBe('server side');
  }, 60000);

  test('sharing: the collaborator joins directly, the role is read back from the server, and removing works', async () => {
    const add = await (await page.request.post(`${BASE}/api/project/${id}/permissions`, { data: { email: st.bob.login, role: 'writer' } })).json();
    expect(add.error).toBeUndefined();
    const onServer = await forge(`/repos/alice/${project}/collaborators/${st.bob.login}`);
    expect(onServer.status).toBe(204);
    const list = await (await page.request.get(`${BASE}/api/project/${id}/permissions`)).json();
    const perms = list.permissions || list;
    expect(perms.find((p: any) => p.id === st.bob.login)?.role).toBe('writer');
    const up = await (await page.request.post(`${BASE}/api/project/${id}/permissions/${st.bob.login}/role`, { data: { role: 'reader' } })).json();
    expect(up.error).toBeUndefined();
    const perm = await (await forge(`/repos/alice/${project}/collaborators/${st.bob.login}/permission`)).json();
    expect(perm.permission).toBe('read');
    const rm = await (await page.request.post(`${BASE}/api/project/${id}/permissions/${st.bob.login}/remove`, { data: {} })).json();
    expect(rm.error).toBeUndefined();
    expect((await forge(`/repos/alice/${project}/collaborators/${st.bob.login}`)).status).toBe(404);
  }, 60000);

  test('tags and the ZIP download use the server', async () => {
    const t = await (await page.request.post(`${BASE}/api/project/${id}/topics`, { data: { topics: ['neoleaf', 'tese-real'] } })).json();
    expect(t.error).toBeUndefined();
    expect((await (await forge(`/repos/alice/${project}`)).json()).topics).toContain('tese-real');
    const zip = await page.request.get(`${BASE}/api/project/${id}/github-zip`);
    expect(zip.status()).toBe(200);
    expect((await zip.body()).subarray(0, 2).toString()).toBe('PK');
  }, 60000);

  test('deleting hides the project (it is only renamed on the server) and restoring brings it back', async () => {
    const del = await (await page.request.post(`${BASE}/api/project/${id}/delete`, { data: {} })).json();
    expect(del.error).toBeUndefined();
    // the server keeps a redirect from the old name, so look at the names of the repositories themselves
    const names = async () => (await (await forge('/user/repos?limit=50')).json()).map((r: any) => r.name as string);
    const afterDelete = await names();
    expect(afterDelete).not.toContain(project);
    expect(afterDelete.some((n: string) => n.startsWith(project))).toBe(true); // renamed, not removed
    // the project now has the trashed name; restoring goes back to the original one
    const res = await (await page.request.post(`${BASE}/api/project/${del.id}/restore`, { data: {} })).json();
    expect(res.error).toBeUndefined();
    expect(res.id).toBe(id);
    expect(await names()).toContain(project);
  }, 60000);

  test('the session keeps working after the OAuth token expired (set FORGE_TOKEN_TTL=90 when starting the server)', async () => {
    if (!process.env.E2E_FORGE_TTL) return; // only when the instance was started with a short token lifetime
    const ttl = Number(process.env.E2E_FORGE_TTL);
    await sleep((ttl + 15) * 1000); // longer than the token lives (NeoLeaf renews 60 s before it ends)
    const me = await (await page.request.get(BASE + '/api/user/profile')).json();
    expect(me.login).toBe('alice');
    const msg = `test: push after renewal ${Date.now()}`;
    await page.evaluate(async (m: string) => {
      const bg = (window as any).BrowserGit;
      await bg.writeFile('after-renewal.txt', 'x');
      await bg.commit(m);
      await bg.push();
    }, msg);
    const commits = await (await forge(`/repos/alice/${project}/commits?limit=1`)).json();
    expect(commits[0].commit.message.trim()).toBe(msg);
  }, 400000);

  test('signing out ends the session', async () => {
    await page.request.post(BASE + '/auth/logout');
    const me = await (await page.request.get(BASE + '/api/user/profile')).json();
    expect(me.error).toBeTruthy();
    await ctx.close();
  });
});
