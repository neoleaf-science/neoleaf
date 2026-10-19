import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fake, newSession, openProject, poll, type Session } from '../helpers';

// Jupyter notebooks (.ipynb): open, read, edit, save and (with static/pyodide) run the cells, in a modal and an isolated iframe.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#0a7"/></svg>';
const lines = (s: string) => s.split('\n').map((l, i, a) => (i < a.length - 1 ? l + '\n' : l));

const NB = {
  cells: [
    { cell_type: 'markdown', id: 'a1', metadata: {}, source: lines('# Notebook title\n\nText with **bold**, the formula $E = mc^2$ and [a link](https://example.org).\n\n$$\\int_0^1 x^2 dx = \\frac{1}{3}$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>window.__xss = 1</script>\n\n![logo](img/logo.svg) ![tracker](https://tracker.example.org/p.png)') },
    { cell_type: 'code', id: 'b2', execution_count: 1, metadata: {}, source: lines('print("hello")\n2 + 3'), outputs: [
      { output_type: 'stream', name: 'stdout', text: ['hello\n'] },
      { output_type: 'execute_result', execution_count: 1, metadata: {}, data: { 'text/plain': ['5'] } }] },
    { cell_type: 'code', id: 'c3', execution_count: 2, metadata: {}, source: ['figura()'], outputs: [{ output_type: 'display_data', metadata: {}, data: { 'image/png': PNG + '\n', 'text/plain': ['<Figure size 1x1>'] } }] },
    { cell_type: 'code', id: 'd4', execution_count: 3, metadata: {}, source: ['df'], outputs: [{ output_type: 'execute_result', execution_count: 3, metadata: {}, data: {
      'text/html': ['<div><script>window.__xss2 = 1</script><img src="x" onerror="window.__xss3 = 1"><a href="javascript:alert(1)">bad</a><table class="dataframe"><thead><tr><th></th><th>a</th></tr></thead><tbody><tr><th>0</th><td>1</td></tr><tr><th>1</th><td>2</td></tr></tbody></table></div>'],
      'text/plain': ['   a\n0  1\n1  2'] } }] },
    { cell_type: 'code', id: 'e5', execution_count: 4, metadata: {}, source: ['1 / 0'], outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: ['\u001b[0;31m---------------------------------------------------------------------------\u001b[0m', '\u001b[0;31mZeroDivisionError\u001b[0m: division by zero'] }] },
    { cell_type: 'raw', id: 'f6', metadata: {}, source: ['raw text'] },
  ],
  metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, custom: { key: 'preserved value' } },
  nbformat: 4, nbformat_minor: 5,
};

const HAVE = fs.existsSync(path.resolve(import.meta.dir, '../../../static/pyodide/pyodide-lock.json'));

