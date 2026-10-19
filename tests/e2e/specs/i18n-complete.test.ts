import { describe, expect, test } from 'bun:test';
import { BASE_URL, getBrowser, newSession, openProject } from '../helpers';

// English is the source language and the key of every translation: static/js/i18n-<code>.js, one file per language
// and the matcher lives in static/js/i18n.js. These tests check that the dictionary is well formed and that the interface
// has no leftover English text when the language is Chinese (a language that is easy to tell apart from the source).

const SCAN = () => {
  // English function words: a text that has one of them as a whole word is English prose, not a name or a code sample
  const EN = /\b(the|and|of|to|for|with|your|you|is|are|in|on|this|that|from|not|or|an|no|has|have|can|will|here|more|all|new|open|save|close|cancel|send|search|file|files|project|projects|folder|error|agent|server|browser|engine)\b/i;
  const out = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const el = (n as Text).parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE)$/.test(el.tagName) || el.closest('.monaco-editor,.xterm,#pdf-container,.cm-editor,.pl-title,.project-title,.tree-name,.tab-name')) continue;
    const t = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
    if (t.length < 2 || /[一-鿿]/.test(t)) continue;
    if (EN.test(t)) out.add('T: ' + t.slice(0, 600));
  }
  for (const el of document.querySelectorAll('[title],[placeholder],[aria-label]')) {
    if (el.closest('.monaco-editor')) continue; // Monaco's own accessibility texts
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = (el.getAttribute(a) || '').trim();
      if (v.length > 1 && !/[一-鿿]/.test(v) && EN.test(v)) out.add(`A(${a}): ` + v.slice(0, 600));
    }
  }
  return [...out];
};

const LANGS = ['cs', 'es', 'pt', 'fr', 'de', 'sv', 'tr', 'it', 'zh', 'nb', 'ru', 'da', 'ko', 'ja'];
const NEW_LANGS = ['cs', 'fr', 'de', 'sv', 'tr', 'it', 'nb', 'ru', 'da', 'ko', 'ja'];
const decode = (h: string) => h.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const squash = (h: string) => decode(h).replace(/\s+/g, ' ');

async function loadTables(page: any): Promise<Record<string, Record<string, string>>> {
  return page.evaluate(async (ls: string[]) => {
    const w = window as any;
    for (const l of ls) if (!(await w.LDI18n.load(l))) throw new Error('could not load ' + l);
    return Object.fromEntries(ls.map(l => [l, w.LD_I18N[l]]));
  }, LANGS);
}

