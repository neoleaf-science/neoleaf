import { describe, expect, test } from 'bun:test';
import { BASE_URL, newSession } from '../helpers';

// The pages live at /privacy, /terms and /agent. The old Portuguese addresses only redirect, so links published earlier keep working.
describe('legacy page addresses', () => {
  for (const [old, now] of [['/privacidade', '/privacy'], ['/termos', '/terms'], ['/agente', '/agent']]) {
    test(`${old} redirects to ${now}, which serves the page`, async () => {
      const s = await newSession();
      try {
        const r = await s.page.request.get(BASE_URL + old, { maxRedirects: 0 });
        expect(r.status()).toBe(303);
        expect(r.headers()['location']).toBe(now);
        expect((await s.page.request.get(BASE_URL + now)).status()).toBe(200);
      } finally { await s.context.close(); }
    });
  }
});
