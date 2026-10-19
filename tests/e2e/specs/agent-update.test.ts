import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../../..');
const BIN = path.join(ROOT, 'agent/target/debug/neoleaf-agent');

let site: ReturnType<typeof Bun.serve>;
let hits = 0;
const fake = (v: string) => `#!/bin/sh\n[ "$1" = "--version" ] && echo "neoleaf-agent ${v}" && exit 0\necho fake\n`;
const sha = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');
const NEW = fake('99.0.0');

interface Box { home: string; port: number; proc?: ChildProcess; exe: string }
const boxes: Box[] = [];

function mkBox(): Box {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-upd-'));
  const exe = path.join(home, 'agent-copy');
  fs.copyFileSync(BIN, exe);
  fs.chmodSync(exe, 0o755);
  fs.writeFileSync(path.join(home, 'fake-systemctl'), `#!/bin/sh\necho "$@" >> '${home}/ctl.log'\n`, { mode: 0o755 });
  const b = { home, port: 47900 + Math.floor(Math.random() * 90), exe };
  boxes.push(b);
  return b;
}
const env = (b: Box) => ({
  ...process.env,
  HOME: b.home,
  XDG_CONFIG_HOME: path.join(b.home, 'cfg'),
  NEOLEAF_AGENT_PORT: String(b.port),
  NEOLEAF_SYSTEMCTL: path.join(b.home, 'fake-systemctl'),
  NEOLEAF_SITE: `http://127.0.0.1:${site.port}`,
  NEOLEAF_UPDATE_FIRST_SECS: '0',
  NEOLEAF_UPDATE_INTERVAL_SECS: '1',
});
const cli = (b: Box, exe: string, ...args: string[]) =>
  new Promise<{ status: number | null; stdout: string }>(resolve => {
    const p = spawn(exe, args, { env: env(b) });
    let stdout = '';
    p.stdout.on('data', d => (stdout += d));
    p.on('close', status => resolve({ status, stdout }));
  });
const daemon = (b: Box, exe = b.exe) => { b.proc = spawn(exe, ['--no-tray'], { env: env(b), stdio: 'ignore' }); };
const status = async (b: Box) => (await fetch(`http://127.0.0.1:${b.port}/v1/status`)).json() as Promise<any>;
const ctl = (b: Box) => (fs.existsSync(path.join(b.home, 'ctl.log')) ? fs.readFileSync(path.join(b.home, 'ctl.log'), 'utf8').trim().split('\n') : []);
const until = async (fn: () => Promise<boolean> | boolean, ms = 15000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (_) {} await Bun.sleep(150); }
  return false;
};

describe('agent: update notice and automatic update', () => {
  beforeAll(() => {
    const b = spawnSync('cargo', ['build', '--quiet', '--manifest-path', path.join(ROOT, 'agent/Cargo.toml')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('failed to build the agent: ' + b.stderr);
    site = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === '/static/agent/version.json') { hits++; return new Response(JSON.stringify({ version: '99.0.0', sha256: sha(NEW) })); }
        if (u.pathname === '/static/agent/neoleaf-agent-linux-x86_64') return new Response(NEW);
        return new Response('nf', { status: 404 });
      },
    });
  }, 300000);
  afterEach(() => { boxes.forEach(b => b.proc?.kill()); }); // one agent per test: the previous one must not keep polling the site
  afterAll(() => { site?.stop(true); boxes.forEach(b => { b.proc?.kill(); fs.rmSync(b.home, { recursive: true, force: true }); }); });

  test('default mode (notify): /v1/status reports the new version and nothing is installed', async () => {
    const b = mkBox();
    const original = fs.readFileSync(b.exe);
    daemon(b);
    expect(await until(async () => (await status(b)).update?.available === '99.0.0')).toBe(true);
    expect((await status(b)).autoUpdate).toBe('notify');
    expect(fs.readFileSync(b.exe).equals(original)).toBe(true);
    expect(ctl(b).some(l => l.includes('restart'))).toBe(false);
  });

  test('off mode: does not query the site', async () => {
    const b = mkBox();
    expect((await cli(b, b.exe, 'auto-update', 'off')).stdout).toContain('off');
    const before = hits;
    daemon(b);
    expect(await until(async () => (await status(b)).agent === 'neoleaf-agent')).toBe(true);
    await Bun.sleep(2500);
    expect(hits).toBe(before);
    expect((await status(b)).update ?? null).toBeNull();
  });

  test('on mode without an installed service: only warns (cannot restart safely)', async () => {
    const b = mkBox();
    await cli(b, b.exe, 'auto-update', 'on');
    const original = fs.readFileSync(b.exe);
    daemon(b);
    expect(await until(async () => (await status(b)).update?.available === '99.0.0')).toBe(true);
    await Bun.sleep(2000);
    expect(fs.readFileSync(b.exe).equals(original)).toBe(true);
  });

  test('on mode with an installed service: downloads, swaps the binary, restarts the service and keeps the previous one', async () => {
    const b = mkBox();
    expect((await cli(b, b.exe, 'install')).status).toBe(0);
    await cli(b, b.exe, 'auto-update', 'on');
    const installed = path.join(b.home, '.local/bin/neoleaf-agent');
    const original = fs.readFileSync(installed);
    const restartsBefore = ctl(b).filter(l => l.includes('restart')).length;
    daemon(b, installed);
    expect(await until(() => fs.readFileSync(installed, 'utf8') === NEW)).toBe(true);
    expect(ctl(b).filter(l => l.includes('restart')).length).toBeGreaterThan(restartsBefore);
    expect(fs.readFileSync(path.join(b.home, '.local/bin/neoleaf-agent.prev')).equals(original)).toBe(true);
    // rollback restores the previous version
    b.proc?.kill();
    expect((await cli(b, BIN, 'rollback')).status).toBe(0);
    expect(fs.readFileSync(installed).equals(original)).toBe(true);
  });

  test('auto-update rejects an invalid mode and shows the current one', async () => {
    const b = mkBox();
    expect((await cli(b, b.exe, 'auto-update', 'maybe')).status).toBe(1);
    expect((await cli(b, b.exe, 'auto-update')).stdout).toContain('notify');
  });
});
