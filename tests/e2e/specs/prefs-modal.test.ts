import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, type Session } from '../helpers';

describe('language and theme in the user modal', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); });
  afterAll(async () => { await s.context.close(); });

  test('selectors leave the top bar and live in the profile modal', async () => {
    await s.page.goto(BASE_URL + '/');
    expect(await s.page.locator('.top-bar-right .lang-select, .top-bar-right .theme-picker-select').count()).toBe(0);
    expect(await s.page.locator('#user-profile-modal .lang-select').count()).toBe(1);
    expect(await s.page.locator('#user-profile-modal .theme-picker-select').count()).toBe(1);
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    await s.page.selectOption('#user-profile-modal .theme-picker-select', 'dark');
    expect(await s.page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  });

  test('with the language in English, the user modal leaves no Portuguese text', async () => {
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => (window as any).LDI18n.setLang('en'));
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    await s.page.waitForTimeout(500);
    const text = await s.page.locator('#user-profile-modal').innerText();
    for (const pt of ['Repositórios', 'Seguidores', 'Seguindo', 'Ver no GitHub', 'Fechar', 'Painel de administração', 'Membro do']) {
      expect(text.toLowerCase()).not.toContain(pt.toLowerCase());
    }
    expect(text).toContain('Member of GitHub since');
    expect(text).toContain('Admin panel');
  });
});
