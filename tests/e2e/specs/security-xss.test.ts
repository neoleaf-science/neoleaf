import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, XSSER, newSession, type Session } from '../helpers';

// Text chosen by another person (their GitHub or Codeberg display name) reaches the admin panel. It must stay text.
describe('admin panel: a display name that is an attack', () => {
  let admin: Session;
  beforeAll(async () => { admin = await newSession(); });
  afterAll(async () => { await admin.context.close(); });

  test('the name is shown as text and no script of it runs', async () => {
    await admin.page.goto(`${BASE_URL}/admin`);
    await admin.page.waitForSelector('.admin-tabs');
    await admin.page.click('#tabbtn-users');
    await admin.page.waitForSelector(`#users-tbody tr`);
    const row = admin.page.locator('#users-tbody tr', { hasText: XSSER.login });
    expect(await row.count()).toBe(1);
    expect(await row.textContent()).toContain('</script><script>window.__pwned=1</script>');   // literally, as text
    expect(await admin.page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  });

  test('no script block of the page carries another person\'s data', async () => {
    const html = await (await admin.page.request.get(`${BASE_URL}/admin`)).text();
    expect(html).not.toContain('<script>window.__pwned');   // the name may appear only escaped, as text
    expect(html).toContain('&lt;/script&gt;&lt;script&gt;window.__pwned');
    expect(html).not.toContain('id="init-stats"');
  });
});
