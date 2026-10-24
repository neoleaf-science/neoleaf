import { afterAll, describe, expect, test } from 'bun:test';
import { BASE_URL, DEMO_PROJECT, getBrowser, newSession, openProject } from '../helpers';

// Sign in with GitHub (left) and with Codeberg (right), side by side; the repository button in the editor uses the service icon.
describe('GitHub and Codeberg buttons', () => {
  const opened: { close: () => Promise<void> }[] = [];
  afterAll(async () => { for (const c of opened) await c.close(); });

  test('home page: both buttons side by side, GitHub on the left, and translated', async () => {
    const ctx = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    opened.push(ctx);
    const page = await ctx.newPage();
    await page.goto(BASE_URL + '/');
    for (const block of ['nav', 'hero']) {
      const root = block === 'nav' ? page.locator('header.nl-navbar') : page.locator('.nl-hero-cta-wrapper').first();
      const gh = root.locator('a[href="/auth/login"]').first();
      const cb = root.locator('a[href="/auth/login/codeberg"]').first();
      const [g, c] = [await gh.boundingBox(), await cb.boundingBox()];
      expect(g && c, block).toBeTruthy();
      expect(g!.x + g!.width, `${block}: GitHub on the left`).toBeLessThanOrEqual(c!.x + 1);
      expect(Math.abs((g!.y + g!.height / 2) - (c!.y + c!.height / 2)), `${block}: on the same line`).toBeLessThan(12);
    }
    await page.evaluate(() => (window as any).LDI18n.setLang('en'));
    await page.waitForTimeout(400);
    const texts = await page.locator('a[href="/auth/login/codeberg"]').allInnerTexts();
    expect(texts.join(' | ')).toContain('Sign in Free with Codeberg');
    expect(texts.join(' | ')).toContain('Get Started with Codeberg');
    expect(texts.join(' | ')).not.toMatch(/Entrar|Começar/);
    expect(await page.locator('header.nl-navbar a[href="/auth/login/codeberg"]').getAttribute('title')).toBe('Sign in with Codeberg');
  });

  test('home page, terms and privacy texts mention GitHub and Codeberg', async () => {
    const ctx = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    opened.push(ctx);
    const page = await ctx.newPage();
    await page.goto(BASE_URL + '/');
    const en = await page.locator('body').innerText();
    expect(en).toContain('native version control (Git) on GitHub or Codeberg');
    expect(en).toContain('Native Codeberg');
    expect(await page.locator('p', { hasText: 'Unlimited real-time collaboration' }).first().innerText()).not.toContain('—'); // no em dash in new texts (see AGENTS.md)
    await page.evaluate(() => (window as any).LDI18n.setLang('pt'));
    await page.waitForTimeout(400);
    const pt = await page.locator('body').innerText();
    expect(pt).toContain('controle de versão nativo (Git) no GitHub ou no Codeberg');
    await page.evaluate(() => (window as any).LDI18n.setLang('zh'));
    await page.waitForTimeout(400);
    expect(await page.locator('body').innerText()).toContain('GitHub 或 Codeberg');
    const privacy = await (await page.request.get(BASE_URL + '/privacy')).text();
    expect(privacy).toContain('Codeberg e.V.');
    expect(privacy).toContain('https://codeberg.org/user/settings/applications');
    const terms = await (await page.request.get(BASE_URL + '/terms')).text();
    expect(terms).toContain('GitHub or Codeberg');
  });

  test('home page top bar: no line wrapping in items and no overflow, and becomes a menu when narrow', async () => {
    const measure = async (width: number) => {
      const ctx = await (await getBrowser()).newContext({ viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(BASE_URL + '/');
      const r = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.nl-nav-item a, .nl-pill-free')].filter(e => (e as HTMLElement).offsetParent !== null);
        const cont = document.querySelector('.nl-nav-container') as HTMLElement;
        return {
          maxHeight: Math.max(0, ...items.map(e => Math.round(e.getBoundingClientRect().height))),
          overflow: cont.scrollWidth - cont.clientWidth,
          menuVisible: getComputedStyle(document.querySelector('.nl-nav-menu')!).display !== 'none',
          menuButton: getComputedStyle(document.querySelector('.nl-nav-toggle')!).display !== 'none',
        };
      });
      await ctx.close();
      return r;
    };
    for (const w of [1500, 1236, 1180]) {
      const r = await measure(w);
      expect(r.menuVisible, `${w}px: links visible`).toBe(true);
      expect(r.maxHeight, `${w}px: no item wraps onto two lines`).toBeLessThan(45);
      expect(r.overflow, `${w}px: no side overflow`).toBe(0);
    }
    for (const w of [1100, 900]) {
      const r = await measure(w);
      expect(r.menuVisible, `${w}px: links hidden`).toBe(false);
      expect(r.menuButton, `${w}px: menu button`).toBe(true);
      expect(r.overflow, `${w}px: no side overflow`).toBe(0);
    }
  });

  test('editor with the GitHub account: the repository button shows the GitHub icon and text', async () => {
    const s = await newSession();
    opened.push(s.context);
    await openProject(s.page, DEMO_PROJECT);
    const link = s.page.locator('#repo-link');
    expect(await link.getAttribute('data-provider')).toBe('github');
    expect(await link.getAttribute('title')).toBe('Open repository on GitHub');
    expect(await link.locator('svg').getAttribute('viewBox')).toBe('0 0 16 16');
  });

  test('editor with the Codeberg account: the repository button shows the Codeberg icon and text', async () => {
    const ctx = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    opened.push(ctx);
    const page = await ctx.newPage();
    await page.goto(BASE_URL + '/auth/login/codeberg');
    await page.waitForSelector('#proj-row-demo__artigo-1', { timeout: 30000 });
    await openProject(page, DEMO_PROJECT);
    const link = page.locator('#repo-link');
    expect(await link.getAttribute('data-provider')).toBe('codeberg');
    expect(await link.getAttribute('title')).toBe('Open repository on Codeberg');
    expect(await link.locator('svg').getAttribute('viewBox')).toBe('0 0 24 24');
    // and the user modal also swaps the "View on ..." button
    await page.evaluate(() => (window as any).openUserProfileModal());
    expect((await page.locator('#upm-btn-github').innerText()).trim()).toBe('View on Codeberg');
    // screenshot to check the look
    await page.screenshot({ path: process.env.CAPTURA || '/tmp/provider-buttons-editor.png', clip: { x: 700, y: 0, width: 700, height: 60 } });
  });
});
