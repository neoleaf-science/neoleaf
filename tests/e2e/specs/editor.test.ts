import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentFile, demoRemoteFile, editorValue, newSession, openInTree, openProject, type Session } from '../helpers';

describe('editor and file tree', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('opens main.tex and shows the tree', async () => {
    const rows = await s.page.locator('#file-tree .tree-row').allTextContents();
    expect(rows.join(' ')).toContain('main.tex');
    expect(rows.join(' ')).toContain('references.bib');
    expect(await editorValue(s.page)).toContain('\\documentclass');
  });

  // regression: collabStop() wrote the new file's text over the previous one
  test('switching .bib <-> .tex shows the content of each file (and does not corrupt it)', async () => {
    for (let i = 0; i < 3; i++) {
      await openInTree(s.page, 'references.bib');
      expect(await editorValue(s.page)).toContain('@article');
      await openInTree(s.page, 'main.tex');
      const tex = await editorValue(s.page);
      expect(tex).toContain('\\documentclass');
      expect(tex).not.toContain('@article{einstein1905');
    }
    // the remote (fake GitHub) must not have been corrupted either
    const api = demoRemoteFile('demo__artigo-1', 'main.tex');
    expect(api).toContain('\\documentclass');
  });

  test('typed edits survive switching files', async () => {
    await openInTree(s.page, 'main.tex');
    await s.page.locator('.monaco-editor').first().click();
    await s.page.keyboard.press('Control+End');
    await s.page.keyboard.type('\n% e2e-marker');
    await openInTree(s.page, 'references.bib');
    await openInTree(s.page, 'main.tex');
    expect(await editorValue(s.page)).toContain('% e2e-marker');
  });

  test('the Monaco language changes with the file extension', async () => {
    await openInTree(s.page, 'references.bib');
    const bibLang = await s.page.evaluate(() => (globalThis as any).eval('editor.getModel().getLanguageId()'));
    await openInTree(s.page, 'main.tex');
    const texLang = await s.page.evaluate(() => (globalThis as any).eval('editor.getModel().getLanguageId()'));
    expect(bibLang).not.toBe(texLang);
  });

  test('the open tab is reflected in the tab bar', async () => {
    await openInTree(s.page, 'references.bib');
    expect(await s.page.locator('#tab-bar .tab.active').textContent()).toContain('references.bib');
    expect(await currentFile(s.page)).toBe('references.bib');
  });

  test('no unhandled errors in the console', () => {
    expect(s.errors).toEqual([]);
  });
});
