import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, DEMO_PROJECT, newSession, type Session } from '../helpers';

// The sign-out button lives only in the user profile modal, on every page that has the top bar.
describe('sign out inside the profile modal', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); });
  afterAll(async () => { await s.context.close(); });

  for (const [name, path] of [['dashboard', '/'], ['editor', `/project/${DEMO_PROJECT}`], ['admin panel', '/admin']] as const) {
    test(`${name}: no sign-out link in the top bar, one in the profile modal`, async () => {
      await s.page.goto(BASE_URL + path);
      await s.page.waitForSelector('#user-profile-modal', { state: 'attached' });
      expect(await s.page.locator('.top-bar-right a[href="/auth/logout"], header a[href="/auth/logout"]').count()).toBe(0);
      expect(await s.page.locator('#user-profile-modal #upm-btn-logout[href="/auth/logout"]').count()).toBe(1);
      await s.page.evaluate(() => (window as any).openUserProfileModal());
      expect(await s.page.locator('#upm-btn-logout').isVisible()).toBe(true);
    });
  }

  test('clicking it ends the session and goes back to the login page', async () => {
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    await s.page.click('#upm-btn-logout');
    // signing out first deletes this browser's local data, then goes to /auth/logout and lands on the login page
    await s.page.waitForFunction(() => !document.getElementById('user-profile-modal'), null, { timeout: 40000 });
    const res = await s.context.request.get(BASE_URL + '/api/user/profile');
    expect((await res.json()).error).toBeTruthy();
  });
});
