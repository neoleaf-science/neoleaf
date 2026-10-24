import { afterAll, describe, expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserContext } from 'playwright';
import { BASE_URL, newSession, openProject, settled, type Session } from '../helpers';

// In-browser spell check (Hunspell compiled to WebAssembly, in a Web Worker). NeoLeaf hosts no dictionary: the browser asks the person, downloads the
// pinned file from GitHub (jsDelivr as a mirror), checks its SHA-256 and keeps it on the device. The tests serve those files from a disk cache
// (downloaded once from the real addresses and checked against the same hashes) and count the requests that reach "GitHub" and "the mirror".

const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, '../../../static/js/spellcheck-dicts.js'), 'utf8').replace(/^[\s\S]*?self\.NEOLEAF_DICTS = /, '').replace(/;\s*$/, ''));
const DICT_IDS: string[] = manifest.list.map((d: any) => d.id);
const CACHE_DIR = path.join(os.tmpdir(), 'neoleaf-e2e-dict-cache');

async function upstreamBytes(file: { path: string; size: number; sha256: string }): Promise<Buffer> {
  const local = path.join(CACHE_DIR, file.sha256);
  if (fs.existsSync(local)) return fs.readFileSync(local);
  const res = await fetch(manifest.raw + file.path);
  if (!res.ok) throw new Error(`cannot download ${file.path}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(local, bytes);
  return bytes;
}

interface Upstream { raw: number; mirror: number; urls: string[] }
interface UpstreamOptions { failRaw?: (n: number) => boolean; failMirror?: boolean; tamper?: boolean }

// Answers the requests for the pinned addresses with the real files and counts them.
async function serveUpstream(context: BrowserContext, opts: UpstreamOptions = {}): Promise<Upstream> {
  const seen: Upstream = { raw: 0, mirror: 0, urls: [] };
  const files = new Map<string, any>();
  for (const d of manifest.list) for (const f of d.files) { files.set(manifest.raw + f.path, f); files.set(manifest.mirror + f.path, f); }
  await context.route(url => url.href.startsWith(manifest.raw) || url.href.startsWith(manifest.mirror), async route => {
    const url = route.request().url();
    const isRaw = url.startsWith(manifest.raw);
    seen.urls.push(url);
    if (isRaw) seen.raw++; else seen.mirror++;
    if (isRaw ? opts.failRaw?.(seen.raw) : opts.failMirror) return route.abort();
    const file = files.get(url);
    if (!file) return route.fulfill({ status: 404, body: 'not found' });
    let body = await upstreamBytes(file);
    if (opts.tamper) { body = Buffer.from(body); body[body.length - 1] ^= 1; }
    return route.fulfill({ status: 200, body, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' } });
  });
  return seen;
}

const PT = 'Esta frase tem uma palavra errda e outras palavras corretas, não é mesmo?';
const EN = 'Hello wrold, this is a corect sentence about the results of the experiment.';
const doc = (body: string, preamble = '') => `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;
const babel = (opt: string) => `\\usepackage[${opt}]{babel}\n`;

// the text under every spell-check marker of the open file
const marked = (s: Session): Promise<string[]> =>
  s.page.evaluate(() => {
    const model = (globalThis as any).eval('editor.getModel()');
    return (window as any).monaco.editor.getModelMarkers({ owner: 'spellcheck' }).map((m: any) => model.getValueInRange(m));
  });
const setDoc = (s: Session, text: string) => s.page.evaluate(t => (globalThis as any).eval(`editor.setValue(${JSON.stringify(t)})`), text);
const spellState = (s: Session): Promise<string> => s.page.evaluate(() => (window as any).SpellCheck.getState());
const banner = (s: Session): Promise<string | null> => s.page.evaluate(() => document.querySelector('.spell-banner')?.textContent || null);

async function waitMarked(s: Session, ok: (m: string[]) => boolean, ms = 30000): Promise<string[]> {
  const start = Date.now();
  let m: string[] = [];
  while (Date.now() - start < ms) {
    m = await marked(s);
    if (ok(m)) return m;
    await new Promise(r => setTimeout(r, 300));
  }
  return m;
}
const quiet = (s: Session, ms = 3000) => new Promise(r => setTimeout(r, ms)).then(() => marked(s));

interface FreshOptions { lang?: string; consent?: boolean; upstream?: UpstreamOptions }
// A session with the project open; by default the person has already agreed to every download (the consent tests turn that off).
async function fresh(opts: FreshOptions = {}): Promise<{ s: Session; up: Upstream }> {
  const s = await newSession();
  const up = await serveUpstream(s.context, opts.upstream);
  await s.page.addInitScript(([l, ids, consent]) => {
    try {
      localStorage.setItem('ld-lang', l as string);
      if (consent) for (const id of ids as string[]) localStorage.setItem('neoleaf.spell.consent.' + id, '1');
    } catch (_) {}
  }, [opts.lang || 'en', DICT_IDS, opts.consent !== false] as const);
  await openProject(s.page);
  await s.page.waitForFunction(() => !!(window as any).SpellCheck, null, { timeout: 15000 });
  return { s, up };
}

describe('spell check: the person is asked before a dictionary is downloaded', () => {
  let s: Session;
  let up: Upstream;
  afterAll(async () => { await s?.context.close(); });

  test('nothing is downloaded until the person agrees; then it is, and the underlines come', async () => {
    ({ s, up } = await fresh({ consent: false }));
    await setDoc(s, doc(EN));
    await s.page.waitForSelector('.spell-banner', { timeout: 30000 });
    const text = (await banner(s))!;
    expect(text).toContain('English (US)');
    expect(text).toMatch(/\d\.\d MB/);
    expect(text).toContain('GitHub');
    expect(await spellState(s)).toBe('needs');
    expect(await quiet(s, 2500)).toEqual([]);
    expect(up.raw + up.mirror).toBe(0);
    await s.page.click('.spell-banner button:has-text("Download")');
    const m = await waitMarked(s, m => m.length > 0, 60000);
    expect(m.sort()).toEqual(['corect', 'wrold']);
    expect(up.raw).toBe(2); // the .aff and the .dic, once each
    expect(up.mirror).toBe(0);
    expect(await banner(s)).toBe(null);
  }, 150000);

  test('the dictionary stays on the device: after a reload it works, with no new download and no question', async () => {
    const before = up.raw + up.mirror;
    await s.page.reload();
    await s.page.waitForSelector('.monaco-editor');
    await settled(s.page);
    await setDoc(s, doc(EN));
    const m = await waitMarked(s, m => m.includes('wrold'), 60000);
    expect(m.sort()).toEqual(['corect', 'wrold']);
    expect(up.raw + up.mirror).toBe(before);
    expect(await banner(s)).toBe(null);
    // and it is kept in the Cache API of the browser, not sent anywhere else
    const kept: string[] = await s.page.evaluate(async () => (await (await caches.open('neoleaf-dictionaries-v1')).keys()).map(r => r.url));
    expect(kept.length).toBe(2);
  }, 120000);
});

describe('spell check: "Not now"', () => {
  test('hides the question, underlines nothing and downloads nothing, also while typing', async () => {
    const { s, up } = await fresh({ consent: false });
    await setDoc(s, doc(EN));
    await s.page.waitForSelector('.spell-banner', { timeout: 30000 });
    await s.page.click('.spell-banner button:has-text("Not now")');
    expect(await banner(s)).toBe(null);
    await setDoc(s, doc(EN + ' More wrold here.'));
    expect(await quiet(s, 3000)).toEqual([]);
    expect(await banner(s)).toBe(null);
    expect(up.raw + up.mirror).toBe(0);
    await s.context.close();
  }, 120000);
});

describe('spell check: NeoLeaf hosts no dictionary', () => {
  test('the server has no dictionary files', async () => {
    const s = await newSession();
    for (const f of ['en-US.aff', 'en-US.dic', 'pt-BR.aff', 'pt-BR.dic']) {
      const r = await s.page.request.get(`${BASE_URL}/static/dict/${f}`);
      expect(r.status()).toBe(404);
    }
    await s.context.close();
  }, 60000);
});

describe('spell check: the download is checked', () => {
  test('a file that does not match the pinned SHA-256 is refused, nothing is kept and the person is told', async () => {
    const { s, up } = await fresh({ upstream: { tamper: true } });
    await setDoc(s, doc(EN));
    await s.page.waitForFunction(() => (window as any).SpellCheck.getState() === 'error', null, { timeout: 90000 }); // after two retries
    expect(await marked(s)).toEqual([]);
    expect(up.raw).toBeGreaterThanOrEqual(3);
    expect(up.mirror).toBeGreaterThanOrEqual(3); // the mirror is tried each time, and it is tampered too
    const kept: string[] = await s.page.evaluate(async () => (await (await caches.open('neoleaf-dictionaries-v1')).keys()).map(r => r.url));
    expect(kept).toEqual([]);
    await s.context.close();
  }, 200000);

  test('when GitHub fails the mirror is used', async () => {
    const { s, up } = await fresh({ upstream: { failRaw: () => true } });
    await setDoc(s, doc(EN));
    const m = await waitMarked(s, m => m.includes('wrold'), 60000);
    expect(m.sort()).toEqual(['corect', 'wrold']);
    expect(up.mirror).toBeGreaterThanOrEqual(2);
    await s.context.close();
  }, 150000);

  test('a download that fails once is tried again by itself and then works', async () => {
    const { s, up } = await fresh({ upstream: { failRaw: n => n <= 1, failMirror: true } });
    await setDoc(s, doc(PT, babel('brazil')));
    const m = await waitMarked(s, m => m.includes('errda'), 90000);
    expect(m).toEqual(['errda']);
    expect(up.raw).toBeGreaterThanOrEqual(3);
    expect(await spellState(s)).toBe('ready');
    await s.context.close();
  }, 150000);
});

describe('spell check: English', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });

  test('underlines the misspelled words and only them, each on the right text', async () => {
    ({ s } = await fresh());
    await setDoc(s, doc(EN));
    const m = await waitMarked(s, m => m.length > 0, 60000);
    expect(m.sort()).toEqual(['corect', 'wrold']);
  }, 120000);

  test('LaTeX commands, math, labels, citations and comments are not checked', async () => {
    await setDoc(s, doc('Real words $xqzvw + \\alpha$ \\label{qzxv} \\cite{wxyzq} \\textbf{bold} % qwxzv in a comment\n\\begin{equation} zzqqx \\end{equation}\nOnly xyzzyq counts.'));
    const m = await waitMarked(s, m => m.includes('xyzzyq'));
    expect(m).toEqual(['xyzzyq']);
  }, 60000);

  test('suggestions come from the dictionary', async () => {
    const list: string[] = await s.page.evaluate(() => (window as any).SpellCheck.suggest('wrold'));
    expect(list).toContain('world');
  }, 30000);

  test('a word added to the project dictionary stops being underlined and is saved in .neoleaf/dictionary.txt', async () => {
    await setDoc(s, doc('The word zzquux and the word wrold.'));
    expect((await waitMarked(s, m => m.includes('zzquux'))).sort()).toEqual(['wrold', 'zzquux']);
    await s.page.evaluate(() => (window as any).SpellCheck.addToDictionary('zzquux'));
    expect(await waitMarked(s, m => !m.includes('zzquux'), 8000)).toEqual(['wrold']);
    const file: string = await s.page.evaluate(async () => await (window as any).BrowserGit.readFile('.neoleaf/dictionary.txt', 'utf8'));
    expect(file).toContain('zzquux');
    await setDoc(s, doc('Again zzquux and wrold.'));
    expect(await waitMarked(s, m => m.includes('wrold'))).toEqual(['wrold']);
  }, 90000);

  test('"ignore in this session" hides the word without saving it', async () => {
    await setDoc(s, doc('Ignore blorpt here.'));
    await waitMarked(s, m => m.includes('blorpt'));
    await s.page.evaluate(() => (window as any).SpellCheck.ignoreWord('blorpt'));
    expect(await marked(s)).toEqual([]);
    const file: string = await s.page.evaluate(async () => await (window as any).BrowserGit.readFile('.neoleaf/dictionary.txt', 'utf8'));
    expect(file).not.toContain('blorpt');
  }, 60000);

  test('turning the setting off removes the underlines, turning it on brings them back', async () => {
    await setDoc(s, doc('A wrold again.'));
    await waitMarked(s, m => m.includes('wrold'));
    await s.page.evaluate(() => (window as any).SpellCheck.applyConfig({ spellCheck: false, spellLanguage: 'auto' }));
    expect(await marked(s)).toEqual([]);
    await setDoc(s, doc('A wrold again and again.'));
    expect(await quiet(s)).toEqual([]);
    await s.page.evaluate(() => (window as any).SpellCheck.applyConfig({ spellCheck: true, spellLanguage: 'auto' }));
    expect(await waitMarked(s, m => m.includes('wrold'))).toEqual(['wrold']);
  }, 90000);
});

