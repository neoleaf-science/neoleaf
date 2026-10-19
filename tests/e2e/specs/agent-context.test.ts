import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ConTeXt in the agent (`agent-context` engine). Only runs if `context` is on the PATH (for example the standalone/LMTX ConTeXt
// installed in ~/context/tex/texmf-<platform>/bin); without it the test is skipped.
const ROOT = path.resolve(import.meta.dir, '../../..');
const BIN = path.join(ROOT, 'agent/target/debug/neoleaf-agent');
const PORT = 47500 + Math.floor(Math.random() * 90);
const ORIGIN = 'https://neoleaf.science';
const which = (n: string) => spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
const CTX = which('context');
const HAVE = !!CTX;

let home: string, proc: ChildProcess, token: string;
const sha = (b: string) => new Bun.CryptoHasher('sha256').update(b).digest('hex');

async function compile(project: string, files: Record<string, string>, main: string) {
  const refs = Object.entries(files).map(([p, c]) => ({ path: p, sha256: sha(c) }));
  const h = { Origin: ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (p: string, body: unknown) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  await post('/v1/prepare', { files: refs });
  await post('/v1/blobs', { blobs: Object.values(files).map(c => ({ sha256: sha(c), b64: Buffer.from(c).toString('base64') })) });
  return (await (await post('/v1/compile', { project, engine: 'agent-context', mainFile: main, files: refs, installMissing: false })).json()) as any;
}

describe.skipIf(!HAVE)('agent: ConTeXt', () => {
  beforeAll(async () => {
    const b = spawnSync('cargo', ['build', '--quiet', '--manifest-path', path.join(ROOT, 'agent/Cargo.toml')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('failed to build the agent: ' + b.stderr);
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-context-'));
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'cfg'), XDG_CACHE_HOME: path.join(home, 'cache'), NEOLEAF_AGENT_PORT: String(PORT), NEOLEAF_UPDATE_FIRST_SECS: '99999', PATH: `${path.dirname(CTX)}:/usr/bin:/bin` };
    proc = spawn(BIN, ['--no-tray'], { env, stdio: 'ignore' });
    for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/v1/status`)).ok) break; } catch (_) {} await Bun.sleep(100); }
    const code = spawnSync(BIN, ['code'], { env, encoding: 'utf8' }).stdout.split('\n')[0];
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/pair/confirm`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    token = (await r.json()).token;
  }, 300000);
  afterAll(() => { proc?.kill(); if (home) fs.rmSync(home, { recursive: true, force: true }); });

  test('the agent lists ConTeXt among the engines', async () => {
    const st = await (await fetch(`http://127.0.0.1:${PORT}/v1/status`)).json() as any;
    expect(st.engines.map((e: any) => e.id)).toContain('agent-context');
    expect(st.engines.find((e: any) => e.id === 'agent-context').name).toBe('ConTeXt');
  });

  test('compiles a document with \\input in a subfolder and accents, and returns the PDF', async () => {
    const res = await compile('ctx-ok', {
      'main.tex': '\\setuppapersize[A4]\n\\starttext\n\\startchapter[title={Introdução}]\nAção e coração.\n\\input capitulos/dois\n\\stopchapter\n\\stoptext\n',
      'capitulos/dois.tex': '\\startsection[title={Seção dois}]\nTexto da seção dois.\n\\stopsection\n',
    }, 'main.tex');
    expect(res.success).toBe(true);
    expect(Buffer.from(res.pdf_base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.engine_used).toContain('ConTeXt');
    expect(String(res.log).length).toBeGreaterThan(0);
  }, 120000);

  test('main file in a subfolder with the .mkiv extension', async () => {
    const res = await compile('ctx-sub', {
      'tese/main.mkiv': '\\starttext\nOlá do mkiv.\n\\input extra\n\\stoptext\n',
      'tese/extra.tex': 'Texto extra.\n',
    }, 'tese/main.mkiv');
    expect(res.success).toBe(true);
    expect(res.pdf_base64).toBeTruthy();
  }, 120000);

  test('ConTeXt error: returns no PDF and the log shows the undefined command', async () => {
    const res = await compile('ctx-err', { 'main.tex': '\\starttext\nAntes.\n\\comandoinexistente{x}\nDepois.\n\\stoptext\n' }, 'main.tex');
    expect(res.success).toBe(false);
    expect(res.pdf_base64).toBeFalsy();
    expect(String(res.log)).toContain('Undefined control sequence');
  }, 120000);
});
