import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, DEMO_PROJECT, fake, newSession, type Session } from '../helpers';

const LONG = 'dissertacao___test_smells_in_dart_projects__an_empirical_study_and_a_validated_catalog_proposal__ero';

// The project table has to fit the screen at every width, with the worst rows: a very long name without spaces, a title,
// a shared project, and a local copy with its size, the unsent mark and the Clear button.
describe('project list: the table fits', () => {
  let s: Session;
  beforeAll(async () => {
    s = await newSession();
    fake.seedRepo('demo', LONG, { 'main.tex': '\\documentclass{article}\\begin{document}x\\end{document}' }, ['neoleaf']);
    fake.setDescription('demo', LONG, 'NeoLeaf: A title that is long enough to need more than one line in the first column of the table');
  });
  afterAll(async () => { await s.context.close(); });

  for (const width of [1857, 1500, 1280, 1100, 900, 800]) {
    test(`at ${width}px nothing sticks out and the action buttons are inside the screen`, async () => {
      await s.page.setViewportSize({ width, height: 900 });
      await s.page.goto(BASE_URL + '/');
      await s.page.waitForSelector('.pl-row');
      // the worst case of the local copy cell, as the script paints it
      await s.page.evaluate(() => {
        document.querySelectorAll('.pl-row .pl-local').forEach(c => {
          c.innerHTML = '<span class="pl-local-yes">● In this browser</span><span class="pl-local-size">149 MB</span><span class="pl-local-unsent">Unsent changes</span><button class="btn pl-local-clear">Clear</button>';
        });
      });
      const r = await s.page.evaluate(() => {
        const main = document.querySelector('.pl-main') as HTMLElement;
        const table = document.querySelector('.pl-table') as HTMLElement;
        const acts = Array.from(document.querySelectorAll('.pl-row .pl-actions button, .pl-row .pl-actions a')).map(e => Math.round(e.getBoundingClientRect().right));
        const clears = Array.from(document.querySelectorAll('.pl-local-clear')).map(e => Math.round(e.getBoundingClientRect().right));
        return { tableW: Math.round(table.getBoundingClientRect().width), mainW: Math.round(main.clientWidth), pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, inner: window.innerWidth, acts, clears };
      });
      expect(r.pageScroll, `${width}px: no horizontal scroll of the page`).toBeLessThanOrEqual(0);
      expect(r.tableW, `${width}px: table no wider than its container`).toBeLessThanOrEqual(r.mainW);
      if (width > 760) {
        expect(r.acts.length, 'the pencil and the trash are there').toBeGreaterThan(0);
        expect(Math.max(...r.acts), `${width}px: the action buttons are inside the screen`).toBeLessThanOrEqual(r.inner);
        expect(Math.max(...r.clears), `${width}px: the Clear button is inside the screen`).toBeLessThanOrEqual(r.inner);
      }
    });
  }

  test('the relative time reads correctly in the singular too (was "há 1 daa")', async () => {
    await s.page.setViewportSize({ width: 1300, height: 900 });
    await s.page.goto(BASE_URL + '/');
    const t = await s.page.evaluate(async () => {
      const w = window as any; await w.LDI18n.setLang('pt');
      const out = [w.T('1 day ago'), w.T('3 days ago'), w.T('1 hour ago'), w.T('1 month ago'), w.T('1 year ago')];
      await w.LDI18n.setLang('en');
      return out;
    });
    expect(t).toEqual(['há 1 dia', 'há 3 dias', 'há 1 hora', 'há 1 mês', 'há 1 ano']);
  });
});