describe('spell check: one dictionary per language', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });

  // [dictionary, babel option, a correct text, a misspelled word, a word the dictionary of ANOTHER variant does not accept (optional)]
  const CASES: [string, string, string, string][] = [
    ['pt-BR', 'brazil', 'Esta frase tem uma palavra errda e outras palavras corretas, não é mesmo? Computação, análise, e-mail, guarda-chuva.', 'errda'],
    ['pt-PT', 'portuges', 'Este documento está escrito em português e contém algumas palavras comuns para os estudantes da universidade. Documneto.', 'Documneto'],
    ['en-US', 'english', 'This document is written in English and contains some common words for university students. Documnet.', 'Documnet'],
    ['en-GB', 'british', 'This document is written in English and contains some common words for university students, in colour. Documnet.', 'Documnet'],
    ['es-ES', 'spanish', 'Este documento está escrito en español y contiene algunas palabras comunes para los estudiantes de la universidad. Documneto.', 'Documneto'],
    ['fr-FR', 'french', 'Ce document est écrit en français et contient quelques mots courants pour les étudiants de cette université. Documnet.', 'Documnet'],
    ['it-IT', 'italian', 'Questo documento è scritto in italiano e contiene alcune parole comuni per gli studenti della università. Documneto.', 'Documneto'],
    ['de-DE', 'ngerman', 'Dieses Dokument ist in deutscher Sprache geschrieben und enthält einige gebräuchliche Wörter für Studenten der Universität. Dokumnet.', 'Dokumnet'],
  ];

  for (const [id, opt, text, typo] of CASES) {
    test(`${id}: the dictionary is downloaded, accepts a correct text (umlauts, accents, hyphens) and underlines only "${typo}"`, async () => {
      if (!s) ({ s } = await fresh());
      await setDoc(s, doc(text, babel(opt)));
      const m = await waitMarked(s, m => m.includes(typo), 90000);
      expect(m).toEqual([typo]);
      expect(await s.page.evaluate(() => (window as any).SpellCheck.getActiveLanguage())).toBe(id);
    }, 150000);
  }

  test('British spelling is accepted by en-GB and underlined by en-US', async () => {
    await setDoc(s, doc('The colour and the organisation of the centre.', babel('british')));
    await waitMarked(s, () => false, 4000);
    expect(await marked(s)).toEqual([]);
    await setDoc(s, doc('The colour and the organisation of the centre.', babel('american')));
    const m = await waitMarked(s, m => m.includes('colour'), 60000);
    expect(m).toContain('colour');
  }, 150000);
});

