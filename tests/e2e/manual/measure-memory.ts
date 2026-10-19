// Measures the server memory (RSS) before and after a load of heavy requests (ZIPs, Git clones and TeX Live packages in
// parallel), against the fake GitHub. Useful to compare binary versions or allocator tweaks. Needs internet
// (the TeX Live package comes from the real mirror).
//   cargo build --release && bun tests/e2e/manual/measure-memory.ts target/release/neoleaf [VAR=value ...]
// LOAD=zip|clone|ctan runs only one kind of request. Output: idle RSS, after the load and 8 s later (and the peak, hwm).
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startFakeGithub } from '../../fake-github/server';

const [binArg, ...envArgs] = process.argv.slice(2);
const ROOT = path.resolve(import.meta.dir, '../../..');
const bin = path.resolve(binArg);
const extra = Object.fromEntries(envArgs.map(a => [a.split('=')[0], a.slice(a.indexOf('=') + 1)]));
const PORT = 3077;
const BASE = `http://127.0.0.1:${PORT}`;
const sid = 'load-session-' + 'x'.repeat(40);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'loadmem-'));
const fake = await startFakeGithub({ root: path.join(work, 'gh'), seed: false });
// "big" repository: incompressible files (~45 MB in the ZIP)
const files: Record<string, string> = {};
for (let i = 0; i < 3; i++) files[`data/${i}.bin`] = Buffer.from(crypto.getRandomValues(new Uint8Array(15 * 1024 * 1024))).toString('latin1');
files['main.tex'] = '\\documentclass{article}\\begin{document}x\\end{document}\n';
fake.seedRepo('demo', 'big', files, ['neoleaf']);
const t = Math.floor(Date.now() / 1000);
fs.writeFileSync(path.join(work, 'sessions.json'), JSON.stringify({ [sid]: { user: { id: 1, login: 'demo', name: 'Demo', email: 'demo@neoleaf.local' }, access_token: 'fake-demo', refresh_token: null, expires_at: t + 86400, created_at: t } }), { mode: 0o600 });
const child = spawn(bin, [], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', GITHUB_API_URL: fake.url, GITHUB_WEB_URL: fake.url, GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'y', REDIRECT_URI: `${BASE}/auth/callback`, SESSIONS_FILE: path.join(work, 'sessions.json'), BLOCKLIST_FILE: path.join(work, 'b.json'), TEMPLATES_FILE: path.join(work, 't.json'), ...extra },
  stdio: 'ignore',
});
const rss = () => { const s = fs.readFileSync(`/proc/${child.pid}/status`, 'utf8'); const g = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(s)![1]) / 1024; return { rss: Math.round(g('VmRSS')), hwm: Math.round(g('VmHWM')) }; };
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/')).ok) break; } catch {} await Bun.sleep(300); }
await Bun.sleep(20000); // gives the TeX Live index time to load at startup (part of the idle usage)
const cookie = { Cookie: `latex_session=${sid}` };
const out: Record<string, unknown> = { idle: rss() };

const zip = async () => { const r = await fetch(`${BASE}/api/project/demo__big/github-zip`, { headers: cookie }); return (await r.arrayBuffer()).byteLength; };
const ctan = async () => { const r = await fetch(`${BASE}/api/ctan/package`, { method: 'POST', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ package: 'pgf' }) }); return (await r.arrayBuffer()).byteLength; };
const clone = () => new Promise<number>(res => { const d = path.join(work, 'c' + Math.random().toString(36).slice(2)); const c = spawn('git', ['-c', `http.extraHeader=Cookie: latex_session=${sid}`, 'clone', '-q', '--depth', '1', `${BASE}/api/git/demo/big`, d], { stdio: 'ignore' }); c.on('close', code => { fs.rmSync(d, { recursive: true, force: true }); res(code ?? -1); }); });

const par = (n: number, f: () => Promise<unknown>) => Promise.all(Array.from({ length: n }, f));
const only = process.env.LOAD || 'all';
for (let round = 0; round < 3; round++) { if (only === 'all' || only === 'zip') await par(6, zip); if (only === 'all' || only === 'clone') await par(4, clone); if (only === 'all' || only === 'ctan') await par(4, ctan); }
out.afterLoad = rss();
await Bun.sleep(8000);
out.afterIdle8s = rss();
console.log(JSON.stringify(out));
child.kill('SIGTERM'); fake.stop(); fs.rmSync(work, { recursive: true, force: true });
