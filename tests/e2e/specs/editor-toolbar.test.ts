import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { fake, newSession, openInTree, openProject, poll, type Session } from '../helpers';

// Text toolbar (LaTeX and Markdown): each button makes its change through the editor itself.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TEX = ['\\documentclass{article}', '\\begin{document}', 'Introdução', 'palavra outra', '\\section{Métodos}\\label{sec:metodos}', 'a equação \\label{eq:energia}', '\\end{document}', ''].join('\n');
const BIB = ['@article{silva2024deep,', '  author = {Silva, Ana},', '  title = {{Deep Learning para Test Smells}},', '  year = {2024}', '}', '', '@book{souza2020redes,', '  title = {Redes Complexas},', '  year = {2020}', '}', ''].join('\n');

describe('editor toolbar', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const value = () => ev<string>('editor.getValue()');
  const put = (text: string) => ev(`editor.setValue(${JSON.stringify(text)})`);
  const select = (l1: number, c1: number, l2: number, c2: number) => ev(`editor.setSelection({ startLineNumber: ${l1}, startColumn: ${c1}, endLineNumber: ${l2}, endColumn: ${c2} })`);
  const cursor = (l: number, c: number) => ev(`editor.setPosition({ lineNumber: ${l}, column: ${c} })`);
  const click = (id: string) => s.page.click('#ed-' + id);
  const item = (text: string) => s.page.locator('.ed-pop .ed-item', { hasText: text }).first();
  const openTex = async () => { await openInTree(s.page, 'main.tex'); await put(TEX); };

  beforeAll(async () => {
    fake.seedRepo('demo', 'tb', {
      'main.tex': TEX, 'refs.bib': BIB, 'README.md': '# Título\n\nTexto simples\n', 'dados.csv': 'a,b\n1,2\n', 'script.py': 'print(1)\n',
      'images/foto.png': PNG.toString('latin1'),
    }, ['neoleaf']);
    s = await newSession();
    await openProject(s.page, 'demo__tb');
  });
  afterAll(async () => { await s.context.close(); });

  test('the toolbar shows in LaTeX and Markdown, hides for other files and can be hidden (remembered in the browser)', async () => {
    await openTex();
    expect(await s.page.locator('#editor-toolbar').isVisible()).toBe(true);
    for (const id of ['undo', 'redo', 'style', 'bold', 'italic', 'math', 'symbols', 'link', 'comment', 'ref', 'cite', 'image', 'table', 'list']) expect(await s.page.locator('#ed-' + id).count()).toBe(1);
    expect(await s.page.locator('#toolbar-toggle-btn').isVisible()).toBe(true);
    await openInTree(s.page, 'README.md');
    expect(await s.page.locator('#editor-toolbar').isVisible()).toBe(true);
    for (const other of ['refs.bib', 'dados.csv', 'script.py']) {
      await openInTree(s.page, other);
      expect(await s.page.locator('#editor-toolbar').isVisible()).toBe(false);
      expect(await s.page.locator('#toolbar-toggle-btn').isVisible()).toBe(false);
    }
    await openTex();
    await s.page.click('#toolbar-toggle-btn');
    expect(await s.page.locator('#editor-toolbar').isVisible()).toBe(false);
    expect(await ev<string>(`localStorage.getItem('ld-toolbar-hidden')`)).toBe('1');
    await s.page.reload();
    await s.page.waitForSelector('.monaco-editor');
    await s.page.waitForFunction(() => (globalThis as any).eval('typeof currentFileId !== "undefined" && !!currentFileId'));
    await openInTree(s.page, 'main.tex');
    expect(await s.page.locator('#editor-toolbar').isVisible()).toBe(false);
    await s.page.click('#toolbar-toggle-btn');
    expect(await s.page.locator('#editor-toolbar').isVisible()).toBe(true);
  });

  test('undo and redo', async () => {
    await openTex();
    await cursor(3, 1);
    await ev(`editor.executeEdits('t', [{ range: new monaco.Range(3, 1, 3, 1), text: 'NOVO ' }])`);
    expect((await value()).includes('NOVO Introdução')).toBe(true);
    await click('undo');
    expect((await value()).includes('NOVO')).toBe(false);
    await click('redo');
    expect((await value()).includes('NOVO Introdução')).toBe(true);
  });

  test('bold and italic wrap the selection and undo on second click; without a selection a sample is inserted', async () => {
    await openTex();
    await select(4, 1, 4, 8);   // "palavra"
    await click('bold');
    expect((await value()).split('\n')[3]).toBe('\\textbf{palavra} outra');
    await click('bold');
    expect((await value()).split('\n')[3]).toBe('palavra outra');
    await select(4, 9, 4, 14);   // "outra"
    await click('italic');
    expect((await value()).split('\n')[3]).toBe('palavra \\textit{outra}');
    await cursor(3, 1);
    await click('bold');
    expect((await value()).split('\n')[2]).toContain('\\textbf{text}Introdução');
  });

  test('text style: section, subsection, normal text, size and other styles', async () => {
    await openTex();
    await cursor(3, 3);
    await click('style');
    await item('Section').click();
    expect((await value()).split('\n')[2]).toBe('\\section{Introdução}');
    await click('style');
    await item('Subsection').click();
    expect((await value()).split('\n')[2]).toBe('\\subsection{Introdução}');
    await click('style');
    await item('Normal text').click();
    expect((await value()).split('\n')[2]).toBe('Introdução');
    await select(4, 1, 4, 8);
    await click('style');
    await item('Large text').click();
    expect((await value()).split('\n')[3]).toBe('{\\large palavra} outra');
    await select(4, 1, 4, 3);
    await click('style');
    await item('Monospace').click();
    expect((await value()).split('\n')[3]).toContain('\\texttt{');
  });

  test('math: inline formula, display formula and numbered equation', async () => {
    await openTex();
    await select(4, 1, 4, 8);
    await click('math');
    await item('Inline formula').click();
    expect((await value()).split('\n')[3]).toBe('$palavra$ outra');
    await select(4, 1, 4, 10);   // "$palavra$"
    await click('math');
    await item('Display formula').click();
    expect((await value()).split('\n')[3]).toContain('\\[ $palavra$ \\]');
    await openTex();
    await cursor(3, 1);
    await click('math');
    await item('Numbered equation').click();
    const v = await value();
    expect(v).toContain('\\begin{equation}');
    expect(v).toContain('\\label{eq:label}');
    expect(v).toContain('\\end{equation}');
  });

  test('symbols: the palette has tabs and inserts the command; in Markdown it inserts the character', async () => {
    await openTex();
    await cursor(3, 1);
    await click('symbols');
    await s.page.locator('.ed-sym', { hasText: 'α' }).click();
    expect((await value()).split('\n')[2]).toBe('\\alphaIntrodução');
    await s.page.locator('.ed-tab', { hasText: 'Arrows' }).click();
    await s.page.locator('.ed-sym', { hasText: '→' }).click();
    expect((await value()).split('\n')[2]).toBe('\\alpha\\toIntrodução');
    await s.page.locator('.ed-tab', { hasText: 'Operators' }).click();
    await s.page.locator('.ed-sym', { hasText: '√' }).click();
    expect((await value())).toContain('\\sqrt{}');
    await openInTree(s.page, 'README.md');
    await cursor(3, 1);
    await click('symbols');
    await s.page.locator('.ed-sym[title="α"]').click();
    expect((await value()).split('\n')[2]).toBe('αTexto simples');
  });

  test('link: \\href with the selection, \\url and the Markdown format', async () => {
    await openTex();
    await select(4, 1, 4, 8);
    await click('link');
    await item('Link with text').click();
    expect((await value()).split('\n')[3]).toBe('\\href{https://}{palavra} outra');
    await select(4, 1, 4, 2);
    await click('link');
    await item('Address as text').click();
    expect((await value())).toContain('\\url{');
    await openInTree(s.page, 'README.md');
    await put('# Título\n\nTexto simples\n');
    await select(3, 1, 3, 6);
    await click('link');
    await item('Link').click();
    expect((await value()).split('\n')[2]).toBe('[Texto](https://) simples');
  });

  test('comment: opens the comment window for the selected text', async () => {
    await openTex();
    await select(4, 1, 4, 8);
    await click('comment');
    try {
      await s.page.waitForSelector('.modal-backdrop:has(textarea)', { timeout: 10000 });
      expect(await s.page.locator('.modal-backdrop:has(textarea)').first().textContent()).toContain('palavra');
    } finally {
      await ev(`document.querySelectorAll('.modal-backdrop').forEach(e => { if (e.querySelector('textarea')) e.remove(); })`);
    }
  });

  test('label and reference: defines \\label and picks a project label for \\ref, \\eqref and \\pageref', async () => {
    await openTex();
    await cursor(3, 1);
    await click('ref');
    await item('Define a label').click();
    expect((await value()).split('\n')[2]).toContain('\\label{label}');
    await openTex();
    await cursor(3, 1);
    await click('ref');
    await item('Reference a label').click();
    await s.page.waitForSelector('.ed-picker .ed-row');
    const labels = await s.page.locator('.ed-picker .ed-row span').allTextContents();
    expect(labels).toEqual(expect.arrayContaining(['sec:metodos', 'eq:energia']));
    await s.page.fill('.ed-filter', 'energia');
    expect(await s.page.locator('.ed-picker .ed-row').count()).toBe(1);
    await s.page.locator('.ed-picker .ed-row').click();
    expect((await value()).split('\n')[2]).toBe('\\ref{eq:energia}Introdução');
    await click('ref');
    await item('Reference an equation').click();
    await s.page.locator('.ed-picker .ed-row', { hasText: 'sec:metodos' }).click();
    expect((await value())).toContain('\\eqref{sec:metodos}');
  });

  test('citation: picks a .bib key (with the title) and opens the reference search', async () => {
    await openTex();
    await cursor(3, 1);
    await click('cite');
    await item('Cite a reference from the .bib').click();
    await s.page.waitForSelector('.ed-picker .ed-row');
    const rows = await s.page.locator('.ed-picker .ed-row').allTextContents();
    expect(rows.join('|')).toContain('silva2024deep');
    expect(rows.join('|')).toContain('Deep Learning para Test Smells (2024)');
    await s.page.locator('.ed-picker .ed-row', { hasText: 'souza2020redes' }).click();
    expect((await value()).split('\n')[2]).toBe('\\cite{souza2020redes}Introdução');
    await click('cite');
    await item('Cite in parentheses').click();
    await s.page.locator('.ed-picker .ed-row', { hasText: 'silva2024deep' }).click();
    expect((await value())).toContain('\\citep{silva2024deep}');
    await click('cite');
    await item('Search papers to cite').click();
    expect(await ev<string>('pdfTab')).toBe('refs');
    await s.page.click('#tab-pdf-btn');
  });

  test('in Markdown, label and citation are disabled', async () => {
    await openInTree(s.page, 'README.md');
    expect(await s.page.locator('#ed-ref').isDisabled()).toBe(true);
    expect(await s.page.locator('#ed-cite').isDisabled()).toBe(true);
    expect(await s.page.locator('#ed-bold').isDisabled()).toBe(false);
  });

  test('image: lists the project ones, adds graphicx if missing and inserts the figure environment', async () => {
    await openTex();
    await cursor(3, 1);
    await click('image');
    await s.page.waitForSelector('.ed-picker .ed-row');
    expect(await s.page.locator('.ed-picker .ed-row', { hasText: 'images/foto.png' }).count()).toBe(1);
    await s.page.locator('.ed-picker .ed-row', { hasText: 'images/foto.png' }).click();
    const v = await poll(() => value(), x => x.includes('\\includegraphics'), 10000);
    expect(v).toContain('\\usepackage{graphicx}');
    expect(v.split('\n')[1]).toBe('\\usepackage{graphicx}');   // right after \documentclass
    expect(v).toContain('\\includegraphics[width=0.8\\linewidth]{images/foto.png}');
    expect(v).toContain('\\begin{figure}[htbp]');
    expect(v).toContain('\\label{fig:foto}');
    // with graphicx already in the document, do not repeat
    await cursor(6, 1);
    await click('image');
    await s.page.locator('.ed-picker .ed-row', { hasText: 'images/foto.png' }).click();
    expect(((await value()).match(/usepackage\{graphicx\}/g) || []).length).toBe(1);
  });

  test('image: uploading a file writes to the project image folder (without overwriting) and inserts the figure', async () => {
    await openTex();
    await cursor(3, 1);
    await click('image');
    await s.page.waitForSelector('#ed-image-file', { state: 'attached' });
    await s.page.setInputFiles('#ed-image-file', { name: 'meu gráfico.png', mimeType: 'image/png', buffer: PNG });
    const v = await poll(() => value(), x => x.includes('images/meu_gr'), 15000);
    expect(v).toMatch(/\{images\/meu_gr_fico\.png\}/);
    const written = await poll(() => ev<number>(`BrowserGit.readFile('images/meu_gr_fico.png', 'uint8array').then(b => b.length).catch(() => 0)`), n => n > 0, 15000);
    expect(written).toBe(PNG.length);
    // same name again: gets a number, the first is not overwritten
    await click('image');
    await s.page.waitForSelector('#ed-image-file', { state: 'attached' });
    await s.page.setInputFiles('#ed-image-file', { name: 'meu gráfico.png', mimeType: 'image/png', buffer: PNG });
    await poll(() => ev<number>(`BrowserGit.readFile('images/meu_gr_fico-2.png', 'uint8array').then(b => b.length).catch(() => 0)`), n => n > 0, 15000);
  });

  test('image in Markdown inserts the ![](path) format', async () => {
    await openInTree(s.page, 'README.md');
    await cursor(3, 1);
    await click('image');
    await s.page.locator('.ed-picker .ed-row', { hasText: 'images/foto.png' }).click();
    expect((await value())).toContain('![description](images/foto.png)');
  });

  test('table: the grid picks rows and columns and inserts the table environment (LaTeX) or the table (Markdown)', async () => {
    await openTex();
    await cursor(3, 1);
    await click('table');
    await s.page.locator('.ed-tcell[data-r="3"][data-c="2"]').hover();
    expect(await s.page.locator('.ed-table .ed-pop-title').textContent()).toContain('3 × 2');
    await s.page.locator('.ed-tcell[data-r="3"][data-c="2"]').click();
    const v = await value();
    expect(v).toContain('\\begin{table}[htbp]');
    expect(v).toContain('\\begin{tabular}{cc}');
    expect(v).toContain('Column 1 & Column 2 \\\\');
    expect(v.split('\n').filter(l => l.trim().endsWith('\\\\')).length).toBe(3);   // header and two rows
    expect(v).toContain('\\end{table}');
    await openInTree(s.page, 'README.md');
    await cursor(3, 1);
    await click('table');
    await s.page.locator('.ed-tcell[data-r="2"][data-c="3"]').click();
    const md = await value();
    expect(md).toContain('| Column 1 | Column 2 | Column 3 |');
    expect(md).toContain('| --- | --- | --- |');
  });

  test('list: template without selection; with several selected lines each line becomes an item', async () => {
    await openTex();
    await cursor(3, 1);
    await click('list');
    await item('Bulleted list').click();
    expect(await value()).toContain('\\begin{itemize}');
    await put(['linha um', 'linha dois', '', 'linha três'].join('\n'));
    await select(1, 1, 4, 11);
    await click('list');
    await item('Numbered list').click();
    expect(await value()).toBe(['\\begin{enumerate}', '\t\\item linha um', '\t\\item linha dois', '\t\\item linha três', '\\end{enumerate}'].join('\n'));
    await openInTree(s.page, 'README.md');
    await put(['um', 'dois', 'três'].join('\n'));
    await select(1, 1, 3, 5);
    await click('list');
    await item('Numbered list').click();
    expect(await value()).toBe('1. um\n2. dois\n3. três');
    await select(1, 1, 3, 8);
    await click('list');
    await item('Bulleted list').click();
    expect(await value()).toBe('- um\n- dois\n- três');
  });

  test('style in Markdown becomes # headings', async () => {
    await openInTree(s.page, 'README.md');
    await put('Título novo\n');
    await cursor(1, 3);
    await click('style');
    await item('Section').click();
    expect((await value()).split('\n')[0]).toBe('## Título novo');
    await click('style');
    await item('Normal text').click();
    expect((await value()).split('\n')[0]).toBe('Título novo');
  });

  test('in a narrow width what does not fit goes to the "⋯" menu and the buttons keep working', async () => {
    await openTex();
    expect(await s.page.locator('#ed-more').isVisible()).toBe(false);
    await s.page.setViewportSize({ width: 760, height: 900 });
    await poll(() => s.page.locator('#ed-more').isVisible(), v => v === true, 10000);
    await s.page.click('#ed-more');
    await s.page.waitForSelector('.ed-more-pop .ed-btn');
    expect(await s.page.locator('.ed-more-pop .ed-btn').count()).toBeGreaterThan(0);
    const inside = await s.page.locator('.ed-more-pop .ed-btn').evaluateAll(bs => bs.map(b => b.id));
    expect(inside).toContain('ed-list');   // the last group was the first to leave
    await cursor(3, 1);
    await s.page.locator('.ed-more-pop #ed-list').click();
    await item('Bulleted list').click();
    expect(await value()).toContain('\\begin{itemize}');
    await s.page.setViewportSize({ width: 1400, height: 900 });
    await poll(() => s.page.locator('#ed-more').isVisible(), v => v === false, 10000);
    expect(await s.page.locator('#editor-toolbar #ed-list').count()).toBe(1);
  });
});