describe('spell check: no preamble, language from the words or from the interface', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });

  test('Portuguese text with the interface in Portuguese uses the Portuguese dictionary', async () => {
    ({ s } = await fresh({ lang: 'pt' }));
    await setDoc(s, doc(PT));
    const m = await waitMarked(s, m => m.includes('errda'), 60000);
    expect(m).toEqual(['errda']);
  }, 120000);

  test('English text with the interface in Portuguese uses the English dictionary', async () => {
    await setDoc(s, doc(EN));
    const m = await waitMarked(s, m => m.includes('wrold'), 60000);
    expect(m.sort()).toEqual(['corect', 'wrold']);
  }, 90000);

  test('Spanish text without a preamble is recognised and checked with the Spanish dictionary', async () => {
    await setDoc(s, doc('Este es un documento escrito en español para los estudiantes que quieren aprender con los ejemplos del curso, pero también para los profesores. Un documneto.'));
    const m = await waitMarked(s, m => m.includes('documneto'), 60000);
    expect(m).toEqual(['documneto']);
    expect(await s.page.evaluate(() => (window as any).SpellCheck.getActiveLanguage())).toBe('es-ES');
  }, 90000);

  test('a Markdown file is checked too, and URLs and code are not', async () => {
    await s.page.evaluate(() => (globalThis as any).eval('monaco.editor.setModelLanguage(editor.getModel(), "markdown")'));
    await setDoc(s, 'This is a wrold of text with a [link](https://exxample.org/qqzzx) and `codeqz` and https://zzyyxx.example.org here.\n');
    const m = await waitMarked(s, m => m.includes('wrold'));
    expect(m).toEqual(['wrold']);
  }, 60000);
});

