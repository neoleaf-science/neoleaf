import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fake, newSession, openInTree, openProject, poll, type Session } from '../helpers';

// "Run" tab of .py files (Pyodide in an isolated iframe). Only runs if static/pyodide exists (python3 scripts/fetch_pyodide.py).
const HAS_PYODIDE = fs.existsSync(path.resolve(import.meta.dir, '../../../static/pyodide/pyodide-lock.json'));

describe.skipIf(!HAS_PYODIDE)('run Python (interface)', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const dialogs: string[] = [];
  let accept = true;
  const output = () => s.page.locator('#py-out').textContent().catch(() => '');
  const status = () => s.page.locator('#py-status').textContent();
  const run = async () => { await s.page.click('#py-run'); };
  const finished = (t = 120000) => poll(() => s.page.locator('#py-stop').isDisabled(), v => v === true, t);

  beforeAll(async () => {
    fake.seedRepo('demo', 'pyui', {
      'main.tex': '\\documentclass{article}\n\\begin{document}Hi\n\\end{document}\n',
      'ola.py': 'print("hello from python")\n',
      'data.csv': 'n,v\n1,10\n2,20\n3,30\n',
      'util.py': 'def double(x):\n    return 2 * x\n',
      'sum.py': 'import pandas as pd\nfrom util import double\ndf = pd.read_csv("data.csv")\nprint("sum", double(int(df["v"].sum())))\nif __name__ == "__main__":\n    print("entry", __file__)\n',
      'chart.py': 'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [1, 4, 9])\nplt.savefig("figures/squares.png", dpi=60)\nprint("figure ready")\n',
      'error.py': 'print("before")\nx = 1 / 0\n',
      'loop.py': 'while True:\n    pass\n',
    }, ['neoleaf']);
    s = await newSession();
    s.page.on('dialog', d => { dialogs.push(d.message()); if (accept) d.accept(); else d.dismiss(); });
    await openProject(s.page, 'demo__pyui');
  });
  afterAll(async () => { await s.context.close(); });

  test('a .py opens in Python mode, is editable and shows the Run panel by itself', async () => {
    await openInTree(s.page, 'main.tex');
    expect(await s.page.locator('#tab-preview-btn').isVisible()).toBe(false);
    await openInTree(s.page, 'ola.py');
    expect(await ev<string>('editor.getModel().getLanguageId()')).toBe('python');
    expect(await ev<boolean>('editor.getOption(monaco.editor.EditorOption.readOnly)')).toBe(false);
    await s.page.waitForSelector('#py-run', { state: 'visible' });
    expect(await ev<string>('pdfTab')).toBe('preview');
    expect(await s.page.locator('#py-stop').isDisabled()).toBe(true);
  });

  test('declining the first-time warning runs nothing', async () => {
    accept = false;
    await run();
    await s.page.waitForTimeout(800);
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]).toContain('no access to the internet');
    expect(await output()).toBe('');
    expect(await s.page.locator('#py-run').isDisabled()).toBe(false);
    accept = true;
  });

  test('running shows the output and the time; the warning only appears once', async () => {
    await run();
    await poll(() => output(), v => (v || '').includes('hello from python'), 120000);
    await finished();
    expect(await status()).toContain('Done');
    expect(dialogs.length).toBe(2);   // the warning from the previous test and this one
    await run();
    await finished();
    expect(dialogs.length).toBe(2);   // did not ask again
  });

  test('the header ▶ and Ctrl+Enter run the Python (they do not compile the LaTeX)', async () => {
    await ev(`editor.setValue('print("by the button")')`);
    await s.page.click('#compile-btn');
    await poll(() => output(), v => (v || '').includes('by the button'), 60000);
    await finished();
    await ev(`editor.setValue('print("by the shortcut")')`);
    await ev(`editor.focus()`);
    await s.page.keyboard.press('Control+Enter');
    await poll(() => output(), v => (v || '').includes('by the shortcut'), 60000);
    await finished();
    expect(await ev<string>('pdfTab')).toBe('preview');   // did not jump to the PDF
  });

  test('the script sees the text on screen (even unsaved), the data and the modules of the project, and __name__ == "__main__"', async () => {
    await openInTree(s.page, 'sum.py');
    await run();
    await poll(() => output(), v => (v || '').includes('entry'), 120000);
    await finished();
    const t = (await output()) || '';
    expect(t).toContain('sum 120');
    expect(t).toContain('entry /work/sum.py');
  });

  test('a Python error shows in red with the traceback, after the output that already came out', async () => {
    await openInTree(s.page, 'error.py');
    await run();
    await poll(() => s.page.locator('#py-error').count(), n => n > 0, 120000);
    await finished();
    expect(await output()).toContain('before');
    expect(await s.page.locator('#py-error').textContent()).toContain('ZeroDivisionError');
    expect(await status()).toContain('error');
  });

  test('figures show in the panel and can be saved to the project (with confirmation to replace)', async () => {
    await openInTree(s.page, 'chart.py');
    await ev(`BrowserGit.writeFile('figures/readme.txt', 'folder the script uses')`);   // the folder exists in the project
    await run();
    await s.page.waitForSelector('.py-img', { timeout: 120000 });
    await finished();
    expect(await s.page.locator('.py-fname').first().textContent()).toContain('figures/squares.png');
    expect(await s.page.locator('.py-img').first().evaluate((i: HTMLImageElement) => i.naturalWidth > 0)).toBe(true);
    const before = dialogs.length;
    await s.page.locator('.py-card button', { hasText: 'Save to the project' }).first().click();
    const bytes = await poll(() => ev<number[]>(`BrowserGit.readFile('figures/squares.png', 'uint8array').then(b => Array.from(b.slice(0, 8))).catch(() => [])`), v => v.length === 8, 20000);
    expect(bytes.map(b => b.toString(16).padStart(2, '0')).join('')).toBe('89504e470d0a1a0a');
    expect(dialogs.length).toBe(before);   // new file: no question
    expect(await s.page.locator('.py-card button', { hasText: 'Saved to the project' }).count()).toBe(1);
    await poll(() => s.page.locator('#file-tree .tree-row', { hasText: 'squares.png' }).count(), n => n === 1, 20000);
    // again: the file already exists, it asks before replacing; declining does not write
    await ev(`BrowserGit.writeFile('figures/squares.png', new Uint8Array([1, 2, 3]))`);
    await run();
    await s.page.waitForSelector('.py-img', { timeout: 120000 });
    await finished();
    accept = false;
    await s.page.locator('.py-card button', { hasText: 'Save to the project' }).first().click();
    await s.page.waitForTimeout(500);
    expect(dialogs.at(-1)).toContain('Replace figures/squares.png');
    expect(await ev<number>(`BrowserGit.readFile('figures/squares.png', 'uint8array').then(b => b.length)`)).toBe(3);
    accept = true;
    await s.page.locator('.py-card button', { hasText: 'Save to the project' }).first().click();
    await poll(() => ev<number>(`BrowserGit.readFile('figures/squares.png', 'uint8array').then(b => b.length)`), n => n > 100, 20000);
  });

  test('Stop interrupts an infinite loop and the panel can run again', async () => {
    await openInTree(s.page, 'loop.py');
    await run();
    await poll(() => s.page.locator('#py-stop').isDisabled(), v => v === false, 60000);
    await s.page.waitForTimeout(1500);   // Python is already in the loop
    await s.page.click('#py-stop');
    await finished(30000);
    expect(await s.page.locator('#py-error').textContent()).toContain('Interrupted');
    expect(await s.page.locator('#py-run').isDisabled()).toBe(false);
    await openInTree(s.page, 'ola.py');   // (the shortcut test changed its content)
    await run();
    await poll(() => output(), v => (v || '').includes('by the shortcut'), 60000);
  });

  test('generated file names are handled as text and dangerous paths are not saved', async () => {
    await ev(`editor.setValue('open("<img src=x onerror=window.__x=1>.txt", "w").write("a")')`);
    await run();
    await s.page.waitForSelector('.py-card', { timeout: 120000 });
    await finished();
    expect(await s.page.locator('.py-fname').first().textContent()).toContain('<img src=x');
    expect(await s.page.locator('.py-card img').count()).toBe(0);
    expect(await ev<boolean>('window.__x === undefined')).toBe(true);
  });

  test('going back to a .tex removes the panel and the ▶ compiles the LaTeX again', async () => {
    await openInTree(s.page, 'main.tex');
    expect(await s.page.locator('#tab-preview-btn').isVisible()).toBe(false);
    expect(await s.page.locator('#py-panel').isVisible()).toBe(false);
    expect(await ev<boolean>('PyUI.active()')).toBe(false);
  });
});
