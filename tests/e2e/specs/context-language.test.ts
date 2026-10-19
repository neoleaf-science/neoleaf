import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, type Session } from '../helpers';

// ConTeXt in the editor: own language for .mkiv/.mkxl, suggestions from the index, folding, structure and log errors.
describe('editor: ConTeXt', () => {
  let s: Session;
  const MAIN = '\\startproduct main\n\\startchapter[title={Introduction}]\nText.\n\\input chapters/two\n\\component three\n\\stopchapter\n\\stopproduct\n';
  beforeAll(async () => {
    s = await newSession();
    await openProject(s.page);
    await s.page.evaluate(async main => {
      const B = (window as any).BrowserGit;
      await B.writeFile('book.mkiv', main);
      await B.writeFile('chapters/two.tex', '\\startsection[title={Section two}]\n\\externalfigure[figs/map.png][width=5cm]\n\\stopsection\n');
      await B.writeFile('three.mkiv', '\\startcomponent three\n\\startsection[title={Third, with comma}, reference=sec:three]\n\\stopsection\n\\stopcomponent\n');
      await B.writeFile('loose.mkiv', '\\startsection[title={Loose}]\n\\stopsection\n');
      await (window as any).FT.refreshFromBrowserGit();
      (window as any).FT.openPath('book.mkiv');
    }, MAIN);
    await s.page.waitForFunction(() => (globalThis as any).eval('currentFileId') === 'book.mkiv', null, { timeout: 15000 });
    // the editor is read-only while the project loads; without this Monaco does not open the suggestion list
    await s.page.waitForFunction(() => !(globalThis as any).eval('editor').getOption((globalThis as any).eval('monaco').editor.EditorOption.readOnly), null, { timeout: 30000 });
  });
  afterAll(async () => { await s.context.close(); });

  test('.mkiv, .mkxl and .mkvi use the context language; .tex stays latex', async () => {
    const r = await s.page.evaluate(() => ({
      mkiv: (window as any).LD.languageFor('a.mkiv'), mkxl: (window as any).LD.languageFor('a.mkxl'), mkvi: (window as any).LD.languageFor('a.mkvi'), tex: (window as any).LD.languageFor('a.tex'),
      open: (globalThis as any).eval('editor').getModel().getLanguageId(),
    }));
    expect(r).toEqual({ mkiv: 'context', mkxl: 'context', mkvi: 'context', tex: 'latex', open: 'context' });
  });

  test('highlighting: blocks, titles, keys and comments have their own colors', async () => {
    const toks = await s.page.evaluate(() => {
      const m = (globalThis as any).eval('monaco');
      return m.editor.tokenize('\\startsection[title={X}] % nota\n\\setupbodyfont[12pt]\n\\starttyping\n\\x\n\\stoptyping', 'context').map((l: any[]) => l.map(t => t.type));
    });
    expect(toks[0]).toContain('keyword.section.context');
    expect(toks[0]).toContain('attribute.name.context');
    expect(toks[0]).toContain('comment.context');
    expect(toks[1]).toContain('keyword.preamble.context');
    expect(toks[3]).toContain('string.verbatim.context'); // inside \starttyping
  });

  async function suggestions(text: string) {
    await s.page.evaluate(() => (window as any).LDContext.loadIndex());
    await s.page.evaluate(t => {
      const ed = (globalThis as any).eval('editor');
      ed.getModel().setValue(t);
      const last = ed.getModel().getLineCount();
      ed.setPosition({ lineNumber: last, column: ed.getModel().getLineMaxColumn(last) });
      ed.focus();
    }, text);
    await s.page.evaluate(() => (globalThis as any).eval('editor').trigger('test', 'editor.action.triggerSuggest', {}));
    await s.page.waitForSelector('.suggest-widget.visible', { timeout: 15000 });
    await s.page.waitForTimeout(400);
    return s.page.$$eval('.suggest-widget .monaco-list-row', rows => rows.map(r => (r.getAttribute('aria-label') || r.textContent || '')));
  }

  test('suggests ConTeXt commands from the index', async () => {
    const rows = await suggestions('\\setupbodyf');
    expect(rows.some(r => r.includes('\\setupbodyfont'))).toBe(true);
  });

  test('inside [ ] suggests the keys and values of the command', async () => {
    const keys = await suggestions('\\startsection[ti');
    expect(keys.some(r => r.includes('title'))).toBe(true);
    await s.page.keyboard.press('Escape');
    const vals = await suggestions('\\setupbodyfont[');
    expect(vals.some(r => /\brm\b/.test(r))).toBe(true);
  });

  test('folds the pairs \\start...\\stop... and ignores what is commented out', async () => {
    const ranges = await s.page.evaluate(() => {
      const m = (globalThis as any).eval('monaco');
      const model = m.editor.createModel('\\starttext\n\\startsection[title={a}]\ntext\n%\\startfake\n\\stopsection\n\\stoptext\n', 'context');
      const r = (window as any).LDContext.foldingRanges(model, m).map((x: any) => [x.start, x.end]);
      model.dispose();
      return r;
    });
    expect(ranges).toEqual([[2, 4], [1, 5]]);
  });

  test('structure: follows \\input and \\component, reads title={...} and finds the images', async () => {
    const r = await s.page.evaluate(async () => {
      const B = (window as any).BrowserGit;
      const files: Record<string, string> = {};
      for (const f of ['book.mkiv', 'chapters/two.tex', 'three.mkiv', 'loose.mkiv']) files[f] = await B.readFile(f);
      const p = (window as any).LDOutline.parse(files, 'book.mkiv', true, true);
      return { items: p.items.map((i: any) => `${i.kind || 's'}|${i.path}:${i.line}|${i.title}`), orphans: p.orphans.map((o: any) => o.path) };
    });
    expect(r.items).toEqual([
      's|book.mkiv:2|Introduction',
      's|chapters/two.tex:1|Section two',
      'image|chapters/two.tex:2|figs/map.png',
      's|three.mkiv:2|Third, with comma',
    ]);
    expect(r.orphans).toEqual(['loose.mkiv']);
  });

  test('ConTeXt errors in the log become diagnostics with the line', async () => {
    const d = await s.page.evaluate(() => (globalThis as any).eval('parseLogToDiagnostics')(
      'tex error       > tex error on line 3 in file ./chapters/two.tex: Undefined control sequence\nmtx-context     | fatal error: return code: 1\n'));
    expect(d).toEqual([{ line: 3, message: 'Undefined control sequence (chapters/two.tex)', is_error: true }]);
  });
});