describe('translation files are well formed', () => {
  test('every language is filled, with the placeholders of the English text', async () => {
    const s = await newSession();
    await s.page.goto(BASE_URL + '/');
    const tables = await loadTables(s.page);
    await s.context.close();
    expect(Object.keys(tables.pt).length).toBeGreaterThan(100);
    const ph = (t: string) => (t.match(/\{\d+\}/g) || []).sort().join(',');
    const broken: string[] = [];
    for (const l of LANGS) {
      for (const [k, v] of Object.entries(tables[l])) {
        if (typeof v !== 'string' || !v.trim()) broken.push(`${l}: empty translation for ${JSON.stringify(k)}`);
        else if (ph(v) !== ph(k)) broken.push(`${l}: placeholders differ from English: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
        else if (v.includes('\u2014')) broken.push(`${l}: em dash in ${JSON.stringify(v)}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('Portuguese, Spanish and Chinese have the same keys; the other languages lack only the text of the legal pages', async () => {
    const s = await newSession();
    await s.page.goto(BASE_URL + '/');
    const tables = await loadTables(s.page);
    const legalHtml = squash((await (await s.context.request.get(BASE_URL + '/privacy')).text()) + ' ' + (await (await s.context.request.get(BASE_URL + '/terms')).text()));
    await s.context.close();
    const ref = Object.keys(tables.pt);
    const broken: string[] = [];
    for (const l of ['es', 'zh']) {
      for (const k of ref) if (!(k in tables[l])) broken.push(`${l}: missing ${JSON.stringify(k)}`);
      for (const k of Object.keys(tables[l])) if (!(k in tables.pt)) broken.push(`${l}: extra ${JSON.stringify(k)}`);
    }
    for (const l of NEW_LANGS) {
      for (const k of Object.keys(tables[l])) if (!(k in tables.pt)) broken.push(`${l}: key that Portuguese does not have ${JSON.stringify(k)}`);
      for (const k of ref) {
        if (k in tables[l]) continue;
        // a text left out must be one that only the privacy policy or the terms use (those pages stay in English for these languages)
        const parts = k.split(/\{\d+\}/).map(x => squash(x).trim()).filter(x => x.length >= 3);
        if (!parts.every(p => legalHtml.includes(p))) broken.push(`${l}: missing ${JSON.stringify(k)} (and it is not text of the legal pages)`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('only the language in use is downloaded, and the old single dictionary is gone', async () => {
    const s = await newSession();
    const files: string[] = [];
    s.page.on('request', r => { const m = r.url().match(/\/static\/js\/i18n[^/?]*\.js/); if (m) files.push(m[0]); });
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => localStorage.setItem('ld-lang', 'en'));
    await s.page.reload();
    expect(files.filter(f => /i18n-/.test(f))).toEqual([]);              // English needs no file
    files.length = 0;
    await s.page.evaluate(() => localStorage.setItem('ld-lang', 'pt'));
    await s.page.reload();
    expect(files.filter(f => /i18n-/.test(f))).toEqual(['/static/js/i18n-pt.js']);
    expect((await s.context.request.get(BASE_URL + '/static/js/i18n-dict.js')).status()).toBe(404);
    await s.context.close();
  });

  test('the chosen language is applied on the first paint (no English flash) and the switch loads the file', async () => {
    const s = await newSession();
    await s.page.addInitScript(() => { try { localStorage.setItem('ld-lang', 'pt'); } catch (_) {} });
    await s.page.goto(BASE_URL + '/');
    expect(await s.page.evaluate(() => (window as any).LDI18n.lang())).toBe('pt');
    expect(await s.page.evaluate(() => document.documentElement.lang)).toBe('pt-BR');
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    expect(await s.page.locator('#upm-btn-logout').innerText()).toContain('Sair');
    // switching to a language that is not loaded yet fetches its file
    await s.page.evaluate(() => (window as any).LDI18n.setLang('zh'));
    expect(await s.page.evaluate(() => (window as any).LDI18n.lang())).toBe('zh');
    expect(await s.page.locator('#upm-btn-logout').innerText()).toContain('退出');
    await s.context.close();
  });

  test('the picker lists the 15 languages by their own names, and each one loads and sets the page language', async () => {
    const s = await newSession();
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => (window as any).openUserProfileModal());   // the picker lives in the profile modal
    const names = await s.page.evaluate(() => Array.from((document.querySelector('.lang-select') as HTMLSelectElement).options).map(o => o.textContent));
    expect(names).toEqual(['English', 'Čeština', 'Español', 'Português', 'Français', 'Deutsch', 'Svenska', 'Türkçe', 'Italiano', '简体中文', 'Norsk', 'Русский', 'Dansk', '한국어', '日本語']);
    const html: Record<string, string> = { en: 'en', cs: 'cs', es: 'es', pt: 'pt-BR', fr: 'fr', de: 'de', sv: 'sv', tr: 'tr', it: 'it', zh: 'zh-CN', nb: 'nb', ru: 'ru', da: 'da', ko: 'ko', ja: 'ja' };
    for (const [code, lang] of Object.entries(html)) {
      await s.page.selectOption('#user-profile-modal .lang-select', code);
      await s.page.waitForFunction((c: string) => (window as any).LDI18n.lang() === c, code, { timeout: 15000 });
      expect(await s.page.evaluate(() => document.documentElement.lang)).toBe(lang);
    }
    await s.context.close();
  });

  test('the browser language picks the first language: Norwegian variants go to nb', async () => {
    for (const [locale, want] of [['fr-CA', 'fr'], ['nn-NO', 'nb'], ['no', 'nb'], ['ja-JP', 'ja'], ['sw', 'en']] as const) {
      const ctx = await (await getBrowser()).newContext({ locale });
      const page = await ctx.newPage();
      await page.goto(BASE_URL + '/');
      expect(await page.evaluate(() => (window as any).LDI18n.lang())).toBe(want);
      await ctx.close();
    }
  });

  test('the privacy policy and the terms show a notice (in the language) when they are only available in English', async () => {
    const s = await newSession();
    await s.page.goto(BASE_URL + '/privacy');
    await s.page.evaluate(() => (window as any).LDI18n.setLang('fr'));
    expect(await s.page.locator('#legal-lang-note').isVisible()).toBe(true);
    expect(await s.page.locator('#legal-lang-note').innerText()).toContain('anglais');
    await s.page.goto(BASE_URL + '/terms');
    await s.page.evaluate(() => (window as any).LDI18n.setLang('ja'));
    expect(await s.page.locator('#legal-lang-note').isVisible()).toBe(true);
    await s.page.evaluate(() => (window as any).LDI18n.setLang('pt'));
    expect(await s.page.locator('#legal-lang-note').isVisible()).toBe(false);   // translated: no notice
    await s.page.evaluate(() => (window as any).LDI18n.setLang('en'));
    expect(await s.page.locator('#legal-lang-note').isVisible()).toBe(false);
    await s.context.close();
  });

  test('no interface text is left in English in any new language (dashboard and editor)', async () => {
    const s = await newSession();
    await s.page.goto(BASE_URL + '/');
    const pt = await loadTables(s.page).then(t => Object.keys(t.pt));
    const leftover: Record<string, string[]> = {};
    const scan = (lang: string) => s.page.evaluate(({ keys, lang }: { keys: string[]; lang: string }) => {
      const tables = (window as any).LD_I18N, tab = tables[lang]; const known = new Set(keys);
      const SKIP = '[data-no-i18n], .lang-select, .monaco-editor, pre, code, textarea, script, style, .tree-name, .tab-name, .pl-title, #raw-log';
      const out: string[] = [];
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = tw.nextNode())) {
        const el = n.parentElement; if (!el || el.closest(SKIP)) continue;
        const text = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (text.length > 3 && known.has(text) && !(text in tab)) out.push(text);
      }
      return Array.from(new Set(out));
    }, { keys: pt, lang });
    for (const lang of NEW_LANGS) {
      await s.page.goto(BASE_URL + '/');
      await s.page.evaluate(l => (window as any).LDI18n.setLang(l), lang);
      await s.page.waitForTimeout(600);
      leftover[lang + ' dashboard'] = await scan(lang);
    }
    for (const lang of ['fr', 'ja', 'ru']) {
      await openProject(s.page);
      await s.page.evaluate(l => (window as any).LDI18n.setLang(l), lang);
      await s.page.waitForTimeout(1500);
      leftover[lang + ' editor'] = await scan(lang);
    }
    await s.page.evaluate(() => (window as any).LDI18n.setLang('en'));
    await s.context.close();
    const found = Object.fromEntries(Object.entries(leftover).filter(([, v]) => v.length));
    expect(found).toEqual({});
  });
});

describe('interface without English text when the language is Chinese', () => {
  const found: Record<string, string[]> = {};
  // Not interface: the person's name, sample document text, language names and example URLs.
  const OK = /Demo User|Português \(BR\)|English|github\.com\/owner/;

  test('dashboard, editor and administration', async () => {
    const s = await newSession();
    await s.page.goto(BASE_URL + '/');
    await s.page.evaluate(() => (window as any).LDI18n.setLang('zh'));
    for (const [name, url] of [['dashboard', '/'], ['admin', '/admin'], ['terms', '/terms'], ['privacy', '/privacy']] as const) {
      await s.page.goto(BASE_URL + url);
      await s.page.waitForTimeout(1500);
      found[name] = await s.page.evaluate(SCAN);
    }
    await openProject(s.page);
    await s.page.waitForTimeout(2500);
    found['editor'] = await s.page.evaluate(SCAN);
    await s.context.close();
    for (const [screen, items] of Object.entries(found)) {
      if (screen === 'terms' || screen === 'privacy') continue; // legal texts, still English/Portuguese only
      expect(items.filter(i => !OK.test(i))).toEqual([]);
    }
  });
});
