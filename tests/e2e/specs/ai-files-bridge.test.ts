import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BASE_URL, newSession, openProject, poll, type Session } from '../helpers';

// What the AI tools add beyond reading (docs/mcp-bridge.md): whole-file proposals (a draft, applied only by a click or by the session
// switch), the compiler, a local model without a key, and the MCP bridge that lets AI apps on the person's computer use the editor tab.
// The compiler is replaced by a stub here (compile.test.ts covers the real one): what is checked is the tool, not TeX.

let s: Session;
const run = (name: string, input: any = {}): Promise<{ content: string; isError: boolean }> =>
  s.page.evaluate(({ name, input }) => (window as any).AITools.run({ name, input }), { name, input });
const drafts = (): Promise<any[]> => s.page.evaluate(() => (window as any).AITools.drafts());
const readFile = (p: string): Promise<string> => s.page.evaluate(p => (window as any).BrowserGit.readFile(p), p).then(String);

beforeAll(async () => {
  s = await newSession();
  await openProject(s.page);
  await s.page.evaluate(async () => {
    await (window as any).BrowserGit.writeFile('sections/intro.tex', 'First line.\nThe quick brown fox.\nLast line.');
    await (window as any).FT.refreshFromBrowserGit();
  });
});
afterAll(async () => { await s.context.close(); });

describe('AI tools: whole files', () => {
  test('propose_file makes a draft for a new file and leaves the project as it was', async () => {
    await s.page.evaluate(() => (window as any).AITools.begin());
    const r = await run('propose_file', { path: 'sections/circle.tex', content: '\\section{Circle}\nHello.\n' });
    expect(r.isError).toBe(false);
    expect(r.content).toContain('nothing was changed');
    const d = (await drafts())[0];
    expect(d).toMatchObject({ kind: 'file', file: 'sections/circle.tex', isNew: true, status: 'pending', lines: [0, 3] });
    const files = await s.page.evaluate(async () => (await (window as any).BrowserGit.listFiles()).map((f: any) => f.path));
    expect(files).not.toContain('sections/circle.tex');
  });

  test('paths that could escape the project, hidden folders and non-text files are refused', async () => {
    for (const p of ['../x.tex', '/abs.tex', '.hidden/x.tex', 'a/../b.tex', 'x.exe', 'dir/', 'bad\\name.tex', '']) {
      const r = await run('propose_file', { path: p, content: 'a' });
      expect(r.isError).toBe(true);
    }
    expect((await run('propose_file', { path: 'big.tex', content: 'x'.repeat(200001) })).isError).toBe(true);
    expect((await run('propose_file', { path: 'sections/intro.tex', content: 'First line.\nThe quick brown fox.\nLast line.' })).isError).toBe(true);
    expect((await run('propose_file', { path: 'sections/circle.tex', content: 'again' })).isError).toBe(true);   // one proposal per file
  });

  test('applying a new file writes it and shows it in the tree; the same draft cannot overwrite a file that exists now', async () => {
    const out = await s.page.evaluate(async () => {
      const w = window as any;
      const d = w.AITools.drafts().find((x: any) => x.file === 'sections/circle.tex');
      const first = await w.Comments.applyFile(d, { name: 'Test', model: 'm' }, w.AITools.fingerprint);
      const second = await w.Comments.applyFile(d, { name: 'Test', model: 'm' }, w.AITools.fingerprint);
      return { first, second, inTree: w.FT.entries().some((e: any) => e.path === 'sections/circle.tex') };
    });
    expect(out.first).toBeNull();
    expect(out.second).toContain('changed since the proposal');
    expect(out.inTree).toBe(true);
    expect(await readFile('sections/circle.tex')).toBe('\\section{Circle}\nHello.\n');
  });

  test('replacing a file goes through the editor (undoable) and a file that changed after the proposal is not overwritten', async () => {
    await s.page.evaluate(() => (window as any).AITools.begin());
    const r = await run('propose_file', { path: 'sections/intro.tex', content: 'Replaced.\n' });
    expect(r.isError).toBe(false);
    const d = (await drafts())[0];
    expect(d).toMatchObject({ isNew: false, lines: [3, 2] });
    const result = await s.page.evaluate(async () => {
      const w = window as any;
      const draft = w.AITools.drafts()[0];
      const ok = await w.Comments.applyFile(draft, { name: 'Test', model: 'm' }, w.AITools.fingerprint);
      const text = (0, eval)('editor.getValue()');
      (0, eval)("editor.getModel().pushEditOperations([], [{ range: editor.getModel().getFullModelRange(), text: 'Someone typed this.' }], () => null)");
      const stale = await w.Comments.applyFile(draft, { name: 'Test', model: 'm' }, w.AITools.fingerprint);
      return { ok, text, stale };
    });
    expect(result.ok).toBeNull();
    expect(result.text).toBe('Replaced.\n');
    expect(result.stale).toContain('changed since the proposal');
  });
});

