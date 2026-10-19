import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { fake, newSession, openInTree, openProject, poll, type Session } from '../helpers';

// CSV and TSV files: open as text in the editor and the "Preview" tab shows the table (isolated iframe, cells as text),
// with sorting, filter, separator choice, row limit and copy as `tabular`.
describe('CSV and TSV preview', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const frame = async () => (await (await s.page.waitForSelector('#csv-preview-frame', { state: 'attached' })).contentFrame())!;
  const cells = async () => (await frame()).evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td:not(.idx)')).map(td => td.textContent)));
  const header = async () => (await frame()).evaluate(() => Array.from(document.querySelectorAll('thead th:not(.idx)')).map(th => th.textContent!.replace(/[▲▼]/g, '')));
  const waitTable = (cond: (t: string[][]) => boolean) => poll(async () => (await cells().catch(() => [])), cond, 30000);

  const CSV = 'nome,idade,cidade\n"Silva, Ana",31,Palmas\nBruno,9,"Salvador"\nCarla,100,"São ""Paulo"""\n';
  const PV = 'produto;preço\nlápis;1,50\ncaneta;3,25\n';
  const TSV = 'a\tb\n1\t2\n3\t4\n';
  const DANGER = 'x,y\n"<img src=x onerror=\'window.parent.document.title=1\'>","<script>window.parent.document.title=2</script>"\n';
  const BIG = 'n,v\n' + Array.from({ length: 2500 }, (_, i) => `${i + 1},v${i + 1}`).join('\n') + '\n';

  beforeAll(async () => {
    fake.seedRepo('demo', 'csv', {
      'main.tex': '\\documentclass{article}\n\\begin{document}Oi\n\\end{document}\n',
      'dados.csv': CSV,
      'precos.csv': PV,
      'tabela.tsv': TSV,
      'perigo.csv': DANGER,
      'grande.csv': BIG,
      'vazio.csv': '',
    }, ['neoleaf']);
    s = await newSession();
    await openProject(s.page, 'demo__csv');
  });
  afterAll(async () => { await s.context.close(); });

  for (const file of ['dados.csv', 'tabela.tsv']) {
    test(`${file}: opens as text in CSV mode, is editable and writes to the clone`, async () => {
      await openInTree(s.page, file);
      expect(await ev<string>('editor.getModel().getLanguageId()')).toBe('csv');
      expect(await ev<boolean>('editor.getOption(monaco.editor.EditorOption.readOnly)')).toBe(false);
      const mark = `${Date.now()}`;
      await ev(`editor.setValue(editor.getValue() + ${JSON.stringify('z' + mark + '\n')})`);
      const written = await poll(() => ev<string>(`BrowserGit.readFile(${JSON.stringify(file)})`), v => v.includes('z' + mark), 20000);
      expect(written).toContain('z' + mark);
    });
  }

  test('the Preview tab shows up by itself and shows the table (quotes, comma inside a cell and escaped quotes)', async () => {
    await openInTree(s.page, 'main.tex');
    expect(await s.page.locator('#tab-preview-btn').isVisible()).toBe(false);
    await openInTree(s.page, 'dados.csv');
    await ev(`editor.setValue(${JSON.stringify(CSV)})`);
    await s.page.waitForSelector('#tab-preview-btn', { state: 'visible' });
    expect(await ev<string>('pdfTab')).toBe('preview');
    const t = await waitTable(x => x.length === 3 && x[0][0] === 'Silva, Ana' && x[2][2] === 'São "Paulo"');
    expect(await header()).toEqual(['nome', 'idade', 'cidade']);
    expect(t[0]).toEqual(['Silva, Ana', '31', 'Palmas']);
    expect(t[1]).toEqual(['Bruno', '9', 'Salvador']);
    expect(t[2]).toEqual(['Carla', '100', 'São "Paulo"']);
    expect(await s.page.locator('#csv-bar').isVisible()).toBe(true);
    expect(await s.page.locator('#csv-info').textContent()).toContain('3 rows × 3 columns');
  });

  test('clicking the header sorts (numbers as numbers), again reverses and the third time restores the original', async () => {
    const f = await frame();
    await f.click('thead th:nth-child(3)');   // "idade" column (the first is the "#")
    expect((await waitTable(x => x[0][0] === 'Bruno')).map(l => l[1])).toEqual(['9', '31', '100']);
    await f.click('thead th:nth-child(3)');
    expect((await waitTable(x => x[0][0] === 'Carla')).map(l => l[1])).toEqual(['100', '31', '9']);
    await f.click('thead th:nth-child(3)');
    expect((await waitTable(x => x[0][0] === 'Silva, Ana')).map(l => l[0])).toEqual(['Silva, Ana', 'Bruno', 'Carla']);
  });

  test('the filter shows only matching rows and the summary reports it', async () => {
    await s.page.fill('#csv-filter', 'bru');
    expect(await waitTable(x => x.length === 1)).toEqual([['Bruno', '9', 'Salvador']]);
    expect(await s.page.locator('#csv-info').textContent()).toContain('1 in the filter');
    await s.page.fill('#csv-filter', 'nada-disso');
    await waitTable(x => x.length === 0);
    expect(await (await frame()).evaluate(() => document.querySelector('.msg')?.textContent || '')).toContain('No row matches');
    await s.page.fill('#csv-filter', '');
    await waitTable(x => x.length === 3);
  });

  test('the separator is detected (semicolon) and can be forced in the selector', async () => {
    await openInTree(s.page, 'precos.csv');
    expect(await waitTable(x => x.length === 2 && x[0][0] === 'lápis')).toEqual([['lápis', '1,50'], ['caneta', '3,25']]);
    expect(await s.page.locator('#csv-info').textContent()).toContain('semicolon');
    await s.page.selectOption('#csv-delimiter', ',');
    const t = await waitTable(x => x.length === 2 && x[0][0] === 'lápis;1');   // with comma: "lápis;1" and "50"
    expect(t[0]).toEqual(['lápis;1', '50']);
    await s.page.selectOption('#csv-delimiter', '');
    await waitTable(x => x.length === 2 && x[0].length === 2 && x[0][0] === 'lápis');
  });

  test('TSV uses the tab; without a header the first row becomes data', async () => {
    await openInTree(s.page, 'tabela.tsv');
    await ev(`editor.setValue(${JSON.stringify(TSV)})`);
    expect(await waitTable(x => x.length === 2 && x[0][0] === '1')).toEqual([['1', '2'], ['3', '4']]);
    expect(await header()).toEqual(['a', 'b']);
    await s.page.uncheck('#csv-header');
    expect(await waitTable(x => x.length === 3 && x[0][0] === 'a')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
    await s.page.check('#csv-header');
    await waitTable(x => x.length === 2);
  });

  test('cells with HTML and script go in as text and run nothing', async () => {
    await s.page.evaluate(() => { (window as any).__title = document.title; });
    await openInTree(s.page, 'perigo.csv');
    const t = await waitTable(x => x.length === 1 && x[0][0].includes('<img'));
    expect(t[0][0]).toContain('<img');
    expect(t[0][1]).toContain('<script>');
    await s.page.waitForTimeout(500);
    const title = await s.page.evaluate(() => [document.title, (window as any).__title]);
    expect(title[0]).toBe(title[1]);
    expect(await (await frame()).evaluate(() => document.querySelectorAll('table img, table script').length)).toBe(0);
    expect(await s.page.locator('#csv-preview-frame').getAttribute('sandbox')).toBe('allow-scripts');
  });

  test('big file shows 2000 rows and the "show more" button reveals the rest', async () => {
    await openInTree(s.page, 'grande.csv');
    expect((await waitTable(x => x.length === 2000)).length).toBe(2000);
    expect(await s.page.locator('#csv-info').textContent()).toContain('2500 rows');
    await (await frame()).click('button.more');
    expect((await waitTable(x => x.length === 2500)).length).toBe(2500);
  });

  test('empty file shows a notice', async () => {
    // after the big table the tree may redraw between click and release; retry until it switches
    await poll(async () => {
      await s.page.locator('#file-tree .tree-row', { hasText: 'vazio.csv' }).first().click();
      await s.page.waitForTimeout(500);
      return ev<string>('currentFileId');
    }, f => f === 'vazio.csv', 20000);
    await poll(async () => (await (await frame()).evaluate(() => document.querySelector('.msg')?.textContent || '')), v => v.includes('Empty'), 20000);
  });

  test('copies the table as tabular (LaTeX escapes, numeric columns on the right)', async () => {
    await s.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openInTree(s.page, 'dados.csv');
    await ev(`editor.setValue(${JSON.stringify('item,valor\nA & B,10\nx_y 50%,2\n')})`);
    await waitTable(x => x.length === 2);
    await s.page.click('#csv-copy');
    const text = await poll(() => s.page.evaluate(() => navigator.clipboard.readText()), v => v.includes('tabular'), 10000);
    expect(text).toContain('\\begin{tabular}{lr}');
    expect(text).toContain('item & valor \\\\');
    expect(text).toContain('A \\& B & 10 \\\\');
    expect(text).toContain('x\\_y 50\\% & 2 \\\\');
    expect(text).toContain('\\end{tabular}');
  });

  test('going back to a .tex removes the tab', async () => {
    await openInTree(s.page, 'main.tex');
    expect(await s.page.locator('#tab-preview-btn').isVisible()).toBe(false);
    expect(await s.page.locator('#csv-bar').isVisible()).toBe(false);
  });
});
