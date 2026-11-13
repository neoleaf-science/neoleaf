import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, openProject, type Session } from '../helpers';

// AI assistant, step 3 (docs/ai-assistant-plan.md): what the assistant can read, and the limits. The tools only read, from the
// browser's copy of the project; nothing here calls a provider or the NeoLeaf server.

let s: Session;
const toOrigin: string[] = [];

const run = (name: string, input: any = {}, invalid = false): Promise<{ content: string; isError: boolean }> =>
  s.page.evaluate(({ name, input, invalid }) => (window as any).AITools.run({ name, input, invalid }), { name, input, invalid });
const begin = () => s.page.evaluate(() => (window as any).AITools.begin());
const sent = (): Promise<{ tool: string; path: string; chars: number }[]> => s.page.evaluate(() => (window as any).AITools.sent());
const write = (path: string, content: string) => s.page.evaluate(({ path, content }) => (window as any).BrowserGit.writeFile(path, content), { path, content });

beforeAll(async () => {
  s = await newSession();
  await openProject(s.page);
  // a binary file, a file that is too large, a second text file and something inside a hidden folder
  await s.page.evaluate(async () => {
    const bg = (window as any).BrowserGit;
    await bg.writeFile('figures/plot.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    await bg.writeFile('data/huge.csv', 'a,b\n' + '1,2\n'.repeat(300000));
    await bg.writeFile('sections/intro.tex', ['\\section{Intro}', 'The quick brown fox.', 'A SECRET-MARKER line.', 'Last line.'].join('\n'));
    await bg.writeFile('.neoleaf/secret-notes.json', '{"hidden":"HIDDEN-MARKER"}');
  });
  s.page.on('request', r => { if (r.url().startsWith(BASE_URL)) toOrigin.push(r.url() + '\n' + (r.postData() || '')); });
});
afterAll(async () => { await s.context.close(); });

describe('AI tools: reading the project', () => {
  test('the tool list has the reading tools, the compiler and three that only make drafts, each with a closed schema', async () => {
    const defs = await s.page.evaluate(() => (window as any).AITools.defs());
    expect(defs.map((d: any) => d.name)).toEqual(['list_files', 'read_file', 'search', 'open_file_and_selection', 'compile_log', 'list_comments', 'add_comment', 'add_suggestion', 'propose_file', 'compile', 'changed_files']);
    for (const d of defs) {
      expect(d.schema.additionalProperties).toBe(false);
      expect(d.description.length).toBeGreaterThan(20);
      expect(d.name).not.toMatch(/write|delete|save|edit|push|commit/);
    }
  });

  test('list_files names every file of the tree; what is not text or is too large is marked, hidden folders are not there', async () => {
    await begin();
    const r = await run('list_files');
    expect(r.isError).toBe(false);
    expect(r.content).toContain('main.tex (');
    expect(r.content).toContain('sections/intro.tex (');
    expect(r.content).toMatch(/figures\/plot\.png \(8 bytes, not text\)/);
    expect(r.content).toMatch(/data\/huge\.csv \(\d+ bytes, too large\)/);
    expect(r.content).not.toContain('.neoleaf');
    expect(r.content).not.toContain('.git');
  });

  test('read_file reads a file or a range of lines', async () => {
    const whole = await run('read_file', { path: 'sections/intro.tex' });
    expect(whole.content).toBe('[sections/intro.tex, lines 1 to 4 of 4]\n\\section{Intro}\nThe quick brown fox.\nA SECRET-MARKER line.\nLast line.');
    const part = await run('read_file', { path: 'sections/intro.tex', from_line: 2, to_line: 3 });
    expect(part.content).toBe('[sections/intro.tex, lines 2 to 3 of 4]\nThe quick brown fox.\nA SECRET-MARKER line.');
    expect((await run('read_file', { path: 'sections/intro.tex', from_line: 9 })).content).toContain('has 4 lines');
  });

  test('paths outside the tree, hidden folders, binaries and oversize files are refused', async () => {
    for (const path of ['../other/main.tex', '/etc/passwd', '.neoleaf/secret-notes.json', '.neoleaf/config.json', '.git/config', 'sections/../.neoleaf/secret-notes.json', 'sections', 'nope.tex', 'MAIN.TEX']) {
      const r = await run('read_file', { path });
      expect(r.isError).toBe(true);
      expect(r.content).toContain('There is no file');
      expect(r.content).not.toContain('HIDDEN-MARKER');
    }
    expect((await run('read_file', { path: 'figures/plot.png' })).content).toContain('not a text file');
    expect((await run('read_file', { path: 'data/huge.csv' })).content).toContain('too large');
  });

  test('arguments that do not fit the schema, bad JSON and unknown tools are refused without running anything', async () => {
    expect((await run('read_file', {})).content).toContain('missing argument "path"');
    expect((await run('read_file', { path: 'main.tex', mode: 'w' })).content).toContain('unknown argument "mode"');
    expect((await run('read_file', { path: 7 })).content).toContain('must be text');
    expect((await run('read_file', { path: 'main.tex', from_line: 0 })).content).toContain('whole number');
    expect((await run('read_file', { path: 'main.tex', from_line: 3, to_line: 1 })).content).toContain('before from_line');
    expect((await run('read_file', { path: 'main.tex' }, true)).content).toContain('not valid JSON');
    for (const name of ['write_file', 'constructor', '__proto__', 'toString']) {
      const r = await run(name, {});
      expect(r).toEqual({ content: `There is no tool called "${name}".`, isError: true });
    }
  });

  test('the open file is read as it is on the screen, unsaved text included', async () => {
    const onDisk = await s.page.evaluate(() => (window as any).BrowserGit.readFile('main.tex'));
    await s.page.evaluate(() => { const ed = (globalThis as any).eval('editor'); ed.setValue('% UNSAVED-ON-SCREEN\n' + ed.getValue()); });
    const r = await run('read_file', { path: 'main.tex', from_line: 1, to_line: 1 });
    expect(r.content).toContain('% UNSAVED-ON-SCREEN');
    expect(onDisk).not.toContain('UNSAVED-ON-SCREEN');
    expect((await run('search', { text: 'unsaved-on-screen' })).content).toContain('main.tex:1: % UNSAVED-ON-SCREEN');
  });

  test('search finds text in any case, with file and line, and never looks into hidden folders', async () => {
    const r = await run('search', { text: 'secret-marker' });
    expect(r.content).toBe('sections/intro.tex:3: A SECRET-MARKER line.');
    expect((await run('search', { text: 'HIDDEN-MARKER' })).content).toBe('No match.');
    expect((await run('search', { text: '' })).isError).toBe(true);
    // many matches: only the first ones, and it says so
    await write('many.tex', 'needle here\n'.repeat(80));
    const many = await run('search', { text: 'needle' });
    expect(many.content.split('\n').filter(l => l.startsWith('many.tex:')).length).toBe(50);
    expect(many.content).toContain('only the first matches');
  });

  test('the editor state, the compile log, the comments and the changed files', async () => {
    await s.page.evaluate(() => { const g = globalThis as any; const ed = g.eval('editor'); const m = g.eval('monaco'); ed.setSelection(new m.Range(1, 3, 1, 12)); });
    const sel = await run('open_file_and_selection');
    expect(sel.content).toContain('Open file: main.tex');
    expect(sel.content).toContain('Selected text (lines 1 to 1):\nUNSAVED-O');
    expect((await run('compile_log')).content).toContain('not compiled in this session');
    await s.page.evaluate(() => { (window as any).lastCompileResult = { success: false, mainFile: 'main.tex', log: 'x'.repeat(30000) + '\n! Undefined control sequence.' }; });
    const log = await run('compile_log');
    expect(log.content).toContain('Compilation failed. Main file: main.tex');
    expect(log.content).toContain('beginning of the log was left out');
    expect(log.content).toContain('! Undefined control sequence.');
    expect(log.content.length).toBeLessThan(21000);

    expect((await run('list_comments')).content).toBe('There are no open comments.');
    await s.page.evaluate(() => (window as any).Project.comments.op({ op: 'add', file: 'main.tex', kind: 'suggestion', quote: 'old words', text: 'please fix', replacement: 'new words', range: { sl: 2, sc: 1, el: 2, ec: 5 } }));
    const c = await run('list_comments');
    expect(c.content).toContain('Suggestion at main.tex:2 by Demo User');
    expect(c.content).toContain('passage: "old words"');
    expect(c.content).toContain('proposed: "new words"');
    expect(c.content).toContain('Demo User: please fix');
    expect(c.content).not.toContain('@'); // no e-mail address of a collaborator

    const ch = await run('changed_files');
    expect(ch.content).toContain('new: sections/intro.tex');
    expect(ch.content).not.toContain('.neoleaf');
  });
});

describe('AI tools: limits', () => {
  test('a long file comes in parts, cut at a line end, and says where to read on', async () => {
    await write('long.tex', Array.from({ length: 4000 }, (_, i) => `line ${i + 1} ` + 'x'.repeat(30)).join('\n'));
    await begin();
    const first = await run('read_file', { path: 'long.tex' });
    const m = /\[long\.tex, lines 1 to (\d+) of 4000\]/.exec(first.content)!;
    const end = Number(m[1]);
    expect(end).toBeLessThan(4000);
    expect(first.content).toContain(`[cut here: read on with from_line ${end + 1}]`);
    expect(first.content.length).toBeLessThanOrEqual(60000 + 200);
    // the last line that came is whole
    expect(first.content).toContain(`line ${end} ` + 'x'.repeat(30) + '\n[cut here');
    const next = await run('read_file', { path: 'long.tex', from_line: end + 1 });
    expect(next.content.startsWith(`[long.tex, lines ${end + 1} to `)).toBe(true);
    expect(next.content).toContain(`\nline ${end + 1} `);
  });

  test('the total per question is respected, the list of what was sent is kept, and a new question starts again', async () => {
    await begin();
    let reads = 0;
    for (;;) {
      const r = await run('read_file', { path: 'long.tex' });
      if (r.isError) { expect(r.content).toContain('reading limit for this question'); break; }
      reads++;
      expect(reads).toBeLessThan(20);
    }
    const total = await s.page.evaluate(() => (window as any).AITools.total());
    expect(total).toBeLessThanOrEqual(400000);
    expect(total).toBeGreaterThan(340000);
    const list = await sent();
    expect(list.length).toBe(reads);
    expect(list.every(e => e.tool === 'read_file' && e.path === 'long.tex' && e.chars > 0)).toBe(true);
    expect(list.reduce((n, e) => n + e.chars, 0)).toBe(total);
    // no other tool gets through either
    expect((await run('list_files')).isError).toBe(true);
    await begin();
    expect(await sent()).toEqual([]);
    expect((await run('list_files')).isError).toBe(false);
    expect((await sent()).map(e => e.tool)).toEqual(['list_files']);
  });

  test('reading the project sent nothing to the NeoLeaf server', () => {
    expect(toOrigin.filter(r => /SECRET-MARKER|UNSAVED-ON-SCREEN|line 17 /.test(r))).toEqual([]);
  });

  test('no unhandled console errors', () => {
    expect(s.errors).toEqual([]);
  });
});
