import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BASE_URL, getBrowser } from '../helpers';

// Institution install: an optional `neoleaf.toml` (see neoleaf.example.toml) changes the sign-in screen, which providers are on and where
// Terms and Privacy point. The main test server runs WITHOUT the file and must behave exactly as the public site does; a second server
// runs WITH it.

const PORT = Number(process.env.E2E_INST_PORT || 3019);
const INST = `http://127.0.0.1:${PORT}`;
const APP = path.resolve(import.meta.dir, '../../..');
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SVG_DARK = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#ffffff"/></svg>';

const TOML = `
[brand]
name = "IFTO <LaTeX> & Cia"
logo = "brand/logo.png"
logo_dark = "brand/logo-dark.svg"
accent = "#1a7f37"
contact_email = "suporte@ifto.edu.br"

[legal]
terms_url = "https://ifto.edu.br/termos"

[providers.github]
enabled = true
client_secret_env = "INST_GH_SECRET"

[providers.codeberg]
enabled = false
`;

let dir = '';
let child: ChildProcess | null = null;

const env = (extra: Record<string, string> = {}) => ({
  ...process.env,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  GITHUB_CLIENT_ID: 'inst-client',
  INST_GH_SECRET: 'inst-secret',
  CODEBERG_CLIENT_ID: 'x',
  CODEBERG_CLIENT_SECRET: 'y', // keys exist, but the file leaves Codeberg off
  REDIRECT_URI: `${INST}/auth/callback`,
  SESSIONS_FILE: path.join(dir, 'sessions.json'),
  BLOCKLIST_FILE: path.join(dir, 'blocked.json'),
  TEMPLATES_FILE: path.join(dir, 'templates.json'),
  NEOLEAF_WORKSPACE_DIR: path.join(dir, 'repos'),
  TL_CACHE_DIR: path.join(dir, 'tlcache'),
  ...extra,
});

async function waitFor(url: string, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url, { redirect: 'manual' })).status > 0) return true; } catch (_) {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-inst-'));
  fs.mkdirSync(path.join(dir, 'brand'));
  fs.writeFileSync(path.join(dir, 'brand/logo.png'), PNG);
  fs.writeFileSync(path.join(dir, 'brand/logo-dark.svg'), SVG_DARK);
  fs.writeFileSync(path.join(dir, 'neoleaf.toml'), TOML);
  child = spawn('cargo', ['run', '--quiet'], { cwd: APP, env: env({ NEOLEAF_CONFIG: path.join(dir, 'neoleaf.toml') }), stdio: 'ignore', detached: true });
  if (!(await waitFor(INST + '/'))) throw new Error('the institution server did not start');
}, 300000);

afterAll(() => {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {} }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('without neoleaf.toml (the public site)', () => {
  test('the home page is the NeoLeaf landing page and there is no logo route', async () => {
    const html = await (await fetch(BASE_URL + '/')).text();
    expect(html).toContain('nl-hero');
    expect(html).not.toContain('inst-card');
    expect((await fetch(BASE_URL + '/brand/logo')).status).toBe(404);
    expect((await fetch(BASE_URL + '/brand/logo-dark')).status).toBe(404);
  });

  test('Terms and Privacy are the built-in pages, not redirects', async () => {
    for (const p of ['/terms', '/privacy']) {
      const r = await fetch(BASE_URL + p, { redirect: 'manual' });
      expect(r.status).toBe(200);
    }
  });

  test('both sign-in routes still start the OAuth flow', async () => {
    for (const p of ['/auth/login', '/auth/login/codeberg']) {
      const r = await fetch(BASE_URL + p, { redirect: 'manual' });
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).not.toBe('/');
    }
  });
});

