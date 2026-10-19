import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { BASE_URL, newSession, poll, type Session } from '../helpers';

// Project trash: deleting renames with date/time and adds the #deleted tag; the "Trash" view lists and restores.
describe('project trash', () => {
  let s: Session;
  let id = '';        // project created only for these tests (the demo article is used by other specs)
  let trashedId = '';
  const dialogs: string[] = [];
  const visibleRows = (page: Page) => page.locator('#pl-body .pl-row:visible');
  const api = (path: string) => s.page.evaluate(async p => (await fetch(p, { method: 'POST' })).json(), path);

  beforeAll(async () => {
    s = await newSession();
    s.page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await s.page.goto(BASE_URL + '/'); // the fetch below needs a page of the site
    const created = await s.page.evaluate(async () => (await fetch('/api/project/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'e2e-trash', template: 'article' }) })).json());
    id = created.id;
    expect(id).toBe('demo__e2e-trash');
  });
  afterAll(async () => { await s.context.close(); });

  const dashboard = async () => { await s.page.goto(BASE_URL + '/'); await s.page.waitForSelector('#pl-body'); };

  test('the dashboard shows the delete button and the trash starts with the right counter', async () => {
    await dashboard();
    await expect(visibleRows(s.page).filter({ hasText: 'e2e-trash' }).count()).resolves.toBe(1);
    await expect(s.page.locator(`#proj-row-${id} .pl-action-danger`).count()).resolves.toBe(1);
    const before = Number(await s.page.locator('#pl-trash-count').textContent());
    expect(before).toBeGreaterThanOrEqual(0);
  });

  test('confirming in the modal sends the project to the trash, with date/time in the name and the deleted tag', async () => {
    const t0 = Date.now();
    await s.page.locator(`#proj-row-${id} .pl-action-danger`).click();
    await s.page.waitForSelector('#delete-modal', { state: 'visible' });
    expect(await s.page.locator('#delete-modal-name').textContent()).toContain('e2e-trash');
    await s.page.click('#delete-confirm');
    // reloads already in the Trash view
    await s.page.waitForFunction(() => document.querySelector('.pl-main h1')?.textContent === 'Trash');
    const row = visibleRows(s.page).filter({ hasText: 'e2e-trash' });
    await expect(row.count()).resolves.toBe(1);
    trashedId = (await row.first().getAttribute('data-id'))!;
    const m = trashedId.match(/^demo__e2e-trash-deleted-(\d{8})-(\d{6})$/);
    expect(m).not.toBeNull();
    // the date/time in the name (UTC) is the current one
    const d = m![1], t = m![2];
    const stamp = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
    expect(Math.abs(stamp - t0)).toBeLessThan(2 * 60 * 1000);
    // #deleted tag visible, restore action and name shown without the suffix
    expect(await row.first().textContent()).toContain('#deleted');
    expect(await row.first().locator('.pl-title-text').textContent()).toContain('e2e-trash');
    await expect(row.first().locator('text=Restore').count()).resolves.toBe(1);
  });

  test('the project leaves the normal list and the trash counter goes up', async () => {
    await dashboard();
    await expect(visibleRows(s.page).filter({ hasText: 'e2e-trash' }).count()).resolves.toBe(0);
    expect(Number(await s.page.locator('#pl-trash-count').textContent())).toBeGreaterThanOrEqual(1);
    // the #deleted tag does not show in the tag bar of the normal view, only in the trash one
    expect(await s.page.locator('#pl-tag-bar').textContent()).not.toContain('#deleted');
    await s.page.click('#pl-nav-trash');
    await expect(visibleRows(s.page).filter({ hasText: 'e2e-trash' }).count()).resolves.toBe(1);
    expect(await s.page.locator('#pl-tag-bar').textContent()).toContain('#deleted');
    // the other projects do not show in the trash
    await expect(visibleRows(s.page).filter({ hasText: 'artigo-1' }).count()).resolves.toBe(0);
  });

  test('clicking a trash row does not open the project', async () => {
    await visibleRows(s.page).filter({ hasText: 'e2e-trash' }).first().locator('.pl-title-text').click();
    await Bun.sleep(300);
    expect(new URL(s.page.url()).pathname).toBe('/');
  });

  test('searching #deleted in the trash finds the project', async () => {
    await s.page.fill('#pl-search', '#deleted');
    await expect(visibleRows(s.page).filter({ hasText: 'e2e-trash' }).count()).resolves.toBe(1);
    await s.page.fill('#pl-search', '');
  });

  test('deleting again or restoring a project outside the trash is refused', async () => {
    expect((await api(`/api/project/${trashedId}/delete`)).error).toContain('already in the trash');
    expect((await api(`/api/project/demo__artigo-1/restore`)).error).toContain('not in the trash');
  });

  test('restoring gives back the original name and removes the tag', async () => {
    await visibleRows(s.page).filter({ hasText: 'e2e-trash' }).first().locator('text=Restore').click();
    await poll(() => Promise.resolve(dialogs.some(d => d.includes('Restore'))), ok => ok, 5000);
    await s.page.waitForFunction(() => document.querySelector('.pl-main h1')?.textContent === 'All projects');
    const row = visibleRows(s.page).filter({ hasText: 'e2e-trash' });
    await expect(row.count()).resolves.toBe(1);
    expect(await row.first().getAttribute('data-id')).toBe(id);
    expect(await row.first().textContent()).not.toContain('#deleted');
    await s.page.click('#pl-nav-trash');
    await expect(visibleRows(s.page).filter({ hasText: 'e2e-trash' }).count()).resolves.toBe(0);
  });

  test('the restored project opens normally in the editor', async () => {
    await s.page.goto(`${BASE_URL}/project/${id}`);
    await s.page.waitForSelector('.monaco-editor');
  });

  test('restoring with the original name taken is refused', async () => {
    const first = await api(`/api/project/${id}/delete`);
    expect(first.success).toBe(true);
    // creates another project with the same original name and tries to restore the first one
    const again = await s.page.evaluate(async () => (await fetch('/api/project/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'e2e-trash', template: 'article' }) })).json());
    expect(again.id).toBe(id);
    const r = await api(`/api/project/${first.id}/restore`);
    expect(r.error).toContain('already exists');
  });

  test('no unhandled console errors', () => {
    expect(s.errors).toEqual([]);
  });
});
