import { afterAll, describe, expect, test } from 'bun:test';
import { BASE_URL, getBrowser } from '../helpers';

describe('landing page', () => {
  let ctx: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newContext']>>;
  afterAll(async () => { await ctx?.close(); });

  test('the title is a single sentence, with a comma and no em dash', async () => {
    ctx = await (await getBrowser()).newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`);
    const title = (await page.locator('h1.nl-hero-title').innerText()).replace(/\s+/g, ' ').trim();
    expect(title).toBe('Write like a scientist with NeoLeaf, the online collaborative LaTeX editor that charges you absolutely nothing.');
    expect(title).not.toContain('\u2014');
  });

  test('the NeoLeaf name has the gradient in the title and in the top bar', async () => {
    const page = (await ctx.pages())[0];
    const grad = (sel: string) => page.evaluate(s => {
      const el = document.querySelector(s) as HTMLElement;
      const cs = getComputedStyle(el);
      return { text: el.textContent?.trim(), image: cs.backgroundImage, fill: cs.webkitTextFillColor, clip: cs.webkitBackgroundClip || cs.backgroundClip };
    }, sel);
    for (const sel of ['h1.nl-hero-title em:first-of-type', '.nl-navbar .nl-brand-gradient']) {
      const g = await grad(sel);
      expect(g.image).toContain('linear-gradient');
      expect(g.fill).toBe('rgba(0, 0, 0, 0)');
      expect(g.clip).toBe('text');
    }
    expect((await grad('h1.nl-hero-title em:first-of-type')).text).toBe('NeoLeaf');
    expect((await grad('.nl-navbar .nl-brand-gradient')).text).toBe('NeoLeaf');
    // the "absolutely nothing" keeps the same effect
    expect(await page.locator('h1.nl-hero-title em').count()).toBe(2);
  });

  test('the NeoLeaf name also has the gradient in the dashboard bar (the editor shows only the logo)', async () => {
    const { newSession } = await import('../helpers');
    const sess = await newSession();
    try {
      for (const where of ['dash'] as const) {
        await sess.page.goto(`${BASE_URL}/`);
        const g = await sess.page.evaluate(() => {
          const el = document.querySelector('.brand-title .brand-gradient') as HTMLElement;
          const cs = getComputedStyle(el);
          return { text: el.textContent, image: cs.backgroundImage, fill: cs.webkitTextFillColor, clip: cs.webkitBackgroundClip || cs.backgroundClip };
        });
        expect(g.text).toBe('NeoLeaf');
        expect(g.image).toContain('linear-gradient');
        expect(g.fill).toBe('rgba(0, 0, 0, 0)');
        expect(g.clip).toBe('text');
      }
    } finally { await sess.context.close(); }
  });

  test('the four editor screens load and take turns', async () => {
    const c2 = await (await getBrowser()).newContext({ locale: 'en-US' });
    const page = await c2.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.waitForSelector('.nl-mockup-img');
    const info = await page.$$eval('.nl-mockup-img', imgs => imgs.map(i => ({ src: new URL((i as HTMLImageElement).src).pathname, ok: (i as HTMLImageElement).complete })));
    expect(info.map(i => i.src)).toEqual(['/static/img/editor_preview.webp', '/static/img/editor_preview_claro.webp', '/static/img/editor_preview_2.webp', '/static/img/editor_preview_claro_2.webp']);
    for (const i of info) expect((await page.request.get(`${BASE_URL}${i.src}`)).status()).toBe(200);
    for (const i of info) expect((await page.request.get(`${BASE_URL}${i.src}`)).headers()['content-type']).toBe('image/webp');
    expect(await page.locator('.nl-mockup-badge-float').count()).toBe(0); // no badge over the image
    // one at a time is visible: every 5 s the next one
    const visible = () => page.$$eval('.nl-mockup-img', imgs => imgs.map(i => Number(getComputedStyle(i).opacity) > 0.5));
    await page.waitForFunction(() => document.querySelectorAll('.nl-mockup-img').length === 4);
    const seen = new Set<number>();
    for (let t = 0; t < 22 && seen.size < 4; t++) { const v = await visible(); const k = v.indexOf(true); if (k >= 0) seen.add(k); await page.waitForTimeout(1000); }
    expect(seen.size).toBe(4);
    await c2.close();
  }, 60000);

  test('the Green Web Foundation badge is in the footer, sends no referrer and its text is translated', async () => {
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`);
    const img = page.locator('footer img[src^="https://app.greenweb.org/api/v3/greencheckimage/neoleaf.science"]');
    expect(await img.count()).toBe(1);
    expect(await img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect([await img.getAttribute('width'), await img.getAttribute('height')]).toEqual(['200px', '95px']);
    expect(await img.getAttribute('alt')).toContain('green hosting');
    await page.evaluate(() => (window as any).LDI18n.setLang('pt'));
    expect(await img.getAttribute('alt')).toContain('hospedagem verde');
    await page.evaluate(() => (window as any).LDI18n.setLang('en'));
    await page.close();
  });

  test('the Website Carbon badge comes from site/carbon.json, links to the result page, and needs no third-party request', async () => {
    const page = await ctx.newPage();
    const external: string[] = [];
    page.on('request', r => { if (/websitecarbon\.com|unpkg\.com/.test(r.url())) external.push(r.url()); });
    await page.goto(`${BASE_URL}/`);
    const badge = page.locator('footer a.nl-carbon');
    expect(await badge.count()).toBe(1);
    expect(await badge.getAttribute('href')).toBe('https://www.websitecarbon.com/website/neoleaf-science/');
    const data = JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(import.meta.dir, '../../../site/carbon.json'), 'utf8'));
    const text = (await badge.innerText()).replace(/\s+/g, ' ');
    expect(text).toContain(`${data.co2} g of CO\u2082 per page view`);
    expect(text).toContain(`Cleaner than ${data.cleaner_than}% of pages tested`);
    expect(text).toContain(`Rating ${data.rating} \u00b7 Tested on ${data.tested}`);
    expect(external).toEqual([]);   // nothing is fetched from websitecarbon.com or a CDN: the numbers are ours
    // translated
    await page.evaluate(() => (window as any).LDI18n.setLang('pt'));
    const pt = (await badge.innerText()).replace(/\s+/g, ' ');
    expect(pt).toContain('Mais limpo que');
    expect(pt).toContain('Classificação');
    expect(await badge.getAttribute('title')).toContain('resultado completo');
    await page.evaluate(() => (window as any).LDI18n.setLang('en'));
    await page.close();
  });

  test('the page CSS and JS come from /site and the support section is the last one, with the Ko-fi link', async () => {
    const c = await (await getBrowser()).newContext({ locale: 'en-US' });
    const page = await c.newPage();
    const css = await page.request.get(`${BASE_URL}/site/home.css`);
    expect(css.status()).toBe(200);
    expect(css.headers()['content-type']).toContain('text/css');
    const js = await page.request.get(`${BASE_URL}/site/home.js`);
    expect(js.status()).toBe(200);
    expect(js.headers()['content-type']).toContain('javascript');
    await page.goto(`${BASE_URL}/`);
    expect(await page.locator('main > section').last().getAttribute('id')).toBe('support');
    expect(await page.locator('#support a[href="https://ko-fi.com/tassiovirginio"]').count()).toBe(1);
    await c.close();
  });

  test('no personal section: the footer has the copyright line, the licenses link, and the trust points stay', async () => {
    const c = await (await getBrowser()).newContext({ locale: 'en-US' });
    const page = await c.newPage();
    await page.goto(`${BASE_URL}/`);
    expect(await page.locator('.nl-about-card, .nl-about-photo').count()).toBe(0);
    const html = await page.content();
    expect(html).not.toContain('tassio.png');
    expect(html).not.toContain('Who is behind');
    expect(html).not.toMatch(/beta/i);   // the system is no longer in beta: no badge by the logo, no "Public Beta Version" in the footer
    expect(await page.locator('.nl-nav-brand').first().innerText()).toBe('NeoLeaf');
    expect(await page.locator('.nl-footer-bottom').innerText()).toContain('© 2026 Tássio Virgínio');
    expect(await page.locator('.nl-footer-bottom a[href="/licenses"]').count()).toBe(1);
    expect(await page.locator('#about .nl-about-point').count()).toBe(3);
    expect((await page.request.get(`${BASE_URL}/static/img/tassio.png`)).status()).toBe(404);
    await c.close();
  });
});
