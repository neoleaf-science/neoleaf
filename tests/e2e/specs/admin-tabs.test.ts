import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, type Session } from '../helpers';

// Admin panel: the users list and the blocked list live in the "Users" tab, between "Overview" and "Templates".
describe('admin panel tabs', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await s.page.goto(`${BASE_URL}/admin`); await s.page.waitForSelector('.admin-tabs'); });
  afterAll(async () => { await s.context.close(); });

  test('tabs appear in the order Overview, Users and Templates', async () => {
    const tabs = await s.page.locator('.admin-tabs .admin-tab').allTextContents();
    expect(tabs.map(t => t.replace(/^\S+\s/, ''))).toEqual(['Overview', 'Users', 'Templates']);
  });

  test('the users list is not in the overview, only in the Users tab', async () => {
    expect(await s.page.locator('#users-tbody').isVisible()).toBe(false);
    expect(await s.page.locator('#blocked-box').isVisible()).toBe(false);
    await s.page.click('#tabbtn-users');
    expect(await s.page.locator('#users-tbody').isVisible()).toBe(true);
    expect(await s.page.locator('#blocked-box').isVisible()).toBe(true);
    expect(await s.page.locator('#users-tbody tr', { hasText: 'demo@neoleaf.local' }).count()).toBeGreaterThanOrEqual(1); // one row per provider when another spec signed in through Codeberg
    expect(await s.page.locator('#tab-overview').isVisible()).toBe(false);
    expect(await s.page.locator('#tabbtn-users').getAttribute('class')).toContain('active');
  });

  test('the chosen tab is kept after reloading the page', async () => {
    await s.page.reload();
    await s.page.waitForSelector('#users-tbody', { state: 'visible' });
    await s.page.click('#tabbtn-overview');
    await s.page.reload();
    await s.page.waitForSelector('#count-peers', { state: 'visible' });
    expect(await s.page.locator('#users-tbody').isVisible()).toBe(false);
  });
});
