import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BASE_URL, VICTIM, getBrowser, newSession, testWorkDir, type Session } from '../helpers';

// User blocking by the administrator. Here the demo user is an administrator (ADMIN_EMAILS) and there is a second person,
// "student-e2e", with their own session, to be blocked.
describe('user blocking (admin)', () => {
  let admin: Session;
  const dialogs: string[] = [];
  const profileOf = async (sid: string) => {
    const ctx = await (await getBrowser()).newContext();
    await ctx.addCookies([{ name: 'latex_session', value: sid, url: BASE_URL }]);
    const r = await ctx.request.get(`${BASE_URL}/api/user/profile`);
    const body = await r.json();
    await ctx.close();
    return body;
  };
  const adminPage = async () => { await admin.page.goto(`${BASE_URL}/admin`); await admin.page.click('#tabbtn-users'); await admin.page.waitForSelector('#users-tbody', { state: 'visible' }); };
  const blockedRow = (login: string) => admin.page.locator(`#blocked-tbody tr[data-blocked-login="${login}"]`);

  beforeAll(async () => {
    admin = await newSession();
    admin.page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  });
  afterAll(async () => { await admin.context.close(); });

  test('before blocking, the person has a valid session', async () => {
    expect((await profileOf(VICTIM.sid)).login).toBe(VICTIM.login);
  });

  test('a non-administrator cannot block anyone', async () => {
    const ctx = await (await getBrowser()).newContext();
    await ctx.addCookies([{ name: 'latex_session', value: VICTIM.sid, url: BASE_URL }]);
    const r = await ctx.request.post(`${BASE_URL}/api/admin/users/block`, { data: { login: 'anyone' } });
    expect((await r.json()).error).toBe('Access denied');
    await ctx.close();
  });

  test('the list shows the block button on other users, and not on oneself', async () => {
    await adminPage();
    const victimRow = admin.page.locator('#users-tbody tr', { hasText: VICTIM.login });
    await expect(victimRow.locator('.btn-block').count()).resolves.toBe(1);
    const myRow = admin.page.locator('#users-tbody tr', { hasText: 'demo@neoleaf.local' });
    await expect(myRow.locator('.btn-block').count()).resolves.toBe(0);
  });

  test('block through the modal: shows in the blocked list with the reason and disappears from the sessions', async () => {
    await admin.page.locator('#users-tbody tr', { hasText: VICTIM.login }).locator('.btn-block').click();
    await admin.page.waitForSelector('#block-modal', { state: 'visible' });
    expect(await admin.page.locator('#block-modal-name').textContent()).toContain('Student E2E');
    await admin.page.fill('#block-modal-reason', 'tentou acessar projetos alheios');
    await admin.page.click('#block-confirm');
    await admin.page.waitForSelector(`#blocked-tbody tr[data-blocked-login="${VICTIM.login}"]`);
    const row = blockedRow(VICTIM.login);
    expect(await row.textContent()).toContain('tentou acessar projetos alheios');
    expect(await row.textContent()).toContain('by @demo');
    expect(await admin.page.locator('#users-tbody tr', { hasText: VICTIM.login }).count()).toBe(0);
    expect(await admin.page.locator('#blocked-count').textContent()).toBe('1');
  });

  test("the person's session stops being valid right away", async () => {
    expect((await profileOf(VICTIM.sid)).error).toBeTruthy();
  });

  test('the block is saved on disk (blocked.json, 0600)', () => {
    const file = path.join(testWorkDir(), 'blocked.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved.some((b: any) => b.login === VICTIM.login && b.id === VICTIM.id && b.reason.includes('projetos alheios'))).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  test('you cannot block yourself or another administrator', async () => {
    const r = await admin.page.evaluate(async () => (await fetch('/api/admin/users/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo' }) })).json());
    expect(r.error).toContain('yourself');
    const r2 = await admin.page.evaluate(async () => (await fetch('/api/admin/users/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'e2e-other-admin' }) })).json());
    expect(r2.error).toContain('administrator');
    const r3 = await admin.page.evaluate(async () => (await fetch('/api/admin/users/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'login inválido!' }) })).json());
    expect(r3.error).toContain('Invalid login');
  });

  test('block by login (someone who never signed in) and unblock', async () => {
    await adminPage();
    await admin.page.fill('#block-login-input', '@Fulano-Sem-Sessao');
    await admin.page.fill('#block-login-reason', 'visto nos logs');
    await admin.page.click('#block-by-login-form button[type=submit]');
    await admin.page.waitForSelector('#blocked-tbody tr[data-blocked-login="Fulano-Sem-Sessao"]');
    expect(await admin.page.locator('#blocked-count').textContent()).toBe('2');
    // unblocks (the confirm is accepted automatically)
    await blockedRow('Fulano-Sem-Sessao').locator('.btn-unblock').click();
    await admin.page.waitForFunction(() => document.getElementById('blocked-count')?.textContent === '1');
    expect(dialogs.some(d => d.includes('Unblock @Fulano-Sem-Sessao'))).toBe(true);
    expect(await blockedRow('Fulano-Sem-Sessao').count()).toBe(0);
  });

  test('unblocking someone who is not blocked is refused', async () => {
    const r = await admin.page.evaluate(async () => (await fetch('/api/admin/users/unblock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'ninguem-aqui' }) })).json());
    expect(r.error).toContain('is not blocked');
  });

  test('the login page shows the blocked account notice', async () => {
    const ctx = await (await getBrowser()).newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/?blocked=1`);
    expect(await page.locator('#account-blocked').textContent()).toContain('blocked by the administrator');
    await ctx.close();
  });

  test('once unblocked, the person leaves the list (the old session does not come back)', async () => {
    await adminPage();
    await blockedRow(VICTIM.login).locator('.btn-unblock').click();
    await admin.page.waitForFunction(() => document.getElementById('blocked-count')?.textContent === '0');
    expect((await profileOf(VICTIM.sid)).error).toBeTruthy();
    expect(await admin.page.locator('#blocked-tbody').textContent()).toContain('No blocked users');
  });

  test('no unhandled errors in the admin console', () => {
    expect(admin.errors).toEqual([]);
  });
});
