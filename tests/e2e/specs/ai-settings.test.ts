import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, COMMON, DEMO_PROJECT, newSession, openProject, poll, type Session } from '../helpers';

// AI assistant, step 1 (docs/ai-assistant-plan.md): the switch, the settings and the consent. Nothing here calls a provider.
// The test server has no neoleaf.toml, like the public site, so the assistant is on. With `[ai]` off (an institution install) or
// NEOLEAF_AI=off the page has no AI element at all (unit tests in src/views/editor_page.rs and src/config.rs).

const SECRET = 'sk-test-e2e-NEVER-LEAVES-THE-BROWSER-0123456789';
const KEY_DEMO = 'neoleaf.ai.github.1';

const aiKeys = (page: any): Promise<string[]> => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('neoleaf.ai.')));
const openTab = async (page: any) => {
  await page.click('#tab-ai-btn');
  await page.waitForSelector('#ai-container .ai-card');
};

describe('AI assistant: settings and consent', () => {
  let s: Session;
  const seen: string[] = []; // everything the page sent anywhere: address, headers and body
  const dialogs: string[] = [];

  beforeAll(async () => {
    s = await newSession();
    s.page.on('request', r => seen.push([r.url(), JSON.stringify(r.headers()), r.postData() || ''].join('\n')));
    s.page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await openProject(s.page);
  });
  afterAll(async () => { await s.context.close(); });

  test('the tab opens on the notice, and nothing is stored before the person accepts it', async () => {
    await openTab(s.page);
    expect(await s.page.locator('#ai-notice').isVisible()).toBe(true);
    expect(await s.page.locator('#ai-form').count()).toBe(0);
    expect(await s.page.locator('#ai-container').getAttribute('data-account')).toBe('github.1');
    expect(await aiKeys(s.page)).toEqual([]);
    expect(await s.page.evaluate(() => (window as any).AISettings.get())).toBeNull();
  });

  test('after the notice comes the form, which refuses a missing key, a missing model and an address that is not https', async () => {
    await s.page.click('#ai-consent');
    await s.page.waitForSelector('#ai-form');
    await s.page.click('#ai-save');
    expect(await s.page.locator('#ai-error').innerText()).toContain('API key');
    await s.page.fill('#ai-key', SECRET);
    await s.page.click('#ai-save');
    expect(await s.page.locator('#ai-error').innerText()).toContain('model');
    // the built-in providers have a fixed address; only "Other" asks for one
    expect(await s.page.locator('#ai-url-row').isVisible()).toBe(false);
    await s.page.selectOption('#ai-provider', 'custom');
    expect(await s.page.locator('#ai-url-row').isVisible()).toBe(true);
    expect(await s.page.inputValue('#ai-key')).toBe(SECRET);
    await s.page.fill('#ai-model', 'some-model');
    for (const bad of ['http://example.com/v1', 'ftp://example.com', 'https://user:pw@example.com', 'not an address']) {
      await s.page.fill('#ai-url', bad);
      await s.page.click('#ai-save');
      expect(await s.page.locator('#ai-error').innerText()).toContain('https://');
      // a refused field does not erase what was typed in the others
      expect(await s.page.inputValue('#ai-key')).toBe(SECRET);
      expect(await s.page.inputValue('#ai-model')).toBe('some-model');
      expect(await s.page.inputValue('#ai-provider')).toBe('custom');
    }
    expect(await s.page.evaluate(() => (window as any).AISettings.get())).toBeNull();
  });

  test('saved settings are per account, in this browser; an empty name is the model name', async () => {
    await s.page.selectOption('#ai-provider', 'anthropic');
    await s.page.fill('#ai-key', SECRET);
    await s.page.fill('#ai-model', 'claude-opus-5-5');
    await s.page.click('#ai-save');
    await s.page.waitForSelector('#ai-ready');
    expect(await aiKeys(s.page)).toEqual([KEY_DEMO]);
    const got = await s.page.evaluate(() => (window as any).AISettings.get());
    expect(got).toEqual({ provider: 'anthropic', dialect: 'anthropic', baseUrl: 'https://api.anthropic.com', key: SECRET, model: 'claude-opus-5-5', name: 'claude-opus-5-5' });
    expect(await s.page.locator('#ai-ready-name').innerText()).toBe('claude-opus-5-5');
    // the key is not shown back
    expect(await s.page.locator('#ai-ready').innerText()).not.toContain(SECRET);
  });

  test('a name is shown as plain text, with the AI mark and the model always there', async () => {
    await s.page.click('#ai-change');
    await s.page.fill('#ai-name', '<img src=x onerror=window.__pwned=1>');
    await s.page.click('#ai-save');
    await s.page.waitForSelector('#ai-ready');
    expect(await s.page.locator('#ai-ready-name').innerText()).toBe('<img src=x onerror=window.__pwned=1>');
    expect(await s.page.locator('#ai-ready img').count()).toBe(0);
    expect(await s.page.evaluate(() => (window as any).__pwned)).toBeUndefined();
    expect(await s.page.locator('#ai-ready .ai-badge').innerText()).toBe('AI');
    expect(await s.page.locator('#ai-ready .ai-badge').getAttribute('title')).toBe('claude-opus-5-5');
    expect(await s.page.locator('#ai-ready .ai-meta').first().innerText()).toContain('claude-opus-5-5');
    await s.page.click('#ai-change');
    await s.page.fill('#ai-name', 'Reviewer');
    await s.page.click('#ai-save');
    expect((await s.page.evaluate(() => (window as any).AISettings.get())).name).toBe('Reviewer');
  });

  test('the settings survive a reload', async () => {
    await openProject(s.page);
    await openTab(s.page);
    expect(await s.page.locator('#ai-ready-name').innerText()).toBe('Reviewer');
  });

  test('anyone in the project can turn the assistant off for the project, and the settings window does not undo it', async () => {
    await s.page.click('#ai-project-off');
    await s.page.waitForSelector('#ai-project-off-notice');
    expect(dialogs.some(d => d.includes('for everyone'))).toBe(true);
    const stored = async () => JSON.parse(await s.page.evaluate(() => (window as any).BrowserGit.readFile('.neoleaf/config.json')));
    expect((await stored()).ai).toBe('off');
    expect(await s.page.evaluate(() => (window as any).AISettings.allowedInProject())).toBe(false);
    // saving the project settings the way the settings window does (it does not know the field) keeps the rule
    await s.page.evaluate(async () => { const P = (window as any).Project; const { config } = await P.config.get(); delete config.ai; await P.config.save({ ...config, autoSync: true }); });
    expect((await stored()).ai).toBe('off');
    await s.page.click('#ai-project-on');
    await s.page.waitForSelector('#ai-ready');
    expect((await stored()).ai).toBeUndefined();
    expect(await s.page.evaluate(() => (window as any).AISettings.allowedInProject())).toBe(true);
  });

  test('the key was never sent anywhere, and no AI provider was contacted', () => {
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.filter(r => r.includes(SECRET))).toEqual([]);
    expect(seen.map(r => r.split('\n')[0]).filter(u => /anthropic|openai|openrouter|generativelanguage/.test(u))).toEqual([]);
  });

  test('another account on the same browser does not get the first one\'s key, even after a session that ended by itself', async () => {
    // a session that ends by itself deletes nothing in the browser: the first account's entry is still there
    await s.context.clearCookies();
    await s.context.addCookies([{ name: 'latex_session', value: COMMON.sid, url: BASE_URL }]);
    await s.page.goto(BASE_URL + '/');
    const created = await s.page.evaluate(async () => (await fetch('/api/project/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'e2e-ai-other', template: 'article' }) })).json());
    await s.page.goto(`${BASE_URL}/project/${created.id}`);
    await s.page.waitForSelector('#tab-ai-btn');
    await openTab(s.page);
    expect(await s.page.locator('#ai-container').getAttribute('data-account')).toBe(`github.${COMMON.id}`);
    expect(await s.page.locator('#ai-notice').isVisible()).toBe(true);
    expect(await s.page.evaluate(() => (window as any).AISettings.get())).toBeNull();
    expect(await aiKeys(s.page)).toEqual([KEY_DEMO]);
    expect(await s.page.locator('#ai-container').innerText()).not.toContain('Reviewer');
  });

  test('no unhandled console errors', () => {
    expect(s.errors).toEqual([]);
  });
});

describe('AI assistant: other languages and forgetting the key', () => {
  let s: Session;
  beforeAll(async () => {
    s = await newSession();
    s.page.on('dialog', d => d.accept());
    await s.page.addInitScript(() => { try { localStorage.setItem('ld-lang', 'pt'); } catch (_) {} });
    await openProject(s.page);
  });
  afterAll(async () => { await s.context.close(); });

  test('the tab and the notice are translated', async () => {
    expect(await s.page.locator('#tab-ai-btn').innerText()).toContain('IA');
    await openTab(s.page);
    expect(await s.page.locator('#ai-notice .ai-title').innerText()).toBe('Assistente de IA');
    expect(await s.page.locator('#ai-consent').innerText()).toBe('Entendi, continuar');
  });

  test('"Forget the key" removes the entry and goes back to the notice', async () => {
    await s.page.click('#ai-consent');
    await s.page.fill('#ai-key', SECRET);
    await s.page.fill('#ai-model', 'm');
    await s.page.click('#ai-save');
    await s.page.waitForSelector('#ai-ready');
    expect(await aiKeys(s.page)).toEqual([KEY_DEMO]);
    await s.page.click('#ai-forget');
    await s.page.waitForSelector('#ai-notice');
    expect(await aiKeys(s.page)).toEqual([]);
  });

  test('"Delete all local data" removes the AI settings too, and says so', async () => {
    await s.page.click('#ai-consent');
    await s.page.fill('#ai-key', SECRET);
    await s.page.fill('#ai-model', 'm');
    await s.page.click('#ai-save');
    await s.page.waitForSelector('#ai-ready');
    const asked: string[] = [];
    s.page.on('dialog', d => asked.push(d.message()));
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    await s.page.evaluate(() => (document.getElementById('upm-st-clear-all') as HTMLElement).click());
    // the open project is gone, so the page goes back to the project list: wait for that before looking at the storage
    await s.page.waitForURL(u => u.pathname === '/', { timeout: 40000 });
    expect(await aiKeys(s.page)).toEqual([]);
    expect(asked.some(m => m.includes('IA'))).toBe(true);
  });

  // signs out with this test's own session (the shared test accounts must stay signed in for the other files)
  test('signing out removes the AI settings of this browser', async () => {
    await openProject(s.page);
    await openTab(s.page);
    await s.page.click('#ai-consent');
    await s.page.fill('#ai-key', SECRET);
    await s.page.fill('#ai-model', 'm');
    await s.page.click('#ai-save');
    await s.page.waitForSelector('#ai-ready');
    expect(await aiKeys(s.page)).toEqual([KEY_DEMO]);
    await s.page.evaluate(() => (window as any).openUserProfileModal());
    await s.page.click('#upm-btn-logout');
    await s.page.waitForFunction(() => !document.getElementById('user-profile-modal'), null, { timeout: 40000 });
    expect(await poll(() => aiKeys(s.page), k => k.length === 0)).toEqual([]);
  });
});
