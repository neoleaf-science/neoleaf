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
