import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getBrowser } from '../helpers';

// The institution install, end to end, with Docker: `neoleaf init` inside the image, `docker compose` with Caddy and the bundled Forgejo,
// `setup-forgejo.sh`, then a real sign-in, a project, a PDF compiled in the browser and a restart. Opt in with E2E_INSTALL=1 (needs Docker and
// network the first time; the binary comes from `mise run build:linux`, or set E2E_INSTALL_BIN). The normal suite skips it.

const ON = process.env.E2E_INSTALL === '1';
const APP = path.resolve(import.meta.dir, '../../..');
const BIN = process.env.E2E_INSTALL_BIN || path.join(os.homedir(), '.cache/ld-bookworm/target/neoleaf-linux');
const PORT = Number(process.env.E2E_INSTALL_PORT || 8080);
const SITE = `http://localhost:${PORT}`;
const GIT = `http://git.localhost:${PORT}`;
const IMAGE = 'neoleaf:e2e-install';
const PROJECT = 'neoleaf-inst-e2e';
const run = ON ? describe : describe.skip;

let work = '';
let inst = '';

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const compose = (...args: string[]) => sh('docker', ['compose', ...args], { cwd: inst, env: { NEOLEAF_IMAGE: IMAGE, COMPOSE_PROJECT_NAME: PROJECT } });

beforeAll(() => {
  if (!ON) return;
  if (!fs.existsSync(BIN)) throw new Error(`no server binary at ${BIN}: run \`mise run build:linux\` in the parent folder`);
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-install-'));
  const rel = path.join(work, 'release');
  inst = path.join(work, 'install');
  fs.mkdirSync(inst);
  sh(path.join(APP, 'scripts/package_release_dir.sh'), [rel, BIN], { cwd: APP });
  sh('docker', ['build', '-q', '-f', 'install/Dockerfile', '-t', IMAGE, '.'], { cwd: rel });
  // `neoleaf init` the way the guide tells people to run it: inside the image, as themselves, writing into the folder
  sh('docker', ['run', '--rm', '-u', `${process.getuid!()}:${process.getgid!()}`, '-v', `${inst}:/out`, IMAGE, './neoleaf', 'init', '--dir', '/out',
    '--url', SITE, '--name', 'Install test', '--contact', 'suporte@example.edu', '--git', 'bundled']);
  sh('./setup-forgejo.sh', [], { cwd: inst, env: { NEOLEAF_IMAGE: IMAGE, COMPOSE_PROJECT_NAME: PROJECT } });
}, 900000);

