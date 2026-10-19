import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, type Session } from '../helpers';

// The main green button (.btn-primary) must stay visible on mouse hover, in every theme.
// (Before, the hover used a CSS variable that no theme defined: the background went transparent and the text vanished.)
describe('main button on hover, in every theme', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); });
  afterAll(async () => { await s.context.close(); });

  test('the hover background is not transparent and differs from the text color', async () => {
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    const themes: string[] = await s.page.evaluate(() => [...document.querySelectorAll('#user-profile-modal .theme-picker-select option')].map(o => (o as HTMLOptionElement).value));
    expect(themes.length).toBeGreaterThanOrEqual(10);
    const btn = s.page.locator('#user-profile-modal .btn-primary').first();
    const colors = () => btn.evaluate(e => { const c = getComputedStyle(e); return { bg: c.backgroundColor, fg: c.color, border: c.borderColor }; });
    for (const t of themes) {
      await s.page.selectOption('#user-profile-modal .theme-picker-select', t);
      await s.page.mouse.move(0, 0);
      await s.page.waitForTimeout(250);
      const normal = await colors();
      await btn.hover();
      await s.page.waitForTimeout(250);
      const hover = await colors();
      const msg = `theme ${t}: normal ${normal.bg}, hover ${hover.bg}, text ${hover.fg}`;
      expect(normal.bg, msg).not.toBe('rgba(0, 0, 0, 0)');
      expect(hover.bg, msg).not.toBe('rgba(0, 0, 0, 0)');
      expect(hover.bg, msg + ' (background equal to text)').not.toBe(hover.fg);
      expect(hover.bg, msg + ' (hover equal to normal)').not.toBe(normal.bg);
    }
  });
});
