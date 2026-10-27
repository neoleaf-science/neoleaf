import { afterAll, describe, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { newSession, openProject, poll, type Session } from '../helpers';

// Formula preview: a panel with the typeset formula when the mouse rests on it in a LaTeX file (KaTeX, safe settings, the project's own commands).

let s: Session;
afterAll(async () => { await s?.context.close(); });

const setText = (page: Page, text: string) => page.evaluate(t => { (globalThis as any).eval('editor').setValue(t); }, text);
const panel = (page: Page) => page.evaluate(() => { const p = document.querySelector('.ld-mathprev') as HTMLElement | null; return p && p.style.display !== 'none' ? p.innerHTML : null; });

// the mouse on a character of the text
async function hover(page: Page, line: number, column: number) {
  const at = await page.evaluate(([l, c]) => {
    const e = (globalThis as any).eval('editor');
    const p = e.getScrolledVisiblePosition({ lineNumber: l, column: c });
    const box = e.getDomNode().getBoundingClientRect();
    return { x: box.left + p.left + 3, y: box.top + p.top + p.height / 2 };
  }, [line, column]);
  await page.mouse.move(at.x - 40, at.y + 60); // from somewhere else, so that the move is seen
  await page.mouse.move(at.x, at.y);
}

describe('formula finder', () => {
  test('finds inline, display and environment formulas and skips comments, escaped dollars and unclosed ones', async () => {
    s = await newSession();
    await openProject(s.page);
    const found = await s.page.evaluate(() => {
      const f = (window as any).MathPreview.formulas;
      const t = 'Cost is 5\\$ and $a+b$ then \\(c\\) and \\[d\\] and $$e$$ % $skip$ here\n\\begin{align}\nx &= 1 \\\\ y &= 2\n\\end{align}\n\\begin{itemize}\\item $z$\\end{itemize}\nOpen $never closed\n\nNext paragraph $w$\n';
      return f(t).map((x: any) => ({ s: x.source.trim(), d: x.display }));
    });
    expect(found.map((x: any) => x.s)).toEqual(['a+b', 'c', 'd', 'e', '\\begin{align*}\nx &= 1 \\\\ y &= 2\n\\end{align*}', 'z', 'w']);
    expect(found.map((x: any) => x.d)).toEqual([false, false, true, true, true, false, false]);
  }, 120000);

  test('equation, eqnarray and multline are mapped to what KaTeX has', async () => {
    const found = await s.page.evaluate(() => (window as any).MathPreview.formulas('\\begin{equation}x=1\\label{e}\\end{equation}\\begin{eqnarray}a&=&b\\end{eqnarray}\\begin{multline}p\\\\q\\end{multline}').map((x: any) => x.source));
    expect(found[0]).toBe('x=1\\label{e}');
    expect(found[1]).toBe('\\begin{align*}a&=&b\\end{align*}');
    expect(found[2]).toBe('\\begin{gather*}p\\\\q\\end{gather*}');
  }, 30000);

  test('project commands are turned into definitions KaTeX reads', async () => {
    const d = await s.page.evaluate(() => {
      const f = (window as any).MathPreview.definition;
      return [f('\\newcommand{\\R}{\\mathbb{R}}'), f('\\renewcommand*{\\norm}[1]{\\left\\lVert #1 \\right\\rVert}'), f('\\DeclareMathOperator{\\argmax}{arg\\,max}'), f('\\newcommand{\\broken}{\\x'), f('\\usepackage{amsmath}')];
    });
    expect(d).toEqual(['\\def\\R{\\mathbb{R}}', '\\def\\norm#1{\\left\\lVert #1 \\right\\rVert}', '\\def\\argmax{\\operatorname{arg\\,max}}', '', '']);
  }, 30000);
});

describe('formula panel', () => {
  test('resting the mouse on a formula shows it typeset, moving away hides it', async () => {
    await setText(s.page, '\\documentclass{article}\n\\begin{document}\nThe ratio $\\frac{a}{b}$ is small.\n\\end{document}\n');
    await hover(s.page, 3, 16);
    const html = await poll(() => panel(s.page), p => !!p, 15000);
    expect(html).toContain('katex');
    expect(html).toContain('mfrac');
    await s.page.mouse.move(5, 5);
    await poll(() => panel(s.page), p => p === null, 5000);
  }, 60000);

  test('the project\'s own commands are used', async () => {
    await setText(s.page, '\\newcommand{\\R}{\\mathbb{R}}\n\nLet $x \\in \\R$ be given.\n');
    await hover(s.page, 3, 8);
    const html = await poll(() => panel(s.page), p => !!p, 15000);
    expect(html).toContain('mathbb');
    await s.page.mouse.move(5, 5);
  }, 60000);

  test('a command KaTeX does not know shows no panel, and the preview does not break the editor', async () => {
    await setText(s.page, 'See $\\totallyunknown{x}$ here.\n');
    await hover(s.page, 1, 8);
    await new Promise(r => setTimeout(r, 1200));
    expect(await panel(s.page)).toBeNull();
  }, 60000);

  test('a formula cannot link anywhere or make the page spin', async () => {
    await setText(s.page, 'A $\\href{javascript:alert(1)}{click}$ and $\\def\\a{\\a\\a}\\a$ here.\n');
    await hover(s.page, 1, 6);
    await new Promise(r => setTimeout(r, 1200));
    const p1 = await panel(s.page);
    expect(p1 === null || !/<a[ >]/.test(p1)).toBe(true);
    await s.page.mouse.move(5, 5);
    const t0 = Date.now();
    await hover(s.page, 1, 45);
    await new Promise(r => setTimeout(r, 1500));
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(await panel(s.page)).toBeNull(); // the expansion limit stopped it
    expect(await s.page.evaluate(() => (globalThis as any).eval('editor').getValue()).then((v: string) => v.length)).toBeGreaterThan(10);
  }, 60000);

  test('typing hides the panel, and "Toggle formula preview" turns the feature off for this browser', async () => {
    await setText(s.page, 'Short $x^2$ here.\n');
    await hover(s.page, 1, 8);
    await poll(() => panel(s.page), p => !!p, 15000);
    await s.page.evaluate(() => (globalThis as any).eval('editor').trigger('kb', 'type', { text: 'z' }));
    await poll(() => panel(s.page), p => p === null, 5000);
    await s.page.evaluate(() => (globalThis as any).eval("editor.getAction('ld.mathPreview').run()"));
    expect(await s.page.evaluate(() => localStorage.getItem('neoleaf.editor.mathPreview'))).toBe('0');
    await s.page.mouse.move(5, 5);
    await hover(s.page, 1, 8);
    await new Promise(r => setTimeout(r, 1200));
    expect(await panel(s.page)).toBeNull();
    await s.page.evaluate(() => (globalThis as any).eval("editor.getAction('ld.mathPreview').run()"));
    expect(await s.page.evaluate(() => localStorage.getItem('neoleaf.editor.mathPreview'))).toBe('1');
  }, 90000);
});
