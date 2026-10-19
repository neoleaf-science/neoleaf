import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BASE_URL, fake, newSession, openProject, poll, testWorkDir, type Session } from '../helpers';

// Live editing rooms are per project: two projects with main.tex must not get mixed up.
describe('Live editing: rooms separated by project and repository access', () => {
  let a: Session, b: Session;
  const ev = <T>(s: Session, code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;

  beforeAll(async () => {
    a = await newSession(); b = await newSession();
    await b.page.goto(BASE_URL + '/');
    await b.page.waitForFunction(() => !!(window as any).ProjectImport);
    await b.page.evaluate(() => (window as any).ProjectImport.startNew('e2e-rooms', 'article'));
  });
  afterAll(async () => { await a.context.close(); await b.context.close(); });

  test('the text of one project does not show up in the main.tex of another project', async () => {
    const mark = `% MARK-ONLY-IN-PROJECT-A-${Date.now()}`;
    await openProject(a.page);
    await poll(() => ev<boolean>(a, 'window.collabActive === true'), v => v === true, 20000);
    await ev(a, `editor.setValue(${JSON.stringify(mark)} + '\\n' + editor.getValue())`);
    await new Promise(r => setTimeout(r, 1500));

    await openProject(b.page, 'demo__e2e-rooms');
    await poll(() => ev<boolean>(b, 'window.collabActive === true'), v => v === true, 20000);
    const textB = await ev<string>(b, 'editor.getValue()');
    expect(textB).not.toContain(mark);
    expect(textB.length).toBeGreaterThan(20);
    // and the opposite: what the other project loaded must not enter the text of whoever was already editing
    await new Promise(r => setTimeout(r, 1500));
    expect(await ev<string>(a, 'editor.getValue()')).toContain(mark);
  });

  test('without repository access, the room connection is refused', async () => {
    const denied = await a.page.evaluate(() => new Promise<string>(resolve => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/file/main.tex?project=other-person__private-repo`);
      ws.onopen = () => { ws.close(); resolve('open'); };
      ws.onerror = () => resolve('denied');
      ws.onclose = () => resolve('denied');
    }));
    expect(denied).toBe('denied');
  });

  test('the relay stores nothing on the server: live editing sends nothing to GitHub and creates no copy on disk', async () => {
    const before = fake.file('demo', 'artigo-1', 'main.tex');
    const mark = `% ONLY-IN-MEMORY-${Date.now()}`;
    await ev(a, `editor.setValue(${JSON.stringify(mark)} + '\\n' + editor.getValue())`);
    await new Promise(r => setTimeout(r, 4000)); // the old save happened in ~2 s
    expect(fake.file('demo', 'artigo-1', 'main.tex')).toBe(before);
    expect(fs.existsSync(path.join(testWorkDir(), 'repos'))).toBe(false);
    // but the text stays saved in the browser (local clone)
    const local = await poll(() => a.page.evaluate(async () => (await (window as any).BrowserGit.readFile('main.tex')) as string), t => t.includes('ONLY-IN-MEMORY'), 10000);
    expect(local).toContain(mark);
  });

  test('two people opening the same file at the same time do not duplicate the text', async () => {
    const c = await newSession(), d = await newSession();
    try {
      await Promise.all([openProject(c.page), openProject(d.page)]);
      await Promise.all([c, d].map(x => poll(() => ev<boolean>(x, 'window.collabActive === true'), v => v === true, 25000)));
      await new Promise(r => setTimeout(r, 1500));
      const [tc, td] = await Promise.all([ev<string>(c, 'editor.getValue()'), ev<string>(d, 'editor.getValue()')]);
      expect(tc).toBe(td);
      expect(tc.split('\\documentclass').length - 1).toBe(1);
    } finally { await c.context.close(); await d.context.close(); }
  });
});

