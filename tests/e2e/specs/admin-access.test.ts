import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, COMMON, getBrowser, newSession, type Session } from '../helpers';

// Access to the administration panel lives in the user modal (no longer in the projects top bar) and only for administrators.
describe('administration panel access', () => {
  let admin: Session;
  beforeAll(async () => { admin = await newSession(); });
  afterAll(async () => { await admin.context.close(); });

  test('administrator: no button in the bar; the user modal has the link and it works', async () => {
    await admin.page.goto(`${BASE_URL}/`);
    expect(await admin.page.locator('.top-bar-right a[href="/admin"]').count()).toBe(0);
    await admin.page.evaluate(() => (window as any).openUserProfileModal());
    const link = admin.page.locator('#user-profile-modal #upm-btn-admin');
    expect(await link.count()).toBe(1);
    expect(await link.getAttribute('href')).toBe('/admin');
    await link.click();
    await admin.page.waitForURL(/\/admin$/);
    expect(await admin.page.locator('#tabbtn-models').count()).toBe(1);
    // system version at the top of the page (the one from Cargo.toml)
    expect(await admin.page.locator('.admin-title-area h1 .version-badge').textContent()).toMatch(/^v\d+\.\d+\.\d+$/);
    // TeX Live package cache card: how many, how much space, up to how much and when the last one came in
    const cache = await admin.page.locator('.meta-item:has-text("TeX Live package cache") .meta-val').textContent();
    expect(cache).toMatch(/^\d+ packages, [\d.]+ (MB|GB) of [\d.]+ (MB|GB) · last: /);
  });

  test('regular person: the modal shows no link and /admin is denied', async () => {
    const ctx = await (await getBrowser()).newContext();
    await ctx.addCookies([{ name: 'latex_session', value: COMMON.sid, url: BASE_URL }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.evaluate(() => (window as any).openUserProfileModal());
    expect(await page.locator('#upm-btn-admin').count()).toBe(0);
    expect(await page.locator('a[href="/admin"]').count()).toBe(0);
    await page.goto(`${BASE_URL}/admin`);
    expect(await page.locator('#tabbtn-models').count()).toBe(0);
    await ctx.close();
  });
});
