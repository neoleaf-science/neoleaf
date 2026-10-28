import { afterAll, describe, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { BASE_URL, getBrowser } from '../helpers';

// The screenshots on the home page: each one has a caption that changes with it, and they can be moved through with the arrows, the dots and the keyboard.

let ctx: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newContext']>>;
let page: Page;
afterAll(async () => { await ctx?.close(); });

const active = () => page.evaluate(() => {
  const f = document.querySelector('.nl-shot.is-active') as HTMLElement;
  return { id: f.id, title: f.querySelector('h3')!.textContent, text: f.querySelector('p')!.textContent, hidden: Array.from(document.querySelectorAll('.nl-shot')).filter(x => x !== f).every(x => x.getAttribute('aria-hidden') === 'true') };
});

describe('home page screenshots', () => {
  test('seven screens, each with a title and a description, the first one shown', async () => {
    ctx = await (await getBrowser()).newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: 'reduce' }); // no automatic turning here: the tests move through the screens themselves
    page = await ctx.newPage();
    await page.goto(BASE_URL + '/');
    await page.evaluate(() => localStorage.setItem('ld-lang', 'en')); // the page opens in the language of the browser: the checks below read the English text
    await page.reload();
    await page.waitForSelector('#nl-shots');
    const n = await page.$$eval('.nl-shot', fs => fs.map(f => ({ title: f.querySelector('h3')!.textContent, words: f.querySelector('p')!.textContent!.split(' ').length, src: (f.querySelector('img') as HTMLImageElement).getAttribute('src') })));
    expect(n).toHaveLength(7);
    for (const s of n) { expect(s.title!.length).toBeGreaterThan(5); expect(s.words).toBeGreaterThan(10); }
    expect((await active()).id).toBe('shot-1');
    expect((await active()).hidden).toBe(true);
    for (const s of n) { const r = await ctx.request.get(BASE_URL + s.src!); expect(r.status()).toBe(200); expect(r.headers()['content-type']).toBe('image/webp'); }
  }, 60000);

  test('the arrows move on and back, wrapping around, and the caption changes with the screen', async () => {
    const first = await active();
    await page.click('#nl-shot-next');
    const second = await active();
    expect(second.id).toBe('shot-2');
    expect(second.title).not.toBe(first.title);
    expect(second.text).not.toBe(first.text);
    await page.click('#nl-shot-prev');
    expect((await active()).id).toBe('shot-1');
    await page.click('#nl-shot-prev');
    expect((await active()).id).toBe('shot-7');
    await page.click('#nl-shot-next');
    expect((await active()).id).toBe('shot-1');
  }, 60000);

  test('the dots and the keyboard work, and the dot of the shown screen is selected', async () => {
    await page.click('.nl-shot-dot[data-i="4"]');
    expect((await active()).id).toBe('shot-5');
    expect(await page.$$eval('.nl-shot-dot', ds => ds.map(d => d.getAttribute('aria-selected')))).toEqual(['false', 'false', 'false', 'false', 'true', 'false', 'false']);
    expect(await page.getAttribute('.nl-shot-dot[data-i="4"]', 'aria-label')).toBe('Screen 5 of 7');
    await page.focus('#nl-shots');
    await page.keyboard.press('ArrowRight');
    expect((await active()).id).toBe('shot-6');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect((await active()).id).toBe('shot-4');
    // a click on the picture also moves on
    await page.click('#shot-4 .nl-shot-img');
    expect((await active()).id).toBe('shot-5');
  }, 60000);

  test('the visible screen is on the page and the others do not take space or reach assistive technology', async () => {
    await page.click('.nl-shot-dot[data-i="0"]');
    await page.locator('#screenshots').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const vis = await page.$$eval('.nl-shot', fs => fs.map(f => getComputedStyle(f).visibility));
    expect(vis.filter(v => v === 'visible')).toHaveLength(1);
    const box = await page.locator('#shot-1 img').boundingBox();
    expect(box!.width).toBeGreaterThan(600);
    // the live region only starts to announce once the person has moved through the screens
    expect(await page.getAttribute('.nl-shots-stage', 'aria-live')).toBe('polite');
    expect(await page.getAttribute('#nl-shot-play', 'aria-label')).toBe('Play the slideshow');
  }, 60000);

  test('the captions and the controls are translated', async () => {
    await page.evaluate(() => localStorage.setItem('ld-lang', 'pt'));
    await page.reload();
    await page.waitForSelector('#nl-shots');
    await page.waitForTimeout(500);
    const t = await active();
    expect(t.title).toBe('Escreva, compile e veja o PDF');
    expect(await page.getAttribute('#nl-shot-next', 'aria-label')).toBe('Próxima tela');
    expect(await page.getAttribute('.nl-shot-dot[data-i="2"]', 'aria-label')).toBe('Tela 3 de 7');
    await page.click('#nl-shot-next');
    expect((await active()).title).toBe('O mapa do artigo');
    await page.evaluate(() => localStorage.removeItem('ld-lang'));
  }, 60000);

  test('it turns by itself, pauses for the mouse, and stops for good when the person takes over', async () => {
    const c = await (await getBrowser()).newContext({ viewport: { width: 1300, height: 900 }, locale: 'en-US' });
    const p = await c.newPage();
    await p.goto(BASE_URL + '/');
    await p.evaluate(() => localStorage.setItem('ld-lang', 'en'));
    await p.reload();
    await p.waitForSelector('#nl-shots');
    // a short interval for the test
    await p.evaluate(() => document.getElementById('nl-shots')!.setAttribute('data-interval', '1500'));
    await p.reload();
    await p.waitForSelector('#nl-shots');
    const now = () => p.evaluate(() => (document.querySelector('.nl-shot.is-active') as HTMLElement).id);
    expect(await p.getAttribute('#nl-shot-play', 'aria-label')).toBe('Pause the slideshow');
    expect(await p.getAttribute('.nl-shots-stage', 'aria-live')).toBe('off'); // nothing is announced while it turns by itself
    await p.mouse.move(5, 5);
    await p.waitForFunction(() => (document.querySelector('.nl-shot.is-active') as HTMLElement).id !== 'shot-1', null, { timeout: 15000 });
    // the mouse on it holds it
    const box = await p.locator('#shot-1').boundingBox();
    await p.mouse.move(650, 400);
    const held = await now();
    await p.waitForTimeout(2500);
    expect(await now()).toBe(held);
    // the pause button stops it, and play starts it again
    await p.mouse.move(5, 5);
    await p.click('#nl-shot-play');
    expect(await p.getAttribute('#nl-shot-play', 'aria-label')).toBe('Play the slideshow');
    await p.mouse.move(5, 5);
    const stopped = await now();
    await p.waitForTimeout(2500);
    expect(await now()).toBe(stopped);
    // moving through the screens by hand also stops it and lets a screen reader hear the captions
    await p.click('#nl-shot-next');
    expect(await p.getAttribute('.nl-shots-stage', 'aria-live')).toBe('polite');
    await p.mouse.move(5, 5);
    const mine = await now();
    await p.waitForTimeout(2500);
    expect(await now()).toBe(mine);
    await c.close();
  }, 90000);

  test('it does not turn by itself for people who ask for less motion', async () => {
    const c = await (await getBrowser()).newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: 'reduce' });
    const p = await c.newPage();
    await p.goto(BASE_URL + '/');
    await p.evaluate(() => localStorage.setItem('ld-lang', 'en'));
    await p.reload();
    await p.waitForSelector('#nl-shots');
    expect(await p.getAttribute('#nl-shot-play', 'aria-label')).toBe('Play the slideshow');
    await p.waitForTimeout(3000);
    expect(await p.evaluate(() => (document.querySelector('.nl-shot.is-active') as HTMLElement).id)).toBe('shot-1');
    await c.close();
  }, 60000);
});
