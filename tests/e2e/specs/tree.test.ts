import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { poll, currentFile, demoRemoteFile, editorValue, newSession, openInTree, openProject, settled, type Session } from '../helpers';

const row = (page: Page, name: string) => page.locator('#file-tree .tree-row', { hasText: name }).first();

async function menu(page: Page, name: string, item: string) {
  await row(page, name).click({ button: 'right' });
  await page.locator('.tree-popup-item', { hasText: item }).click();
}

async function answerName(page: Page, value: string) {
  await page.waitForSelector('#name-input', { state: 'visible' });
  await page.fill('#name-input', value);
  await page.click('#name-ok');
}

describe('file tree operations', () => {
  let s: Session;
  const dialogs: string[] = [];

  // fresh project for each test: each one changes the tree
  beforeEach(async () => {
    await s?.context.close();
    s = await newSession();
    dialogs.length = 0;
    s.page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await openProject(s.page);
  });
  afterAll(async () => { await s?.context.close(); });

  test('creating a file with an existing name does not erase the content', async () => {
    const before = await editorValue(s.page);
    await s.page.evaluate(() => { (globalThis as any).FT.newFile(); });
    await answerName(s.page, 'main.tex');
    await poll(() => dialogs.length, n => n > 0);
    expect(dialogs[0]).toContain('already exists');
    await openInTree(s.page, 'references.bib');
    await openInTree(s.page, 'main.tex');
    expect(await editorValue(s.page)).toBe(before);
  });

  test('the new file window offers the file types and keeps the extension in step with the name', async () => {
    await s.page.evaluate(() => { (globalThis as any).FT.newFile(); });
    await s.page.waitForSelector('#name-type', { state: 'visible' });
    expect(await s.page.inputValue('#name-input')).toBe('new.tex');
    expect(await s.page.inputValue('#name-type')).toBe('tex');
    const values = await s.page.$$eval('#name-type option', os => os.map(o => (o as HTMLOptionElement).value));
    expect(values).toEqual(expect.arrayContaining(['tex', 'bib', 'typ', 'md', 'py', '']));
    await s.page.selectOption('#name-type', 'typ');
    expect(await s.page.inputValue('#name-input')).toBe('new.typ');
    await s.page.fill('#name-input', 'chapter.md');
    expect(await s.page.inputValue('#name-type')).toBe('md');
    await s.page.selectOption('#name-type', 'bib');
    expect(await s.page.inputValue('#name-input')).toBe('chapter.bib');
    await s.page.fill('#name-input', 'data.xyz');
    expect(await s.page.inputValue('#name-type')).toBe('');
    await s.page.selectOption('#name-type', '');
    expect(await s.page.inputValue('#name-input')).toBe('data.xyz');
    await s.page.fill('#name-input', 'notes.txt');
    await s.page.click('#name-ok');
    await openInTree(s.page, 'notes.txt');
    expect(await currentFile(s.page)).toBe('notes.txt');
  });

  test('the type list is only in the new file window', async () => {
    await menu(s.page, 'main.tex', 'Rename');
    await s.page.waitForSelector('#name-input', { state: 'visible' });
    expect(await s.page.isVisible('#name-type')).toBe(false);
    await s.page.evaluate(() => { (globalThis as any).FT.nameCancel(); });
  });

  test('renaming the open file keeps the text and does not recreate the old name', async () => {
    await menu(s.page, 'main.tex', 'Rename');
    await answerName(s.page, 'paper.tex');
    await poll(() => currentFile(s.page), v => v === 'paper.tex').catch(e => { throw new Error(e.message + ' dialogs=' + JSON.stringify(dialogs) + ' errs=' + JSON.stringify(s.errors)); });
    await settled(s.page);
    await s.page.locator('.monaco-editor').first().click();
    await s.page.keyboard.press('Control+End');
    await s.page.keyboard.type('\n% after-renaming');
    await openInTree(s.page, 'references.bib');
    await openInTree(s.page, 'paper.tex');
    expect(await editorValue(s.page)).toContain('% after-renaming');
    const names = await s.page.locator('#file-tree .tree-row').allTextContents();
    expect(names.join(' ')).toContain('paper.tex');
    expect(names.join(' ')).not.toContain('main.tex');
  });

  test('renaming to an existing name is refused', async () => {
    await menu(s.page, 'references.bib', 'Rename');
    await answerName(s.page, 'main.tex');
    await poll(() => dialogs.length, n => n > 0);
    expect(dialogs[0]).toContain('already exists');
    await openInTree(s.page, 'main.tex');
    expect(await editorValue(s.page)).toContain('\\documentclass');
  });

  test('deleting a non-empty folder removes everything inside', async () => {
    await s.page.evaluate(async () => {
      await (window as any).BrowserGit.writeFile('chapters/a.tex', 'A');
      await (window as any).BrowserGit.writeFile('chapters/sub/b.tex', 'B');
      await (window as any).FT.refresh();
    });
    await row(s.page, 'chapters').waitFor();
    await menu(s.page, 'chapters', 'Delete');
    await poll(() => s.page.locator('#file-tree .tree-row', { hasText: 'chapters' }).count(), n => n === 0);
    expect(dialogs.some(d => d.includes('Error'))).toBe(false);
    const files = await s.page.evaluate(async () => Object.keys(await (window as any).BrowserGit.getAllTexAndAssetFiles()));
    expect(files.some(f => f.startsWith('chapters/'))).toBe(false);
  });
});

describe('concurrent file switching', () => {
  test('several switches fired together end on the last file, without mixing texts', async () => {
    const s = await newSession();
    await openProject(s.page);
    await s.page.evaluate(() => {
      const w = globalThis as any;
      w.switchFile('references.bib', 'references.bib');
      w.switchFile('main.tex', 'main.tex');
      w.switchFile('references.bib', 'references.bib');
      w.switchFile('main.tex', 'main.tex');
    });
    await poll(() => currentFile(s.page), v => v === 'main.tex');
    await settled(s.page);
    expect(await editorValue(s.page)).toContain('\\documentclass');
    await s.page.locator('.monaco-editor').first().click();
    await s.page.keyboard.press('Control+End');
    await s.page.keyboard.type('\n% only-in-tex');
    await openInTree(s.page, 'references.bib');
    expect(await editorValue(s.page)).not.toContain('% only-in-tex');
    const bib = demoRemoteFile('demo__artigo-1', 'references.bib');
    expect(bib).not.toContain('% only-in-tex');
    await s.context.close();
  });
});
