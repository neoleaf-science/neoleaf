import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { fake, newSession, openInTree, openProject, poll, type Session } from '../helpers';

// "Preview" tab: shows the rendered Markdown in the PDF panel, in an isolated iframe, and sanitizes dangerous HTML.
describe('Markdown preview', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const pframe = () => s.page.frames().find(f => f !== s.page.mainFrame() && f.parentFrame() === s.page.mainFrame() && f.url() === 'about:srcdoc')!;
  const body = async () => pframe().evaluate(() => document.body.innerHTML);

  const README = [
    '# Project title', '', 'Text with **bold**, _italic_ and `code`.', '',
    '| a | b |', '|---|---|', '| 1 | 2 |', '',
    '- [x] done', '- [ ] to do', '',
    '```js', 'const x = 1;', '```', '',
    '![logo](img/logo.svg)', '',
    '![vanished](img/does-not-exist.png)', '',
    'See [the notes](docs/notes.md) and [the site](https://example.org/page).',
  ].join('\n');
  const DANGEROUS = [
    '# Dangerous', '',
    '<script>window.parent.document.title="hijacked"</script>', '',
    '<img src="x" onerror="alert(1)">', '',
    '<a href="https://example.org" onclick="alert(2)">link</a>', '',
    '[bad](javascript:alert(3))', '',
    '<iframe src="https://example.org"></iframe>', '',
    '<p style="color:red">style</p>', '',
    '<form action="https://example.org"><input name="a"></form>',
  ].join('\n');
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#0a7"/></svg>';

  beforeAll(async () => {
    fake.seedRepo('demo', 'md-visual', {
      'main.tex': '\\documentclass{article}\n\\begin{document}Oi\n\\end{document}\n',
      'README.md': README,
      'danger.md': DANGEROUS,
      'docs/notes.md': '# Notes\n\nAnother page.\n',
      'img/logo.svg': SVG,
    }, ['neoleaf']);
    s = await newSession();
    await openProject(s.page, 'demo__md-visual');
  });
  afterAll(async () => { await s.context.close(); });

  test('when opening a .md, the Preview tab appears by itself and shows the rendered text', async () => {
    expect(await s.page.locator('#tab-preview-btn').isVisible()).toBe(false); // main.tex: no tab
    await openInTree(s.page, 'README.md');
    await s.page.waitForSelector('#tab-preview-btn', { state: 'visible' });
    expect(await ev<string>('pdfTab')).toBe('preview');
    await poll(async () => (await body().catch(() => '')), h => h.includes('Project title'), 20000);
    const h = await body();
    expect(h).toContain('<h1>Project title</h1>');
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<table>');
    expect(h).toMatch(/<input[^>]*checked[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked/);
    expect(h).toContain('<code class="language-js">');
    // external link opens in another tab, without opener
    expect(h).toMatch(/<a href="https:\/\/example\.org\/page" target="_blank" rel="noopener noreferrer">/);
  });

  test('a repository image becomes data:, and one that does not exist becomes a notice', async () => {
    const info = await pframe().evaluate(() => ({ src: document.querySelector('img')?.getAttribute('src') || '', notice: document.querySelector('.md-missing')?.textContent || '' }));
    expect(info.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(info.notice).toContain('vanished');
  });

  test('the iframe is isolated: sandbox without allow-same-origin and a content policy', async () => {
    const sandbox = await s.page.locator('#md-preview-frame').getAttribute('sandbox');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    const csp = await pframe().evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'nonce-/);
  });

  test('updates while typing, without reloading the iframe', async () => {
    await ev(`editor.setValue(editor.getValue() + '\\n\\n## New paragraph ${Date.now()}\\n')`);
    await poll(async () => await body(), h => h.includes('New paragraph'), 10000);
  });

  test('clicking a relative link opens the other file in the editor', async () => {
    await pframe().evaluate(() => (document.querySelector('a[data-md-path="docs/notes.md"]') as HTMLElement).click());
    await s.page.waitForFunction(() => (globalThis as any).eval('currentFileId') === 'docs/notes.md', null, { timeout: 15000 });
    await poll(async () => await body(), h => h.includes('Another page'), 10000);
  });

  test('dangerous HTML is removed and nothing executes', async () => {
    const alerts: string[] = [];
    s.page.on('dialog', d => { alerts.push(d.message()); d.dismiss(); });
    await openInTree(s.page, 'danger.md');
    await poll(async () => await body(), h => h.includes('Dangerous'), 15000);
    await s.page.waitForTimeout(800);
    const h = await body();
    expect(h).not.toMatch(/<script|onerror|onclick|javascript:|<iframe|<form|style=/i);
    expect(await s.page.title()).not.toBe('hijacked');
    expect(alerts).toEqual([]);
    expect(await pframe().evaluate(() => document.querySelectorAll('script').length)).toBe(0); // the content carries no script (the shell's own already ran and left with the body)
  });

  test('going back to a .tex the tab goes away and the PDF returns; reopening the .md brings the preview back', async () => {
    await openInTree(s.page, 'main.tex');
    await s.page.waitForFunction(() => (globalThis as any).eval('pdfTab') === 'pdf');
    expect(await s.page.locator('#tab-preview-btn').isVisible()).toBe(false);
    await openInTree(s.page, 'README.md');
    await s.page.waitForFunction(() => (globalThis as any).eval('pdfTab') === 'preview');
    expect(await s.page.locator('#tab-preview-btn').isVisible()).toBe(true);
  });
});
