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

const FILES: Record<string, string> = {
  'samples/main.tex': '\\documentclass{article}\n\\begin{document}\nSee \\cite{knuth84}.\n\\input{capitulo}\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n',
  'samples/capitulo.tex': 'Chapter text.\n',
  'samples/refs.bib': '@book{knuth84, author={Donald Knuth}, title={The TeXbook}, publisher={Addison-Wesley}, year={1984}}\n',
};

async function compile(project: string) {
  const files = Object.entries(FILES).map(([p, c]) => ({ path: p, sha256: sha(c) }));
  const h = { Origin: ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (p: string, body: unknown) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  await post('/v1/prepare', { files });
  await post('/v1/blobs', { blobs: Object.values(FILES).map(c => ({ sha256: sha(c), b64: Buffer.from(c).toString('base64') })) });
  return (await (await post('/v1/compile', { project, engine: 'agent-pdflatex', mainFile: 'samples/main.tex', files, installMissing: false })).json()) as any;
}

describe.skipIf(!HAVE)('agent: main file in a subfolder', () => {
  beforeAll(async () => {
    const b = spawnSync('cargo', ['build', '--quiet', '--manifest-path', path.join(ROOT, 'agent/Cargo.toml')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('failed to build the agent: ' + b.stderr);
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-subdir-'));
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

  test('the .bib and \\input next to the main file are found and the citations resolve', async () => {
    const res = await compile('subdir');
    expect(res.success).toBe(true);
    const lastRun = String(res.log).split('Run number').pop()!;
    expect(String(res.log)).not.toContain('Bib file(s) not found');
    expect(lastRun).not.toMatch(/Citation `[^']+' on page \d+ undefined/);
    expect(res.bbl_base64).toBeTruthy(); // the .bbl was generated from samples/refs.bib
  });
});
