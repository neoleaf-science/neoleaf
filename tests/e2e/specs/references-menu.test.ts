import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { fake, newSession, openInTree, openProject, poll, type Session } from '../helpers';

// Editor menu tied to the References tab: selected text, selected DOI, citation key and actions inside a .bib.
describe('references: editor menu', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const ok = (id: string) => ev<boolean>(`editor.getAction('${id}').isSupported()`);
  const run = (id: string) => ev<void>(`editor.getAction('${id}').run()`);
  const select = (line: number, from: number, to: number) => ev(`editor.setSelection({ startLineNumber: ${line}, startColumn: ${from}, endLineNumber: ${line}, endColumn: ${to} })`);
  const cursor = (line: number, col: number) => ev(`editor.setPosition({ lineNumber: ${line}, column: ${col} })`);
  const CORS = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  const DOI = '10.1000/novo.2024';
  const has = (text: string) => s.page.locator('.refs-toast', { hasText: text });

  const TEX = ['\\documentclass{article}', '\\begin{document}', 'Deep learning for smells.', `DOI: ${DOI}`, 'See \\cite{existing2020} and \\cite{a,other2021}.', '\\bibliography{refs}', '\\end{document}', ''].join('\n');
  const BIB = [
    '@article{existing2020,', '  author = {Duplicate, Dora},', '  title = {{Paper \\& that {already} exists}},', '  booktitle = {Other},', '  year = {2020},', '  doi = {10.1000/dup}', '}', '',
    '@misc{other2021,', '  title = "No doi",', '  url = {https://doi.org/10.5555/via.url}', '}', '',
  ].join('\n');

  beforeAll(async () => {
    fake.seedRepo('demo', 'refs-menu', { 'main.tex': TEX, 'refs.bib': BIB }, ['neoleaf']);
    s = await newSession();
    for (const h of ['api.crossref.org', 'api.unpaywall.org']) await s.page.route(new RegExp('^https://' + h.replace(/\./g, '\\.') + '/'), r => r.fulfill({ status: 500, headers: CORS, body: '{}' }));
    await s.page.route(/^https:\/\/api\.crossref\.org\//, r => r.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ message: { DOI: DOI, title: ['Deep Learning Revisited'], author: [{ given: 'Eva', family: 'Nunes' }], issued: { 'date-parts': [[2024]] }, 'container-title': ['New Journal'], type: 'journal-article' } }) }));
    await s.page.route(/^https:\/\/api\.unpaywall\.org\//, r => r.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ is_oa: true, best_oa_location: { url_for_pdf: 'https://example.org/open.pdf' } }) }));
    await openProject(s.page, 'demo__refs-menu');
    // does not open real windows: keeps the addresses
    await s.page.evaluate(() => { (window as any).__opened = []; window.open = ((u: string) => { (window as any).__opened.push(u); return null; }) as any; });
  });
  afterAll(async () => { await s.context.close(); });

  test('selected text: "Search references" only shows with a selection and opens the tab already searching', async () => {
    await openInTree(s.page, 'main.tex');
    await cursor(3, 5);
    expect(await ok('ld.refs')).toBe(false);
    await select(3, 1, 14);   // "Deep learning"
    expect(await ok('ld.refs')).toBe(true);
    await run('ld.refs');
    await s.page.waitForSelector('#refs-q');
    expect(await s.page.locator('#refs-q').inputValue()).toBe('Deep learning');
    expect(await ev<string>('pdfTab')).toBe('refs');
    await poll(() => s.page.locator('.refs-status').count(), n => n > 0, 20000);
  });

  test('the "Open the References tab" action exists and has the Ctrl+Alt+R shortcut', async () => {
    await s.page.click('#tab-pdf-btn');
    await cursor(3, 5);
    expect(await ok('ld.refs-open')).toBe(true);
    await run('ld.refs-open');
    await s.page.waitForSelector('#refs-q');
    expect(await ev<string>('pdfTab')).toBe('refs');
    await openInTree(s.page, 'main.tex');
    await s.page.click('#tab-pdf-btn');
    await ev(`editor.focus()`);
    await s.page.keyboard.press('Control+Alt+KeyR');
    await poll(() => ev<string>('pdfTab'), v => v === 'refs', 10000);
  });

  test('selected DOI: offers add by DOI and open the DOI; plain text does not', async () => {
    await openInTree(s.page, 'main.tex');
    await select(4, 6, 6 + DOI.length);
    expect(await ok('ld.refs-doi-add')).toBe(true);
    expect(await ok('ld.refs-doi-open')).toBe(true);
    await select(3, 1, 12);
    expect(await ok('ld.refs-doi-add')).toBe(false);
    expect(await ok('ld.refs-doi-open')).toBe(false);
    await select(4, 6, 6 + DOI.length);
    await run('ld.refs-doi-open');
    expect(await ev<string[]>('window.__opened')).toContain('https://doi.org/' + DOI);
  });

  test('"Add this reference by DOI" writes the entry to the .bib and replaces the selected DOI with the \\cite', async () => {
    await select(4, 6, 6 + DOI.length);
    await run('ld.refs-doi-add');
    const bib = await poll(() => ev<string>(`BrowserGit.readFile('refs.bib')`), v => v.includes('nunes2024deep'), 90000).catch(async e => {
      // if it fails, shows what the screen reported (helps find the cause on a loaded machine)
      const notices = await s.page.locator('.refs-toast, .refs-msg').allTextContents().catch(() => []);
      throw new Error(e.message.slice(0, 120) + ' | notices: ' + JSON.stringify(notices) + ' | file: ' + await ev<string>('currentFileId'));
    });
    expect(bib).toContain('@article{nunes2024deep,');
    expect(bib).toContain(`doi = {${DOI}}`);
    await poll(() => ev<string>('currentFileId'), v => v === 'main.tex', 20000);
    const tex = await poll(() => ev<string>(`BrowserGit.readFile('main.tex')`), v => v.includes('\\cite{nunes2024deep}'), 90000);
    expect(tex).toContain('DOI: \\cite{nunes2024deep}');   // the DOI was replaced
    expect(tex).not.toContain(DOI);
  });

  test('citation key: offers go to the entry, open the DOI and look for the open-access PDF', async () => {
    await openInTree(s.page, 'main.tex');
    const line = (await ev<string>('editor.getModel().getValue()')).split('\n').findIndex(l => l.startsWith('See')) + 1;
    await cursor(line, 5);
    expect(await ok('ld.refs-key-go')).toBe(false);   // outside a \cite
    await cursor(line, 14);   // inside "existing2020"
    await poll(() => ok('ld.refs-key-go'), v => v === true, 10000);
    await run('ld.refs-key-doi');
    await poll(() => ev<string[]>('window.__opened'), a => a.includes('https://doi.org/10.1000/dup'), 10000);
    await run('ld.refs-key-pdf');
    await poll(() => ev<string[]>('window.__opened'), a => a.includes('https://example.org/open.pdf'), 10000);
    await run('ld.refs-key-go');
    await poll(() => ev<string>('currentFileId'), v => v === 'refs.bib', 20000);
    expect(await ev<number>('editor.getPosition().lineNumber')).toBe(1);
  });

  test('inside the .bib: the entry actions only appear in .bib and use the entry under the cursor', async () => {
    await openInTree(s.page, 'refs.bib');
    for (const id of ['ld.bib-search', 'ld.bib-doi', 'ld.bib-pdf', 'ld.bib-cite']) expect(await ok(id)).toBe(true);
    expect(await ok('ld.refs')).toBe(false);
    await openInTree(s.page, 'main.tex');
    for (const id of ['ld.bib-search', 'ld.bib-doi', 'ld.bib-pdf', 'ld.bib-cite']) expect(await ok(id)).toBe(false);
  });

  test('.bib: "Search this paper online" uses the title (braces and escapes removed; booktitle does not confuse)', async () => {
    await openInTree(s.page, 'refs.bib');
    await cursor(3, 10);
    await run('ld.bib-search');
    await s.page.waitForSelector('#refs-q');
    expect(await s.page.locator('#refs-q').inputValue()).toBe('Paper & that already exists');
  });

  test('.bib: open the DOI and the open-access PDF (including via the DOI in the url field) and copy the \\cite', async () => {
    await s.page.click('#tab-pdf-btn');
    await openInTree(s.page, 'refs.bib');
    await cursor(3, 10);
    await run('ld.bib-doi');
    expect(await ev<string[]>('window.__opened')).toContain('https://doi.org/10.1000/dup');
    const otherLine = (await ev<string>('editor.getModel().getValue()')).split('\n').findIndex(l => l.includes('other2021')) + 2;
    await cursor(otherLine, 4);
    await run('ld.bib-doi');
    expect(await ev<string[]>('window.__opened')).toContain('https://doi.org/10.5555/via.url');
    await run('ld.bib-pdf');
    await poll(() => ev<string[]>('window.__opened'), a => a.includes('https://example.org/open.pdf'), 10000);
    await s.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await run('ld.bib-cite');
    expect(await poll(() => s.page.evaluate(() => navigator.clipboard.readText()), v => v.includes('cite'), 10000)).toBe('\\cite{other2021}');
  });

  test('.bib: with no cursor inside an entry it warns; and the fields of an entry are read correctly', async () => {
    await cursor(1, 1);
    await ev(`editor.executeEdits('t', [{ range: new monaco.Range(1, 1, 1, 1), text: '% loose comment\\n' }])`);
    await cursor(1, 3);
    await run('ld.bib-cite');
    await has('cursor inside an entry').first().waitFor({ timeout: 10000 });
    const campos = await s.page.evaluate(() => {
      const R = (window as any).References;
      const b = '@article{k, title = {A {B} \\& c}, booktitle = {X}, year = 2020, note = "one \\"two\\"", doi={10.1/x}}';
      return [R.fieldOf(b, 'title'), R.fieldOf(b, 'booktitle'), R.fieldOf(b, 'year'), R.fieldOf(b, 'doi'), R.fieldOf(b, 'journal')];
    });
    expect(campos).toEqual(['A B & c', 'X', '2020', '10.1/x', '']);
  });
});
