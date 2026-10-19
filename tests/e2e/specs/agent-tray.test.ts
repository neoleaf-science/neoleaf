import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Tray icon at boot: the service can start BEFORE the tray exists (and the icon never showed up). Here a private D-Bus
// bus starts without a tray; the agent starts; then a fake tray appears and the icon must register with it.
// If the tray "forgets" the icon, the agent recreates it. Skipped without dbus-daemon or python with dbus.
const ROOT = path.resolve(import.meta.dir, '../../..');
const BIN = path.join(ROOT, 'agent/target/debug/neoleaf-agent');
const which = (n: string) => spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
// system python (mise's `python3` does not work with the fake HOME)
const PY = fs.existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3';
const HAVE = !!which('dbus-daemon') && spawnSync(PY, ['-c', 'import dbus, gi']).status === 0;

let home: string, addr: string, bus: ChildProcess | null = null, agent: ChildProcess, watcher: ChildProcess, state: string;
const read = () => { try { return JSON.parse(fs.readFileSync(state, 'utf8')) as { regs: number; items: string[] }; } catch (_) { return null; } };
const until = async (f: () => boolean, ms: number) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await Bun.sleep(200); } return false; };

describe.skipIf(!HAVE)('agent: tray icon', () => {
  beforeAll(async () => {
    const b = spawnSync('cargo', ['build', '--quiet', '--manifest-path', path.join(ROOT, 'agent/Cargo.toml')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('failed to build the agent: ' + b.stderr);
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-tray-'));
    state = path.join(home, 'watcher.json');
    bus = spawn('dbus-daemon', ['--session', '--nofork', '--print-address'], { stdio: ['ignore', 'pipe', 'ignore'] });
    addr = await new Promise<string>(res => { let buf = ''; bus!.stdout!.on('data', d => { buf += String(d); if (buf.includes('\n')) res(buf.split('\n')[0]); }); });
    const env = { ...process.env, DBUS_SESSION_BUS_ADDRESS: addr, HOME: home, XDG_CONFIG_HOME: path.join(home, 'cfg'), XDG_CACHE_HOME: path.join(home, 'cache'), NEOLEAF_AGENT_PORT: String(47900 + Math.floor(Math.random() * 90)), NEOLEAF_UPDATE_FIRST_SECS: '99999', NEOLEAF_TRAY_CHECK_SECS: '2' };
    agent = spawn(BIN, [], { env, stdio: 'ignore' }); // without --no-tray, and with no tray on the bus
    await Bun.sleep(1500);
    watcher = spawn(PY, [path.join(import.meta.dir, '../fixtures/fake-sni-watcher.py'), state], { env, stdio: 'ignore' });
  }, 60000);
  afterAll(() => {
    agent?.kill(); watcher?.kill();
    bus?.kill();
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  test('the agent starts without a tray and registers the icon when one appears', async () => {
    const ok = await until(() => !!read() && read()!.items.length === 1, 15000);
    expect(ok).toBe(true);
    expect(read()!.items[0]).toContain(`StatusNotifierItem-${agent.pid}-`);
  });

  test('left click also opens the menu, and the menu has short rows with the compilers in a submenu', async () => {
    const r = spawnSync(PY, [path.join(import.meta.dir, '../fixtures/tray-menu.py'), read()!.items[0]], { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: addr }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const info = JSON.parse(r.stdout) as { itemIsMenu: boolean; menu: { children: { label: string; enabled: boolean; visible: boolean; type: string; children?: { label: string }[] }[] } };
    expect(info.itemIsMenu).toBe(true);   // ItemIsMenu: the tray shows the menu on left click
    const itens = info.menu.children.filter(i => i.visible && i.type !== 'separator');
    const rotulos = itens.map(i => i.label);
    expect(rotulos[0]).toMatch(/^Agent running · port \d+$/);
    expect(rotulos[1]).toMatch(/^Version \d+\.\d+\.\d+/);
    expect(rotulos.some(l => l.startsWith('Compilers'))).toBe(true);
    for (const esperado of ['Check for updates', 'Copy pairing code', 'Open NeoLeaf', 'Quit']) expect(rotulos).toContain(esperado);
    // nothing long that the tray would have to cut with "..."
    expect(rotulos.filter(l => l.length > 45)).toEqual([]);
    const comp = itens.find(i => i.label.startsWith('Compilers'))!;
    expect(comp.children && comp.children.length).toBeGreaterThan(0);   // the list goes in the submenu
  });

  test('if the tray forgets the icon, the agent recreates it', async () => {
    const before = read()!.regs;
    process.kill(watcher.pid!, 'SIGUSR1');
    expect(await until(() => read()!.items.length === 0, 5000)).toBe(true);
    expect(await until(() => { const r = read()!; return r.regs > before && r.items.length === 1; }, 30000)).toBe(true);
  }, 60000);
});
