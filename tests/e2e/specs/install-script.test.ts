import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BASE_URL, getBrowser } from '../helpers';

// One-line installer: curl -fsSL <site>/install.sh | sh
const ROOT = path.resolve(import.meta.dir, '../../..');
const sha = (b: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(b).digest('hex');

let home: string;
const env = (extra: Record<string, string> = {}) => ({
  ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'cfg'), XDG_CACHE_HOME: path.join(home, 'cache'),
  NEOLEAF_SYSTEMCTL: path.join(home, 'fake-systemctl'), ...extra,
});
// setsid: no controlling terminal, so the script asks nothing on /dev/tty
const runScript = (cmd: string, extra: Record<string, string> = {}) =>
  new Promise<{ status: number | null; out: string; err: string }>(resolve => {
    const p = spawn('setsid', ['-w', 'sh', '-c', cmd], { env: env(extra) });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('close', status => resolve({ status, out, err }));
  });

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-install-'));
  fs.writeFileSync(path.join(home, 'fake-systemctl'), `#!/bin/sh\necho "$@" >> '${home}/ctl.log'\n`, { mode: 0o755 });
});
afterAll(() => { if (home) fs.rmSync(home, { recursive: true, force: true }); });

describe('agent one-line installer', () => {
  test('the script is served with the own server address and no placeholder', async () => {
    const r = await fetch(`${BASE_URL}/install.sh`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('shellscript');
    const text = await r.text();
    expect(text).toStartWith('#!/bin/sh');
    expect(text).toContain(`SITE="\${NEOLEAF_SITE:-${BASE_URL}}"`);
    expect(text).not.toContain('__SITE__');
    expect(spawnSync('sh', ['-n'], { input: text }).status).toBe(0); // valid syntax
  });

  test('the Windows installer (install.ps1) is served with the server address and verifies the SHA-256', async () => {
    const r = await fetch(`${BASE_URL}/install.ps1`);
    expect(r.status).toBe(200);
    const ps = await r.text();
    expect(ps).not.toContain('__SITE__');
    expect(ps).toContain(BASE_URL);
    expect(ps).toContain('sha256_windows');
    expect(ps).toContain('neoleaf-agent-windows-x86_64.exe');
    expect(ps).toContain('Get-FileHash');
  });

  test('a forged Host does not point the script to another server', () => {
    const out = spawnSync('curl', ['-s', '-H', 'Host: evil.example', `${BASE_URL}/install.sh`], { encoding: 'utf8' }).stdout;
    expect(out).toContain('SITE="${NEOLEAF_SITE:-https://neoleaf.science}"');
    expect(out).not.toContain('evil.example');
  });

  test('curl | sh downloads, verifies the SHA-256, installs to ~/.local/bin and registers the service', async () => {
    const r = await runScript(`curl -fsSL ${BASE_URL}/install.sh | sh`);
    expect(r.err).toBe('');
    expect(r.status).toBe(0);
    expect(r.out).toContain('verified (SHA-256)');
    expect(r.out).toContain('Done.');
    const bin = path.join(home, '.local/bin/neoleaf-agent');
    expect(fs.statSync(bin).mode & 0o111).toBeGreaterThan(0);
    // it is the same binary the server publishes
    expect(sha(fs.readFileSync(bin))).toBe(sha(fs.readFileSync(path.join(ROOT, 'static/agent/neoleaf-agent-linux-x86_64'))));
    expect(spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout).toMatch(/^neoleaf-agent \d+\.\d+\.\d+/);
    expect(fs.readFileSync(path.join(home, 'cfg/systemd/user/neoleaf-agent.service'), 'utf8')).toContain(`ExecStart="${bin}"`);
    expect(fs.readFileSync(path.join(home, 'ctl.log'), 'utf8')).toContain('restart neoleaf-agent.service');
  });

  test('running again updates without error (idempotent)', async () => {
    const r = await runScript(`curl -fsSL ${BASE_URL}/install.sh | sh`);
    expect(r.status).toBe(0);
  });

  test('mismatched SHA-256: aborts and installs nothing', async () => {
    const h2 = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-install2-'));
    fs.writeFileSync(path.join(h2, 'fake-systemctl'), '#!/bin/sh\n', { mode: 0o755 });
    const fake = '#!/bin/sh\necho fake\n';
    const stub = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === '/static/agent/version.json') return new Response(JSON.stringify({ version: '9.9.9', sha256: sha('something else') }));
        if (p === '/static/agent/neoleaf-agent-linux-x86_64') return new Response(fake);
        return new Response('nf', { status: 404 });
      },
    });
    try {
      const script = await (await fetch(`${BASE_URL}/install.sh`)).text();
      const r = await new Promise<{ status: number | null; err: string }>(resolve => {
        const p = spawn('setsid', ['-w', 'sh'], { env: { ...env(), HOME: h2, XDG_CONFIG_HOME: path.join(h2, 'cfg'), NEOLEAF_SITE: `http://127.0.0.1:${stub.port}`, NEOLEAF_SYSTEMCTL: path.join(h2, 'fake-systemctl') } });
        let err = '';
        p.stderr.on('data', d => (err += d));
        p.on('close', status => resolve({ status, err }));
        p.stdin.end(script);
      });
      expect(r.status).toBe(1);
      expect(r.err).toContain('SHA-256');
      expect(fs.existsSync(path.join(h2, '.local/bin/neoleaf-agent'))).toBe(false);
    } finally { stub.stop(true); fs.rmSync(h2, { recursive: true, force: true }); }
  });

  test('the home page and /agent show the command, pointing to the current server', async () => {
    const ctx = await (await getBrowser()).newContext();
    const page = await ctx.newPage();
    for (const p of ['/', '/agent']) {
      await page.goto(BASE_URL + p);
      const cmd = (await page.locator('#install-cmd-text').first().textContent())!.trim();
      expect(cmd).toBe(`curl -fsSL ${BASE_URL}/install.sh | sh`);
    }
    expect(await page.locator('a[href="/install.sh"]').count()).toBeGreaterThan(0);
    await ctx.close();
  });
});