describe('notebooks Jupyter (.ipynb)', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const frame = async () => (await (await s.page.waitForSelector('#nb-frame', { state: 'attached' })).contentFrame())!;
  const openNb = async (name: string) => {
    await s.page.locator('#file-tree .tree-row', { hasText: name }).first().click();
    await s.page.waitForSelector('#nb-frame', { state: 'attached' });
    const f = await frame();
    await f.waitForSelector('#nb, .fatal', { timeout: 30000 });
    return f;
  };
  const closeNb = async () => { await s.page.click('#nb-close'); await s.page.waitForSelector('#nb-overlay', { state: 'detached' }); };
  const readNb = (name: string) => ev<string>(`BrowserGit.readFile(${JSON.stringify(name)})`);
  const saved = async (name: string, cond: (j: any, raw: string) => boolean) => JSON.parse(await poll(() => readNb(name), v => { try { return cond(JSON.parse(v), v); } catch (_) { return false; } }, 20000));

  beforeAll(async () => {
    fake.seedRepo('demo', 'nb', {
      'main.tex': '\\documentclass{article}\n\\begin{document}Hi\n\\end{document}\n',
      'nb.ipynb': JSON.stringify(NB, null, 1) + '\n',
      'broken.ipynb': '{ this is not json',
      'old.ipynb': JSON.stringify({ nbformat: 3, worksheets: [] }),
      'empty.ipynb': JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }),
      'img/logo.svg': SVG,
      'data.csv': 'a,b\n1,2\n3,4\n',
      'script.py': 'print(1)\n',
      'refs.bib': '@article{k, title={t}}\n',
      'analysis/other.ipynb': JSON.stringify({ cells: [{ cell_type: 'markdown', metadata: {}, source: ['# Other notebook'] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }),
    }, ['neoleaf']);
    s = await newSession();
    await openProject(s.page, 'demo__nb');
  });
  afterAll(async () => { await s.context.close(); });

  test('opens as a modal, with the In/Out prompts, the markdown and the formulas rendered', async () => {
    const f = await openNb('nb.ipynb');
    expect(await f.locator('.cell').count()).toBe(6);
    expect(await f.locator('.cell.code .in-prompt').allTextContents()).toEqual(['In [1]:', 'In [2]:', 'In [3]:', 'In [4]:']);
    expect(await f.locator('.out-prompt', { hasText: 'Out [1]:' }).count()).toBe(1);
    expect(await f.locator('.md h1').textContent()).toBe('Notebook title');
    expect(await f.locator('.md strong').textContent()).toBe('bold');
    expect(await f.locator('.md table td').first().textContent()).toBe('1');
    await poll(() => f.locator('.md .katex').count(), n => n >= 2, 20000);   // $...$ and $$...$$ with KaTeX
    expect(await f.locator('.md .katex-display').count()).toBe(1);
    expect(await f.locator('.md a').getAttribute('target')).toBe('_blank');
    expect(await f.locator('.cell.raw').count()).toBe(1);
    expect(await s.page.locator('#nb-overlay').isVisible()).toBe(true);
    expect(await s.page.locator('#nb-frame').getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
  });

  test('the notebook content executes nothing: scripts, onerror and dangerous links are removed; external images do not load', async () => {
    const f = await frame();
    expect(await f.evaluate(() => [(window as any).__xss, (window as any).__xss2, (window as any).__xss3])).toEqual([undefined, undefined, undefined]);
    expect(await f.locator('#cells script, #cells img[onerror], #cells a[href^="javascript"]').count()).toBe(0);
    expect(await f.locator('.html a').count()).toBe(1);
    expect(await f.locator('.html a').getAttribute('href')).toBeNull();
    // the image from an external server was dropped (the content policy only accepts data:)
    const srcs = await f.locator('.md img').evaluateAll(is => is.map(i => i.getAttribute('src') || ''));
    expect(srcs.some(x => x.includes('tracker.example.org'))).toBe(false);
  });

  test('project images (relative path) become data: via BrowserGit; the saved PNG and the HTML table appear', async () => {
    const f = await frame();
    await poll(() => f.locator('.md img[src^="data:image/svg+xml"]').count(), n => n === 1, 20000);
    expect(await f.locator('.out-body img[src^="data:image/png"]').count()).toBe(1);
    expect(await f.locator('.out-body table.dataframe tbody tr').count()).toBe(2);
    expect(await f.locator('pre.stream').first().textContent()).toContain('hello');
    // error with ANSI colors: the text comes out without the codes and the colored part becomes a <span>
    const err = f.locator('pre.error');
    expect(await err.textContent()).toContain('ZeroDivisionError: division by zero');
    expect(await err.textContent()).not.toContain('[0;31m');
    expect(await err.locator('span.fg-r').count()).toBeGreaterThan(0);
  });

  test('command mode keyboard: j/k, b, dd, z, m and y', async () => {
    const f = await frame();
    await f.locator('.cell').nth(1).locator('.prompt').first().click();
    expect(await f.locator('.cell.selected').getAttribute('data-uid')).toBe(await f.locator('.cell').nth(1).getAttribute('data-uid'));
    await s.page.keyboard.press('j');
    expect(await f.locator('.cell').nth(2).evaluate(e => e.classList.contains('selected'))).toBe(true);
    await s.page.keyboard.press('k');
    expect(await f.locator('.cell').nth(1).evaluate(e => e.classList.contains('selected'))).toBe(true);
    await s.page.keyboard.press('b');
    expect(await f.locator('.cell').count()).toBe(7);
    expect(await f.locator('.cell').nth(2).evaluate(e => e.classList.contains('selected'))).toBe(true);
    await s.page.keyboard.press('d'); await s.page.keyboard.press('d');
    expect(await f.locator('.cell').count()).toBe(6);
    await s.page.keyboard.press('z');
    expect(await f.locator('.cell').count()).toBe(7);
    await s.page.keyboard.press('m');
    expect(await f.locator('.cell').nth(2).evaluate(e => e.classList.contains('markdown'))).toBe(true);
    await s.page.keyboard.press('y');
    expect(await f.locator('.cell').nth(2).evaluate(e => e.classList.contains('code'))).toBe(true);
    await s.page.keyboard.press('d'); await s.page.keyboard.press('d');
    expect(await f.locator('.cell').count()).toBe(6);
  });

  test('editing: Enter edits, the code is highlighted, Tab indents, Esc leaves; autosave writes a valid .ipynb like the Jupyter one', async () => {
    const f = await frame();
    await f.locator('.cell').nth(1).locator('.prompt').first().click();
    await s.page.keyboard.press('Enter');
    const ta = f.locator('.cell').nth(1).locator('textarea');
    await ta.focus();
    await s.page.keyboard.press('Control+End');
    await s.page.keyboard.type('\nfor i in range(3):');
    await s.page.keyboard.press('Enter');
    await s.page.keyboard.type('print(i)  # comment');
    expect(await f.locator('.cell').nth(1).locator('.hl .tk-k').first().textContent()).toBe('for');
    expect(await f.locator('.cell').nth(1).locator('.hl .tk-c').textContent()).toContain('# comment');
    expect(await ta.inputValue()).toContain('for i in range(3):\n    print(i)');   // auto indentation came after the colon
    await s.page.keyboard.press('Escape');
    expect(await f.locator('.cell.edit').count()).toBe(0);
    const j = await saved('nb.ipynb', x => x.cells[1].source.join('').includes('print(i)  # comment'));
    expect(j.cells[1].source[0]).toBe('print("hello")\n');          // the code becomes a list of lines, as in Jupyter
    expect(j.cells[1].outputs.length).toBe(2);                    // the outputs remain
    expect(j.cells[1].execution_count).toBe(1);
    expect(j.metadata.custom.key).toBe('preserved value');     // what NeoLeaf does not understand is preserved
    expect(j.nbformat).toBe(4);
    expect(j.nbformat_minor).toBe(5);
    expect(j.cells[0].id).toBe('a1');
    const raw = await readNb('nb.ipynb');
    expect(raw.startsWith('{\n "cells": [')).toBe(true);          // keys in alphabetical order and 1-space indentation
    expect(raw.endsWith('}\n')).toBe(true);
    expect(await f.locator('#nb-save').textContent()).toContain('Saved');
  });

  test('"Save without outputs" writes without outputs and counters; "Clear outputs" erases on screen', async () => {
    const f = await frame();
    await f.locator('#nb-strip').check();
    const j = await saved('nb.ipynb', x => x.cells[1].outputs.length === 0);
    expect(j.cells.filter((c: any) => c.cell_type === 'code').every((c: any) => c.outputs.length === 0 && c.execution_count === null)).toBe(true);
    expect(await f.locator('.out-body').count()).toBeGreaterThan(0);     // on screen they remain
    expect(await ev<string>(`localStorage.getItem('ld-nb-strip')`)).toBe('1');
    await f.locator('#nb-strip').uncheck();
    await saved('nb.ipynb', x => x.cells[1].outputs.length === 2);
    await f.click('#nb-clear');
    expect(await f.locator('.out-body').count()).toBe(0);
    expect(await f.locator('.cell.code .in-prompt').first().textContent()).toBe('In [ ]:');
    const k = await saved('nb.ipynb', x => x.cells[1].outputs.length === 0);
    expect(k.cells[1].execution_count).toBeNull();
    expect(await ev<string>(`localStorage.getItem('ld-nb-strip')`)).toBe('0');
  });

  test('an invalid file, an old nbformat and an empty notebook show the right message', async () => {
    await closeNb();
    let f = await openNb('broken.ipynb');
    expect(await f.locator('.fatal').textContent()).toContain('valid JSON');
    await closeNb();
    f = await openNb('old.ipynb');
    expect(await f.locator('.fatal').textContent()).toContain('nbformat 4');
    await closeNb();
    f = await openNb('empty.ipynb');
    expect(await f.locator('.empty').textContent()).toContain('has no cells');
    await f.click('#nb-add');
    expect(await f.locator('.cell').count()).toBe(1);
    await closeNb();   // closing writes what was missing
    const j = await saved('empty.ipynb', x => x.cells.length === 1);
    expect(j.cells[0].cell_type).toBe('code');
    expect(j.cells[0].id).toMatch(/^[0-9a-f]{6,8}$/);
  });

  test('the window is a modal with the tree on the left: only notebooks, data and images (no .py, .tex or .bib)', async () => {
    const f = await openNb('nb.ipynb');
    const names = await s.page.locator('#nb-tree .nb-tree-row.file').allTextContents();
    const cleaned = names.map(n => n.replace(/^\S+\s/, ''));
    for (const wanted of ['nb.ipynb', 'other.ipynb', 'data.csv', 'logo.svg', 'broken.ipynb']) expect(cleaned).toContain(wanted);
    for (const forbidden of ['script.py', 'main.tex', 'refs.bib']) expect(cleaned).not.toContain(forbidden);
    expect(await s.page.locator('#nb-tree .nb-tree-row.dir').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('analysis'), expect.stringContaining('img')]));
    expect(await s.page.locator('#nb-tree .nb-tree-row.active').textContent()).toContain('nb.ipynb');
    // it is a modal: window smaller than the screen, with a darkened backdrop behind
    const box = await s.page.locator('.nb-modal').boundingBox();
    const screen = s.page.viewportSize()!;
    expect(box!.width).toBeLessThan(screen.width);
    expect(box!.height).toBeLessThan(screen.height);
    expect(await s.page.locator('#nb-overlay').evaluate(e => getComputedStyle(e).backgroundColor)).toContain('0, 0, 0');
    await f.waitForSelector('.cell');
    // collapse a folder
    await s.page.locator('#nb-tree .nb-tree-row.dir', { hasText: 'analysis' }).click();
    expect(await s.page.locator('#nb-tree .nb-tree-row.file', { hasText: 'other.ipynb' }).count()).toBe(0);
    await s.page.locator('#nb-tree .nb-tree-row.dir', { hasText: 'analysis' }).click();
    expect(await s.page.locator('#nb-tree .nb-tree-row.file', { hasText: 'other.ipynb' }).count()).toBe(1);
  });

  test('clicking a data file or an image shows the file; "Back to notebook" restores the notebook', async () => {
    await s.page.locator('#nb-tree .nb-tree-row.file', { hasText: 'data.csv' }).click();
    await s.page.waitForSelector('#nb-viewer', { state: 'visible' });
    expect(await s.page.locator('.nb-viewer-text').textContent()).toContain('a,b');
    expect(await s.page.locator('#nb-frame').isVisible()).toBe(false);
    expect(await s.page.locator('#nb-tree .nb-tree-row.active').textContent()).toContain('data.csv');
    await s.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await s.page.click('#nb-copy-path');
    expect(await poll(() => s.page.evaluate(() => navigator.clipboard.readText()), v => v === 'data.csv', 10000)).toBe('data.csv');
    await s.page.locator('#nb-tree .nb-tree-row.file', { hasText: 'logo.svg' }).click();
    await poll(() => s.page.locator('.nb-viewer-img').evaluate((i: HTMLImageElement) => i.naturalWidth > 0), v => v === true, 10000);
    await s.page.click('#nb-back');
    expect(await s.page.locator('#nb-viewer').isVisible()).toBe(false);
    expect(await s.page.locator('#nb-frame').isVisible()).toBe(true);
    expect(await (await frame()).locator('.cell').count()).toBeGreaterThan(0);
  });

  test('clicking another notebook swaps the window content without closing it', async () => {
    await s.page.locator('#nb-tree .nb-tree-row.file', { hasText: 'other.ipynb' }).click();
    await poll(async () => { const f = await frame(); return f ? await f.locator('.md h1').textContent().catch(() => '') : ''; }, v => v === 'Other notebook', 20000);
    expect(await s.page.locator('#nb-title').textContent()).toBe('analysis/other.ipynb');
    expect(await s.page.locator('#nb-tree .nb-tree-row.active').textContent()).toContain('other.ipynb');
    expect(await s.page.locator('#nb-overlay').count()).toBe(1);
  });

  test('clicking the darkened backdrop closes the window', async () => {
    await s.page.locator('#nb-overlay').click({ position: { x: 4, y: 4 } });
    await s.page.waitForSelector('#nb-overlay', { state: 'detached' });
  });
});

