import { afterAll, describe, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { editorValue, newSession, openInTree, openProject, poll, type Session } from '../helpers';

// Complete and normalize .bib entries from their DOI. The registries are simulated: the tests count what is asked and check that only the DOI leaves the browser.

let s: Session;
const asked: string[] = [];
afterAll(async () => { await s?.context.close(); });

const WORK = {
  message: {
    DOI: '10.1234/Good.One', title: ['A Study of Pulses'], author: [{ given: 'Ada', family: 'Lovelace' }, { given: 'Alan', family: 'Turing' }],
    issued: { 'date-parts': [[2020]] }, 'container-title': ['Journal of Tests'], type: 'journal-article', volume: '5', issue: '2', page: '12-15',
    publisher: 'Test Press', URL: 'https://doi.org/10.1234/good.one',
  },
};

const setText = (page: Page, text: string) => page.evaluate(t => { (globalThis as any).eval('editor').setValue(t); }, text);
const runAction = (page: Page, id: string) => page.evaluate(i => (globalThis as any).eval(`editor.getAction('${i}').run()`), id);

describe('complete .bib by DOI', () => {
  test('the entry reader finds fields in braces, quotes and bare values, and leaves comments and strings alone', async () => {
    s = await newSession();
    await s.context.route(/api\.(crossref|openalex)\.org\//, async route => {
      const url = decodeURIComponent(route.request().url());
      asked.push(url);
      if (/good\.one/i.test(url) && url.includes('crossref')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WORK) });
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await openProject(s.page);
    const entries = await s.page.evaluate(() => (window as any).BibComplete.parseEntries(
      '@comment{ignore me @article{x, a={b}}}\n@string{s = "x"}\n@article{k1,\n  title = {A {nested} title},\n  year = 2020,\n  note = "quoted, with comma",\n  month = jan # "x"\n}\n@book(k2, title={B})\n'));
    expect(entries.map((e: any) => e.key)).toEqual(['k1', 'k2']);
    expect(entries[0].fields.map((f: any) => f.name)).toEqual(['title', 'year', 'note', 'month']);
    expect(entries[0].fields[0].value).toBe('A {nested} title');
    expect(entries[0].fields[1].value).toBe('2020');
    expect(entries[0].fields[2].value).toBe('quoted, with comma');
    expect(entries[0].fields[3].concat).toBe(true);
  }, 120000);

  test('missing fields are added, a different value is only offered, pages are normalized', async () => {
    await openInTree(s.page, 'references.bib');
    await setText(s.page, '@article{lovelace,\n  title = {My own title},\n  pages = {12-15},\n  doi = {https://doi.org/10.1234/good.one},\n  url = {https://doi.org/10.1234/good.one}\n}\n\n% a comment\n@misc{nodoi,\n  title = {No DOI here}\n}\n\n@article{gone,\n  doi = {10.9999/not.there}\n}\n');
    asked.length = 0;
    await runAction(s.page, 'ld.bib-complete-all');
    await s.page.waitForSelector('#bibc-modal .bibc-entry');
    const rows = await s.page.$$eval('#bibc-modal .bibc-row', rs => rs.map(r => ({ key: (r.querySelector('input') as HTMLInputElement).dataset.key, field: (r.querySelector('input') as HTMLInputElement).dataset.field, checked: (r.querySelector('input') as HTMLInputElement).checked, kind: r.className.replace('bibc-row bibc-', '') })));
    const by = (f: string) => rows.find((r: any) => r.key === 'lovelace' && r.field === f) as any;
    expect(by('journal')).toMatchObject({ checked: true, kind: 'add' });
    expect(by('volume')).toMatchObject({ checked: true, kind: 'add' });
    expect(by('author')).toMatchObject({ checked: true, kind: 'add' });
    expect(by('title')).toMatchObject({ checked: false, kind: 'change' }); // my title differs: not replaced unless ticked
    expect(by('pages')).toMatchObject({ checked: true, kind: 'normalize' });
    expect(by('doi')).toMatchObject({ checked: true, kind: 'normalize' });
    expect(by('url')).toMatchObject({ checked: true, kind: 'remove' });
    const skipped = await s.page.innerText('#bibc-modal .bibc-skipped');
    expect(skipped).toContain('nodoi');
    expect(skipped).toContain('gone');
    // only DOIs were asked for, once each, and nothing of the project text left the browser
    expect(asked.every(u => /\/works\/10\.\d+\/|\/works\/doi:10\./.test(u))).toBe(true);
    expect(asked.some(u => /My own title|No DOI here/.test(u))).toBe(false);
  }, 60000);

  test('Apply edits only the ticked fields in place and keeps the layout, the comment and the key', async () => {
    await s.page.click('#bibc-modal input[data-key="lovelace"][data-field="title"]'); // also replace the title
    await s.page.click('#bibc-apply');
    const text = await poll(() => editorValue(s.page), t => t.includes('journal ='));
    expect(text).toContain('@article{lovelace,');
    expect(text).toContain('journal = {Journal of Tests}');
    expect(text).toContain('author = {Lovelace, Ada and Turing, Alan}');
    expect(text).toContain('pages = {12--15}');
    expect(text).toContain('doi = {10.1234/good.one}');
    expect(text).not.toContain('url = {https://doi.org');
    expect(text).toContain('title = {{A Study of Pulses}}'); // replaced because it was ticked
    expect(text).toContain('% a comment');
    expect(text).toContain('@misc{nodoi,\n  title = {No DOI here}\n}');
    expect(await s.page.isVisible('#bibc-modal')).toBe(false);
  }, 60000);

  test('the entry under the cursor only: nothing is offered for a complete entry', async () => {
    await setText(s.page, '@article{done,\n  author = {Lovelace, Ada and Turing, Alan},\n  title = {{A Study of Pulses}},\n  journal = {Journal of Tests},\n  year = {2020},\n  volume = {5},\n  number = {2},\n  pages = {12--15},\n  publisher = {Test Press},\n  doi = {10.1234/good.one}\n}\n');
    await s.page.evaluate(() => (globalThis as any).eval('editor.setPosition({lineNumber: 3, column: 5})'));
    await runAction(s.page, 'ld.bib-complete');
    await s.page.waitForSelector('#bibc-modal .bibc-empty');
    expect(await s.page.isDisabled('#bibc-apply')).toBe(true);
    await s.page.click('#bibc-modal .btn:not(.btn-primary)');
    expect(await s.page.isVisible('#bibc-modal')).toBe(false);
  }, 60000);

  test('an entry with an empty or missing field list gets the new fields after its key', async () => {
    const out = await s.page.evaluate(async () => {
      const B = (window as any).BibComplete;
      const text = '@article{lonely,\n}\n';
      const entries = B.parseEntries(text);
      const rows = [{ entry: entries[0], source: '', changes: [{ field: 'year', kind: 'add', before: '', after: '2021', checked: true }] }];
      const edits = B.buildEdits(text, rows).sort((a: any, b: any) => b.start - a.start);
      let t = text;
      for (const e of edits) t = t.slice(0, e.start) + e.text + t.slice(e.end);
      return t;
    });
    expect(out).toBe('@article{lonely,\n  year = {2021},\n}\n');
  }, 30000);
});
