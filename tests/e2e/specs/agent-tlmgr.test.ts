import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Really compiles through the agent (needs latexmk + pdflatex on the machine) with a fake `tlmgr` on the PATH,
// which reproduces an outdated TinyTeX: it refuses to install until `tlmgr update --self` runs.
const ROOT = path.resolve(import.meta.dir, '../../..');
const BIN = path.join(ROOT, 'agent/target/debug/neoleaf-agent');
const PORT = 47600 + Math.floor(Math.random() * 300);
const ORIGIN = 'https://neoleaf.science';
const which = (n: string) => spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
const HAVE_TEX = !!which('latexmk') && !!which('pdflatex');

let home: string, proc: ChildProcess, token: string;
const sha = (b: Uint8Array | string) => new Bun.CryptoHasher('sha256').update(b).digest('hex');

function fakeTlmgr(mode: 'stale' | 'broken') {
  const dir = path.join(home, 'bin');
  const state = path.join(home, 'tlmgr.updated');
  const log = path.join(home, 'tlmgr.log');
  fs.rmSync(state, { force: true });
  fs.rmSync(log, { force: true });
  fs.writeFileSync(path.join(dir, 'tlmgr'), `#!/bin/sh
echo "$@" >> '${log}'
case "$1" in
  search) printf 'nlbundle:\\n\\ttexmf-dist/tex/latex/nlbundle/nlpkg.sty\\n' ;;
  update) touch '${state}'; exit 0 ;;
  install)
    if [ "${mode}" = broken ]; then echo "tlmgr: disk full"; exit 1; fi
    if [ ! -f '${state}' ]; then printf '=====\\ntlmgr itself needs to be updated.\\nPlease do this via either\\n  tlmgr update --self\\n=====\\ntlmgr: Terminating; please see warning above!\\n'; exit 1; fi
    printf '\\\\ProvidesPackage{nlpkg}\\n\\\\endinput\\n' > '${home}/tex/nlpkg.sty'; exit 0 ;;
esac
`, { mode: 0o755 });
  return { log: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}

async function compile(project: string) {
  const main = '\\documentclass{article}\n\\usepackage{nlpkg}\n\\begin{document}Ola\\end{document}\n';
  const files = [{ path: 'main.tex', sha256: sha(main) }];
  const h = { Origin: ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (p: string, body: unknown) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  await post('/v1/prepare', { files });
  await post('/v1/blobs', { blobs: [{ sha256: sha(main), b64: Buffer.from(main).toString('base64') }] });
  const r = await post('/v1/compile', { project, engine: 'agent-pdflatex', mainFile: 'main.tex', files, installMissing: true });
  return r.json() as Promise<any>;
}

describe.skipIf(!HAVE_TEX)('agent: automatic package installation with an outdated tlmgr', () => {
  beforeAll(async () => {
    const b = spawnSync('cargo', ['build', '--quiet', '--manifest-path', path.join(ROOT, 'agent/Cargo.toml')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('failed to build the agent: ' + b.stderr);
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-tlmgr-'));
    fs.mkdirSync(path.join(home, 'bin'));
    fs.mkdirSync(path.join(home, 'tex'));
    for (const n of ['latexmk', 'pdflatex']) fs.symlinkSync(fs.realpathSync(which(n)), path.join(home, 'bin', n));
    const env = {
      ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'cfg'), XDG_CACHE_HOME: path.join(home, 'cache'),
      NEOLEAF_AGENT_PORT: String(PORT), NEOLEAF_UPDATE_FIRST_SECS: '99999',
      PATH: `${path.join(home, 'bin')}:/usr/bin:/bin`, TEXINPUTS: `${path.join(home, 'tex')}:`,
    };
    proc = spawn(BIN, ['--no-tray'], { env, stdio: 'ignore' });
    for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/v1/status`)).ok) break; } catch (_) {} await Bun.sleep(100); }
    const code = spawnSync(BIN, ['code'], { env, encoding: 'utf8' }).stdout.split('\n')[0];
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/pair/confirm`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    token = (await r.json()).token;
  }, 300000);
  afterAll(() => { proc?.kill(); if (home) fs.rmSync(home, { recursive: true, force: true }); });

  test('outdated tlmgr: the agent runs update --self, installs the package and compiles', async () => {
    const tl = fakeTlmgr('stale');
    const res = await compile('e2e-stale');
    expect(res.success).toBe(true);
    expect(res.installed).toContain('nlbundle');
    expect(tl.log().filter(l => l.startsWith('install') || l.startsWith('update'))).toEqual(['install nlbundle', 'update --self', 'install nlbundle']);
  });

  test('when tlmgr fails, the log explains why (instead of just repeating the LaTeX error)', async () => {
    fakeTlmgr('broken');
    fs.rmSync(path.join(home, 'tex/nlpkg.sty'), { force: true });
    const res = await compile('e2e-broken');
    expect(res.success).toBe(false);
    expect(res.log).toContain('Could not install automatically (tlmgr)');
    expect(res.log).toContain('disk full');
  });
});
