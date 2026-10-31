import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeGithub, type FakeGithub } from '../../fake-github/server';
import { getBrowser } from '../helpers';

// Your own Git server (Forgejo or Gitea) as a sign-in provider (`[providers.<id>]` in neoleaf.toml). The fake server answers as a Forgejo
// at /api/v1, like it does for Codeberg; here it is the institution's server. A second NeoLeaf runs WITH the file; the main test server
// (without it) must not know the new routes.

const PORT = Number(process.env.E2E_FORGE_PORT || 3021);
const BASE = `http://127.0.0.1:${PORT}`;
const APP = path.resolve(import.meta.dir, '../../..');
const KEY = Buffer.alloc(32, 9);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let dir = '';
let demoId = 0; // the id the fake Forgejo gives to `demo`: the administrator listed in neoleaf.toml
let fake: FakeGithub;
let child: ChildProcess | null = null;

const toml = (withForge: boolean) => `
[brand]
name = "Forge test"
[providers.github]
enabled = true
${withForge ? `
[providers.git-test]
kind = "gitea"
url = "${fake.url}"
label = "Entrar com a conta da instituição"
enabled = true
admins = [${demoId}]
client_id = "forge-client"
client_secret_env = "FORGE_SECRET"
[providers.git-pub]
kind = "forgejo"
url = "${fake.url.replace('127.0.0.1', 'localhost')}"
internal_url = "${fake.url}"
label = "Public address, private reach"
enabled = true
client_id = "forge-client"
client_secret_env = "FORGE_SECRET"
[providers.git-off]
kind = "forgejo"
url = "${fake.url}"
enabled = false
client_id = "x"
client_secret_env = "FORGE_SECRET"
` : ''}`;

async function startNeoleaf(withForge: boolean) {
  fs.writeFileSync(path.join(dir, 'neoleaf.toml'), toml(withForge));
  child = spawn('cargo', ['run', '--quiet'], {
    cwd: APP,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NEOLEAF_CONFIG: path.join(dir, 'neoleaf.toml'),
      GITHUB_API_URL: fake.url,
      GITHUB_WEB_URL: fake.url,
      GITHUB_CLIENT_ID: 'gh',
      GITHUB_CLIENT_SECRET: 'gh',
      FORGE_SECRET: 'forge-secret',
      REDIRECT_URI: `${BASE}/auth/callback`,
      SESSIONS_FILE: path.join(dir, 'sessions.json'),
      SESSION_KEY: KEY.toString('base64'),
      BLOCKLIST_FILE: path.join(dir, 'blocked.json'),
      TEMPLATES_FILE: path.join(dir, 'templates.json'),
      NEOLEAF_WORKSPACE_DIR: path.join(dir, 'repos'),
      TL_CACHE_DIR: path.join(dir, 'tlcache'),
      COLLAB_RECHECK_SECS: '2',
    },
    stdio: 'ignore',
    detached: true,
  });
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    try { if ((await fetch(BASE + '/', { redirect: 'manual' })).status < 500) return; } catch (_) {}
    await sleep(300);
  }
  throw new Error('the server did not start');
}

async function stopNeoleaf() {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {} }
  child = null;
  await sleep(500);
}

function readSessions(): string {
  const raw = fs.readFileSync(path.join(dir, 'sessions.json'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(4, 16));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(16, raw.length - 16)), d.final()]).toString('utf8');
}


/** Signs in as `login` through the OAuth redirects by hand (the fake server authorizes whoever `?login=` names). */
async function signInAs(login: string) {
  const r1 = await fetch(`${BASE}/auth/login/git-test`, { redirect: 'manual' });
  const state = (r1.headers.getSetCookie().find(c => c.startsWith('oauth_state=')) || '').split(';')[0];
  const r2 = await fetch(`${r1.headers.get('location')}&login=${login}`, { redirect: 'manual' });
  const r3 = await fetch(r2.headers.get('location')!, { redirect: 'manual', headers: { cookie: state } });
  const sid = (r3.headers.getSetCookie().find(c => c.startsWith('latex_session=')) || '').split(';')[0].split('=')[1] || '';
  return { location: r3.headers.get('location'), sid };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-forge-'));
  fake = await startFakeGithub({ root: path.join(dir, 'forge') });
  demoId = (await (await fetch(`${fake.url}/api/v1/user`, { headers: { Authorization: 'Bearer fake-demo' } })).json()).id;
  await startNeoleaf(true);
}, 300000);