afterAll(() => {
  if (!ON || !inst) return;
  try { compose('down', '-v'); } catch (_) {}
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

run('institution install with docker compose and the bundled Forgejo', () => {
  let ctx: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newContext']>>;
  let page: Awaited<ReturnType<typeof ctx.newPage>>;
  const admin = () => {
    const t = fs.readFileSync(path.join(inst, 'forgejo-admin.txt'), 'utf8');
    return { login: /login: (.+)/.exec(t)![1].trim(), password: /password: (.+)/.exec(t)![1].trim() };
  };

  test('the files are private where they must be, and the OAuth keys were written by the setup script', () => {
    expect((fs.statSync(path.join(inst, '.env')).mode & 0o777).toString(8)).toBe('600');
    expect((fs.statSync(path.join(inst, 'forgejo-admin.txt')).mode & 0o777).toString(8)).toBe('600');
    const env = fs.readFileSync(path.join(inst, '.env'), 'utf8');
    expect(env).toMatch(/^GIT_CLIENT_ID=.+/m);
    expect(env).toMatch(/^GIT_CLIENT_SECRET=.+/m);
    // the keys are in .env only, never in the file that people copy around
    expect(fs.readFileSync(path.join(inst, 'neoleaf.toml'), 'utf8')).not.toMatch(/secret\s*=\s*"[A-Za-z0-9]{20,}/);
  });

  test('the sign-in screen is the institution\'s, with the bundled server as the only provider', async () => {
    const html = await (await fetch(SITE + '/')).text();
    expect(html).toContain('<h1>Install test</h1>');
    expect(html).toContain('mailto:suporte@example.edu');
    expect(html).toContain('href="/auth/login/git"');
    expect(html).not.toContain('href="/auth/login"');
    expect(html).not.toContain('nl-hero');
  });

  test('the configuration is valid inside the container', () => {
    const out = compose('run', '--rm', '--no-deps', 'neoleaf', './neoleaf', '--check-config');
    expect(out).toContain('provider git (Sign in with your account at http://git.localhost:' + PORT + ', reached by NeoLeaf at http://forgejo:3000): on, 1 administrator(s) listed');
  }, 120000);

  test('signing in through the bundled Forgejo (real login and authorization pages) ends on the dashboard, as an administrator', async () => {
    ctx = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('ld-lang', 'en'); } catch (_) {} });
    await page.goto(SITE + '/');
    await page.click('a[href="/auth/login/git"]');
    await page.waitForSelector('input[name=user_name]');
    const a = admin();
    await page.fill('input[name=user_name]', a.login);
    await page.fill('input[name=password]', a.password);
    await page.locator('button', { hasText: 'Sign in' }).last().click();
    const grant = page.locator('button[name=granted][value=true]');
    await Promise.race([grant.waitFor({ timeout: 30000 }).then(() => grant.click()).catch(() => {}), page.waitForURL(u => u.origin === SITE, { timeout: 30000 }).catch(() => {})]);
    await page.waitForURL(u => u.origin === SITE, { timeout: 30000 });
    await page.waitForSelector('#user-profile-modal', { state: 'attached', timeout: 30000 });
    const me = await (await page.request.get(SITE + '/api/user/profile')).json();
    expect(me.login).toBe(a.login);
    expect(me.id).toBe(1);
    expect((await page.request.get(SITE + '/admin')).status()).toBe(200);
  }, 120000);

  test('a project is created on the bundled Forgejo, opens, and compiles to a PDF in the browser', async () => {
    await page.goto(SITE + '/');
    await page.evaluate(() => (window as any).openNewProjectModal());
    await page.fill('#proj-name', 'first-project');
    await page.click('#btn-create-submit');
    await page.waitForURL(/\/project\/forgeadmin__first-project/, { timeout: 60000 });
    await page.waitForSelector('.monaco-editor');
    await page.waitForFunction(async () => {
      const bg = (window as any).BrowserGit;
      return !!bg && (await bg.isCloned()) && (await bg.listFiles()).filter((f: any) => !f.is_folder).length >= 1;
    }, null, { timeout: 90000 });
    const repo = await page.request.get(`${GIT}/api/v1/repos/forgeadmin/first-project`, { headers: { Authorization: 'Basic ' + Buffer.from(`${admin().login}:${admin().password}`).toString('base64') } });
    expect(repo.status()).toBe(200);
    await page.click('#compile-btn');
    await page.waitForFunction(() => !!document.querySelector('#pdf-viewer canvas'), null, { timeout: 180000 });
  }, 400000);

  test('after the server restarts the session is still valid (the sessions live in the data volume, encrypted)', async () => {
    compose('restart', 'neoleaf');
    const end = Date.now() + 90000;
    let me: any = {};
    while (Date.now() < end) {
      try { me = await (await page.request.get(SITE + '/api/user/profile')).json(); if (me.login) break; } catch (_) {}
      await new Promise(r => setTimeout(r, 1000));
    }
    expect(me.login).toBe(admin().login);
    await ctx.close();
  }, 200000);

  test('what the container writes stays in its volume: nothing of the project is on the server', () => {
    const files = compose('exec', '-T', 'neoleaf', 'find', '/data', '-type', 'f', '-not', '-path', '/data/tlcache/*').split('\n').filter(Boolean);
    expect(files.some(f => f.endsWith('sessions.json'))).toBe(true);
    expect(files.some(f => /\.(tex|bib|pdf)$/.test(f))).toBe(false);
  });
});
