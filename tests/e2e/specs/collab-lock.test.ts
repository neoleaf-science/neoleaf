import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, poll, type Session } from '../helpers';

// Lock on the tab: with two people in the file, either one locks and either one unlocks; while locked, only whoever locked edits.
describe('Live editing: file lock', () => {
  let a: Session, b: Session;
  const ev = <T>(s: Session, code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const ro = (s: Session) => ev<boolean>(s, 'editor.getOption(monaco.editor.EditorOption.readOnly)');
  const lockBtn = (s: Session) => s.page.locator('#tab-bar .tab.active .tab-lock');
  const active = (s: Session) => ev<boolean>(s, 'window.collabActive === true');

  beforeAll(async () => {
    a = await newSession(); b = await newSession();
    await openProject(a.page);
    await poll(() => active(a), v => v === true, 25000);
  });
  afterAll(async () => { await a.context.close(); await b.context.close(); });

  test('alone, the person does not see the lock', async () => {
    expect(await lockBtn(a).count()).toBe(0);
  });

  test('with two people the lock shows, unlocked, before the file name', async () => {
    await openProject(b.page);
    await poll(() => active(b), v => v === true, 25000);
    await poll(() => lockBtn(a).count(), n => n === 1, 15000);
    await poll(() => lockBtn(b).count(), n => n === 1, 15000);
    expect(await lockBtn(a).getAttribute('aria-pressed')).toBe('false');
    // it sits in front of the name
    expect(await a.page.evaluate(() => { const t = document.querySelector('#tab-bar .tab.active')!; const l = t.querySelector('.tab-lock')!, n = t.querySelector('.tab-name')!; return !!(l.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING); })).toBe(true);
    expect(await ro(a)).toBe(false);
    expect(await ro(b)).toBe(false);
  });

  test('locking: the other person sees who locked and can only read; the server discards what they try to write', async () => {
    await lockBtn(a).click();
    await poll(() => ro(b), v => v === true, 10000);
    expect(await ro(a)).toBe(false);
    expect(await lockBtn(b).getAttribute('class')).toContain('by-other');
    expect(await lockBtn(a).getAttribute('class')).not.toContain('by-other');
    expect(await lockBtn(b).getAttribute('title')).toContain('Locked by');

    // write by code (ignores the editor read-only flag): the relay does not forward it
    const mark = `% INTRUDER-${Date.now()}`;
    const before = await ev<string>(a, 'editor.getValue()');
    await ev(b, `editor.setValue(${JSON.stringify(mark)} + '\\n' + editor.getValue())`);
    await new Promise(r => setTimeout(r, 2500));
    expect(await ev<string>(a, 'editor.getValue()')).toBe(before);
    // whoever tried goes back to the room text
    await poll(() => ev<string>(b, 'editor.getValue()'), v => !v.includes(mark) && v === before, 20000);

    // whoever locked keeps editing and the other receives
    const mine = `% FROM-THE-LOCKER-${Date.now()}`;
    await ev(a, `editor.setValue(${JSON.stringify(mine)} + '\\n' + editor.getValue())`);
    await poll(() => ev<string>(b, 'editor.getValue()'), v => v.includes(mine), 15000);
  });

  test('either person unlocks, and both can edit again', async () => {
    await poll(() => lockBtn(b).count(), n => n === 1, 20000);
    await lockBtn(b).click();
    await poll(() => ro(b), v => v === false, 10000);
    expect(await ro(a)).toBe(false);
    expect(await lockBtn(a).getAttribute('aria-pressed')).toBe('false');
    const mark = `% AFTER-UNLOCKING-${Date.now()}`;
    await ev(b, `editor.setValue(${JSON.stringify(mark)} + '\\n' + editor.getValue())`);
    await poll(() => ev<string>(a, 'editor.getValue()'), v => v.includes(mark), 15000);
  });

  test('when only one person is left, the lock and the padlock disappear', async () => {
    await lockBtn(a).click();
    await poll(() => ro(b), v => v === true, 10000);
    await b.page.close();   // whoever was reading leaves: only the locker remains
    await poll(() => lockBtn(a).count(), n => n === 0, 15000);
    expect(await ro(a)).toBe(false);
    // a person who joins later finds the file free
    const c = await newSession();
    try {
      await openProject(c.page);
      await poll(() => active(c), v => v === true, 25000);
      expect(await ro(c)).toBe(false);
      await poll(() => lockBtn(c).count(), n => n === 1, 15000);
      expect(await lockBtn(c).getAttribute('aria-pressed')).toBe('false');
    } finally { await c.context.close(); }
  });

  test('whoever locks and leaves releases the file for whoever stayed', async () => {
    await a.page.close();   // the room goes back to only the two people of this test
    const c = await newSession(), d = await newSession();
    try {
      await openProject(c.page); await poll(() => active(c), v => v === true, 25000);
      await openProject(d.page); await poll(() => active(d), v => v === true, 25000);
      await poll(() => lockBtn(c).count(), n => n === 1, 15000);
      await lockBtn(c).click();
      await poll(() => ro(d), v => v === true, 10000);
      await c.page.close();
      await poll(() => ro(d), v => v === false, 15000);
      await poll(() => lockBtn(d).count(), n => n === 0, 10000);
    } finally { await c.context.close(); await d.context.close(); }
  });
});