afterAll(async () => {
  await stopNeoleaf();
  try { fake?.stop(); } catch (_) {}
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the public site (no neoleaf.toml) does not know the new routes', () => {
  test('an unknown provider address is a 404 there', async () => {
    const main = process.env.E2E_BASE_URL || `http://127.0.0.1:${process.env.E2E_PORT || 3001}`;
    expect((await fetch(main + '/auth/login/git-test', { redirect: 'manual' })).status).toBe(404);
    expect((await fetch(main + '/auth/callback/git-test', { redirect: 'manual' })).status).toBe(404);
  });
});

describe('your own Forgejo/Gitea server as a provider', () => {
  let ctx: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newContext']>>;
  let page: Awaited<ReturnType<typeof ctx.newPage>>;
  let sid = '';

  test('the sign-in screen lists GitHub and the server, with the label as written; the one that is off is not there', async () => {
    const html = await (await fetch(BASE + '/')).text();
    expect(html).toContain('href="/auth/login"');
    expect(html).toContain('href="/auth/login/git-test"');
    expect(html).toContain('<span>Entrar com a conta da instituição</span>');
    expect(html).not.toContain('git-off');
    expect(html).not.toContain('/auth/login/codeberg');
  });

  test('internal_url: people are sent to the public address, NeoLeaf itself reaches the server at the internal one', async () => {
    const r1 = await fetch(`${BASE}/auth/login/git-pub`, { redirect: 'manual' });
    const loc = r1.headers.get('location')!;
    expect(loc.startsWith(fake.url.replace('127.0.0.1', 'localhost') + '/login/oauth/authorize')).toBe(true);
    // the browser step is done by hand (the fake server answers on the internal address), then NeoLeaf exchanges the code on its own side
    const state = (r1.headers.getSetCookie().find(c => c.startsWith('oauth_state=')) || '').split(';')[0];
    const r2 = await fetch(loc.replace('localhost', '127.0.0.1') + '&login=demo', { redirect: 'manual' });
    const cb = new URL(r2.headers.get('location')!);
    expect(cb.pathname).toBe('/auth/callback/git-pub');
    const r3 = await fetch(cb.toString(), { redirect: 'manual', headers: { cookie: state } });
    const sid2 = (r3.headers.getSetCookie().find(c => c.startsWith('latex_session=')) || '').split(';')[0].split('=')[1] || '';
    expect(sid2).not.toBe('');
    const me = await (await fetch(`${BASE}/api/user/profile`, { headers: { cookie: `latex_session=${sid2}` } })).json();
    expect(me.login).toBe('demo');
    // the projects list also goes through the internal address
    const home = await (await fetch(BASE + '/', { headers: { cookie: `latex_session=${sid2}` } })).text();
    expect(home).toContain('demo__artigo-1');
  });

  test('a provider that is off, or one that does not exist, cannot be used by typing its address', async () => {
    for (const p of ['git-off', 'codeberg', 'nope']) {
      const r = await fetch(`${BASE}/auth/login/${p}`, { redirect: 'manual' });
      expect([r.status, r.headers.get('location')]).toEqual([303, '/']);
      const c = await fetch(`${BASE}/auth/callback/${p}?code=fake-demo&state=x`, { redirect: 'manual' });
      expect([c.status, c.headers.get('location')]).toEqual([303, '/']);
    }
  });

  test('signing in leads to the dashboard, with the server as the provider', async () => {
    ctx = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 900 } });
    page = await ctx.newPage();
    await page.goto(BASE + '/auth/login/git-test');
    await page.waitForSelector('#proj-row-demo__artigo-1', { timeout: 30000 });
    sid = (await ctx.cookies()).find(c => c.name === 'latex_session')!.value;
    const me = await (await page.request.get(BASE + '/api/user/profile')).json();
    expect(me.login).toBe('demo');
    expect(me.html_url).toBe(`${fake.url}/demo`);
  });

  test('the project opens through the Git proxy and its local copy is kept apart from GitHub (folder git-test.demo)', async () => {
    await page.goto(`${BASE}/project/demo__artigo-1`);
    await page.waitForSelector('.monaco-editor');
    await page.waitForFunction(async () => {
      const bg = (window as any).BrowserGit;
      return !!bg && (await bg.isCloned()) && (await bg.listFiles()).filter((f: any) => !f.is_folder).length >= 2;
    }, null, { timeout: 60000 });
    const dirs = await page.evaluate(async () => new (window as any).LightningFS('neoleaf-git').promises.readdir('/repos'));
    expect(dirs).toContain('git-test.demo');
    const own = await page.evaluate(async () => new (window as any).LightningFS('neoleaf-git').promises.readdir('/repos/git-test.demo'));
    expect(own).toContain('artigo-1');
    // the GitHub-style folder never holds this project (an empty `demo` folder may exist, as it does for Codeberg)
    const github = await page.evaluate(async () => new (window as any).LightningFS('neoleaf-git').promises.readdir('/repos/demo').catch(() => []));
    expect(github).not.toContain('artigo-1');
  });

  test('sharing joins directly and tags and ZIP use the Forgejo calls', async () => {
    const add = await (await page.request.post(`${BASE}/api/project/demo__artigo-1/permissions`, { data: { email: 'colleague-gt', role: 'writer' } })).json();
    expect(add.error).toBeUndefined();
    const list = await (await page.request.get(`${BASE}/api/project/demo__artigo-1/permissions`)).json();
    const perms = list.permissions || list;
    expect(perms.find((p: any) => p.id === 'colleague-gt')?.role).toBe('writer');
    expect(perms.some((p: any) => p.kind === 'invitation')).toBe(false);
    const t = await (await page.request.post(`${BASE}/api/project/demo__artigo-1/topics`, { data: { topics: ['neoleaf', 'tese-gt'] } })).json();
    expect(t.error).toBeUndefined();
    expect(fake.topics('demo', 'artigo-1')).toContain('tese-gt');
    const zip = await page.request.get(`${BASE}/api/project/demo__artigo-1/github-zip`);
    expect(zip.status()).toBe(200);
    expect((await zip.body()).subarray(0, 2).toString()).toBe('PK');
    await page.request.post(`${BASE}/api/project/demo__artigo-1/permissions/colleague-gt/remove`, { data: {} });
  });

  test('administrators: the id listed in neoleaf.toml opens /admin (without the Templates tab); another account does not', async () => {
    const adm = await fetch(`${BASE}/admin`, { headers: { cookie: `latex_session=${sid}` } });
    expect(adm.status).toBe(200);
    const html = await adm.text();
    expect(html).toContain('Users');
    expect(html).not.toContain('tabbtn-models');
    expect((await fetch(`${BASE}/api/admin/stats`, { headers: { cookie: `latex_session=${sid}` } })).status).toBe(200);
    const other = await signInAs('alice');
    expect(other.location).toBe('/');
    expect(other.sid).not.toBe('');
    expect((await fetch(`${BASE}/admin`, { headers: { cookie: `latex_session=${other.sid}` } })).status).toBe(403);
    expect((await fetch(`${BASE}/api/admin/stats`, { headers: { cookie: `latex_session=${other.sid}` } })).status).toBe(403);
  });

  test('an administrator blocks an account of that server by login, and it cannot sign in again', async () => {
    const r = await (await fetch(`${BASE}/api/admin/users/block`, { method: 'POST', headers: { cookie: `latex_session=${sid}`, 'content-type': 'application/json' }, body: JSON.stringify({ login: 'alice', provider: 'git-test', id: 0, reason: 'e2e' }) })).json();
    expect(r.error).toBeUndefined();
    const again = await signInAs('alice');
    expect(again.location).toBe('/?blocked=1');
    expect(again.sid).toBe('');
    // blocked by provider: the same login on another provider is not affected, and an unknown provider is refused
    const bad = await (await fetch(`${BASE}/api/admin/users/block`, { method: 'POST', headers: { cookie: `latex_session=${sid}`, 'content-type': 'application/json' }, body: JSON.stringify({ login: 'x_y', provider: 'github', id: 0, reason: 'e2e' }) })).json();
    expect(String(bad.error || '')).toContain('Invalid login');
    const un = await (await fetch(`${BASE}/api/admin/users/unblock`, { method: 'POST', headers: { cookie: `latex_session=${sid}`, 'content-type': 'application/json' }, body: JSON.stringify({ login: 'alice', provider: 'git-test' }) })).json();
    expect(un.error).toBeUndefined();
    expect((await signInAs('alice')).location).toBe('/');
  });

  // ---- the browser side: the local copies of two providers (or of GitHub) with the same owner and name never mix

  /** Runs `code` against the browser's file system (the same database the page uses) and flushes it. */
  const fsDo = (code: string) => page.evaluate(async (c: string) => {
    const pfs = new (window as any).LightningFS('neoleaf-git').promises;
    const out = await (new Function('pfs', 'return (async () => {' + c + '})()'))(pfs);
    if (pfs.flush) await pfs.flush();
    return out;
  }, code);
  const clone = (dir: string) => `
    for (const d of ${JSON.stringify(dir.split('/').slice(1).map((_, i, a) => '/' + a.slice(0, i + 1).join('/')))}) { try { await pfs.mkdir(d); } catch (_) {} }
    try { await pfs.mkdir(${JSON.stringify(dir + '/.git')}); } catch (_) {}
    await pfs.writeFile(${JSON.stringify(dir + '/.git/HEAD')}, 'ref: refs/heads/main\\n');
    await pfs.writeFile(${JSON.stringify(dir + '/marker.txt')}, 'old');`;

  test('copies from earlier versions (GitHub: demo/..., Codeberg: codeberg.demo/...) sit beside the provider copy and are not listed as ours', async () => {
    page.on('dialog', d => d.accept());
    await page.addInitScript(() => { try { localStorage.setItem('ld-lang', 'en'); } catch (_) {} });
    await fsDo(clone('/repos/demo/artigo-1') + clone('/repos/codeberg.demo/artigo-1'));
    await page.goto(BASE + '/');
    await page.evaluate(() => (window as any).openUserProfileModal());
    await page.click('#upm-tab-btn-storage');
    const row = page.locator('.upm-st-row', { hasText: 'demo/artigo-1' });
    await row.waitFor({ timeout: 15000 });
    expect(await row.count()).toBe(1); // only the one of this account: the other two are another provider's
    expect(await row.textContent()).toContain('git-test'); // the badge names the provider
    await page.waitForFunction(() => /2 project\(s\) from other accounts/.test(document.getElementById('upm-st-others')?.textContent || ''), null, { timeout: 15000 });
  });

  test('"Clear" on the project list removes only this provider\'s copy; the same name on GitHub and Codeberg stays', async () => {
    await page.goto(BASE + '/');
    const cell = page.locator('#proj-row-demo__artigo-1 .pl-local');
    await cell.locator('.pl-local-yes').waitFor({ timeout: 15000 });
    await cell.locator('.pl-local-clear').click();
    await cell.locator('.pl-local-no').waitFor({ timeout: 15000 });
    const left = await fsDo(`const r = {}; for (const d of ['/repos/git-test.demo', '/repos/demo', '/repos/codeberg.demo']) r[d] = await pfs.readdir(d).catch(() => []); return r;`);
    expect(left['/repos/git-test.demo']).not.toContain('artigo-1');
    expect(left['/repos/demo']).toContain('artigo-1');
    expect(left['/repos/codeberg.demo']).toContain('artigo-1');
    // and opening the project again downloads it into the provider's own folder
    await page.goto(`${BASE}/project/demo__artigo-1`);
    await page.waitForFunction(async () => (await (window as any).BrowserGit.isCloned()), null, { timeout: 60000 });
    expect(await fsDo(`return pfs.readdir('/repos/git-test.demo');`)).toContain('artigo-1');
    expect(await fsDo(`return pfs.readFile('/repos/demo/artigo-1/marker.txt', 'utf8');`)).toBe('old');
  });

  test('a project created in NeoLeaf can pull what someone else committed on the server (it has no clone-made fetch settings)', async () => {
    const name = 'pull-after-create';
    await page.goto(BASE + '/');
    await page.evaluate(() => (window as any).openNewProjectModal());
    await page.fill('#proj-name', name);
    await page.click('#btn-create-submit');
    await page.waitForURL(new RegExp(`/project/demo__${name}`), { timeout: 60000 });
    for (let i = 0; i < 60 && !fake.tree('demo', name).includes('main.tex'); i++) await sleep(500);
    expect(fake.tree('demo', name)).toContain('main.tex');
    // someone else commits on the server (not through NeoLeaf)
    fake.addCommit('demo', name, 'from-outside.txt', 'written elsewhere');
    const got = await page.evaluate(async () => {
      const bg = (window as any).BrowserGit;
      const r = await bg.pull();
      return { r, text: await bg.readFile('from-outside.txt') };
    });
    expect(got.r.success).toBe(true);
    expect(got.text).toBe('written elsewhere');
  }, 180000);

  test('the session is stored with the provider id, and survives the server leaving neoleaf.toml (unused, not deleted)', async () => {
    await page.close();
    await stopNeoleaf();
    expect(readSessions()).toContain('"provider":"git-test"');
    await startNeoleaf(false); // the same file, without the server
    const gone = await (await fetch(BASE + '/api/user/profile', { headers: { cookie: `latex_session=${sid}` } })).json();
    expect(gone.error).toBeTruthy();
    expect((await fetch(BASE + '/auth/login/git-test', { redirect: 'manual' })).headers.get('location')).toBe('/');
    expect(readSessions()).toContain('"provider":"git-test"'); // still there after a restart and a request
    await stopNeoleaf();
    await startNeoleaf(true); // the server comes back: the same session works again
    const back = await (await fetch(BASE + '/api/user/profile', { headers: { cookie: `latex_session=${sid}` } })).json();
    expect(back.login).toBe('demo');
    await ctx.close();
  }, 400000);
});
