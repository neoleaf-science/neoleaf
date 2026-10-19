import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { fake, newSession, openInTree, openProject, poll, type Session } from '../helpers';

// Mermaid files (.mmd and .mermaid): open in the editor, show in the "Preview" tab (isolated iframe), show syntax errors,
// do not run diagram code, have examples and export SVG and PNG.
describe('Mermaid editor and preview', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const frame = async () => (await (await s.page.waitForSelector('#mermaid-preview-frame', { state: 'attached' })).contentFrame())!;
  const body = async () => (await frame()).evaluate(() => document.getElementById('out')!.innerHTML);

  const FLOW = 'flowchart TD\n  A[Start] --> B{Works?}\n  B -- Yes --> C[Great]\n';
  const DANGEROUS = 'flowchart TD\n  A["<img src=x onerror=\'window.parent.document.title=1\'>"] --> B["<script>window.parent.document.title=2</script>"]\n';

  beforeAll(async () => {
    fake.seedRepo('demo', 'mermaid', {
      'main.tex': '\\documentclass{article}\n\\begin{document}Oi\n\\end{document}\n',
      'flow.mmd': FLOW,
      'sequence.mermaid': 'sequenceDiagram\n  A->>B: oi\n',
      'broken.mmd': 'flowchart TD\n  A --> \n  B[[[\n',
      'danger.mmd': DANGEROUS,
      'empty.mmd': '',
      'README.md': '# Title\n\nText.\n',
    }, ['neoleaf']);
    s = await newSession();
    await openProject(s.page, 'demo__mermaid');
  });
  afterAll(async () => { await s.context.close(); });

  for (const file of ['flow.mmd', 'sequence.mermaid']) {
    test(`${file}: opens in Mermaid mode, is editable and writes to the clone`, async () => {
      await openInTree(s.page, file);
      expect(await ev<string>('editor.getModel().getLanguageId()')).toBe('mermaid');
      expect(await ev<boolean>('editor.getOption(monaco.editor.EditorOption.readOnly)')).toBe(false);
      const mark = `%% mark ${Date.now()}`;
      await ev(`editor.setValue(editor.getValue() + ${JSON.stringify('\n' + mark + '\n')})`);
      const saved = await poll(() => ev<string>(`BrowserGit.readFile(${JSON.stringify(file)})`), v => v.includes(mark), 20000);
      expect(saved).toContain(mark);
    });
  }

  test('the Preview tab appears on its own and draws the diagram (SVG with the labels)', async () => {
    await openInTree(s.page, 'main.tex');
    expect(await s.page.locator('#tab-preview-btn').isVisible()).toBe(false);
    await openInTree(s.page, 'flow.mmd');
    await s.page.waitForSelector('#tab-preview-btn', { state: 'visible' });
    expect(await ev<string>('pdfTab')).toBe('preview');
    const h = await poll(async () => (await body().catch(() => '')), x => x.includes('<svg') && x.includes('Works?'), 60000);
    expect(h).toContain('Start');
    expect(h).toContain('Great');
    expect(await s.page.locator('#mermaid-bar').isVisible()).toBe(true);
  });

  test('the diagram follows the edit', async () => {
    await ev(`editor.setValue('flowchart LR\\n  X[New label] --> Y[End]\\n')`);
    const h = await poll(async () => (await body().catch(() => '')), x => x.includes('> label<') && x.includes('>End<'), 20000);
    expect(h).not.toContain('Works?');
  });

  test('wrong syntax shows the error and keeps working after being fixed', async () => {
    await openInTree(s.page, 'broken.mmd');
    const h = await poll(async () => (await body().catch(() => '')), x => x.includes('mm-err'), 30000);
    expect(h).toContain('mm-err');
    await ev(`editor.setValue('flowchart TD\\n  A[Ok] --> B[Right]\\n')`);
    const ok = await poll(async () => (await body().catch(() => '')), x => x.includes('Right'), 20000);
    expect(ok).not.toContain('mm-err');
  });

  test('labels with HTML and script run nothing and do not touch the page', async () => {
    await s.page.evaluate(() => { (window as any).__title = document.title; });
    await openInTree(s.page, 'danger.mmd');
    await poll(async () => (await body().catch(() => '')), x => x.includes('<svg') || x.includes('mm-err'), 30000);
    await s.page.waitForTimeout(800);
    const title = await s.page.evaluate(() => [document.title, (window as any).__title]);
    expect(title[0]).toBe(title[1]);
    expect(await (await frame()).evaluate(() => document.querySelectorAll('#out script, #out img[onerror]').length)).toBe(0);
    // the frame is isolated: no allow-same-origin
    const sandbox = await s.page.locator('#mermaid-preview-frame').getAttribute('sandbox');
    expect(sandbox).toBe('allow-scripts');
  });

  test('empty file shows a notice, without error', async () => {
    await openInTree(s.page, 'empty.mmd');
    const h = await poll(async () => (await body().catch(() => '')), x => x.includes('mm-msg') && !x.includes('Loading'), 30000);
    expect(h).toContain('mm-msg');
    expect(h).not.toContain('mm-err');
  });

  test('the examples menu inserts the diagram into the editor', async () => {
    await openInTree(s.page, 'empty.mmd');
    await s.page.selectOption('#mermaid-examples', '0');
    const text = await poll(() => ev<string>('editor.getValue()'), v => v.includes('flowchart'), 10000);
    expect(text).toContain('flowchart TD');
    const h = await poll(async () => (await body().catch(() => '')), x => x.includes('<svg') && x.includes('Works?'), 30000);
    expect(h).toContain('Debug');
  });

  test('exports SVG and PNG', async () => {
    await openInTree(s.page, 'flow.mmd');
    await poll(async () => (await body().catch(() => '')), x => x.includes('<svg'), 30000);
    const [svg] = await Promise.all([s.page.waitForEvent('download'), s.page.click('#mermaid-export-svg')]);
    expect(svg.suggestedFilename()).toBe('flow.svg');
    const content = (await import('node:fs')).readFileSync((await svg.path())!, 'utf8');
    expect(content).toContain('<svg');
    expect(content).toContain('xmlns=');
    const [png] = await Promise.all([s.page.waitForEvent('download'), s.page.click('#mermaid-export-png')]);
    expect(png.suggestedFilename()).toBe('flow.png');
    const bytes = (await import('node:fs')).readFileSync((await png.path())!);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.length).toBeGreaterThan(500);
  });

  test('Markdown keeps working and hides the Mermaid frame; going back to .tex removes the tab', async () => {
    await openInTree(s.page, 'README.md');
    await s.page.waitForSelector('#tab-preview-btn', { state: 'visible' });
    await poll(() => ev<string>(`document.getElementById('md-preview-frame') ? 'yes' : ''`), v => v === 'yes', 20000);
    expect(await s.page.locator('#mermaid-preview-frame').isVisible()).toBe(false);
    expect(await s.page.locator('#mermaid-bar').isVisible()).toBe(false);
    expect(await s.page.locator('#md-preview-frame').isVisible()).toBe(true);
    await openInTree(s.page, 'flow.mmd');
    expect(await s.page.locator('#md-preview-frame').isVisible()).toBe(false);
    expect(await s.page.locator('#mermaid-preview-frame').isVisible()).toBe(true);
    await openInTree(s.page, 'main.tex');
    expect(await s.page.locator('#tab-preview-btn').isVisible()).toBe(false);
  });
});
