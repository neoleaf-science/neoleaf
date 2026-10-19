import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, type Session } from '../helpers';

describe('editor: back to projects button', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('shows only the logo (without the NeoLeaf name) and swaps to the house on hover', async () => {
    expect(await s.page.locator('.top-bar-left .brand-title').count()).toBe(0);
    expect(await s.page.getAttribute('.home-logo-btn', 'href')).toBe('/');
    // without the "/" slash between the logo and the project name
    expect((await s.page.textContent('.top-bar-left'))!.includes('/')).toBe(false);
    const op = (sel: string) => s.page.$eval(sel, e => getComputedStyle(e).opacity);
    await s.page.mouse.move(700, 500);
    expect(await op('.home-logo-btn .home-logo')).toBe('1');
    expect(await op('.home-logo-btn .home-icon')).toBe('0');
    await s.page.hover('.home-logo-btn');
    await s.page.waitForTimeout(400);
    expect(await op('.home-logo-btn .home-logo')).toBe('0');
    expect(await op('.home-logo-btn .home-icon')).toBe('1');
  });
});
