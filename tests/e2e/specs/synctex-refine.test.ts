import { afterAll, describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { currentFile, newSession, openProject, poll, type Session } from '../helpers';

// Double click on the PDF: SyncTeX says where TeX was reading, which for a title or a heading that a class prints is the class (or the \maketitle line), not
// the place where the person wrote the words. The words under the click are looked for in the .tex files, and the SyncTeX line is kept only when it has them.

let s: Session;
afterAll(async () => { await s?.context.close(); });

const run = <T>(fn: string, ...args: any[]) => s.page.evaluate(([f, a]) => (window as any).SyncTeX[f as string](...(a as any[])), [fn, args] as any) as Promise<T>;

describe('finding where the clicked words are written', () => {
  test('words are compared without case, accents or ligatures, and commands and comments are left out', async () => {
    s = await newSession();
    await openProject(s.page);
    expect(await run('wordsOf', 'The ﬁrst Ação, Naïve 42')).toEqual(['the', 'first', 'acao', 'naive', '42']);
    const toks = await run<any[]>('tokenize', '\\title{The Name}\n% a comment about nothing\n\\textbf{bold} text \\% not a comment\n');
    expect(toks.map(t => `${t.w}@${t.line}`)).toEqual(['the@1', 'name@1', 'bold@3', 'text@3', 'not@3', 'a@3', 'comment@3']);
  }, 120000);

  test('a phrase is found in the file and line where it is written, the nearest to the SyncTeX answer first', async () => {
    const files = [
      { path: 'main.tex', text: '\\documentclass{article}\n\\title{The Name of the Title Is Hope}\n\\begin{document}\n\\maketitle\nHello world, a long hello.\n\\end{document}\n' },
      { path: 'sections/a.tex', text: 'Hello world again.\n\nMore text.\nHello world once more.\n' },
    ];
    expect(await run('findPhrase', files, ['name', 'of', 'the', 'title'], null, 'main.tex')).toEqual({ path: 'main.tex', line: 2 });
    // the same words twice: the one nearest to the SyncTeX answer
    expect(await run('findPhrase', files, ['hello', 'world'], { path: 'sections/a.tex', line: 4 }, 'main.tex')).toEqual({ path: 'sections/a.tex', line: 4 });
    expect(await run('findPhrase', files, ['hello', 'world'], { path: 'sections/a.tex', line: 1 }, 'main.tex')).toEqual({ path: 'sections/a.tex', line: 1 });
    // nothing to tell places apart: a short word, or a word that is everywhere
    expect(await run('findPhrase', files, ['of'], null, 'main.tex')).toBeNull();
    expect(await run('findPhrase', files, ['hello'], null, 'main.tex')).toBeNull();
    expect(await run('findPhrase', files, ['hope'], null, 'main.tex')).toEqual({ path: 'main.tex', line: 2 });
    expect(await run('findPhrase', files, ['absent', 'words'], null, 'main.tex')).toBeNull();
  }, 30000);

  test('the SyncTeX line is kept when it has the word (near it), and not when it is a macro line', async () => {
    const text = 'Intro line\n\\begin{document}\n\\maketitle\nSome real text here\nmore text\n';
    expect(await run('lineHasWord', text, 4, 'real', 1)).toBe(true);
    expect(await run('lineHasWord', text, 5, 'real', 1)).toBe(true);     // a space or a kern belongs to the line where it was made: one line of slack
    expect(await run('lineHasWord', text, 3, 'title', 1)).toBe(false);   // \maketitle: the word is not written there
    expect(await run('lineHasWord', 'a\nb\nc\nd\ne\nf\nreal\n', 1, 'real', 1)).toBe(false);
    expect(await run('lineHasWord', '\\title{The Name}\n\n\\maketitle\n', 3, 'name', 1)).toBe(false);
    // the line where the word is written: the nearest to the SyncTeX one (the blank line that ended a paragraph points to the line above it)
    expect(await run('nearestLineWithWord', 'x\nfirst pelicans here\n\nnext\n', 3, 'pelicans', 1)).toBe(2);
    expect(await run('nearestLineWithWord', 'pelicans\npelicans\n', 1.5, 'pelicans', 1)).toBe(1);   // a tie: the earlier one
    expect(await run('nearestLineWithWord', 'x\nfirst pelicans here\n\nnext\n', 4, 'pelicans', 1)).toBeNull();
    // a common word does not tell the paragraphs apart; the phrase around it does
    const two = 'The first paragraph is here.\n\nThe second paragraph is there.\n';
    expect(await run('nearestLineWithPhrase', two, 2, ['the', 'second', 'paragraph'], 0, 1)).toBe(3);
    expect(await run('nearestLineWithPhrase', two, 2, ['the', 'first', 'paragraph'], 0, 1)).toBe(1);
    expect(await run('nearestLineWithPhrase', two, 2, ['the', 'second', 'paragraph'], 0, 0)).toBeNull();   // no slack: not on line 2
    // a phrase that runs over a source line break, the answer is the line of the focus word
    expect(await run('nearestLineWithPhrase', 'A long line of\ntext that goes on\n', 2, ['line', 'of', 'text'], 2, 1)).toBe(2);
    expect(await run('findPhrase', [{ path: 'a.tex', text: 'x\nSome title words\n' }], ['some', 'title', 'words'], null, 'a.tex', 1)).toEqual({ path: 'a.tex', line: 2 }); // the \title two lines above is not the place of what \maketitle prints
  }, 30000);
});

// A PDF and a SyncTeX file made by hand: a page with a title that the (fake) class printed, at line 3000 of acmart.cls
function pdfWith(text: string): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 20 150 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
const sp = (bp: number) => Math.round(bp / 0.99626 * 65536);
function synctexWith(tag2: string, line: number): Uint8Array {
  const txt = ['SyncTeX Version:1', 'Input:1:./main.tex', `Input:2:./${tag2}`, 'Output:pdf', 'Magnification:1000', 'Unit:1', 'X Offset:0', 'Y Offset:0', 'Content:',
    '{1', `(2,${line}:${sp(20)},${sp(50)}:${sp(250)},${sp(14)},${sp(4)}`, ')', '}', 'Postamble:', ''].join('\n');
  return new Uint8Array(gzipSync(Buffer.from(txt)));
}

describe('double click on the PDF', () => {
  const MAIN = '\\documentclass{acmart}\n\\title{The Name of the Title Is Hope}\n\\begin{document}\n\\maketitle\nSome text.\n\\end{document}\n';

  async function setup(syncFile: string, syncLine: number) {
    await s.page.evaluate(async main => {
      const bg = (window as any).BrowserGit;
      await bg.writeFile('main.tex', main);
      await bg.writeFile('acmart.cls', '\\ProvidesClass{acmart}\n' + '%\n'.repeat(3000));
      (globalThis as any).eval('editor').setValue(main);
      if ((window as any).FT && (window as any).FT.refreshFromBrowserGit) await (window as any).FT.refreshFromBrowserGit();
    }, MAIN);
    await s.page.evaluate(async ([pdf, sync]) => {
      const bytes = new Uint8Array(pdf as number[]); const sy = new Uint8Array(sync as number[]);
      await (window as any).PdfView.show(bytes, sy);
    }, [Array.from(pdfWith('The Name of the Title Is Hope')), Array.from(synctexWith(syncFile, syncLine))] as any);
    await s.page.evaluate(() => (globalThis as any).eval("hasPdf = true; updatePdfEmpty(); switchTab('pdf')")); // as the compilation does once there is a PDF
    await poll(() => s.page.evaluate(() => !!document.querySelector('.pdf-page canvas')), v => v, 20000);
    // let the synctex be read
    await new Promise(r => setTimeout(r, 400));
  }

  async function dbl(fractionOfLine: number) {
    const box = await s.page.evaluate(() => { const el = document.querySelector('.pdf-page') as HTMLElement; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
    // the page is 300 x 200 bp; the text runs from x = 20 for about 250 bp, its baseline at y = 50 from the top
    const x = box.l + (20 + 250 * fractionOfLine) / 300 * box.w;
    const y = box.t + 45 / 200 * box.h;
    await s.page.mouse.dblclick(x, y);
  }

  test('a title that the class printed leads to the \\title in main.tex, not to the class', async () => {
    await setup('acmart.cls', 3000);
    await dbl(0.6);
    await poll(() => currentFile(s.page), f => f === 'main.tex', 10000);
    const line = await poll(() => s.page.evaluate(() => (globalThis as any).eval('editor').getPosition().lineNumber), l => l === 2, 10000);
    expect(line).toBe(2);
  }, 90000);

  test('the \\maketitle line that SyncTeX gives for it is replaced too', async () => {
    await setup('main.tex', 4);
    await dbl(0.2);
    await poll(() => s.page.evaluate(() => (globalThis as any).eval('editor').getPosition().lineNumber), l => l === 2, 10000);
  }, 90000);

  test('when SyncTeX is right, it is not overridden', async () => {
    await s.page.evaluate(async () => { (globalThis as any).eval('editor').setPosition({ lineNumber: 5, column: 1 }); });
    await setup('main.tex', 2); // SyncTeX says line 2, which has the words
    await s.page.evaluate(() => { (globalThis as any).eval('editor').setPosition({ lineNumber: 6, column: 1 }); });
    await dbl(0.5);
    await poll(() => s.page.evaluate(() => (globalThis as any).eval('editor').getPosition().lineNumber), l => l === 2, 10000);
    expect(await currentFile(s.page)).toBe('main.tex');
  }, 90000);
});

describe('with a real compilation', () => {
  test('double click on the title of a compiled article leads to the \\title that was written, and on a paragraph to its own line', async () => {
    const doc = ['\\documentclass{article}', '\\title{A Remarkably Original Contribution}', '\\author{Ada Lovelace}', '\\begin{document}', '\\maketitle', '',
      '\\section{Introduction}', 'The first paragraph says something unusual about pelicans.', '', 'The second paragraph is about walruses and nothing else.', '\\end{document}', ''].join('\n');
    await s.page.evaluate(async d => {
      const bg = (window as any).BrowserGit;
      await bg.writeFile('main.tex', d);
      (globalThis as any).eval('editor').setValue(d);
    }, doc);
    const busy = () => s.page.evaluate(() => (document.getElementById('compile-btn') as HTMLButtonElement).disabled);
    await s.page.click('#compile-btn');
    await poll(busy, b => b, 10000).catch(() => {});
    await poll(busy, b => !b, 170000);
    await poll(() => s.page.evaluate(() => !!document.querySelector('.pdf-page canvas')), v => v, 60000);
    await s.page.evaluate(() => (globalThis as any).eval("switchTab('pdf')"));
    await new Promise(r => setTimeout(r, 800));
    // find the words on the page, then click in the middle of their line (not on the edge between two lines)
    const spot = (needle: string) => s.page.evaluate(async n => {
      const P = (window as any).PdfView;
      const el = document.querySelector('.pdf-page') as HTMLElement; el.scrollIntoView({ block: 'start' });
      const r = el.getBoundingClientRect();
      const scale = r.width / 595.3;          // an A4 page is 595.3 bp wide
      for (let y = 40; y < 800; y += 1) for (let x = 60; x < 540; x += 12) {
        const at = await P.textAt(1, x, y);
        if (at && at.words.includes(n)) {
          let y1 = y;
          while ((await P.textAt(1, x, y1 + 1)) && (await P.textAt(1, x, y1 + 1)).words.join(' ') === at.words.join(' ')) y1++;
          const ym = (y + y1) / 2;
          return { cx: r.left + x * scale, cy: r.top + ym * scale };
        }
      }
      return null;
    }, needle);
    const goTo = async (needle: string, expectLine: number) => {
      await s.page.evaluate(() => (globalThis as any).eval("editor.setPosition({ lineNumber: 11, column: 1 })"));
      const p = await spot(needle);
      expect(p).not.toBeNull();
      await s.page.mouse.dblclick(p!.cx, p!.cy);
      const line = await poll(() => s.page.evaluate(() => (globalThis as any).eval('editor').getPosition().lineNumber), l => l !== 11, 10000);
      expect(line).toBe(expectLine);
    };
    await goTo('remarkably', 2);       // the title: \title{...}, not the \maketitle line
    await goTo('pelicans', 8);
    await goTo('walruses', 10);
  }, 240000);

  test('a click a little before the words, in the margin of the line, still finds the line', async () => {
    await s.page.evaluate(() => (globalThis as any).eval("editor.setPosition({ lineNumber: 11, column: 1 })"));
    const r = await s.page.evaluate(async () => {
      const P = (window as any).PdfView;
      const el = document.querySelector('.pdf-page') as HTMLElement; el.scrollIntoView({ block: 'start' });
      const rect = el.getBoundingClientRect(); const scale = rect.width / 595.3;
      for (let y = 40; y < 800; y += 1) for (let x = 60; x < 540; x += 6) {
        const at = await P.textAt(1, x, y);
        if (at && at.words.includes('walruses')) {
          let y1 = y;
          while ((await P.textAt(1, x, y1 + 1)) && (await P.textAt(1, x, y1 + 1)).words.includes('walruses')) y1++;
          // the first x (from the left) that is still inside the words of the line: then 8 bp to the left of it is the margin of the line
          let left = x; while ((await P.textAt(1, left - 1, (y + y1) / 2)) && left > 25) left--;
          return { cx: rect.left + (left - 8) * scale, cy: rect.top + ((y + y1) / 2) * scale };
        }
      }
      return null;
    });
    expect(r).not.toBeNull();
    await s.page.mouse.dblclick(r!.cx, r!.cy);
    const line = await poll(() => s.page.evaluate(() => (globalThis as any).eval('editor').getPosition().lineNumber), l => l !== 11, 10000);
    expect(line).toBe(10);               // the line of the second paragraph
  }, 120000);
});

