import { afterAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, type Session } from '../helpers';

// What the privacy policy says about the local copy, the browser's direct requests and the sign-out, in each language that has the full text.
describe('privacy policy: local copy, direct requests, sign out, encrypted sessions', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });
  const text = async () => (await s.page.locator('.legal-container').innerText()).replace(/\s+/g, ' ');

  test('English: the statements are there, and the page makes no request to third parties of its own', async () => {
    s = await newSession();
    const external: string[] = [];
    s.page.on('request', r => { if (!r.url().startsWith(BASE_URL)) external.push(r.url()); });
    await s.page.goto(BASE_URL + '/privacy');
    const t = await text();
    expect(t).toContain('NeoLeaf does not encrypt this copy.');
    expect(t).toContain('use a separate browser profile or a private window');
    expect(t).toContain('Storage tab');
    expect(t).toContain('Services your browser contacts directly');
    for (const name of ['Monaco', 'PDF.js', 'Green Web Foundation', 'Crossref', 'OpenAlex', 'PubMed', 'Europe PMC', 'DOAJ', 'HAL', 'Zenodo', 'OpenAIRE', 'Unpaywall', 'arXiv', 'DBLP']) expect(t).toContain(name);
    expect(t).toContain('NeoLeaf does not send them your project files.');
    expect(t).toContain('deletes all NeoLeaf data stored in the browser');
    expect(t).toContain('the NeoLeaf data stored in your browser is deleted');
    expect(t).toContain('encrypted file (AES-256-GCM)');
    expect(external.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u))).toEqual([]);   // the policy itself loads nothing from other sites
  });

  for (const [lang, a, b, c, d] of [
    ['pt', 'não criptografa essa cópia', 'perfil de navegador separado', 'aba Armazenamento', 'arquivo criptografado (AES-256-GCM)'],
    ['es', 'no cifra esta copia', 'perfil de navegador distinto', 'pestaña Almacenamiento', 'archivo cifrado (AES-256-GCM)'],
    ['zh', '不会加密此副本', '单独的浏览器配置文件', '存储空间', '加密文件中（AES-256-GCM）'],
  ] as const) {
    test(`${lang}: translated`, async () => {
      await s.page.goto(BASE_URL + '/privacy');
      await s.page.evaluate((l: string) => (window as any).LDI18n.setLang(l), lang);
      const t = await text();
      for (const part of [a, b, c, d]) expect(t, `${lang}: ${part}`).toContain(part);
      expect(t).not.toContain('NeoLeaf does not encrypt this copy');   // no English left of the new text
      expect(await s.page.locator('#legal-lang-note').isVisible()).toBe(false);
      await s.page.evaluate(() => (window as any).LDI18n.setLang('en'));
    });
  }

  test('another language shows the English text with the notice', async () => {
    await s.page.goto(BASE_URL + '/privacy');
    await s.page.evaluate(() => (window as any).LDI18n.setLang('fr'));
    expect(await text()).toContain('NeoLeaf does not encrypt this copy.');
    expect(await s.page.locator('#legal-lang-note').isVisible()).toBe(true);
    await s.page.evaluate(() => (window as any).LDI18n.setLang('en'));
  });
});
