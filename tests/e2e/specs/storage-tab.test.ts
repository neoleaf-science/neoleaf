import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, DEMO_PROJECT, newSession, openProject, poll, type Session } from '../helpers';

// "Storage" tab of the user modal: usage bar, compiler cache, projects kept in this browser.
describe('storage tab in the user modal', () => {
  let s: Session;
  const dialogs: string[] = [];
  let dialogMode: 'accept' | 'dismiss' = 'accept';
  // opens the editor and waits until the clone is complete and written (leaving earlier would cut the download short)
  const openAndWait = async () => {
    await openProject(s.page);
    await s.page.waitForFunction(() => (globalThis as any).eval('typeof currentFileId !== "undefined" && !!currentFileId'), null, { timeout: 40000 });
    await new Promise(r => setTimeout(r, 2000));
  };
  const openTab = async () => {
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    await s.page.click('#upm-tab-btn-storage');
  };
  beforeAll(async () => {
    s = await newSession();
    s.page.on('dialog', d => { dialogs.push(d.message()); if (dialogMode === 'dismiss') d.dismiss(); else d.accept(); });
    await openAndWait();   // leaves a local clone of the demo project in this browser
  });
  afterAll(async () => { await s.context.close(); });

  test('the tab shows the used and free space, with a bar', async () => {
    await s.page.goto(BASE_URL + '/');
    await openTab();
    await poll(() => s.page.textContent('#upm-st-text'), t => /used of/.test(String(t)), 15000);
    expect(await s.page.locator('#upm-pane-storage').isVisible()).toBe(true);
    expect(await s.page.locator('#upm-pane-profile').isVisible()).toBe(false);
    expect(await s.page.textContent('#upm-st-used-txt')).toContain('Used:');
    expect(await s.page.textContent('#upm-st-free-txt')).toContain('Free:');
    expect(await s.page.getAttribute('#upm-st-bar', 'role')).toBe('progressbar');
    // back to the profile tab
    await s.page.click('#upm-tab-btn-profile');
    expect(await s.page.locator('#upm-pane-profile').isVisible()).toBe(true);
  });

  test('the sign-out and close buttons stay visible in both tabs', async () => {
    await s.page.click('#upm-tab-btn-storage');
    expect(await s.page.locator('#upm-btn-logout').isVisible()).toBe(true);
  });

  test('the list shows the project stored in this browser, with its size', async () => {
    await s.page.click('#upm-tab-btn-storage');
    const row = s.page.locator('.upm-st-row', { hasText: 'demo/' + DEMO_PROJECT.split('__')[1] });
    await row.waitFor({ timeout: 15000 });
    await poll(() => row.locator('.upm-st-size').textContent(), t => /\d/.test(String(t)) && !/Calculating/.test(String(t)), 15000);
    expect(await row.locator('.upm-st-remove').isEnabled()).toBe(true);
  });

  test('clear compiler cache empties the cache and leaves the projects', async () => {
    await s.page.evaluate(async () => {
      const c = await caches.open('texlive-font-bundles-v1');
      await c.put('/fake-bundle.tar', new Response(new Blob(['x'.repeat(1000)])));
    });
    await s.page.click('#upm-tab-btn-profile');
    await s.page.click('#upm-tab-btn-storage');
    await poll(() => s.page.textContent('#upm-st-cache-info'), t => /1 saved file/.test(String(t)), 15000);
    await s.page.click('#upm-st-cache-btn');
    await poll(() => s.page.evaluate(async () => (await caches.keys()).length), n => n === 0, 15000);
    await poll(() => s.page.textContent('#upm-st-cache-info'), t => /0 saved file/.test(String(t)), 15000);
    expect(await s.page.locator('.upm-st-row').count()).toBeGreaterThan(0);   // the project is still listed
  });

  test('in the editor, the open project cannot be removed', async () => {
    await openAndWait();
    await openTab();
    const row = s.page.locator('.upm-st-row', { hasText: 'demo/' + DEMO_PROJECT.split('__')[1] });
    await row.waitFor({ timeout: 15000 });
    expect(await row.locator('.upm-st-remove').isDisabled()).toBe(true);
    expect(await row.locator('.upm-st-remove').textContent()).toContain('open now');
  });

  test('removing a project asks first, deletes the local copy, and opening it again downloads it', async () => {
    await s.page.goto(BASE_URL + '/');
    await openTab();
    const name = 'demo/' + DEMO_PROJECT.split('__')[1];
    const row = s.page.locator('.upm-st-row', { hasText: name });
    await row.waitFor({ timeout: 15000 });
    dialogs.length = 0;
    await row.locator('.upm-st-remove').click();
    await poll(() => s.page.locator('.upm-st-row', { hasText: name }).count(), n => n === 0, 20000);
    expect(dialogs.some(d => d.includes('Remove the local copy of ' + name) && d.includes('Nothing is deleted on GitHub'))).toBe(true);
    expect(await s.page.textContent('#upm-st-list')).toContain('No projects are stored in this browser.');
    // opening the project downloads it again (and it shows up in the list)
    await openAndWait();
    await openTab();
    await s.page.locator('.upm-st-row', { hasText: name }).waitFor({ timeout: 15000 });
  });

  test('a project with changes that are not on GitHub gets a warning before it is removed', async () => {
    await openAndWait();
    await s.page.evaluate(async () => { await (window as any).BrowserGit.writeFile('only-here.txt', 'draft'); });
    await new Promise(r => setTimeout(r, 1500));   // background storage writes
    await s.page.goto(BASE_URL + '/');
    await openTab();
    const name = 'demo/' + DEMO_PROJECT.split('__')[1];
    const row = s.page.locator('.upm-st-row', { hasText: name });
    await row.waitFor({ timeout: 15000 });
    dialogs.length = 0;
    await row.locator('.upm-st-remove').click();
    await poll(() => dialogs.length, n => n > 0, 15000);
    expect(dialogs[0]).toContain('WARNING: this copy has changes that are not on GitHub');
  });

  // ---- several people in the same browser

  const rawCount = () => s.page.evaluate(() => new Promise<number>(res => {
    const r = indexedDB.open('neoleaf-git');
    r.onerror = () => res(-1);
    r.onsuccess = () => {
      const db = r.result; const names = Array.from(db.objectStoreNames);
      if (!names.length) { db.close(); res(0); return; }
      const tx = db.transaction(names, 'readonly'); let total = 0; let left = names.length;
      names.forEach(n => { const c = tx.objectStore(n).count(); c.onsuccess = () => { total += c.result; if (--left === 0) { db.close(); res(total); } }; });
    };
  }));
  const seedFs = (fn: string) => s.page.evaluate(async (code: string) => {
    const w = window as any; const pfs = w.__upmFs ? w.__upmFs.promises : w.BrowserGit.getFs().pfs;
    await (new Function('pfs', 'return (async () => {' + code + '})()'))(pfs);
    if (pfs.flush) await pfs.flush();
  }, fn);

  test('the list shows only the projects of the signed-in account; the others are only counted', async () => {
    await s.page.goto(BASE_URL + '/');
    await openTab();
    await poll(() => s.page.textContent('#upm-st-text'), t => /used of/.test(String(t)), 15000);
    // another person's copy, the same login on the other provider, and a copy of someone else's repository that THIS account opened
    await seedFs(`
      for (const d of ['/repos/other-user', '/repos/other-user/secret-paper', '/repos/codeberg.demo', '/repos/codeberg.demo/mine-on-codeberg', '/repos/friend', '/repos/friend/shared']) await pfs.mkdir(d).catch(() => {});
      await pfs.writeFile('/repos/other-user/secret-paper/main.tex', 'x'.repeat(2000));
      await pfs.writeFile('/repos/codeberg.demo/mine-on-codeberg/main.tex', 'y'.repeat(1000));
      await pfs.writeFile('/repos/friend/shared/main.tex', 'z'.repeat(500));
      await pfs.mkdir('/meta').catch(() => {});
      await pfs.writeFile('/meta/' + encodeURIComponent('friend/shared') + '.json', JSON.stringify({ login: 'demo', provider: 'github' }));
    `);
    await s.page.evaluate(() => (window as any).StorageManager.refresh());
    await s.page.locator('.upm-st-row', { hasText: 'friend/shared' }).waitFor({ timeout: 15000 });   // opened by this account: listed
    await poll(() => s.page.textContent('#upm-st-others'), t => /2 project\(s\) from other accounts/.test(String(t)), 15000);
    const modalText = await s.page.locator('#user-profile-modal').innerText();
    expect(modalText).not.toContain('secret-paper');
    expect(modalText).not.toContain('other-user');
    expect(modalText).not.toContain('mine-on-codeberg');
  });

  test('opening a project records which account opened it', async () => {
    await openAndWait();
    const meta = await s.page.evaluate(async () => {
      const pfs = (window as any).BrowserGit.getFs().pfs;
      return JSON.parse(await pfs.readFile('/meta/' + encodeURIComponent('demo/' + 'artigo-1') + '.json', 'utf8'));
    });
    expect(meta.login).toBe('demo');
    expect(meta.provider).toBe('github');
  });

  test('"Delete all local data" asks, names the work that would be lost, and empties everything', async () => {
    await openAndWait();
    await s.page.evaluate(async () => { await (window as any).BrowserGit.writeFile('only-here.txt', 'draft'); });
    await new Promise(r => setTimeout(r, 1500));
    await s.page.evaluate(async () => { const c = await caches.open('texlive-font-bundles-v1'); await c.put('/x.tar', new Response('x')); });
    await s.page.goto(BASE_URL + '/');
    await openTab();
    await s.page.locator('.upm-st-row').first().waitFor({ timeout: 15000 });
    dialogs.length = 0;
    dialogMode = 'dismiss';
    await s.page.click('#upm-st-clear-all');
    await poll(() => dialogs.length, n => n > 0, 20000);
    dialogMode = 'accept';
    expect(dialogs[0]).toContain('Delete ALL local data of NeoLeaf');
    expect(dialogs[0]).toContain('These copies have changes that are not on GitHub or Codeberg');
    expect(dialogs[0]).toContain('demo/artigo-1');
    expect(await s.page.locator('.upm-st-row').count()).toBeGreaterThan(0);   // dismissed: nothing was deleted
    await s.page.click('#upm-st-clear-all');
    await poll(() => s.page.locator('.upm-st-row').count(), n => n === 0, 30000);
    expect(await s.page.evaluate(async () => (await caches.keys()).length)).toBe(0);
    expect(await s.page.textContent('#upm-st-others')).toBe('');
    expect(await rawCount()).toBeLessThan(5);
  });

  test('signing out deletes everything, but asks first when work would be lost', async () => {
    await openAndWait();
    await s.page.evaluate(async () => { await (window as any).BrowserGit.writeFile('only-here.txt', 'draft'); });
    await new Promise(r => setTimeout(r, 1500));
    await s.page.goto(BASE_URL + '/');
    expect(await rawCount()).toBeGreaterThan(8);
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    dialogs.length = 0;
    dialogMode = 'dismiss';
    await s.page.click('#upm-btn-logout');
    await poll(() => dialogs.length, n => n > 0, 30000);
    expect(dialogs[0]).toContain('Signing out deletes all NeoLeaf data stored in this browser');
    expect(dialogs[0]).toContain('demo/artigo-1');
    await new Promise(r => setTimeout(r, 500));
    expect(s.page.url()).not.toContain('logout');
    expect((await (await s.context.request.get(BASE_URL + '/api/user/profile')).json()).login).toBe('demo');   // still signed in
    expect(await rawCount()).toBeGreaterThan(8);                                                           // and nothing was deleted
    dialogMode = 'accept';
    await s.page.click('#upm-btn-logout');
    await s.page.waitForFunction(() => !document.getElementById('user-profile-modal'), null, { timeout: 40000 });   // the login page
    expect((await (await s.context.request.get(BASE_URL + '/api/user/profile')).json()).error).toBeTruthy();
    expect(await rawCount()).toBeLessThan(5);
  });
});
