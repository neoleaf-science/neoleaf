import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, newSession, openProject, type Session } from '../helpers';

describe('XSS and snippets', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  test('push modal escapes the last commit message and the branch', async () => {
    const injected = await s.page.evaluate(() => {
      const w = globalThis as any;
      (window as any).__xss = 0;
      w.eval(`gitStatusState = { branch: '<img src=x onerror="window.__xss=1">', last_commit: '<img src=x onerror="window.__xss=2">', ahead: 1, uncommitted_changes: 0 }`);
      w.openGitPushModal();
      return document.querySelectorAll('#git-push-info img, #git-push-modal img').length;
    });
    await s.page.waitForTimeout(500);
    expect(injected).toBe(0);
    expect(await s.page.evaluate(() => (window as any).__xss)).toBe(0);
  });

  test('\\newcommand snippets escape the backslash (\\\\ in Monaco)', async () => {
    const src = await (await s.page.request.get(BASE_URL + '/static/js/autocomplete.js')).text();
    expect(src).toContain("['newcommand', '{\\\\\\\\${1:name}}");
    expect(src).not.toContain("'{\\\\${1:");
  });
});
