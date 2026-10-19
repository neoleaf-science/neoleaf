import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../../..');
const BIN = path.join(ROOT, 'agent/target/debug/neoleaf-agent');
const PORT = 47500 + Math.floor(Math.random() * 400);
const URL_ = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'https://neoleaf.science';

let proc: ChildProcess;
let home: string;
const env = () => ({ ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'cfg'), XDG_CACHE_HOME: path.join(home, 'cache'), NEOLEAF_AGENT_PORT: String(PORT) });
const cli = (...args: string[]) => spawnSync(BIN, args, { env: env(), encoding: 'utf8' }).stdout.trim();

const call = (p: string, opts: { method?: string; body?: unknown; token?: string; origin?: string | null } = {}) =>
  fetch(URL_ + p, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(opts.origin === null ? {} : { Origin: opts.origin ?? ORIGIN }),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

const newCode = () => cli('code').split('\n')[0];

async function pair(): Promise<string> {
  const r = await call('/v1/pair/confirm', { body: { code: newCode() } });
  expect(r.status).toBe(200);
  return (await r.json()).token;
}

describe('local agent: pairing and authorization', () => {
  beforeAll(async () => {
    const b = spawnSync('cargo', ['build', '--quiet', '--manifest-path', path.join(ROOT, 'agent/Cargo.toml')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('failed to build the agent: ' + b.stderr);
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-agent-e2e-'));
    proc = spawn(BIN, ['--no-tray'], { env: env(), stdio: 'ignore' });
    for (let i = 0; i < 300; i++) {
      try { if ((await call('/v1/status')).ok) return; } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('agent did not start');
  }, 300000);
  afterAll(() => { proc?.kill(); if (home) fs.rmSync(home, { recursive: true, force: true }); });

  test('status answers without pairing and reports paired=false', async () => {
    const d = await (await call('/v1/status')).json();
    expect(d.agent).toBe('neoleaf-agent');
    expect(d.paired).toBe(false);
  });

  test('a disallowed origin gets 403', async () => {
    expect((await call('/v1/status', { origin: 'https://evil.example' })).status).toBe(403);
  });

  test('without pairing, compiling is refused (401)', async () => {
    expect((await call('/v1/compile', { body: {} })).status).toBe(401);
    expect((await call('/v1/prepare', { body: { files: [] }, token: 'nlt_fake' })).status).toBe(401);
  });

  test('a wrong code is refused and, after 5 errors, the code is invalidated', async () => {
    const code = newCode();
    for (let i = 0; i < 4; i++) expect((await call('/v1/pair/confirm', { body: { code: 'AAAA-AAAA-AAAA' } })).status).toBe(401);
    expect((await call('/v1/pair/confirm', { body: { code: 'AAAA-AAAA-AAAA' } })).status).toBe(429);
    expect((await call('/v1/pair/confirm', { body: { code } })).status).toBe(401); // the right one died too
  });

  test('the right code yields its own token, single use; the code is not valid twice', async () => {
    const code = newCode();
    const ok = await call('/v1/pair/confirm', { body: { code: code.toLowerCase().replace(/-/g, ' ') } });
    expect(ok.status).toBe(200);
    const { token } = await ok.json();
    expect(token).toStartWith('nlt_');
    expect((await call('/v1/pair/confirm', { body: { code } })).status).toBe(401);
    expect((await (await call('/v1/status', { token })).json()).paired).toBe(true);
    // the token is not stored as plain text on disk
    const stored = fs.readFileSync(path.join(home, 'cfg/neoleaf-agent/devices.json'), 'utf8');
    expect(stored).not.toContain(token);
  });

  test('pairing requires a browser origin (curl without Origin cannot)', async () => {
    expect((await call('/v1/pair/confirm', { body: { code: newCode() }, origin: null })).status).toBe(404);
  });

  test('revoking through the CLI cuts off only that browser', async () => {
    const a = await pair();
    const b = await pair();
    const id = new Bun.CryptoHasher('sha256').update(a).digest('hex').slice(0, 8);
    expect(cli('devices')).toContain(id);
    expect(cli('revoke', id)).toContain('1 access');
    const statuses = await Promise.all([a, b].map(async t => (await (await call('/v1/status', { token: t })).json()).paired));
    expect(statuses.filter(Boolean).length).toBe(1);
  });

  test('/v1/unpair undoes the pairing of the browser itself', async () => {
    const t = await pair();
    expect((await call('/v1/unpair', { method: 'POST', body: {}, token: t })).status).toBe(200);
    expect((await (await call('/v1/status', { token: t })).json()).paired).toBe(false);
  });

  test('revoke all drops every access', async () => {
    const t = await pair();
    cli('revoke', 'all');
    expect((await (await call('/v1/status', { token: t })).json()).paired).toBe(false);
    expect(cli('devices')).toContain('No paired browsers');
  });
});
