import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, COMMON, fake, getBrowser, newSession, type Session } from '../helpers';

// Template catalog: the admin registers only metadata and the source link (GitHub); the files come from GitHub through the
// browser, via a stateless proxy. Here the demo user is an admin (ADMIN_EMAILS) and "student-common" is not.
describe('template catalog', () => {
  let admin: Session;
  const model = (over: Record<string, unknown> = {}) => ({
    id: 'tcc-e2e', name: 'Test thesis', description: 'Template for the tests', category: 'thesis', institution: 'IFTO', language: 'pt', license: 'MIT',
    source: 'https://github.com/demo/thesis-template', git_ref: 'v1', subdir: 'tcc', main_file: 'main.tex', engine: 'wasm-xelatex', preview_url: '', enabled: true, order: 1, ...over,
  });
  const post = (path: string, body: unknown) => admin.page.request.post(`${BASE_URL}${path}`, { data: body }).then(r => r.json());
  const asCommon = async () => {
    const ctx = await (await getBrowser()).newContext();
    await ctx.addCookies([{ name: 'latex_session', value: COMMON.sid, url: BASE_URL }]);
    return ctx;
  };

  beforeAll(async () => {
    admin = await newSession();
    await admin.page.goto(`${BASE_URL}/`);
    fake.seedRepo('demo', 'thesis-template', {
      'tcc/main.tex': '\\documentclass{abntex2}\n\\begin{document}\n\\input{tcc/cap1}\n\\end{document}\n',
      'tcc/cap1.tex': '\\chapter{Introduction}\nTemplate text.\n',
      'README.md': 'does not belong to the template (outside the folder)\n',
    }, [], 'v1');
  });
  afterAll(async () => { await admin.context.close(); });

  test('the public list starts empty and only the admin registers', async () => {
    const anon = await (await getBrowser()).newContext();
    expect(await (await anon.request.get(`${BASE_URL}/api/templates`)).json()).toEqual({ templates: [] });
    expect((await anon.request.post(`${BASE_URL}/api/admin/templates/save`, { data: model() })).status()).toBeLessThan(500);
    expect(await (await anon.request.get(`${BASE_URL}/api/templates`)).json()).toEqual({ templates: [] });
    await anon.close();

    const v = await asCommon();
    const r = await (await v.request.post(`${BASE_URL}/api/admin/templates/save`, { data: model() })).json();
    expect(r.error).toMatch(/^Access denied$/);
    expect((await (await v.request.get(`${BASE_URL}/api/admin/templates`)).json()).error).toMatch(/^Access denied$/);
    await v.close();
    expect(await (await admin.page.request.get(`${BASE_URL}/api/templates`)).json()).toEqual({ templates: [] });
  });

  test('rejects a source outside GitHub, a reserved id and dangerous paths', async () => {
    for (const bad of [{ source: 'https://gitlab.com/a/b' }, { id: 'article' }, { subdir: '../x' }, { main_file: '/etc/passwd' }, { preview_url: 'javascript:alert(1)' }, { git_ref: '-x' }]) {
      const r = await post('/api/admin/templates/save', model(bad));
      expect(r.success).toBeUndefined();
      expect(typeof r.error).toBe('string');
    }
    expect(await (await admin.page.request.get(`${BASE_URL}/api/templates`)).json()).toEqual({ templates: [] });
  });

  test('check verifies repository, version and file on GitHub', async () => {
    expect((await post('/api/admin/templates/check', model())).success).toBe(true);
    expect((await post('/api/admin/templates/check', model({ git_ref: 'v9' }))).error).toContain('version "v9"');
    expect((await post('/api/admin/templates/check', model({ main_file: 'does-not-exist.tex' }))).error).toContain('was not found');
    expect((await post('/api/admin/templates/check', model({ git_ref: 'v9', subdir: '', main_file: '' }))).error).toContain('Version');
    expect((await post('/api/admin/templates/check', model({ source: 'demo/missing-repository' }))).error).toContain('Repository not found');
  });

  test('saving publishes to the public list without exposing who changed it; disabling hides it', async () => {
    expect((await post('/api/admin/templates/save', model())).success).toBe(true);
    const pub = await (await admin.page.request.get(`${BASE_URL}/api/templates`)).json();
    expect(pub.templates.map((m: any) => m.id)).toEqual(['tcc-e2e']);
    expect(pub.templates[0].sourceUrl).toBe('https://github.com/demo/thesis-template');
    expect(JSON.stringify(pub)).not.toContain('updated');
    expect((await post('/api/admin/templates/save', model({ enabled: false }))).success).toBe(true);
    expect((await (await admin.page.request.get(`${BASE_URL}/api/templates`)).json()).templates).toEqual([]);
    expect((await (await admin.page.request.get(`${BASE_URL}/api/admin/templates`)).json()).templates).toHaveLength(1);
    await post('/api/admin/templates/save', model());
  });

  test('the ZIP is only served to signed-in people and only for a registered template', async () => {
    const anon = await (await getBrowser()).newContext();
    expect((await anon.request.get(`${BASE_URL}/api/templates/tcc-e2e/zip`)).status()).toBe(401);
    await anon.close();
    expect((await admin.page.request.get(`${BASE_URL}/api/templates/does-not-exist/zip`)).status()).toBe(404);
    const ok = await admin.page.request.get(`${BASE_URL}/api/templates/tcc-e2e/zip`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()['content-type']).toBe('application/zip');
    expect(ok.headers()['cache-control']).toBe('no-store');
  });

  test('creating a project from the gallery uses the template folder, the main file and the engine', async () => {
    await admin.page.goto(`${BASE_URL}/`);
    await admin.page.evaluate(() => (window as any).openNewProjectModal());
    await admin.page.waitForSelector('#tpl-gallery .tpl-card[data-value="model:tcc-e2e"]');
    expect(await admin.page.locator('#tpl-gallery .tpl-card').count()).toBe(4);
    await admin.page.click('#tpl-gallery .tpl-card[data-value="model:tcc-e2e"]');
    expect(await admin.page.inputValue('#proj-template')).toBe('model:tcc-e2e');
    await admin.page.fill('#proj-name', 'e2e-from-template');
    await admin.page.click('#btn-create-submit');
    await admin.page.waitForURL(/\/project\/demo__e2e-from-template/, { timeout: 30000 });
    const tree = () => fake.tree('demo', 'e2e-from-template');
    for (let i = 0; i < 60 && !tree().includes('cap1.tex'); i++) await new Promise(r => setTimeout(r, 500));
    expect(tree()).toContain('main.tex');
    expect(tree()).toContain('cap1.tex');
    expect(tree().some(f => f.includes('README') && !f.startsWith('.'))).toBe(false);
    const cfg = JSON.parse(fake.file('demo', 'e2e-from-template', '.neoleaf/config.json'));
    expect(cfg.mainFile).toBe('main.tex');
    expect(cfg.engine).toBe('wasm-xelatex');
  });

  test('the admin Templates tab lists, edits and removes', async () => {
    const dialogs: string[] = [];
    admin.page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await admin.page.goto(`${BASE_URL}/admin`);
    await admin.page.click('#tabbtn-models');
    await admin.page.waitForSelector('#models-tbody tr:has-text("Test thesis")');
    await admin.page.click('#models-tbody tr:has-text("Test thesis") button:has-text("Edit")');
    await admin.page.fill('#mf-name', 'Renamed thesis');
    await admin.page.click('#mf-check');
    await admin.page.waitForSelector('#mf-msg:has-text("Repository, version and")');
    await admin.page.click('#mf-save');
    await admin.page.waitForSelector('#models-tbody tr:has-text("Renamed thesis")');
    expect((await (await admin.page.request.get(`${BASE_URL}/api/templates`)).json()).templates[0].name).toBe('Renamed thesis');
    await admin.page.click('#models-tbody tr:has-text("Renamed thesis") button:has-text("Remove")');
    await admin.page.waitForSelector('#models-tbody:has-text("No template registered")');
    expect(dialogs.some(d => d.includes('Remove the template'))).toBe(true);
    expect((await (await admin.page.request.get(`${BASE_URL}/api/templates`)).json()).templates).toEqual([]);
  });
  test('suggested templates come in disabled and with a pinned version', async () => {
    await admin.page.goto(`${BASE_URL}/admin`);
    await admin.page.click('#tabbtn-models');
    await admin.page.waitForSelector('#suggest-tbody tr');
    expect(await admin.page.locator('#suggest-tbody tr').count()).toBe(14);
    await admin.page.click('#suggest-all');
    await admin.page.waitForSelector('#models-tbody tr:has-text("abnTeX2: Academic work")');
    const all = (await (await admin.page.request.get(`${BASE_URL}/api/admin/templates`)).json()).templates;
    expect(all).toHaveLength(14);
    expect(all.every((m: any) => m.enabled === false)).toBe(true);
    expect(all.every((m: any) => m.git_ref.length > 0)).toBe(true);
    expect((await (await admin.page.request.get(`${BASE_URL}/api/templates`)).json()).templates).toEqual([]);
    expect(await admin.page.locator('#suggest-tbody button:disabled').count()).toBe(14);
    for (const m of all) await post('/api/admin/templates/delete', { id: m.id });
  });
});
