import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, type Session } from '../helpers';

describe('project map (real clicks)', () => {
  let s: Session;
  beforeAll(async () => {
    s = await newSession();
    await openProject(s.page);
    await s.page.evaluate(async () => {
      const B = (window as any).BrowserGit;
      const main = '\\documentclass{article}\n\\begin{document}\n\\section{First}\n\\input{sessions/b}\n\\section{Second}\n\\end{document}\n';
      await B.writeFile('main.tex', main);
      (globalThis as any).eval('editor').setValue(main);
      await B.writeFile('loose.tex', '\\section{Loose draft}\n');
      await B.writeFile('sessions/b.tex', '\\subsection{Sub of B}\n\n\\subsubsection{Deep}\nText\n');
      await (window as any).FT.refreshFromBrowserGit();
    });
    await s.page.click('#tab-map-btn');
    await s.page.waitForSelector('#mm-svg .mm-node', { timeout: 15000 });
  });
  afterAll(async () => { await s.context.close(); });

  const nodes = () => s.page.locator('#mm-svg .mm-node').count();

  test('"Not included" starts off and the checkbox turns it on', async () => {
    const has = () => s.page.locator('#mm-svg .mm-node:has-text("Not included")').count();
    expect(await s.page.isChecked('#mm-orph')).toBe(false);
    expect(await has()).toBe(0);
    await s.page.check('#mm-orph');
    expect(await has()).toBe(1);
    await s.page.uncheck('#mm-orph');
    expect(await has()).toBe(0);
  });

  test('clicking the circle collapses and expands the branch', async () => {
    await s.page.waitForFunction(() => document.querySelectorAll('#mm-svg .mm-node').length >= 4);
    const before = await nodes();
    await s.page.locator('#mm-svg .mm-node:has-text("First") .mm-toggle').click();
    expect(await nodes()).toBeLessThan(before);
    await s.page.locator('#mm-svg .mm-node:has-text("First") .mm-toggle').click();
    expect(await nodes()).toBe(before);
  });

  test('clicking a node opens the file and the section line', async () => {
    await s.page.locator('#mm-svg .mm-node:has-text("Sub of B") .mm-box').click();
    await s.page.waitForFunction(() => (globalThis as any).eval('currentFileId') === 'sessions/b.tex', null, { timeout: 10000 });
    await s.page.waitForFunction(() => (globalThis as any).eval('editor').getPosition().lineNumber === 1, null, { timeout: 10000 });
  });

  test('dragging the map does not trigger a click on the node', async () => {
    await s.page.locator('#mm-svg .mm-node:has-text("Second") .mm-box').scrollIntoViewIfNeeded();
    const box = (await s.page.locator('#mm-svg .mm-node:has-text("Second") .mm-box').boundingBox())!;
    await s.page.mouse.move(box.x + 4, box.y + 4);
    await s.page.mouse.down();
    await s.page.mouse.move(box.x + 60, box.y + 40, { steps: 6 });
    await s.page.mouse.up();
    expect(await s.page.evaluate(() => (globalThis as any).eval('currentFileId'))).toBe('sessions/b.tex');
  });
});
