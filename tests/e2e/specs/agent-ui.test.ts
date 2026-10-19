import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BASE_URL, PORT, newSession, openProject, poll, type Session } from '../helpers';

// Real browser + real local agent (with this machine's compilers).
const ROOT = path.resolve(import.meta.dir, '../../..');
const BIN = path.join(ROOT, 'agent/target/debug/neoleaf-agent');
const AGENT_PORT = 47300 + Math.floor(Math.random() * 300);
const which = (n: string) => spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
const HAVE = ['latexmk', 'pdflatex', 'xelatex'].every(n => !!which(n));

let home: string, proc: ChildProcess, s: Session;
const env = () => ({
  ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'cfg'), XDG_CACHE_HOME: path.join(home, 'cache'),
  NEOLEAF_AGENT_PORT: String(AGENT_PORT), NEOLEAF_UPDATE_FIRST_SECS: '99999', NEOLEAF_ORIGINS: new URL(BASE_URL).origin,
  PATH: `${path.join(home, 'bin')}:/usr/bin:/bin`,
});

describe.skipIf(!HAVE)('local agent through the editor UI', () => {
  beforeAll(async () => {
    const b = spawnSync('cargo', ['build', '--quiet', '--manifest-path', path.join(ROOT, 'agent/Cargo.toml')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error('failed to build the agent: ' + b.stderr);
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-ui-'));
    fs.mkdirSync(path.join(home, 'bin'));
    for (const n of ['latexmk', 'pdflatex', 'xelatex', 'lualatex', 'xdvipdfmx']) { const p = which(n); if (p) fs.symlinkSync(fs.realpathSync(p), path.join(home, 'bin', n)); }
    proc = spawn(BIN, ['--no-tray'], { env: env(), stdio: 'ignore' });
    await poll(async () => { try { return (await fetch(`http://127.0.0.1:${AGENT_PORT}/v1/status`)).ok; } catch { return false; } }, ok => ok, 40000);

    s = await newSession();
    await s.context.addInitScript(base => { try { localStorage.setItem('ld-agent-base', base); } catch (_) {} }, `http://127.0.0.1:${AGENT_PORT}`);
    s.page.on('dialog', async d => {
      if (d.type() === 'prompt') {
        const code = spawnSync(BIN, ['code'], { env: env(), encoding: 'utf8' }).stdout.split('\n')[0];
        await d.accept(code);
      } else await d.accept();
    });
    await openProject(s.page);
    await s.page.waitForFunction(() => !!document.querySelector('#engine-select option[value="agent-pdflatex"]'), null, { timeout: 20000 });
  }, 300000);
  afterAll(async () => { proc?.kill(); await s?.context.close(); if (home) fs.rmSync(home, { recursive: true, force: true }); });

  const status = () => s.page.evaluate(() => document.getElementById('status-text')?.textContent || '');
  const busy = () => s.page.evaluate(() => (document.getElementById('compile-btn') as HTMLButtonElement).disabled);
  const compile = async () => {
    await s.page.click('#compile-btn');
    await poll(busy, b => b, 10000).catch(() => {});
    await poll(busy, b => !b, 180000);
    await Bun.sleep(300);
  };

  test('the local engine shows up in the selector and fontspec detection works', async () => {
    const r = await s.page.evaluate(() => ({
      yes: (window as any).LDAgent.needsUnicodeEngine('Fatal Package fontspec Error: The fontspec package requires either XeTeX or\n(fontspec)                      LuaTeX.'),
      no: (window as any).LDAgent.needsUnicodeEngine('! Undefined control sequence.'),
    }));
    expect(r).toEqual({ yes: true, no: false });
  });

  test('a fontspec document compiled on local pdfLaTeX is recompiled with XeLaTeX and warns', async () => {
    await s.page.selectOption('#engine-select', 'agent-pdflatex');
    await s.page.evaluate(() => (globalThis as any).eval(`editor.setValue('\\\\documentclass{article}\\n\\\\usepackage{fontspec}\\n\\\\begin{document}Ola fontspec\\\\end{document}\\n')`));
    await Bun.sleep(1800);
    await compile();
    expect(await status()).toContain('Compiled successfully');
    expect(await status()).toContain('XeLaTeX');
    const log = await s.page.evaluate(() => document.getElementById('raw-log')?.textContent || '');
    expect(log).toContain('recompiled with XeLaTeX');
    await poll(() => s.page.evaluate(() => !!document.querySelector('#pdf-viewer canvas')), ok => ok, 15000);
  });

  test('the selector stays on pdfLaTeX (the switch only applies to that compilation)', async () => {
    expect(await s.page.inputValue('#engine-select')).toBe('agent-pdflatex');
  });
});