describe('with neoleaf.toml', () => {
  test('the sign-in screen carries the name (escaped), logo, accent, contact and only the enabled provider', async () => {
    const html = await (await fetch(INST + '/')).text();
    expect(html).toContain('<h1>IFTO &lt;LaTeX&gt; &amp; Cia</h1>');
    expect(html).not.toContain('<LaTeX>');
    expect(html).toContain('src="/brand/logo"');
    expect(html).toContain('src="/brand/logo-dark"');
    expect(html).toContain('--inst-accent:#1a7f37');
    expect(html).toContain('mailto:suporte@ifto.edu.br');
    expect(html).toContain('href="/auth/login"');
    expect(html).not.toContain('/auth/login/codeberg');
    expect(html).not.toContain('nl-hero');
  });

  test('the logos are served as images, with nosniff and a locked-down policy', async () => {
    const a = await fetch(INST + '/brand/logo');
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('image/png');
    expect(a.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await a.arrayBuffer()).equals(PNG)).toBe(true);
    const b = await fetch(INST + '/brand/logo-dark');
    expect(b.headers.get('content-type')).toBe('image/svg+xml');
    expect(b.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(b.headers.get('content-security-policy')).toContain('sandbox');
  });

  test('Terms go to the institution; Privacy, not configured, stays the built-in page', async () => {
    const t = await fetch(INST + '/terms', { redirect: 'manual' });
    expect(t.status).toBe(303);
    expect(t.headers.get('location')).toBe('https://ifto.edu.br/termos');
    expect((await fetch(INST + '/privacy', { redirect: 'manual' })).status).toBe(200);
  });

  test('a provider that is off cannot be used, even by typing its address; the one that is on can', async () => {
    const off = await fetch(INST + '/auth/login/codeberg', { redirect: 'manual' });
    expect(off.status).toBe(303);
    expect(off.headers.get('location')).toBe('/');
    const on = await fetch(INST + '/auth/login', { redirect: 'manual' });
    expect(on.status).toBe(303);
    expect(on.headers.get('location')).toContain('client_id=inst-client');
  });

  test('the notices of the query string appear on the branded screen', async () => {
    expect(await (await fetch(INST + '/?blocked=1')).text()).toContain('blocked by the administrator');
    expect(await (await fetch(INST + '/?expired=1')).text()).toContain('session expired');
  });

  test('in the browser: the logo loads, the dark theme swaps it, and the text is translated', async () => {
    const ctx = await (await getBrowser()).newContext({ viewport: { width: 1000, height: 700 }, locale: 'en-US' });
    const page = await ctx.newPage();
    try {
      await page.goto(INST + '/');
      const logo = page.locator('.inst-logo-light');
      await logo.waitFor();
      expect(await logo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
      await page.evaluate(() => { localStorage.setItem('ld-theme', 'dark'); });
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      expect(await page.locator('.inst-logo-dark').isVisible()).toBe(true);
      expect(await page.locator('.inst-logo-light').isVisible()).toBe(false);
      await page.evaluate(() => { localStorage.setItem('ld-lang', 'pt'); });
      await page.reload();
      await page.waitForFunction(() => /Entrar com o GitHub/.test(document.body.innerText));
      const text = await page.evaluate(() => document.body.innerText);
      expect(text).toContain('Editor LaTeX colaborativo');
      expect(text).toContain('Termos de Uso');
      await page.screenshot({ path: '/tmp/institution-login.png' });
    } finally {
      await ctx.close();
    }
  });

  test('--check-config explains a valid file and rejects an invalid one without starting the server', () => {
    const bin = path.join(APP, 'target/debug/neoleaf');
    const ok = spawnSync(bin, ['--check-config'], { cwd: APP, env: env({ NEOLEAF_CONFIG: path.join(dir, 'neoleaf.toml') }), encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('provider github: on');
    expect(ok.stdout).toContain('provider codeberg: off');
    expect(ok.stdout).not.toContain('inst-secret');
    const bad = path.join(dir, 'bad.toml');
    for (const [text, msg] of [
      ['[brand]\nlogo = "../x.png"', 'no ..'],
      ['[brand]\naccent = "green"', 'brand.accent'],
      ['[providers.gitlab]\nenabled = true', 'not supported yet'],
      ['[brand\nname=', 'TOML'],
    ] as const) {
      fs.writeFileSync(bad, text);
      const r = spawnSync(bin, ['--check-config'], { cwd: APP, env: env({ NEOLEAF_CONFIG: bad }), encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Invalid configuration');
      if (msg !== 'TOML') expect(r.stderr).toContain(msg);
    }
    const missing = spawnSync(bin, ['--check-config'], { cwd: APP, env: env({ NEOLEAF_CONFIG: path.join(dir, 'nope.toml') }), encoding: 'utf8' });
    expect(missing.status).toBe(1);
  });
});
