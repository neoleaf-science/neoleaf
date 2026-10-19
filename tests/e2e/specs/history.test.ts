import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, poll, type Session } from '../helpers';

// History modal: all project files on the left; choosing one shows its changes and the differences.
describe('change history of all files', () => {
  let s: Session;
  const ev = (code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<any>;
  const names = () => s.page.locator('#history-files .hist-file').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.path));

  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('the left column lists all files and starts with the open file', async () => {
    await ev(`BrowserGit.writeFile('main.tex', editor.getValue() + '\\n% local change')`); // not committed yet
    await ev('openHistory()');
    await s.page.waitForSelector('#history-files .hist-file');
    expect(await names()).toEqual(expect.arrayContaining(['main.tex', 'references.bib']));
    expect(await s.page.locator('#history-files .hist-file.active').getAttribute('data-path')).toBe('main.tex');
    expect(await s.page.locator('#history-file').textContent()).toBe('main.tex');
    // the dot marks the file with a change not committed yet
    expect(await s.page.locator('#history-files .hist-file[data-path="main.tex"] .hist-file-dot').count()).toBe(1);
    expect(await s.page.locator('#history-files .hist-file[data-path="references.bib"] .hist-file-dot').count()).toBe(0);
    await poll(() => s.page.locator('#history-list .hist-item').count(), n => n >= 1, 30000);
  });

  test('choosing another file shows its changes and differences', async () => {
    await s.page.click('#history-files .hist-file[data-path="references.bib"]');
    expect(await s.page.locator('#history-file').textContent()).toBe('references.bib');
    expect(await s.page.locator('#history-files .hist-file.active').getAttribute('data-path')).toBe('references.bib');
    await poll(() => s.page.locator('#history-list .hist-item').count(), n => n >= 1, 30000);
    const diff = await poll(() => ev(`historyDiffEditor ? historyDiffEditor.getModifiedEditor().getValue() : ''`), t => t.includes('@article'), 30000);
    expect(diff).toContain('einstein1905');
    expect(diff).not.toContain('documentclass'); // it is the .bib text, not the .tex one (the cache is per file)
  });

  test('the filter reduces the list of files', async () => {
    await s.page.fill('#history-filter', 'bib');
    expect(await poll(names, n => n.length === 1, 10000)).toEqual(['references.bib']);
    await s.page.fill('#history-filter', 'zzz-nothing');
    await s.page.waitForSelector('#history-files .hist-empty');
    expect(await s.page.locator('#history-files .hist-file').count()).toBe(0);
    expect(await s.page.locator('#history-files .hist-empty').textContent()).toContain('No file');
    await s.page.fill('#history-filter', '');
    expect((await poll(names, n => n.length >= 2, 10000)).length).toBeGreaterThanOrEqual(2);
  });

  test('restoring a version of another file opens that file and applies the text', async () => {
    s.page.once('dialog', d => d.accept());
    await s.page.click('#history-toolbar button:has-text("Restore")');
    await poll(() => ev('currentFileId'), v => v === 'references.bib', 20000);
    expect(await ev(`editor.getValue().includes('einstein1905')`)).toBe(true);
    expect(await s.page.locator('#history-modal').evaluate(e => getComputedStyle(e).display)).toBe('none');
  });
});
