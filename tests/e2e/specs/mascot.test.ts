import { afterAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, openProject, poll, type Session } from '../helpers';

// The NeoLeaf mascot: optional, off by default, silent, only in the editor, switched in the user modal.
describe('mascot', () => {
  const sessions: Session[] = [];
  const fresh = async () => { const s = await newSession(); sessions.push(s); return s; };
  afterAll(async () => { for (const s of sessions) await s.context.close(); });
  const mascot = (s: Session) => s.page.locator('#ld-mascot');
  const shown = (s: Session) => s.page.evaluate(() => { const e = document.getElementById('ld-mascot'); return !!e && getComputedStyle(e).display !== 'none'; });
  const bodyHas = (s: Session, text: string) => s.page.evaluate(t => document.body.innerText.includes(t), text);

  test('off by default: nothing is downloaded and nothing is shown', async () => {
    const s = await fresh();
    const requests: string[] = [];
    s.page.on('request', r => { if (/neoleaf-mascot/.test(r.url())) requests.push(r.url()); });
    await openProject(s.page);
    await s.page.waitForTimeout(2500);
    expect(await mascot(s).count()).toBe(0);
    expect(requests).toEqual([]);
  });

  test('he is shown straight at his saved place: never at the top centre first, then jumping', async () => {
    const s = await fresh();
    await s.page.addInitScript(() => {
      // records where he is every time he is visible and something about him changes
      const seen: Array<{ x: number; y: number }> = [];
      (window as any).__mascotSeen = seen;
      const note = () => {
        const e = document.getElementById('ld-mascot');
        if (e && getComputedStyle(e).display !== 'none') { const r = e.getBoundingClientRect(); seen.push({ x: Math.round(r.left), y: Math.round(r.top) }); }
      };
      new MutationObserver(note).observe(document, { attributes: true, childList: true, subtree: true, attributeFilter: ['style'] });
      const tick = () => { note(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => { localStorage.setItem('ld-mascot', '1'); localStorage.setItem('ld-mascot-pos', JSON.stringify({ x: 0.1, y: 0.6 })); });
    await openProject(s.page);
    await poll(() => shown(s), v => v === true, 20000);
    await s.page.waitForTimeout(1500);
    const vp = s.page.viewportSize()!;
    const seen = await s.page.evaluate(() => (window as any).__mascotSeen as Array<{ x: number; y: number }>);
    expect(seen.length).toBeGreaterThan(0);
    const want = { x: Math.round(vp.width * 0.1), y: Math.round(vp.height * 0.6) };
    // every position he was ever seen at is the saved one (a stray centre position would show up here)
    for (const p of seen) {
      expect(Math.abs(p.x - want.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(p.y - want.y)).toBeLessThanOrEqual(3);
    }
  });

  test('when switched on he appears in the bottom right corner, above the panels and below the modals', async () => {
    const s = await fresh();
    const requests: string[] = [];
    s.page.on('request', r => { if (/neoleaf-mascot/.test(r.url())) requests.push(r.url()); });
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => localStorage.setItem('ld-mascot', '1'));
    await openProject(s.page);
    await poll(() => shown(s), v => v === true, 20000);
    expect(requests.some(u => u.endsWith('/static/img/neoleaf-mascot.png'))).toBe(true);
    const box = await mascot(s).boundingBox();
    const vp = s.page.viewportSize()!;
    expect(box!.x).toBeGreaterThan(vp.width / 2);
    expect(box!.y).toBeGreaterThan(vp.height / 2);
    expect(await mascot(s).evaluate(e => (e as HTMLElement).style.zIndex)).toBe('900');
    expect([box!.width, box!.height]).toEqual([96, 96]);   // 96 x 96 CSS pixels
    expect(await mascot(s).evaluate(e => (e as HTMLElement).style.backgroundSize)).toBe('576px 480px');   // the 768 x 640 sheet at the same scale
    // he does not cover the compile button
    const btn = await s.page.locator('#compile-btn').boundingBox();
    const overlap = !(box!.x + box!.width < btn!.x || btn!.x + btn!.width < box!.x || box!.y + box!.height < btn!.y || btn!.y + btn!.height < box!.y);
    expect(overlap).toBe(false);
  });

  test('the editor keeps the keyboard focus while he is there', async () => {
    const s = await fresh();
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => localStorage.setItem('ld-mascot', '1'));
    await openProject(s.page);
    await poll(() => shown(s), v => v === true, 20000);
    await s.page.evaluate(() => (globalThis as any).eval('editor.focus()'));
    await s.page.keyboard.type('x');
    expect(await s.page.evaluate(() => document.activeElement?.closest('.monaco-editor') !== null)).toBe(true);
  });

  test('the user modal switches him off and on at once and remembers the choice', async () => {
    const s = await fresh();
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => localStorage.setItem('ld-mascot', '1'));
    await openProject(s.page);
    await poll(() => shown(s), v => v === true, 20000);
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    const box = s.page.locator('#upm-mascot');
    expect(await box.isChecked()).toBe(true);
    await box.uncheck();
    await poll(() => shown(s), v => v === false, 10000);
    expect(await s.page.evaluate(() => localStorage.getItem('ld-mascot'))).toBe('0');
    await box.check();
    await poll(() => shown(s), v => v === true, 20000);
    await s.page.reload();
    await s.page.waitForSelector('.monaco-editor');
    await poll(() => shown(s), v => v === true, 20000);
  });

  test('the checkbox is also in the user modal of the project list, and starts unchecked', async () => {
    const s = await fresh();
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    expect(await s.page.locator('#upm-mascot').isChecked()).toBe(false);
    expect(await mascot(s).count()).toBe(0);   // the project list has no mascot even when it is on
    await s.page.locator('#upm-mascot').check();
    await s.page.waitForTimeout(500);
    expect(await mascot(s).count()).toBe(0);
  });

  test('he reacts to the compilation: a success and an error each get a short message', async () => {
    const s = await fresh();
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => localStorage.setItem('ld-mascot', '1'));
    await openProject(s.page);
    await poll(() => shown(s), v => v === true, 20000);
    await s.page.evaluate(() => window.dispatchEvent(new CustomEvent('ld-compile', { detail: { phase: 'done', success: true } })));
    await poll(() => bodyHas(s, 'Compiled! Your PDF is ready.'), v => v === true, 8000);
    await s.page.evaluate(() => window.dispatchEvent(new CustomEvent('ld-compile', { detail: { phase: 'done', success: false } })));
    await poll(() => bodyHas(s, 'Open the Logs tab to see the details.'), v => v === true, 8000);
  });

  test('his words follow the interface language', async () => {
    const s = await fresh();
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => { localStorage.setItem('ld-mascot', '1'); localStorage.setItem('ld-lang', 'pt'); });
    await openProject(s.page);
    await poll(() => bodyHas(s, 'Oi! Eu sou o NeoLeaf'), v => v === true, 25000);
  });

  test('with reduced motion he stays still and quiet', async () => {
    const s = await fresh();
    await s.page.emulateMedia({ reducedMotion: 'reduce' });
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => localStorage.setItem('ld-mascot', '1'));
    await openProject(s.page);
    await poll(() => shown(s), v => v === true, 20000);
    await s.page.evaluate(() => window.dispatchEvent(new CustomEvent('ld-compile', { detail: { phase: 'done', success: false } })));
    await s.page.waitForTimeout(1500);
    expect(await bodyHas(s, 'Open the Logs tab')).toBe(false);
    expect(await bodyHas(s, "Hi! I'm NeoLeaf")).toBe(false);
  });
});
