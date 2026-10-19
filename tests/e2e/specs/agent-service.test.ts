import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../../..');
const BIN = path.join(ROOT, 'agent/target/debug/neoleaf-agent');

let home: string;
let site: ReturnType<typeof Bun.serve>;
let siteBody: { versionJson: string; binary: string };
let ctlLog: string;

const env = () => ({
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, 'cfg'),
  NEOLEAF_AGENT_PORT: '1', // nothing listens here: the agent is "not running"
  NEOLEAF_SYSTEMCTL: path.join(home, 'fake-systemctl'),
  NEOLEAF_SITE: `http://127.0.0.1:${site.port}`,
  PATH: `${path.join(home, 'bin')}:${process.env.PATH}`, // simulates ~/.local/bin outside the PATH; only for the warning
});
// async: the fake site runs in this same process and must keep answering while the agent downloads
const run = (exe: string, ...args: string[]) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>(resolve => {
    const p = spawn(exe, args, { env: env() });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => (stdout += d));
    p.stderr.on('data', d => (stderr += d));
    p.on('close', status => resolve({ status, stdout, stderr }));
  });
const calls = () => (fs.existsSync(ctlLog) ? fs.readFileSync(ctlLog, 'utf8').trim().split('\n') : []);
const sha = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');

// "published" binary: a script that answers --version, so nothing real is replaced
const fake = (v: string) => `#!/bin/sh\n[ "$1" = "--version" ] && echo "neoleaf-agent ${v}" && exit 0\necho fake\n`;

