import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, COMMON, DEMO_PROJECT, fake, newSession, type Session } from '../helpers';
import { raw } from '../raw-http';

const MARK = 'leak-marker';
const leaked = () => fake.requestLog.filter(l => l.includes(MARK));

// Path parameters arrive percent-decoded: `..`, `?`, `#` and `%2F` must never end up inside a URL sent to GitHub.
describe('identifier injection', () => {
  let s: Session;
  let sid = '';
  beforeAll(async () => {
    s = await newSession();
    await s.page.goto(BASE_URL + '/');
    sid = (await s.context.cookies()).find(c => c.name === 'latex_session')!.value;
  });
  afterAll(async () => { await s.context.close(); });

  const badProjects = [`demo__artigo-1%3F${MARK}%3D1`, `demo__artigo-1%23${MARK}`, `demo__artigo-1%2F..%2F..%2Fuser%3F${MARK}`, `demo__%2e%2e`, `..__artigo-1`, `demo__artigo-1%2F${MARK}`, 'semsublinhado'];

  test('project id: every project route refuses it before any call to the service', async () => {
    const routes: [string, string][] = [
      ['GET', 'permissions'], ['POST', 'permissions'], ['POST', 'delete'], ['POST', 'restore'], ['POST', 'topics'], ['GET', 'github-zip'],
      ['POST', 'permissions/someone/role'], ['POST', 'permissions/someone/remove'],
    ];
    for (const id of badProjects) {
      for (const [method, tail] of routes) {
        const r = await raw(method, `/api/project/${id}/${tail}`, { sid, body: method === 'POST' ? { email: 'someone', role: 'writer', topics: [] } : undefined });
        // JSON routes answer with an error body; the ZIP is a plain 400; a path that does not even route is a 404
        const refused = r.status === 400 || r.status === 404 || /Invalid project ID/.test(r.text);
        expect(refused, `${method} ${id}/${tail} -> ${r.status} ${r.text.slice(0, 80)}`).toBe(true);
        expect(r.text).not.toContain('"success":true');
      }
      const page = await raw('GET', `/project/${id}`, { sid });
      expect(page.status === 404 || /Invalid project ID/.test(page.text)).toBe(true);
    }
    expect(leaked()).toEqual([]);
  });

  test('permission id and collaborator name are validated', async () => {
    for (const perm of [`x%3F${MARK}`, `x%23${MARK}`, `%2e%2e`, `inv_12a`, `a%2F${MARK}`]) {
      for (const tail of ['remove', 'role']) {
        const r = await raw('POST', `/api/project/${DEMO_PROJECT}/permissions/${perm}/${tail}`, { sid, body: { role: 'writer' } });
        expect(r.status === 400 || r.status === 404 || /Invalid permission ID/.test(r.text), `${perm}/${tail} -> ${r.status} ${r.text.slice(0, 80)}`).toBe(true);
        expect(r.text).not.toContain('"success":true');
      }
    }
    for (const who of [`a?${MARK}`, `a/${MARK}`, `a#${MARK}`, '..', 'a b']) {
      const r = await raw('POST', `/api/project/${DEMO_PROJECT}/permissions`, { sid, body: { email: who, role: 'writer' } });
      expect(r.text, who).toContain('"error"');
      expect(r.text).not.toContain('"permission"');
    }
    expect(leaked()).toEqual([]);
  });

  test('removing a collaborator reports the provider failure instead of success', async () => {
    // "student-common" has no access to the demo project: the service refuses and the answer must say so
    const r = await raw('POST', `/api/project/${DEMO_PROJECT}/permissions/someone-else/remove`, { sid: COMMON.sid, body: {} });
    const body = JSON.parse(r.text);
    expect(body.success).toBeUndefined();
    expect(typeof body.error).toBe('string');
  });

  test('a pending invitation is never turned into a user name', async () => {
    const before = fake.requestLog.length;
    await raw('POST', `/api/project/${DEMO_PROJECT}/permissions/inv_999999/role`, { sid, body: { role: 'reader' } });
    const calls = fake.requestLog.slice(before);
    expect(calls.some(l => /collaborators\/inv_/.test(l))).toBe(false);
    expect(calls.some(l => l === `PATCH /repos/demo/artigo-1/invitations/999999`)).toBe(true);
  });

  test('git proxy: owner and repo are validated segment by segment, service is one of two', async () => {
    const svc = '?service=git-upload-pack';
    for (const path of [`demo%2F..%2Fx/artigo-1`, `demo/artigo-1%3F${MARK}`, `demo/artigo-1%23${MARK}`, `%2e%2e/artigo-1`, `demo/%2e%2e`, `demo%3F${MARK}/artigo-1`, `de%20mo/artigo-1`]) {
      for (const tail of [`info/refs${svc}`, 'git-upload-pack', 'git-receive-pack']) {
        const r = await raw(tail.startsWith('info') ? 'GET' : 'POST', `/api/git/${path}/${tail}`, { sid, body: tail.startsWith('info') ? undefined : {} });
        expect(r.status === 400 || r.status === 404, `${path}/${tail} -> ${r.status}`).toBe(true);
      }
    }
    for (const q of ['', '?service=git-foo', '?service=git-upload-pack%26leak-marker%3D1', '?service=git-upload-pack/../x', '?service=']) {
      const r = await raw('GET', `/api/git/demo/artigo-1/info/refs${q}`, { sid });
      expect(r.status, q).toBe(400);
    }
    const ok = await raw('GET', `/api/git/demo/artigo-1/info/refs?service=git-upload-pack`, { sid });
    expect(ok.status).toBe(200);
    expect(leaked()).toEqual([]);
  });

  test('template id: only the catalog charset reaches the route', async () => {
    for (const id of [`..%2Fx`, `a%3F${MARK}`, 'Bad_ID', `a%2F${MARK}`]) {
      const r = await raw('GET', `/api/templates/${id}/zip`, { sid });
      expect(r.status === 400 || r.status === 404, `${id} -> ${r.status}`).toBe(true);
    }
    expect((await raw('GET', `/api/templates/nao-existe/zip`, { sid })).status).toBe(404);
    expect(leaked()).toEqual([]);
  });
});