describe('spell check: languages without a dictionary are not checked', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });

  test('a Swedish document (babel swedish) is left alone and nothing is downloaded', async () => {
    let up: Upstream;
    ({ s, up } = await fresh());
    await setDoc(s, doc('Detta är ett dokument skrivet på svenska med några vanliga ord för studenter.', babel('swedish')));
    expect(await quiet(s, 4000)).toEqual([]);
    expect(await s.page.evaluate(() => (window as any).SpellCheck.getActiveLanguage())).toBe(null);
    expect(up.raw + up.mirror).toBe(0);
  }, 60000);

  test('the language is chosen from the project setting, the preamble, the words and the interface', async () => {
    const pick = (text: string, kind = 'latex', cfg = 'auto', ui = 'en') =>
      s.page.evaluate(([t, k, c, u]) => (window as any).SpellCheck.detectLanguage(t, k, c, u), [text, kind, cfg, ui] as string[]);
    const es = 'Este es un documento escrito en español para los estudiantes que quieren aprender con los ejemplos del curso, pero también para los profesores.';
    const de = 'Das ist ein Dokument, das nicht in englischer Sprache geschrieben ist und mit den Studenten von der Universität auf dem Weg ist, wir sind auch dabei.';
    const it = 'Questo è un documento che non è scritto in inglese per gli studenti della università, con gli esempi del corso e anche più di questo, come sono nel nostro programma.';
    const fr = 'Ceci est un document qui est écrit en français pour les étudiants qui ont des examens dans les universités, avec des exemples pour les cours et pas seulement.';
    const sv = 'Detta är ett dokument som är skrivet på svenska och som har några exempel för studenter vid universitetet och för alla som har det som en bok.';
    expect(await pick(doc('x', babel('english,brazil')))).toBe('pt-BR');            // the last option is the main language
    expect(await pick(doc('x', babel('brazil,english')))).toBe('en-US');
    expect(await pick(doc('x', babel('main=brazil,english')))).toBe('pt-BR');
    expect(await pick(doc('x', babel('portuges')))).toBe('pt-PT');
    expect(await pick(doc('x', babel('british')))).toBe('en-GB');
    expect(await pick(doc('x', babel('spanish')))).toBe('es-ES');
    expect(await pick(doc('x', babel('ngerman')))).toBe('de-DE');
    expect(await pick(doc('x', babel('swedish')))).toBe(null);
    expect(await pick(doc('x', '\\usepackage{polyglossia}\n\\setmainlanguage{portuguese}\n'))).toBe('pt-PT');
    expect(await pick(doc('x', '\\usepackage{polyglossia}\n\\setmainlanguage{finnish}\n'))).toBe(null);
    expect(await pick(doc(PT.repeat(3)))).toBe('pt-BR');
    expect(await pick(doc(EN), 'latex', 'auto', 'pt')).toBe('en-US');
    expect(await pick(doc(es.repeat(2)))).toBe('es-ES');
    expect(await pick(doc(de.repeat(2)))).toBe('de-DE');
    expect(await pick(doc(it.repeat(2)))).toBe('it-IT');
    expect(await pick(doc(fr.repeat(2)))).toBe('fr-FR');
    expect(await pick(doc(sv.repeat(2)))).toBe(null);
    expect(await pick(doc('x'), 'latex', 'auto', 'pt')).toBe('pt-BR');               // nothing to go on: the interface language
    expect(await pick(doc('x'), 'latex', 'auto', 'es')).toBe('en-US');
    expect(await pick(doc(EN), 'latex', 'pt-BR', 'en')).toBe('pt-BR');               // the project setting wins
    expect(await pick(doc(EN), 'latex', 'de-DE', 'en')).toBe('de-DE');
  }, 60000);
});

