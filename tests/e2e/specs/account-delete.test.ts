import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, DELETEE, getBrowser } from '../helpers';

// The person deletes their own account: removes access (the session with the token); does not touch the GitHub repositories.
describe('deleting one\'s own account', () => {
  let ctx: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newContext']>>;
  let page: Awaited<ReturnType<typeof ctx.newPage>>;

  beforeAll(async () => {
    ctx = await (await getBrowser()).newContext({ locale: 'en-US' });
    await ctx.addCookies([{ name: 'latex_session', value: DELETEE.sid, url: BASE_URL }]);
    page = await ctx.newPage();
  });
  afterAll(async () => { await ctx.close(); });

  test('without login the API refuses', async () => {
    const anon = await (await getBrowser()).newContext({ locale: 'en-US' });
    const r = await anon.request.post(`${BASE_URL}/api/account/delete`, { data: { confirm_login: 'anything' } });
    expect((await r.json()).error).toBe('Not signed in');
    await anon.close();
  });

  test('the typed login must match (also on the server)', async () => {
    const r = await page.request.post(`${BASE_URL}/api/account/delete`, { data: { confirm_login: 'someone-else' } });
    expect((await r.json()).error).toContain('does not match');
  });

  test('step 1: shows what is deleted, what is not and the legal basis; only continues after checking the box', async () => {
    await page.goto(`${BASE_URL}/`);
    await page.click('.btn-user-profile');
    await page.waitForSelector('#user-profile-modal', { state: 'visible' });
    await page.click('#upm-delete-account');
    await page.waitForSelector('#delete-account-modal', { state: 'visible' });
    const text = (await page.locator('#dac-step1').innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('What will be deleted');
    expect(text).toContain('GitHub repositories');
    expect(text).toContain('stay exactly as they are');
    expect(text).toContain('art. 18 of the LGPD');
    expect(text).toContain('Marco Civil da Internet');
    expect(await page.locator('#dac-continue').isDisabled()).toBe(true);
    await page.check('#dac-understand');
    expect(await page.locator('#dac-continue').isDisabled()).toBe(false);
  });

  test('step 2: only enables with the right login (case-insensitive) and you can go back', async () => {
    await page.click('#dac-continue');
    await page.waitForSelector('#dac-step2', { state: 'visible' });
    expect(await page.locator('#dac-login').textContent()).toBe('student-delete');
    expect(await page.locator('#dac-confirm').isDisabled()).toBe(true);
    await page.fill('#dac-input', 'wrong-student');
    expect(await page.locator('#dac-confirm').isDisabled()).toBe(true);
    await page.click('#dac-back');
    await page.waitForSelector('#dac-step1', { state: 'visible' });
    await page.click('#dac-continue');
    await page.fill('#dac-input', '@STUDENT-Delete');
    expect(await page.locator('#dac-confirm').isDisabled()).toBe(false);
  });

  test('confirming deletes: returns to the login with the notice and the session vanishes', async () => {
    await page.click('#dac-confirm');
    await page.waitForURL(/\/\?deleted=1$/);
    const banner = (await page.locator('#account-deleted').textContent())!;
    expect(banner).toContain('removed your stored session');
    expect(banner).toContain('repositories were not changed');
    expect(banner).not.toContain('LGPD'); // describes what was done, no legal claim
    // the session is no longer valid
    const profile = await page.evaluate(async () => (await fetch('/api/user/profile')).json());
    expect(profile.error).toBeTruthy();
  });

  test('the same session can no longer use the API', async () => {
    const c2 = await (await getBrowser()).newContext({ locale: 'en-US' });
    await c2.addCookies([{ name: 'latex_session', value: DELETEE.sid, url: BASE_URL }]);
    const r = await c2.request.post(`${BASE_URL}/api/account/delete`, { data: { confirm_login: DELETEE.login } });
    expect((await r.json()).error).toBe('Not signed in');
    await c2.close();
  });
});
