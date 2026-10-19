import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Main file in a subfolder (samples/x.tex, as in the ACM/SBC templates) with `\bibliography{refs}` and samples/refs.bib:
// latexmk runs at the project root and must find the .bib/.bst/.tex next to the main file.
const ROOT = path.resolve(import.meta.dir, '../../..');
const BIN = path.join(ROOT, 'agent/target/debug/neoleaf-agent');
const PORT = 47400 + Math.floor(Math.random() * 90);
const ORIGIN = 'https://neoleaf.science';
const which = (n: string) => spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
const HAVE = ['latexmk', 'pdflatex', 'bibtex', 'kpsewhich'].every(n => !!which(n));

let home: string, proc: ChildProcess, token: string;
const sha = (b: string) => new Bun.CryptoHasher('sha256').update(b).digest('hex');

let pwned = '';
const FILES: Record<string, string> = {
  'main.tex': '\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n',
  'latexmkrc': '',
  '.latexmkrc': '',
};

async function compile(project: string, main = 'main.tex', files0 = FILES) {
  const files = Object.entries(files0).map(([p, c]) => ({ path: p, sha256: sha(c) }));
  const h = { Origin: ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (p: string, body: unknown) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  await post('/v1/prepare', { files });
  await post('/v1/blobs', { blobs: Object.values(files0).map(c => ({ sha256: sha(c), b64: Buffer.from(c).toString('base64') })) });
  return (await (await post('/v1/compile', { project, engine: 'agent-pdflatex', mainFile: main, files, installMissing: false })).json()) as any;
}

describe.skipIf(!HAVE)('agent: latexmkrc and option-like names', () => {
  beforeAll(async () => {
    const b = spawnSync('cargo', ['build', '--quiet', '--manifest-path', path.join(ROOT, 'agent/Cargo.toml')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('failed to build the agent: ' + b.stderr);
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-rc-'));
    fs.mkdirSync(path.join(home, 'bin'));
    for (const n of ['latexmk', 'pdflatex', 'bibtex', 'kpsewhich']) fs.symlinkSync(fs.realpathSync(which(n)), path.join(home, 'bin', n));
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'cfg'), XDG_CACHE_HOME: path.join(home, 'cache'), NEOLEAF_AGENT_PORT: String(PORT), NEOLEAF_UPDATE_FIRST_SECS: '99999', PATH: `${path.join(home, 'bin')}:/usr/bin:/bin` };
    proc = spawn(BIN, ['--no-tray'], { env, stdio: 'ignore' });
    for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/v1/status`)).ok) break; } catch (_) {} await Bun.sleep(100); }
    const code = spawnSync(BIN, ['code'], { env, encoding: 'utf8' }).stdout.split('\n')[0];
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/pair/confirm`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    token = (await r.json()).token;
  }, 300000);
  afterAll(() => { proc?.kill(); if (home) fs.rmSync(home, { recursive: true, force: true }); });

  test('a latexmkrc and a .latexmkrc in the project are not executed', async () => {
    pwned = path.join(home, 'pwned');
    const evil = `system("touch ${pwned}");\n`;
    const files = { ...FILES, 'latexmkrc': evil, '.latexmkrc': evil, 'sub/latexmkrc': evil };
    const res = await compile('rc', 'main.tex', files);
    expect(res.success).toBe(true);
    expect(fs.existsSync(pwned)).toBe(false);
  });

  test('a main file that looks like an option is refused', async () => {
    const files = { '-shell-escape.tex': FILES['main.tex'] };
    const res = await compile('opt', '-shell-escape.tex', files);
    expect(res.success).toBeFalsy();
  });

  test('a request with a Host that is not loopback is refused (DNS rebinding)', async () => {
    const r = await new Promise<number>(resolve => {
      const req = require('node:http').request({ host: '127.0.0.1', port: PORT, path: '/v1/status', headers: { Host: 'evil.example:' + PORT } }, (res: any) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
      req.end();
    });
    expect(r).toBe(403);
    const ok = await fetch(`http://127.0.0.1:${PORT}/v1/status`);
    expect(ok.status).toBe(200);
  });
});
