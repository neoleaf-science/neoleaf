import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, COMMON, LISTENER, fake, getBrowser, newSession, openProject, poll, type Session } from '../helpers';

// Live-edit relay hardening: no e-mails to other peers, connection limit, document size limit, access re-check, input validation.
describe('Live editing: relay security', () => {
  let a: Session, b: Session;
  const ev = <T>(s: Session, code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;

  // helpers living in the page: raw sockets kept in window.__ws
  const HELPERS = `
    window.__ws = window.__ws || {};
    window.__open = (name, file, project) => new Promise(resolve => {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws/file/' + encodeURIComponent(file) + '?project=' + encodeURIComponent(project));
      ws.binaryType = 'arraybuffer';
      const rec = { ws, texts: [], bins: 0, opened: false, closed: false };
      ws.onmessage = e => { if (typeof e.data === 'string') rec.texts.push(e.data); else rec.bins++; };
      ws.onopen = () => { rec.opened = true; };
      ws.onclose = () => { rec.closed = true; resolve(rec); };
      window.__ws[name] = rec;
      const t = setInterval(() => { if (rec.opened && rec.texts.length) { clearInterval(t); resolve(rec); } }, 20);
      setTimeout(() => { clearInterval(t); resolve(rec); }, 8000);
    }).then(r => ({ opened: r.opened, closed: r.closed, texts: r.texts }));
  `;
  const open = (s: Session, name: string, file: string, project: string) => s.page.evaluate(([n, f, p]) => (window as any).__open(n, f, p), [name, file, project]) as Promise<{ opened: boolean; closed: boolean; texts: string[] }>;
  const state = (s: Session, name: string) => s.page.evaluate(n => { const r = (window as any).__ws[n]; return { opened: r.opened, closed: r.closed, texts: r.texts.slice(), bins: r.bins }; }, name);

  async function userPage(sid: string) {
    const context = await (await getBrowser()).newContext({ locale: 'en-US' });
    await context.addCookies([{ name: 'latex_session', value: sid, url: BASE_URL }]);
    const page = await context.newPage();
    await page.goto(BASE_URL + '/');
    await page.evaluate(code => (0, eval)(code), HELPERS);
    return { context, page, errors: [] } as Session;
  }

  beforeAll(async () => {
    a = await newSession(); b = await newSession();
    await a.page.goto(BASE_URL + '/'); await b.page.goto(BASE_URL + '/');
    await a.page.evaluate(c => (0, eval)(c), HELPERS); await b.page.evaluate(c => (0, eval)(c), HELPERS);
  });
  afterAll(async () => { await a.context.close(); await b.context.close(); });

  test('hello, join and aw never carry the e-mail of a participant', async () => {
    await open(a, 'p1', 'mail.tex', 'demo__artigo-1');
    const h2 = await open(b, 'p2', 'mail.tex', 'demo__artigo-1');
    expect(h2.opened).toBe(true);
    await a.page.evaluate(() => (window as any).__ws.p1.ws.send(JSON.stringify({ t: 'aw', anchor: 1, head: 2 })));
    await b.page.evaluate(() => (window as any).__ws.p2.ws.send(JSON.stringify({ t: 'aw', anchor: 3, head: 4 })));
    await poll(async () => (await state(a, 'p1')).texts.some(t => JSON.parse(t).t === 'aw'), v => v === true, 5000);
    const all = [...(await state(a, 'p1')).texts, ...(await state(b, 'p2')).texts];
    expect(all.some(t => JSON.parse(t).t === 'join')).toBe(true);
    expect(all.some(t => JSON.parse(t).t === 'hello' && JSON.parse(t).peers.length === 1)).toBe(true);
    for (const t of all) { expect(t).not.toContain('email'); expect(t).not.toContain('demo@neoleaf.local'); }
  });

  test('the project part of the room key ignores case', async () => {
    await open(a, 'c1', 'case.tex', 'demo__artigo-1');
    const h = await open(b, 'c2', 'case.tex', 'DEMO__ARTIGO-1');
    const hello = JSON.parse(h.texts.find(t => JSON.parse(t).t === 'hello')!);
    expect(hello.peers.length).toBe(1);
  });

  test('an invalid project id or file path is refused', async () => {
    for (const [file, project] of [['main.tex', 'demo__artigo-1/../x'], ['main.tex', 'demo'], ['../x.tex', 'demo__artigo-1'], ['a//b.tex', 'demo__artigo-1']]) {
      const r = await open(a, 'bad', file, project);
      expect(r.opened).toBe(false);
    }
    const ok = await open(a, 'good', 'sections/ok.tex', 'demo__artigo-1');
    expect(ok.opened).toBe(true);
  });

  test('a document over the size limit is rejected and the other peer never receives the extra update', async () => {
    await openProject(a.page);
    await poll(() => ev<boolean>(a, 'window.collabActive === true && !!window.Y'), v => v === true, 25000);
    await a.page.evaluate(c => (0, eval)(c), HELPERS); // openProject navigated: inject the helpers again
    await b.page.goto(BASE_URL + '/');
    await b.page.evaluate(c => (0, eval)(c), HELPERS);
    const r = await a.page.evaluate(async () => {
      const Y = (window as any).Y;
      const ydoc = new Y.Doc();
      const text = ydoc.getText('content');
      const w: any = window;
      const p1 = await w.__open('big1', 'big.tex', 'demo__artigo-1');
      const ws1 = w.__ws.big1.ws;
      ydoc.on('update', (u: Uint8Array) => { const m = new Uint8Array(u.length + 1); m[0] = 1; m.set(u, 1); ws1.send(m); });
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      text.insert(0, 'a'.repeat(1_900_000)); await sleep(500);
      ws1.send(JSON.stringify({ t: 'seeded' })); await sleep(300);
      text.insert(0, 'b'.repeat(200_000)); await sleep(500); // applied: the room is now over 2 MB
      return { role: JSON.parse(p1.texts[0]).role };
    });
    expect(r.role).toBe('seed');
    // a second peer joins and gets the state
    const p2 = await b.page.evaluate(async () => { const w: any = window; return w.__open('big2', 'big.tex', 'demo__artigo-1'); });
    expect(p2.opened).toBe(true);
    await poll(async () => (await state(b, 'big2')).bins, n => n >= 1, 8000);
    const binsBefore = (await state(b, 'big2')).bins;
    // a further update on the full document is rejected
    await a.page.evaluate(async () => {
      const w: any = window; const Y = w.Y;
      const d = new Y.Doc(); d.getText('content').insert(0, 'zzz');
      const u = Y.encodeStateAsUpdate(d); const m = new Uint8Array(u.length + 1); m[0] = 1; m.set(u, 1);
      w.__ws.big1.ws.send(m);
    });
    await poll(async () => (await state(a, 'big1')).texts.some(t => JSON.parse(t).t === 'rejected'), v => v === true, 8000);
    await new Promise(r => setTimeout(r, 800));
    expect((await state(b, 'big2')).bins).toBe(binsBefore);
  });

  test('the 11th simultaneous connection of the same person is refused (429) and a slot frees up on close', async () => {
    fake.seedRepo(COMMON.login, 'conn-limit', { 'main.tex': 'x' }, ['neoleaf']);
    const u = await userPage(COMMON.sid);
    try {
      for (let i = 0; i < 10; i++) expect((await open(u, `s${i}`, `f${i}.tex`, `${COMMON.login}__conn-limit`)).opened).toBe(true);
      expect((await open(u, 's10', 'f10.tex', `${COMMON.login}__conn-limit`)).opened).toBe(false);
      await u.page.evaluate(() => (window as any).__ws.s0.ws.close());
      const again = await poll(async () => (await open(u, 's11', 'f11.tex', `${COMMON.login}__conn-limit`)).opened, v => v === true, 8000);
      expect(again).toBe(true);
    } finally { await u.context.close(); }
  });

  test('a person who only listens is disconnected after the admin blocks them', async () => {
    fake.seedRepo(LISTENER.login, 'block-room', { 'main.tex': 'x' }, ['neoleaf']);
    const v = await userPage(LISTENER.sid);
    try {
      expect((await open(v, 'v1', 'main.tex', `${LISTENER.login}__block-room`)).opened).toBe(true);
      const r = await a.page.evaluate(async () => (await fetch('/api/admin/users/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'student-listener', reason: 'collab-security' }) })).json());
      expect(r.error).toBeFalsy();
      const closed = await poll(async () => (await state(v, 'v1')).closed, c => c === true, 10000);
      expect(closed).toBe(true);
    } finally {
      await v.context.close();
      // leave the blocked list as it was: blocklist.test.ts expects it to be empty when it starts
      await a.page.evaluate(async () => (await fetch('/api/admin/users/unblock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'student-listener' }) })).json());
    }
  });

  test('a person who signs out is disconnected even without sending anything', async () => {
    const c = await newSession();
    try {
      await c.page.goto(BASE_URL + '/');
      await c.page.evaluate(code => (0, eval)(code), HELPERS);
      expect((await open(c, 'o1', 'out.tex', 'demo__artigo-1')).opened).toBe(true);
      await c.page.evaluate(() => fetch('/auth/logout', { redirect: 'manual' }));
      const closed = await poll(async () => (await state(c, 'o1')).closed, x => x === true, 10000);
      expect(closed).toBe(true);
    } finally { await c.context.close(); }
  });
});