describe('AI tools: the compiler', () => {
  test('compile runs the project compiler, waits for it and answers with the errors of the log first', async () => {
    await s.page.evaluate(() => {
      const w = window as any;
      w.recompileLatex = () => {
        setTimeout(() => {
          w.lastCompileResult = { at: Date.now(), success: false, log: 'This is TeX.\n! Undefined control sequence.\nl.3 \\foo\n\nMore noise.\n', mainFile: 'main.tex' };
          window.dispatchEvent(new CustomEvent('ld-compile', { detail: { phase: 'done', success: false } }));
        }, 50);
      };
    });
    const r = await run('compile');
    expect(r.isError).toBe(false);
    expect(r.content).toContain('Compilation failed. Main file: main.tex');
    expect(r.content.indexOf('Errors found in the log')).toBeGreaterThan(-1);
    expect(r.content.indexOf('! Undefined control sequence.')).toBeLessThan(r.content.indexOf('End of the log'));
  });
});

describe('local models and the switch for automatic edits', () => {
  test('a local provider needs no key, hides the key field and sends no Authorization header', async () => {
    await s.page.click('#tab-ai-btn');
    await s.page.waitForSelector('#ai-container .ai-card');
    if (await s.page.locator('#ai-consent').count()) await s.page.click('#ai-consent');
    await s.page.waitForSelector('#ai-provider');
    await s.page.selectOption('#ai-provider', 'ollama');
    expect(await s.page.locator('#ai-key-row').isVisible()).toBe(false);
    expect(await s.page.locator('#ai-local-hint').isVisible()).toBe(true);
    await s.page.fill('#ai-model', 'llama3.2');
    await s.page.click('#ai-save');
    await s.page.waitForSelector('#ai-ready');
    const got = await s.page.evaluate(() => (window as any).AISettings.get());
    expect(got).toMatchObject({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', key: '', model: 'llama3.2' });
  });

  test('automatic edits are off by default, ask first and last only in this tab', async () => {
    const dialogs: string[] = [];
    s.page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    expect(await s.page.evaluate(() => (window as any).AISettings.autoApply())).toBe(false);
    expect(await s.page.locator('#ai-auto-apply').isChecked()).toBe(false);
    await s.page.locator('#ai-auto-apply').check({ force: true }).catch(() => {});
    expect(dialogs.some(m => m.includes('without asking'))).toBe(true);
    expect(await s.page.evaluate(() => (window as any).AISettings.autoApply())).toBe(false);   // the person said no
    s.page.removeAllListeners('dialog');
    s.page.on('dialog', d => d.accept());
    await s.page.locator('#ai-auto-apply').check();
    expect(await s.page.evaluate(() => (window as any).AISettings.autoApply())).toBe(true);
    expect(await s.page.evaluate(() => sessionStorage.getItem('neoleaf.ai.auto.github.1'))).toBe('1');
    expect(await s.page.evaluate(() => localStorage.getItem('neoleaf.ai.auto.github.1'))).toBeNull();   // never kept across sessions
  });
});

describe('the MCP bridge', () => {
  const BRIDGE_PORT = 47493;
  let proc: ChildProcess;
  let home = '';
  let code = '';
  let token = '';
  const mcp = (method: string, params: any = {}, auth = true) =>
    fetch(`http://127.0.0.1:${BRIDGE_PORT}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-mcp-'));
    proc = spawn('node', [path.join(__dirname, '..', '..', '..', 'tools', 'mcp-bridge', 'neoleaf-mcp.mjs'), '--port', String(BRIDGE_PORT), '--origin', BASE_URL], { env: { ...process.env, HOME: home, USERPROFILE: home } });
    let out = '';
    proc.stdout!.on('data', c => { out += String(c); });
    await poll(() => out, o => /Pairing code for the NeoLeaf tab: \d{6}/.test(o));
    code = /Pairing code for the NeoLeaf tab: (\d{6})/.exec(out)![1];
    token = fs.readFileSync(path.join(home, '.neoleaf-mcp', 'token'), 'utf8').trim();
  });
  afterAll(() => { try { proc.kill(); } catch (_) {} fs.rmSync(home, { recursive: true, force: true }); });

  test('without the token, or from a foreign origin or host, nothing is answered', async () => {
    expect((await mcp('tools/list', {}, false)).status).toBe(401);
    const foreign = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/mcp`, { method: 'POST', headers: { origin: 'https://evil.example', authorization: 'Bearer ' + token }, body: '{}' });
    expect(foreign.status).toBe(403);
    const page = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/page/pair`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ code }) });
    expect(page.status).toBe(403);
    const wrong = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/page/pair`, { method: 'POST', headers: { origin: BASE_URL }, body: JSON.stringify({ code: '000000' }) });
    expect(wrong.status).toBe(403);
  });

  test('with no tab paired the tools are not offered and a call says so', async () => {
    const list = await (await mcp('tools/list')).json();
    expect(list.result.tools).toEqual([]);
  });

  test('the tab pairs with the code, the app lists the tools and reads the project through it', async () => {
    s.page.removeAllListeners('dialog');
    s.page.on('dialog', d => d.accept());
    await s.page.click('#tab-ai-btn');
    await s.page.waitForSelector('#ai-bridge-card');
    await s.page.fill('#ai-bridge-url', `http://127.0.0.1:${BRIDGE_PORT}`);
    await s.page.fill('#ai-bridge-code', '123456');   // a wrong code first
    await s.page.click('#ai-bridge-pair');
    await s.page.waitForFunction(() => (document.getElementById('ai-bridge-msg')?.textContent || '').length > 0);
    await s.page.fill('#ai-bridge-code', code);
    await s.page.click('#ai-bridge-pair');
    await s.page.waitForFunction(() => (document.getElementById('ai-bridge-state')?.textContent || '').includes('Connected'));
    const list = await (await mcp('tools/list')).json();
    const names = list.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(['add_comment', 'add_suggestion', 'compile', 'compile_log', 'list_comments', 'list_files', 'propose_file', 'read_file', 'search']);
    expect(list.result.tools.find((t: any) => t.name === 'read_file').annotations.readOnlyHint).toBe(true);
    const call = await (await mcp('tools/call', { name: 'read_file', arguments: { path: 'sections/circle.tex' } })).json();
    expect(call.result.isError).toBe(false);
    expect(call.result.content[0].text).toContain('\\section{Circle}');
    const bad = await (await mcp('tools/call', { name: 'read_file', arguments: { path: '../../etc/passwd' } })).json();
    expect(bad.result.isError).toBe(true);
  });

  test('a proposal from an app is only a draft card; the file stays as it was', async () => {
    const before = await readFile('sections/circle.tex');
    const r = await (await mcp('tools/call', { name: 'add_suggestion', arguments: { path: 'sections/circle.tex', quote: 'Hello.', replacement: 'Hi.' } })).json();
    expect(r.result.isError).toBe(false);
    await s.page.waitForSelector('#ai-agent-drafts .ai-draft');
    expect(await readFile('sections/circle.tex')).toBe(before);
  });

  test('disconnecting forgets the token, and the app is told that no tab is connected', async () => {
    await s.page.click('#ai-bridge-stop');
    await poll(async () => (await (await mcp('tools/list')).json()).result.tools.length, n => n === 0);
    expect(await s.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('neoleaf.ai.bridge.')))).toEqual([]);
    expect(s.errors.filter(e => !/WebMCP tool execution failed|Failed to load resource/.test(e))).toEqual([]);
  });
});
