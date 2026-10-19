import { afterAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, type Session } from '../helpers';

// The buttons at the bottom of the user modal: same height, no wrapped text, nothing sticking out, in the longest languages too.
describe('user modal: action buttons', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });

  test('links on one row, Sign out and Close on the next, equal heights, no overflow (administrator, several languages)', async () => {
    s = await newSession();
    await s.page.setViewportSize({ width: 1200, height: 900 });
    await s.page.goto(BASE_URL + '/');
    for (const lang of ['en', 'pt', 'de', 'ru', 'ja', 'fr']) {
      await s.page.evaluate((l: string) => (window as any).LDI18n.setLang(l), lang);
      await s.page.evaluate(() => (window as any).openUserProfileModal());
      await s.page.waitForSelector('#upm-btn-admin', { state: 'visible' });
      const r = await s.page.evaluate(() => {
        const box = (id: string) => document.querySelector(id)!.getBoundingClientRect();
        const acts = Array.from(document.querySelectorAll('#user-profile-modal .upm-act')).map(e => { const b = e.getBoundingClientRect(); return { id: (e as HTMLElement).id || (e as HTMLElement).textContent, h: Math.round(b.height), w: Math.round(b.width), top: Math.round(b.top), left: Math.round(b.left), right: Math.round(b.right) }; });
        const modal = document.querySelector('#user-profile-modal .modal-box') as HTMLElement;
        const m = modal.getBoundingClientRect();
        return { acts, scroll: modal.scrollWidth - modal.clientWidth, modalRight: Math.round(m.right), github: box('#upm-btn-github'), logout: box('#upm-btn-logout'), close: box('#user-profile-modal .upm-session .btn-primary') };
      });
      const heights = r.acts.map(a => a.h);
      expect(Math.max(...heights) - Math.min(...heights), lang + ': equal heights ' + JSON.stringify(r.acts)).toBeLessThanOrEqual(1);
      expect(Math.max(...heights), lang + ': no text wraps onto two lines').toBeLessThan(40);
      expect(r.scroll, lang + ': no horizontal overflow').toBe(0);
      expect(r.acts.every(a => a.right <= r.modalRight), lang + ': every button inside the modal').toBe(true);
      expect(r.logout.top, lang + ': session buttons below the links').toBeGreaterThan(r.github.bottom - 1);
      expect(r.close.left, lang + ': Close on the right of Sign out').toBeGreaterThan(r.logout.right);
      if (lang === 'pt') await s.page.screenshot({ path: '/tmp/claude-1000/-home-tassio-Desenvolvimento-repo-git-neoleaf/bd39f4f3-217d-4bcc-9cf3-f0aab6e16cd3/scratchpad/modal-actions-pt.png', clip: { x: r.github.left - 40, y: r.github.top - 30, width: 480, height: 150 } });
      await s.page.evaluate(() => (window as any).closeUserProfileModal());
    }
    await s.page.evaluate(() => (window as any).LDI18n.setLang('en'));
  });
});
