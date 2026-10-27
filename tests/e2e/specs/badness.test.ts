import { afterAll, describe, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { editorValue, newSession, openInTree, openProject, poll, type Session } from '../helpers';

// Badness (formatter, syntax errors and style findings) compiled to WebAssembly, running in a Web Worker on the open file. Nothing leaves the browser.

let s: Session;
afterAll(async () => { await s?.context.close(); });

const markers = (page: Page) => page.evaluate(() => (window as any).monaco.editor.getModelMarkers({ owner: 'badness' }).map((m: any) => ({ code: m.code, line: m.startLineNumber, message: m.message })));
const setText = (page: Page, text: string) => page.evaluate(t => { (globalThis as any).eval('editor').setValue(t); }, text);

describe('Badness', () => {
  test('the engine is served with the right types and finds style slips with their fixes', async () => {
    s = await newSession();
    await openProject(s.page);
    const wasm = await fetch(new URL('/static/vendor/badness-engine_bg.wasm', s.page.url()).href);
    expect(wasm.status).toBe(200);
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
    const found = await s.page.evaluate(async () => (window as any).LDBadness.check('He said "hi"... and $$x$$\n', 'tex'));
    const rules = found.map((f: any) => f.rule);
    expect(rules).toEqual(expect.arrayContaining(['straight-quotes', 'ellipsis', 'dollar-display-math']));
    expect(found.find((f: any) => f.rule === 'ellipsis').fix.edits[0].content).toBe('\\dots');
  }, 120000);

  test('positions are in UTF-16 units even with accents and emoji', async () => {
    const found = await s.page.evaluate(async () => (window as any).LDBadness.check('Olá ção 😀 \\textbf{x\n', 'tex'));
    const brace = found.find((f: any) => f.message.includes('unclosed `{`'));
    expect(brace).toBeTruthy();
    expect('Olá ção 😀 \\textbf{x\n'.slice(brace.start, brace.end)).toBe('{');
    expect(brace.line).toBe(1);
  }, 30000);

  test('findings are underlined in the editor, with the rule as code', async () => {
    await setText(s.page, '\\documentclass{article}\n\\begin{document}\nHe said "hi"... and $$x$$\n\\end{document}\n');
    const list = await poll(() => markers(s.page), m => m.length >= 3);
    expect(list.map((m: any) => m.code)).toEqual(expect.arrayContaining(['straight-quotes', 'ellipsis', 'dollar-display-math']));
    expect(list.find((m: any) => m.code === 'ellipsis').line).toBe(3);
  }, 60000);

  test('Format Document reflows the text and changes only what it must', async () => {
    const long = 'word '.repeat(40).trim();
    await setText(s.page, `\\documentclass{article}\n\\begin{document}\n${long}\n\\end{document}\n`);
    await s.page.evaluate(() => (globalThis as any).eval("editor.getAction('editor.action.formatDocument').run()"));
    const text = await poll(() => editorValue(s.page), t => t.split('\n').some(l => l.startsWith('word')) && t.split('\n').length > 5);
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(text.startsWith('\\documentclass{article}\n\\begin{document}\n')).toBe(true);
  }, 60000);

  test('"Fix all style issues" applies the safe fixes only', async () => {
    await setText(s.page, 'Wait... and $$x$$ and "quoted"\n');
    await s.page.evaluate(() => (globalThis as any).eval("editor.getAction('badness.fixAll').run()"));
    const text = await poll(() => editorValue(s.page), t => t.includes('\\dots'));
    expect(text).toContain('\\[x\\]');
    expect(text).not.toContain('...');
    expect(text).toContain('"quoted"'); // the quotes fix is not safe, it stays for the person to accept
  }, 60000);

  test('BibTeX: an unterminated entry is flagged and Format Document aligns the fields', async () => {
    await openInTree(s.page, 'references.bib');
    await setText(s.page, '@article{a, title={x}\n@book{b');
    const list = await poll(() => markers(s.page), m => m.length > 0);
    expect(list[0].message).toContain('unterminated');
    await setText(s.page, '@article{a,title={x},author={y}}\n');
    await s.page.evaluate(() => (globalThis as any).eval("editor.getAction('editor.action.formatDocument').run()"));
    const text = await poll(() => editorValue(s.page), t => t.includes('title  ='));
    expect(text).toContain('author =');
  }, 60000);

  test('LaTeX and BibTeX are drawn in a monospaced font and wrap at the width Format Document uses, other files in the page font at the window', async () => {
    await s.page.setViewportSize({ width: 2600, height: 900 });
    await openInTree(s.page, 'main.tex');
    await s.page.evaluate(() => localStorage.removeItem('neoleaf.editor.wrap'));
    const long = 'Test code plays a fundamental role in ensuring software quality, yet its own quality is often overlooked. Poor implementation practices, commonly known as test smells, can reduce the readability, maintainability, and reliability of test suites. Existing tools detect test smells only after the test code has been written, limiting their ability to support developers during implementation.\n';
    await setText(s.page, long);
    const info = () => s.page.evaluate(() => {
      const m = (window as any).monaco; const e = (globalThis as any).eval('editor');
      const line = document.querySelector('#monaco-container .view-line span') as HTMLElement;
      const lines = Array.from(document.querySelectorAll('#monaco-container .view-line')).map(l => (l.textContent || '').replace(/\u00a0/g, ' ').length).filter(n => n > 0);
      return {
        wrap: e.getOption(m.editor.EditorOption.wordWrap), column: e.getOption(m.editor.EditorOption.wordWrapColumn),
        drawn: getComputedStyle(line).fontFamily, mono: document.getElementById('monaco-container')!.classList.contains('ld-mono'), lines,
      };
    });
    await new Promise(r => setTimeout(r, 600));
    const tex = await info();
    expect(tex.wrap).toBe('bounded');
    expect(tex.column).toBe(80);
    expect(tex.mono).toBe(true);
    expect(tex.drawn).toContain('monospace'); // the page's sans-serif does not reach the text of the editor
    expect(tex.lines.length).toBeGreaterThan(2);
    for (const n of tex.lines.slice(0, -1)) { expect(n).toBeLessThanOrEqual(80); expect(n).toBeGreaterThan(65); }
    // the width of the project setting is the width of the screen
    await s.page.evaluate(() => (window as any).LDBadness.applyConfig({ formatLineWidth: 100 }));
    await new Promise(r => setTimeout(r, 600));
    const wide = await info();
    expect(wide.column).toBe(100);
    for (const n of wide.lines.slice(0, -1)) expect(n).toBeLessThanOrEqual(100);
    expect(Math.max(...wide.lines)).toBeGreaterThan(85);
    await s.page.evaluate(() => (window as any).LDBadness.applyConfig({ formatLineWidth: 80 }));
    // BibTeX too
    await openInTree(s.page, 'references.bib');
    expect((await info()).mono).toBe(true);
    // another language is not touched
    await s.page.evaluate(() => { const m = (window as any).monaco; const e = (globalThis as any).eval('editor'); m.editor.setModelLanguage(e.getModel(), 'markdown'); });
    await new Promise(r => setTimeout(r, 400));
    const md = await info();
    expect(md.mono).toBe(false);
    expect(md.wrap).toBe('on');
    await s.page.evaluate(() => { const m = (window as any).monaco; const e = (globalThis as any).eval('editor'); m.editor.setModelLanguage(e.getModel(), 'bibtex'); });
    await s.page.setViewportSize({ width: 1280, height: 720 });
  }, 90000);

  test('line wrapping can be turned off or set to the window, per person, and Alt+Z cycles the modes', async () => {
    await openInTree(s.page, 'main.tex');
    const opt = () => s.page.evaluate(() => {
      const m = (window as any).monaco; const e = (globalThis as any).eval('editor');
      return e.getOption(m.editor.EditorOption.wordWrap);
    });
    await s.page.evaluate(() => localStorage.removeItem('neoleaf.editor.wrap'));
    await s.page.evaluate(() => (window as any).LDBadness.setWrapMode('format'));
    expect(await opt()).toBe('bounded');
    await s.page.evaluate(() => (window as any).LDBadness.setWrapMode('window'));
    expect(await opt()).toBe('on');
    await s.page.evaluate(() => (window as any).LDBadness.setWrapMode('off'));
    expect(await opt()).toBe('off');
    // the choice is kept in this browser and nothing about it goes to the project
    expect(await s.page.evaluate(() => localStorage.getItem('neoleaf.editor.wrap'))).toBe('off');
    expect(await s.page.evaluate(() => JSON.stringify((globalThis as any).eval('projectConfig')))).not.toContain('wrap"');
    // it also holds when another file is opened
    await openInTree(s.page, 'references.bib');
    expect(await opt()).toBe('off');
    // Alt+Z goes to the next mode: off -> format -> window -> off
    await s.page.evaluate(() => (globalThis as any).eval('editor').focus());
    await s.page.keyboard.press('Alt+KeyZ');
    expect(await opt()).toBe('bounded');
    await s.page.keyboard.press('Alt+KeyZ');
    expect(await opt()).toBe('on');
    await s.page.keyboard.press('Alt+KeyZ');
    expect(await opt()).toBe('off');
    await s.page.evaluate(() => (window as any).LDBadness.setWrapMode('format'));
    expect(await opt()).toBe('bounded');
  }, 60000);

  test('turning the style checks off clears the underlines', async () => {
    await openInTree(s.page, 'main.tex');
    await setText(s.page, 'Wait... done\n');
    await poll(() => markers(s.page), m => m.length > 0);
    await s.page.evaluate(() => (window as any).LDBadness.applyConfig({ styleCheck: false }));
    expect((await markers(s.page)).length).toBe(0);
    await setText(s.page, 'Wait... again\n');
    await new Promise(r => setTimeout(r, 1800));
    expect((await markers(s.page)).length).toBe(0);
    await s.page.evaluate(() => (window as any).LDBadness.applyConfig({ styleCheck: true }));
    await poll(() => markers(s.page), m => m.length > 0);
  }, 60000);
});
