import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, getBrowser, newSession, openProject, poll, type Session } from '../helpers';

// The browser reads what the project declares and downloads the missing packages in one go, before the first compile. The server
// is only a proxy for CTAN/TeX Live (POST /api/ctan/resolve and /api/ctan/package), and stores nothing. The responses are
// mocked here: real downloads depend on the network.
describe('early package installation (WebAssembly engine)', () => {
  let s: Session;
  let calls = 0;
  let reply: (files: string[]) => { status: number; body: unknown } = files => ({ status: 200, body: { results: files.map((f, i) => ({ file: f, base: false, package: i === 0 ? 'fake-package' : null })) } });

  beforeAll(async () => {
    s = await newSession();
    await s.page.route('**/api/ctan/resolve', route => {
      calls++;
      const files: string[] = JSON.parse(route.request().postData() || '{}').files || [];
      const r = reply(files);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });
    await s.page.route('**/api/ctan/package', route => {
      // only the fake package is mocked; the rest (e.g. the babel language) goes on to the real server
      if (!/fake-package/.test(route.request().postData() || '')) return route.continue();
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ package: 'fake-package', files: [{ name: 'fakepackage.sty', b64: Buffer.from('\\ProvidesPackage{fakepackage}\n').toString('base64') }] }),
      });
    });
    await openProject(s.page);
  });
  afterAll(async () => { await s.context.close(); });

  const busy = () => s.page.evaluate(() => (document.getElementById('compile-btn') as HTMLButtonElement).disabled);
  const compile = async () => {
    await s.page.click('#compile-btn');
    await poll(busy, b => b, 10000).catch(() => {}); // it may finish before we see the button disabled
    await poll(busy, b => !b, 120000);
    await Bun.sleep(300);
  };
  const rawLog = () => s.page.evaluate(() => document.getElementById('raw-log')?.textContent || '');

  test('the endpoint requires login', async () => {
    const anon = await (await getBrowser()).newContext();
    const r = await anon.request.post(`${BASE_URL}/api/ctan/resolve`, { data: { files: ['xcolor.sty'] } });
    expect((await r.json()).error).toBeTruthy();
    await anon.close();
  });

  test('the first compile calls the endpoint first and the log says what was installed', async () => {
    await compile();
    expect(calls).toBe(1);
    expect(await rawLog()).toContain('fake-package');
  });

  test('compiling again without changing the declared packages does not repeat the call', async () => {
    await compile();
    expect(calls).toBe(1);
  });

  test('declaring a new package in the open file calls the endpoint again', async () => {
    await s.page.evaluate(() => { (globalThis as any).eval(`editor.setValue(editor.getValue().replace('\\\\begin{document}', '\\\\usepackage{xcolor}\\n\\\\begin{document}'))`); });
    await compile();
    expect(calls).toBe(2);
  });

  test('if the endpoint fails, the compile goes on normally', async () => {
    reply = () => ({ status: 500, body: { error: 'unavailable' } });
    await s.page.evaluate(() => { (globalThis as any).eval(`editor.setValue(editor.getValue().replace('\\\\usepackage{xcolor}', '\\\\usepackage{xcolor}\\n\\\\usepackage{amssymb}'))`); });
    await compile();
    expect(calls).toBe(3);
    const hasPdf = await s.page.evaluate(() => !!document.querySelector('#pdf-viewer canvas'));
    expect(hasPdf).toBe(true);
  });
});