describe('spell check: a dictionary that fails to load', () => {
  test('shows a notice, underlines nothing and leaves no old underline behind, then recovers when the setting is applied again', async () => {
    let failing = true;
    const { s } = await fresh({ upstream: { failRaw: () => failing, failMirror: true } });
    await setDoc(s, doc(PT, babel('brazil')));
    await s.page.waitForFunction(() => (window as any).SpellCheck.getState() === 'error', null, { timeout: 90000 }); // after two retries
    expect(await marked(s)).toEqual([]);
    await setDoc(s, doc(PT + ' Mais um erroo.', babel('brazil')));
    expect(await quiet(s, 2000)).toEqual([]);
    expect(await spellState(s)).toBe('error');
    failing = false; // GitHub answers again
    await s.page.evaluate(() => (window as any).SpellCheck.applyConfig({ spellCheck: true, spellLanguage: 'auto' }));
    const m = await waitMarked(s, m => m.includes('erroo'), 90000);
    expect(m.sort()).toEqual(['errda', 'erroo']);
    await s.context.close();
  }, 300000);
});

describe('spell check: the worker is requested with the version of the page', () => {
  test('so a worker kept in the browser cache is never mixed with a newer page', async () => {
    const s = await newSession();
    await serveUpstream(s.context);
    const urls: string[] = [];
    s.page.on('worker', w => urls.push(w.url()));
    const requests: string[] = [];
    s.page.on('request', r => { if (/spellcheck-worker|hunspell-asm|spellcheck-dicts/.test(r.url())) requests.push(r.url()); });
    await s.page.addInitScript(ids => { for (const id of ids as string[]) localStorage.setItem('neoleaf.spell.consent.' + id, '1'); }, DICT_IDS);
    await openProject(s.page);
    await setDoc(s, doc(EN));
    await waitMarked(s, m => m.includes('wrold'), 60000);
    expect(urls.some(u => /\/static\/js\/spellcheck-worker\.js\?v=\d+/.test(u))).toBe(true);
    expect(requests.some(u => /hunspell-asm\.min\.js\?v=\d+/.test(u))).toBe(true);
    expect(requests.some(u => /spellcheck-dicts\.js\?v=\d+/.test(u))).toBe(true);
    await s.context.close();
  }, 120000);
});
