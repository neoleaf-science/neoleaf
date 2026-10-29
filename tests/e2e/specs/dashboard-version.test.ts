import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { BASE_URL, newSession, type Session } from '../helpers';

// The version of the server sits at the bottom of the sidebar of the project list, after the contact line.
describe('project list: the version at the bottom of the sidebar', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); });
  afterAll(async () => { await s.context.close(); });

  test('shows the version of Cargo.toml, after the contact line', async () => {
    const cargo = readFileSync(new URL('../../../Cargo.toml', import.meta.url), 'utf8');
    const version = /^version = "([^"]+)"/m.exec(cargo)![1];
    await s.page.setViewportSize({ width: 1280, height: 900 });
    await s.page.goto(BASE_URL + '/');
    await s.page.waitForSelector('#pl-version');
    expect((await s.page.locator('#pl-version').textContent())!.trim()).toBe(`NeoLeaf v${version}`);
    const order = await s.page.evaluate(() => {
      const v = document.getElementById('pl-version')!.getBoundingClientRect();
      const c = document.querySelector('.pl-sidebar a[href^="mailto:"], aside a[href^="mailto:"]')!.getBoundingClientRect();
      return { versionBelowContact: v.top > c.top, inside: v.bottom <= window.innerHeight };
    });
    expect(order.versionBelowContact).toBe(true);
    expect(order.inside).toBe(true);
    await s.page.locator('aside').first().screenshot({ path: '/tmp/dashboard-version.png' });
  });
});