describe.skipIf(!HAVE)('notebooks: running the cells (Pyodide)', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const frame = async () => (await (await s.page.waitForSelector('#nb-frame', { state: 'attached' })).contentFrame())!;
  const cell = (n: number) => `.cell:nth-of-type(${n})`;
  const openNb = async (name: string) => {
    await s.page.locator('#file-tree .tree-row', { hasText: name }).first().click();
    const f = await frame();
    await f.waitForSelector('#nb');
    return f;
  };
  const idle = (f: any) => poll(() => f.locator('.cell.running, .cell.queued').count(), n => n === 0, 180000);
  const code = (src: string) => ({ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: lines(src) });
  const md = (src: string) => ({ cell_type: 'markdown', metadata: {}, source: lines(src) });
  const mk = (cells: unknown[]) => JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 4 }, null, 1) + '\n';

  beforeAll(async () => {
    fake.seedRepo('demo', 'nbrun', {
      'main.tex': '\\documentclass{article}\n\\begin{document}Hi\n\\end{document}\n',
      'state.ipynb': mk([md('## State'), code('x = 21'), code('x * 2'), code('print("hi")\nimport math\nmath.pi'), code('x = 5;'), code('x'), code('%matplotlib inline\nimport pandas as pd\npd.DataFrame({"a": [1, 2], "b": [3, 4]})'),
        code('import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [1, 4, 9])\nplt.show()'), code('1 / 0'), code('"does not run: the previous error stopped the queue"')]),
      'data.csv': 'n,v\n1,10\n2,20\n3,30\n',
      'analysis/local.csv': 'x\n1\n2\n3\n',
      'analysis/rel.ipynb': mk([code('import os\nprint(os.getcwd())'), code('import pandas as pd\nprint(pd.read_csv("local.csv")["x"].sum())\nprint(pd.read_csv("../data.csv")["v"].sum())')]),
      'loop.ipynb': mk([code('y = 1'), code('while True:\n    pass'), code('y')]),
      'sales.ipynb': mk([md('# Example: Sales Analysis 📊\nThis notebook uses **Pandas** and **Matplotlib**.'),
        code('import pandas as pd\nimport matplotlib.pyplot as plt\nprint("Libraries imported successfully!")'),
        code("dados = {\n    'Product': ['Notebook', 'Smartphone', 'Keyboard'],\n    'Quantity': [10, 25, 40],\n    'Unit_Price': [3500, 1800, 150]\n}\ndf = pd.DataFrame(dados)\ndf['Total_Revenue'] = df['Quantity'] * df['Unit_Price']\ndf"),
        md('### 📈 Revenue Chart by Product'),
        code("plt.figure(figsize=(8, 4))\nplt.bar(df['Product'], df['Total_Revenue'], color='skyblue')\nplt.title('Revenue by Product (R$)')\nplt.show()")]),
    }, ['neoleaf']);
    s = await newSession();
    s.page.on('dialog', d => d.accept());
    await openProject(s.page, 'demo__nbrun');
  });
  afterAll(async () => { await s.context.close(); });

  test('Run all: the kernel keeps variables, shows Out [n], streams, DataFrame and figure, and an error stops the queue', async () => {
    const f = await openNb('state.ipynb');
    await f.click('#nb-runall');
    await poll(() => f.locator('.cell.code .in-prompt').nth(0).textContent(), v => v === 'In [1]:', 180000);
    await idle(f);
    const prompts = await f.locator('.cell.code .in-prompt').allTextContents();
    expect(prompts.slice(0, 8)).toEqual(['In [1]:', 'In [2]:', 'In [3]:', 'In [4]:', 'In [5]:', 'In [6]:', 'In [7]:', 'In [8]:']);
    expect(prompts[8]).toBe('In [ ]:');   // after the error, the last cell did not run
    const output = (n: number) => f.locator('.cell.code').nth(n).locator('.out-body');
    expect(await output(1).first().textContent()).toContain('42');                 // x * 2, with x from another cell
    expect(await f.locator('.cell.code').nth(1).locator('.out-prompt', { hasText: 'Out [2]:' }).count()).toBe(1);
    expect(await output(2).first().textContent()).toContain('hi');                 // print
    expect(await f.locator('.cell.code').nth(2).textContent()).toContain('3.14159');   // value of the last expression
    expect(await f.locator('.cell.code').nth(3).locator('.out-body').count()).toBe(0);   // "x = 5;" shows nothing
    expect(await output(4).first().textContent()).toContain('5');
    expect(await f.locator('.cell.code').nth(5).locator('table.dataframe tbody tr').count()).toBe(2);   // %matplotlib inline ignored; DataFrame as a table
    expect(await f.locator('.cell.code').nth(6).locator('img[src^="data:image/png"]').count()).toBe(1);   // plt.show(): the figure appears in the cell
    expect(await f.locator('.cell.code').nth(7).locator('pre.error').textContent()).toContain('ZeroDivisionError');
    expect(await f.locator('#nb-kernel').textContent()).toContain('idle');
    // the written file carries the outputs in Jupyter format
    const j = JSON.parse(await poll(() => ev<string>(`BrowserGit.readFile('state.ipynb')`), v => { try { return JSON.parse(v).cells[8].outputs.length > 0; } catch (_) { return false; } }, 30000));
    const c2 = j.cells[2];
    expect(c2.outputs[0].output_type).toBe('execute_result');
    expect(c2.outputs[0].data['text/plain']).toEqual(['42']);
    expect(j.cells[3].outputs[0]).toEqual({ name: 'stdout', output_type: 'stream', text: ['hi\n'] });
    expect(j.cells[8].outputs[0].ename).toBe('ZeroDivisionError');
  });

  test('Restarting the kernel erases the variables and resets the numbering', async () => {
    const f = await frame();
    await f.locator('.cell.code').nth(1).locator('.prompt').first().click();
    await f.click('#nb-restart');
    await poll(() => f.locator('.banner').isVisible(), v => v === true, 10000);
    await f.locator('.cell.code').nth(1).locator('.prompt').first().click();
    await s.page.keyboard.press('Control+Enter');   // x * 2 without x
    await idle(f);
    expect(await f.locator('.cell.code').nth(1).locator('pre.error').textContent()).toContain('NameError');
    expect(await f.locator('.cell.code').nth(1).locator('.in-prompt').textContent()).toBe('In [1]:');
  });

  test('Markdown renders when run; Shift+Enter moves to the next cell', async () => {
    const f = await frame();
    await f.locator('.cell').first().dblclick();
    await s.page.keyboard.press('Control+End');
    await s.page.keyboard.type('\n\nNew text with $x^2$');
    await s.page.keyboard.press('Shift+Enter');
    await poll(() => f.locator('.cell').first().locator('.katex').count(), n => n === 1, 10000);
    expect(await f.locator('.cell').first().locator('.md').textContent()).toContain('New text');
    expect(await f.locator('.cell').nth(1).evaluate(e => e.classList.contains('selected'))).toBe(true);
  });

  test('Stop interrupts an infinite loop, restarts the kernel and the queue stops', async () => {
    await s.page.click('#nb-close');
    await s.page.waitForSelector('#nb-overlay', { state: 'detached' });
    const f = await openNb('loop.ipynb');
    await f.click('#nb-runall');
    await poll(() => f.locator('.cell.code').nth(1).evaluate(e => e.classList.contains('running')), v => v === true, 180000);   // the loop, after the first cell
    await s.page.waitForTimeout(1500);
    await f.click('#nb-stop');
    await idle(f);
    expect(await f.locator('.cell.code').nth(1).locator('pre.error').textContent()).toContain('interrupted');
    expect(await f.locator('.cell.code').nth(2).locator('.in-prompt').textContent()).toBe('In [ ]:');   // the last cell did not run
    await f.locator('.cell.code').nth(0).locator('.prompt').first().click();
    await s.page.keyboard.press('Control+Enter');   // the kernel works again
    await idle(f);
    expect(await f.locator('.cell.code').nth(0).locator('.in-prompt').textContent()).toBe('In [1]:');
  });

  test('the "Sales Analysis" example (pandas and matplotlib) runs entirely, with the table and the chart inside the cells', async () => {
    await s.page.click('#nb-close');
    await s.page.waitForSelector('#nb-overlay', { state: 'detached' });
    const f = await openNb('sales.ipynb');
    await f.click('#nb-runall');
    await poll(() => f.locator('.cell.code').nth(1).locator('table.dataframe').count(), n => n === 1, 180000);
    await idle(f);
    expect(await f.locator('.cell.code').first().locator('pre.stream').textContent()).toContain('Libraries imported successfully!');
    expect(await f.locator('.cell.code').nth(1).locator('table.dataframe tbody tr').count()).toBe(3);
    expect(await f.locator('.cell.code').nth(1).locator('table.dataframe').textContent()).toContain('Notebook');
    expect(await f.locator('.cell.code').nth(2).locator('img[src^="data:image/png"]').count()).toBe(1);
    expect(await f.locator('.cell.markdown').nth(1).locator('h3').textContent()).toContain('Revenue Chart');
  });

  test('the kernel sees the project files and the working directory is the notebook folder, as in Jupyter', async () => {
    await s.page.click('#nb-close');
    await s.page.waitForSelector('#nb-overlay', { state: 'detached' });
    await ev(`NotebookView.open('analysis/rel.ipynb')`);   // the folder is collapsed in the main tree
    const f = await frame();
    await f.waitForSelector('#nb');
    await f.click('#nb-runall');
    await poll(() => f.locator('.cell.code').nth(1).locator('pre.stream').count(), n => n === 1, 180000);
    await idle(f);
    expect(await f.locator('.cell.code').nth(0).locator('pre.stream').textContent()).toContain('/work/analysis');
    const output = (await f.locator('.cell.code').nth(1).locator('pre.stream').textContent()) || '';
    expect(output).toContain('6');    // local.csv, in the notebook folder
    expect(output).toContain('60');   // ../data.csv, at the root
  });
});
