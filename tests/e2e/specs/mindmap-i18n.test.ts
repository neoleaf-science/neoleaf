import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, type Session } from '../helpers';

// The UI source language is English; this spec sets the language preference to Portuguese on purpose, to check that
// system texts are translated while the user's own section titles are not.
describe('translated map and outline', () => {
  let s: Session;
  beforeAll(async () => {
    s = await newSession();
    await s.page.addInitScript(() => { try { localStorage.setItem('ld-lang', 'pt'); } catch (_) {} });
    await openProject(s.page);
    await s.page.evaluate(async () => {
      const B = (window as any).BrowserGit;
      // "Images" and "Collapse" are system texts (translated), but here they are the user's own section titles: they must not be translated
      const main = '\\documentclass{article}\n\\begin{document}\n\\section{Images}\n\\input{sessions/b}\n\\end{document}\n';
      await B.writeFile('main.tex', main);
      (globalThis as any).eval('editor').setValue(main);
      await B.writeFile('sessions/b.tex', '\\subsection{Collapse}\n');
      await B.writeFile('loose.tex', '\\section{Draft}\n');
      await (window as any).FT.refreshFromBrowserGit();
    });
    await s.page.click('#tab-map-btn');
    await s.page.waitForSelector('#mm-svg .mm-node', { timeout: 15000 });
  });
  afterAll(async () => { await s.context.close(); });

  test('Map tab texts come out in Portuguese when the preference is pt', async () => {
    expect((await s.page.textContent('#tab-map-btn'))!.trim()).toBe('🗺️ Mapa');
    expect(await s.page.textContent('#mm-fit')).toBe('Ajustar');
    expect(await s.page.textContent('#mm-expand')).toBe('Expandir tudo');
    expect(await s.page.textContent('#mm-collapse')).toBe('Recolher');
    expect(await s.page.locator('#mm-order option').allTextContents()).toEqual(['Sentido horário', 'Sentido anti-horário', 'Todos à direita']);
    expect((await s.page.textContent('.mm-chk:has(#mm-orph)'))!.trim()).toBe('Não incluídos');
    expect(await s.page.getAttribute('#mm-full', 'title')).toBe('Tela cheia (Esc sai)');
    expect(await s.page.textContent('.mm-hint')).toContain('Clique num nó');
  });

  test('user titles are not translated and the "Not included" branch is', async () => {
    await s.page.waitForFunction(() => [...document.querySelectorAll('#mm-svg .mm-text')].some(e => e.textContent === 'Images'), null, { timeout: 15000 });
    const texts = await s.page.$$eval('#mm-svg .mm-text', e => e.map(x => x.textContent));
    expect(texts).toContain('Images');
    expect(texts).toContain('Collapse');
    await s.page.check('#mm-orph');
    expect(await s.page.$$eval('#mm-svg .mm-text', e => e.map(x => x.textContent))).toContain('Não incluídos');
    await s.page.waitForFunction(() => [...document.querySelectorAll('#outline-list .ol-title')].some(e => e.textContent === 'Images'), null, { timeout: 15000 });
    const outline = await s.page.$$eval('#outline-list .ol-title', e => e.map(x => x.textContent));
    expect(outline).toContain('Images');
    expect(await s.page.textContent('#outline-list .outline-group')).toBe('Não incluídos');
  });
});
