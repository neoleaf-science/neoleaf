import { afterAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, settled, type Session } from '../helpers';

// In-browser spell check (Hunspell compiled to WebAssembly, in a Web Worker): which dictionary a document gets, what is underlined,
// the project dictionary in .neoleaf/dictionary.txt, the setting and a dictionary that fails to load.

const PT = 'Esta frase tem uma palavra errda e outras palavras corretas, não é mesmo?';
const EN = 'Hello wrold, this is a corect sentence about the results of the experiment.';
const doc = (body: string, preamble = '') => `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;

// the text under every spell-check marker of the open file
const marked = (s: Session): Promise<string[]> =>
  s.page.evaluate(() => {
    const model = (globalThis as any).eval('editor.getModel()');
    return (window as any).monaco.editor.getModelMarkers({ owner: 'spellcheck' }).map((m: any) => model.getValueInRange(m));
  });
const setDoc = (s: Session, text: string) => s.page.evaluate(t => (globalThis as any).eval(`editor.setValue(${JSON.stringify(t)})`), text);
const spellState = (s: Session): Promise<string> => s.page.evaluate(() => (window as any).SpellCheck.getState());

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

async function fresh(lang = 'en'): Promise<Session> {
  const s = await newSession();
  await s.page.addInitScript(l => { try { localStorage.setItem('ld-lang', l); } catch (_) {} }, lang);
  await openProject(s.page);
  await s.page.waitForFunction(() => !!(window as any).SpellCheck, null, { timeout: 15000 });
  return s;
}

describe('spell check: English', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });

  test('underlines the misspelled words and only them, each on the right text', async () => {
    s = await fresh();
    await setDoc(s, doc(EN));
    const m = await waitMarked(s, m => m.length > 0);
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

describe('spell check: Portuguese', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });

  test('babel brazil: the Portuguese dictionary loads and only the misspelled word is underlined', async () => {
    s = await fresh();
    await setDoc(s, doc(PT, '\\usepackage[brazil]{babel}\n'));
    const m = await waitMarked(s, m => m.length > 0, 60000);
    expect(m).toEqual(['errda']);
    expect(await s.page.evaluate(() => (window as any).SpellCheck.getActiveLanguage())).toBe('pt-BR');
  }, 120000);

  test('accented and hyphenated words, and words from the affix rules, are accepted', async () => {
    await setDoc(s, doc('Computação, análise, números e-mail guarda-chuva casa-grande fazendo escrevemos apresentamos analisamos utilizando através.', '\\usepackage[brazil]{babel}\n'));
    await waitMarked(s, () => false, 4000);
    expect(await marked(s)).toEqual([]);
  }, 60000);

  test('changing the language of the document replaces the underlines, none of the old ones stay', async () => {
    await setDoc(s, doc(EN));
    const m = await waitMarked(s, m => m.includes('wrold'), 60000);
    expect(m.sort()).toEqual(['corect', 'wrold']);
  }, 90000);
});

describe('spell check: no preamble, language from the words or from the interface', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });

  test('Portuguese text with the interface in Portuguese uses the Portuguese dictionary', async () => {
    s = await fresh('pt');
    await setDoc(s, doc(PT));
    const m = await waitMarked(s, m => m.length > 0, 60000);
    expect(m).toEqual(['errda']);
  }, 120000);

  test('English text with the interface in Portuguese uses the English dictionary', async () => {
    await setDoc(s, doc(EN));
    const m = await waitMarked(s, m => m.includes('wrold'), 60000);
    expect(m.sort()).toEqual(['corect', 'wrold']);
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

  test('a French document (babel french) is left alone, not underlined with the English dictionary', async () => {
    s = await fresh();
    await setDoc(s, doc('Ceci est une phrase en français avec des mots corrects.', '\\usepackage[french]{babel}\n'));
    expect(await quiet(s, 4000)).toEqual([]);
    expect(await s.page.evaluate(() => (window as any).SpellCheck.getActiveLanguage())).toBe(null);
  }, 60000);

  test('the language is chosen from the preamble, the words and the interface', async () => {
    const pick = (text: string, kind = 'latex', cfg = 'auto', ui = 'en') =>
      s.page.evaluate(([t, k, c, u]) => (window as any).SpellCheck.detectLanguage(t, k, c, u), [text, kind, cfg, ui] as string[]);
    const es = 'Este es un documento escrito en español para los estudiantes que quieren aprender con los ejemplos del curso, pero también para los profesores.';
    const de = 'Das ist ein Dokument, das nicht in englischer Sprache geschrieben ist und mit den Studenten von der Universität auf dem Weg ist, wir sind auch dabei.';
    const it = 'Questo è un documento che non è scritto in inglese per gli studenti della università, con gli esempi del corso e anche più di questo, come sono nel nostro programma.';
    expect(await pick(doc('x', '\\usepackage[english,brazil]{babel}\n'))).toBe('pt-BR');           // the last option is the main language
    expect(await pick(doc('x', '\\usepackage[brazil,english]{babel}\n'))).toBe('en-US');
    expect(await pick(doc('x', '\\usepackage[main=brazil,english]{babel}\n'))).toBe('pt-BR');
    expect(await pick(doc('x', '\\usepackage[spanish]{babel}\n'))).toBe(null);
    expect(await pick(doc('x', '\\usepackage{polyglossia}\n\\setmainlanguage{portuguese}\n'))).toBe('pt-BR');
    expect(await pick(doc('x', '\\usepackage{polyglossia}\n\\setmainlanguage{german}\n'))).toBe(null);
    expect(await pick(doc(PT.repeat(3)))).toBe('pt-BR');
    expect(await pick(doc(EN), 'latex', 'auto', 'pt')).toBe('en-US');
    expect(await pick(doc(es.repeat(2)))).toBe(null);
    expect(await pick(doc(de.repeat(2)))).toBe(null);
    expect(await pick(doc(it.repeat(2)))).toBe(null);
    expect(await pick(doc('x'), 'latex', 'auto', 'pt')).toBe('pt-BR');                           // nothing to go on: the interface language
    expect(await pick(doc('x'), 'latex', 'auto', 'es')).toBe('en-US');
    expect(await pick(doc(EN), 'latex', 'pt-BR', 'en')).toBe('pt-BR');                           // the project setting wins
  }, 60000);
});

describe('spell check: a dictionary that fails to load', () => {
  let s: Session;
  afterAll(async () => { await s?.context.close(); });

  test('shows a notice, underlines nothing and leaves no old underline behind, then recovers when the setting is applied again', async () => {
    s = await newSession();
    await openProject(s.page);
    await s.page.waitForFunction(() => !!(window as any).SpellCheck, null, { timeout: 15000 });
    // English works first, so there are real underlines that must disappear when the language changes
    await setDoc(s, doc(EN));
    await waitMarked(s, m => m.includes('wrold'));
    await s.context.route('**/static/dict/pt-BR.*', r => r.abort());
    await setDoc(s, doc(PT, '\\usepackage[brazil]{babel}\n'));
    await s.page.waitForFunction(() => (window as any).SpellCheck.getState() === 'error', null, { timeout: 30000 });
    expect(await marked(s)).toEqual([]);
    await setDoc(s, doc(PT + ' Mais um erroo.', '\\usepackage[brazil]{babel}\n'));
    expect(await quiet(s, 2000)).toEqual([]);
    expect(await spellState(s)).toBe('error');
    await s.context.unroute('**/static/dict/pt-BR.*');
    await s.page.evaluate(() => (window as any).SpellCheck.applyConfig({ spellCheck: true, spellLanguage: 'auto' }));
    const m = await waitMarked(s, m => m.includes('erroo'), 60000);
    expect(m.sort()).toEqual(['errda', 'erroo']);
  }, 180000);
});
