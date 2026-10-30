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

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-forge-'));
  fake = await startFakeGithub({ root: path.join(dir, 'forge') });
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
