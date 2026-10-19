import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// XeLaTeX finds fonts by name via fontconfig; TinyTeX does not expose them. Really compiles with the `fontawesome` package,
// which loads "FontAwesome" by name (FontAwesome.otf ships inside the installed TeX).
const ROOT = path.resolve(import.meta.dir, '../../..');
const BIN = path.join(ROOT, 'agent/target/debug/neoleaf-agent');
const ORIGIN = 'https://neoleaf.science';
const which = (n: string) => spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
const kpse = which('kpsewhich');
const HAVE = ['latexmk', 'xelatex', 'xdvipdfmx', 'kpsewhich'].every(n => !!which(n))
  && !!kpse && spawnSync(kpse, ['FontAwesome.otf'], { encoding: 'utf8' }).stdout.trim() !== ''
  && spawnSync(kpse, ['fontawesome.sty'], { encoding: 'utf8' }).stdout.trim() !== ''
  && spawnSync('sh', ['-c', 'fc-list | grep -qi "FontAwesome\\.otf\\|family=FontAwesome"'], {}).status !== 0;

let home: string;
const procs: ChildProcess[] = [];
const sha = (b: string) => new Bun.CryptoHasher('sha256').update(b).digest('hex');
const DOC = '\\documentclass{article}\n\\usepackage{fontawesome}\n\\begin{document}Ola \\faGithub\\end{document}\n';

const env = (port: number, extra: Record<string, string> = {}) => ({
  ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'cfg'), XDG_CACHE_HOME: path.join(home, 'cache'),
  NEOLEAF_AGENT_PORT: String(port), NEOLEAF_UPDATE_FIRST_SECS: '99999', PATH: `${path.join(home, 'bin')}:/usr/bin:/bin`, ...extra,
});

async function startAgent(port: number, extra: Record<string, string> = {}) {
  procs.push(spawn(BIN, ['--no-tray'], { env: env(port, extra), stdio: 'ignore' }));
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/v1/status`)).ok) break; } catch (_) {} await Bun.sleep(100); }
  const code = spawnSync(BIN, ['code'], { env: env(port, extra), encoding: 'utf8' }).stdout.split('\n')[0];
  const r = await fetch(`http://127.0.0.1:${port}/v1/pair/confirm`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  return (await r.json()).token as string;
}

async function compile(port: number, token: string, project: string) {
  const files = [{ path: 'main.tex', sha256: sha(DOC) }];
  const h = { Origin: ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (p: string, body: unknown) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  await post('/v1/prepare', { files });
  await post('/v1/blobs', { blobs: [{ sha256: sha(DOC), b64: Buffer.from(DOC).toString('base64') }] });
  return (await (await post('/v1/compile', { project, engine: 'agent-xelatex', mainFile: 'main.tex', files, installMissing: false })).json()) as any;
}

describe.skipIf(!HAVE)('agent: installed TeX fonts in XeLaTeX', () => {
  beforeAll(() => {
    const b = spawnSync('cargo', ['build', '--quiet', '--manifest-path', path.join(ROOT, 'agent/Cargo.toml')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('failed to build the agent: ' + b.stderr);
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-fonts-'));
    fs.mkdirSync(path.join(home, 'bin'));
    for (const n of ['latexmk', 'xelatex', 'xdvipdfmx', 'kpsewhich']) fs.symlinkSync(fs.realpathSync(which(n)), path.join(home, 'bin', n));
  }, 300000);
  afterAll(() => { procs.forEach(p => p.kill()); if (home) fs.rmSync(home, { recursive: true, force: true }); });

  test('control: without the agent configuration, XeLaTeX cannot find the FontAwesome font', async () => {
    const port = 47200 + Math.floor(Math.random() * 90);
    const token = await startAgent(port, { FONTCONFIG_FILE: '/etc/fonts/fonts.conf' }); // already set: the agent leaves it alone
    const res = await compile(port, token, 'fonts-control');
    expect(res.success).toBe(false);
    expect(res.log).toMatch(/font "FontAwesome" cannot be found/);
  });

  test('the agent gives XeLaTeX the installed TeX fonts and the document compiles', async () => {
    const port = 47300 + Math.floor(Math.random() * 90);
    const token = await startAgent(port);
    const res = await compile(port, token, 'fonts-fix');
    expect(res.success).toBe(true);
    expect(res.pdf_base64?.length).toBeGreaterThan(1000);
    const conf = fs.readFileSync(path.join(home, 'cache/neoleaf-agent/fonts.conf'), 'utf8');
    expect(conf).toContain('/etc/fonts/fonts.conf');
    expect(conf).toContain('fonts/opentype');
  });
});
