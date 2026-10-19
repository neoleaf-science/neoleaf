import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, type Session } from '../helpers';

// The sidebar has a horizontal bar between the files and the outline (sections), draggable like the vertical ones.
describe('bar between files and outline (sections)', () => {
  let s: Session;
  const outlineH = () => s.page.evaluate(() => document.getElementById('outline-list')!.offsetHeight);
  const treeH = () => s.page.evaluate(() => document.getElementById('file-tree')!.offsetHeight);

  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('dragging up grows the outline and shrinks the files', async () => {
    const before = { o: await outlineH(), t: await treeH() };
    const box = (await s.page.locator('#split-outline').boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await s.page.mouse.move(x, y);
    await s.page.mouse.down();
    await s.page.mouse.move(x, y - 90, { steps: 8 });
    await s.page.mouse.up();
    const after = { o: await outlineH(), t: await treeH() };
    expect(after.o).toBeGreaterThan(before.o + 60);
    expect(after.t).toBeLessThan(before.t);
  });

  test('the files never get smaller than the minimum, even when dragging to the top', async () => {
    const box = (await s.page.locator('#split-outline').boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await s.page.mouse.move(x, y);
    await s.page.mouse.down();
    await s.page.mouse.move(x, 5, { steps: 10 });
    await s.page.mouse.up();
    expect(await treeH()).toBeGreaterThanOrEqual(95);
  });

  test('the height is remembered after reloading', async () => {
    const h = await outlineH();
    await s.page.reload();
    await s.page.waitForSelector('#split-outline');
    expect(Math.abs((await outlineH()) - h)).toBeLessThanOrEqual(2);
  });

  test('double click restores the default size and the arrow keys adjust it', async () => {
    await s.page.dblclick('#split-outline');
    expect(await outlineH()).toBeLessThanOrEqual(200); // back to the default maximum (200 px)
    await s.page.locator('#split-outline').focus();
    const base = await outlineH();
    await s.page.keyboard.press('ArrowUp');
    expect(await outlineH()).toBeGreaterThanOrEqual(base); // with no sections the content is short, but the set height grows
    expect(await s.page.evaluate(() => document.getElementById('outline-list')!.style.height)).not.toBe('');
    await s.page.keyboard.press('Home');
    expect(await s.page.evaluate(() => document.getElementById('outline-list')!.style.height)).toBe('');
  });
});