describe('agent: install, update and remove the service', () => {
  beforeAll(() => {
    const b = spawnSync('cargo', ['build', '--quiet', '--manifest-path', path.join(ROOT, 'agent/Cargo.toml')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('failed to build the agent: ' + b.stderr);
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-svc-'));
    fs.mkdirSync(path.join(home, 'bin'));
    ctlLog = path.join(home, 'ctl.log');
    fs.writeFileSync(path.join(home, 'fake-systemctl'), `#!/bin/sh\necho "$@" >> '${ctlLog}'\n`, { mode: 0o755 });
    const bin = fake('99.0.0');
    siteBody = { binary: bin, versionJson: JSON.stringify({ version: '99.0.0', sha256: sha(bin) }) };
    site = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === '/static/agent/version.json') return new Response(siteBody.versionJson);
        if (u.pathname === '/static/agent/neoleaf-agent-linux-x86_64') return new Response(siteBody.binary);
        return new Response('nf', { status: 404 });
      },
    });
  }, 300000);
  afterAll(() => { site?.stop(true); if (home) fs.rmSync(home, { recursive: true, force: true }); });

  // the test binary is copied: `update` replaces its own executable when there is no service
  const copy = () => { const c = path.join(home, 'agent-copy'); fs.copyFileSync(BIN, c); fs.chmodSync(c, 0o755); return c; };

  test('--version reports the version', async () => {
    expect((await run(BIN, '--version')).stdout).toMatch(/^neoleaf-agent \d+\.\d+\.\d+/);
  });

  test('install copies to ~/.local/bin, writes the unit pointing there and restarts the service', async () => {
    const r = await run(copy(), 'install');
    expect(r.status).toBe(0);
    const installed = path.join(home, '.local/bin/neoleaf-agent');
    expect(fs.existsSync(installed)).toBe(true);
    expect(fs.statSync(installed).mode & 0o111).toBeGreaterThan(0);
    const unit = fs.readFileSync(path.join(home, 'cfg/systemd/user/neoleaf-agent.service'), 'utf8');
    expect(unit).toContain(`ExecStart="${installed}"`);
    const c = calls();
    expect(c).toContain('--user daemon-reload');
    expect(c).toContain('--user enable neoleaf-agent.service');
    expect(c).toContain('--user restart neoleaf-agent.service');
    expect(r.stdout).toContain('Service installed');
  });

  test('running install again updates the copy and restarts (does not just enable)', async () => {
    const before = calls().length;
    const r = await run(copy(), 'install');
    expect(r.status).toBe(0);
    expect(calls().slice(before)).toContain('--user restart neoleaf-agent.service');
  });

  test('status shows the service as installed', async () => {
    expect((await run(BIN, 'status')).stdout).toContain('installed (');
  });

  test('update refuses when the published SHA-256 does not match', async () => {
    siteBody.versionJson = JSON.stringify({ version: '99.0.0', sha256: sha('something else') });
    const installed = path.join(home, '.local/bin/neoleaf-agent');
    const before = fs.readFileSync(installed);
    const r = await run(installed, 'update', '--yes');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('SHA-256');
    expect(fs.readFileSync(installed).equals(before)).toBe(true);
  });

  test('update refuses a version.json without SHA-256', async () => {
    siteBody.versionJson = JSON.stringify({ version: '99.0.0' });
    expect((await run(path.join(home, '.local/bin/neoleaf-agent'), 'update', '--yes')).stderr).toContain('SHA-256');
  });

  test('update downloads, verifies, swaps the installed binary and restarts the service', async () => {
    siteBody.versionJson = JSON.stringify({ version: '99.0.0', sha256: sha(siteBody.binary) });
    const installed = path.join(home, '.local/bin/neoleaf-agent');
    const before = calls().length;
    const r = await run(installed, 'update', '--yes');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('99.0.0');
    expect(fs.readFileSync(installed, 'utf8')).toBe(siteBody.binary);
    expect(calls().slice(before)).toContain('--user restart neoleaf-agent.service');
  });

  test('update says it is already on the latest version', async () => {
    siteBody.versionJson = JSON.stringify({ version: '0.0.1', sha256: sha(siteBody.binary) });
    const r = await run(copy(), 'update', '--yes');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('latest version');
  });

  test('update refuses a downloaded binary that is not the announced version', async () => {
    const lie = fake('1.2.3');
    siteBody = { binary: lie, versionJson: JSON.stringify({ version: '99.0.0', sha256: sha(lie) }) };
    const r = await run(copy(), 'update', '--yes');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('announced version');
  });

  // a stray process (e.g. an executable downloaded and run by hand) holding the port stops the new service from starting
  const runWith = (exe: string, extra: Record<string, string>, ...args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>(resolve => {
      const p = spawn(exe, args, { env: { ...env(), ...extra } });
      let stdout = '', stderr = '';
      p.stdout.on('data', d => (stdout += d));
      p.stderr.on('data', d => (stderr += d));
      p.on('close', status => resolve({ status, stdout, stderr }));
    });
  const stubAgent = (version: string) => Bun.serve({ port: 0, fetch: () => new Response(JSON.stringify({ agent: 'neoleaf-agent', version })) });

  test('install warns when another copy of the agent holds the port and the expected version does not come up', async () => {
    const stub = stubAgent('0.0.1');
    try {
      const r = await runWith(copy(), { NEOLEAF_VERIFY_RESTART: '1', NEOLEAF_VERIFY_SECS: '1', NEOLEAF_AGENT_PORT: String(stub.port) }, 'install');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('another copy');
      expect(r.stderr).toContain('0.0.1');
    } finally { stub.stop(true); }
  });

  test('install confirms when the expected version is up', async () => {
    const version = (await run(BIN, '--version')).stdout.trim().split(' ')[1];
    const stub = stubAgent(version);
    try {
      const r = await runWith(copy(), { NEOLEAF_VERIFY_RESTART: '1', NEOLEAF_VERIFY_SECS: '1', NEOLEAF_AGENT_PORT: String(stub.port) }, 'install');
      expect(r.status).toBe(0);
    } finally { stub.stop(true); }
  });

  test('restart always clears the systemd failed state first (start-limit-hit)', async () => {
    const r = await run(copy(), 'install');
    expect(r.status).toBe(0);
    const c = calls();
    const lastRestart = c.lastIndexOf('--user restart neoleaf-agent.service');
    expect(c[lastRestart - 1]).toBe('--user reset-failed neoleaf-agent.service');
  });

  test('uninstall removes the unit and the installed copy', async () => {
    const r = await run(BIN, 'uninstall');
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(home, 'cfg/systemd/user/neoleaf-agent.service'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.local/bin/neoleaf-agent'))).toBe(false);
    expect(calls()).toContain('--user disable --now neoleaf-agent.service');
  });
});
