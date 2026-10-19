// A fake GitHub for the tests and for developing without an account: the REST API NeoLeaf uses, OAuth and the
// Git protocol (through `git http-backend`) over bare repositories on disk. None of this goes to production.
//
//   bun tests/fake-github/server.ts --port 4010 --root /tmp/fake-github
//
// NeoLeaf points to it with GITHUB_API_URL and GITHUB_WEB_URL (both equal to this address).
// The same server also plays the part of a Codeberg (Forgejo): the API at /api/v1 (CODEBERG_URL points to it), with the Forgejo
// differences (tags in `topics`, collaborator joins directly without an invitation, `archive/<ref>.zip`, repository list without tags).
// Tokens: `fake-<login>` (the login comes from the token itself).
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface FakeGithub {
  url: string;
  root: string;
  stop: () => void;
  /** Content of a file on the repository's main branch (or '' if it does not exist). */
  file: (owner: string, repo: string, filePath: string, ref?: string) => string;
  /** List of file paths on the main branch. */
  tree: (owner: string, repo: string, ref?: string) => string[];
  repoExists: (owner: string, repo: string) => boolean;
  topics: (owner: string, repo: string) => string[];
  /** The repository description (where NeoLeaf keeps the display title), and a way to set one as a person would. */
  description: (owner: string, repo: string) => string;
  setDescription: (owner: string, repo: string, description: string) => void;
  /** Creates a repository already with files (and, if given, a tag on the initial commit). */
  seedRepo: (owner: string, name: string, files: Record<string, string>, topics?: string[], tag?: string) => void;
  /** Copies a real bare repository (with all tags and commits) into the fake server. */
  importBare: (owner: string, name: string, srcBare: string) => void;
  /** Requests the article search proxy (src/scholar.rs) made to the fake arXiv and DBLP (`/scholar/arxiv`, `/scholar/dblp`). */
  scholarLog: string[];
  /** Switches for the OAuth token endpoint (the Codeberg refresh flow). Reset them after use. */
  oauth: {
    /** `expires_in` of the token given at sign-in (default: none, so the server assumes 1 hour). 1 makes it expire at once. */
    signInExpiresIn?: number;
    /** What the refresh endpoint does: 'ok' rotates the single-use refresh token, '503' is a provider outage, 'revoked' always says invalid_grant. */
    refreshMode: 'ok' | '503' | 'revoked';
    /** How many refresh requests were accepted (and how many arrived at all). */
    refreshAccepted: number;
    refreshRequests: number;
  };
  /** Every request the fake received (`METHOD /path?query`, as the server sent it), to prove what did NOT reach it. */
  requestLog: string[];
}

interface Repo { owner: string; name: string; description?: string; topics: string[]; collaborators: Map<string, string>; invitations: { id: number; invitee: string; permissions: string; created_at: string }[]; updated_at: string; id: number; public?: boolean }

const ARTICLE = fs.readFileSync(path.resolve(import.meta.dir, '../../src/templates/article.tex'), 'utf8');
const EINSTEIN = '@article{einstein1905,\n  author = {Albert Einstein},\n  title = {Zur Elektrodynamik bewegter K{\\"o}rper},\n  journal = {Annalen der Physik},\n  year = {1905}\n}\n';
const GITIGNORE = '*.aux\n*.log\n*.out\n*.toc\n*.synctex.gz\n*.fls\n*.fdb_latexmk\n.neoleaf/last.*\n';

const PROFILES: Record<string, any> = {
  demo: { id: 1, login: 'demo', name: 'Demo User', email: 'demo@neoleaf.local', created_at: '2024-01-15T10:00:00Z', html_url: 'https://github.com/demo' },
  'student-e2e': { id: 555001, login: 'student-e2e', name: 'Student E2E', email: 'student-e2e@fake.local', created_at: '2024-01-01T00:00:00Z', html_url: 'https://github.com/student-e2e' },
  'student-delete': { id: 555002, login: 'student-delete', name: 'Student Delete', email: 'student-delete@fake.local', created_at: '2024-01-01T00:00:00Z', html_url: 'https://github.com/student-delete' },
};

const git = (args: string[], opts: { cwd?: string; input?: string } = {}) => spawnSync('git', args, { cwd: opts.cwd, input: opts.input, encoding: 'utf8' });

export async function startFakeGithub(opts: { port?: number; root?: string; seed?: boolean } = {}): Promise<FakeGithub> {
  const root = opts.root || fs.mkdtempSync(path.join(os.tmpdir(), 'fake-github-'));
  fs.mkdirSync(root, { recursive: true });
  const repos = new Map<string, Repo>();
  let nextId = 1000;
  const key = (o: string, r: string) => `${o}/${r}`.toLowerCase();
  const bare = (o: string, r: string) => path.join(root, o, `${r}.git`);

  function createRepo(owner: string, name: string): Repo {
    fs.mkdirSync(path.dirname(bare(owner, name)), { recursive: true });
    git(['init', '--bare', '-q', '-b', 'main', bare(owner, name)]);
    const repo: Repo = { owner, name, topics: [], collaborators: new Map(), invitations: [], updated_at: new Date().toISOString(), id: nextId++ };
    repos.set(key(owner, name), repo);
    return repo;
  }

  /** Creates the repository already with files (one initial commit). */
  function seedRepo(owner: string, name: string, files: Record<string, string>, topics: string[], tag?: string) {
    const repo = createRepo(owner, name);
    repo.topics = topics;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-seed-'));
    git(['init', '-q', '-b', 'main'], { cwd: work });
    for (const [f, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(work, f)), { recursive: true });
      fs.writeFileSync(path.join(work, f), text);
    }
    git(['add', '-A'], { cwd: work });
    git(['-c', 'user.name=Demo', '-c', 'user.email=demo@neoleaf.local', 'commit', '-q', '-m', 'feat: initial demo commit'], { cwd: work });
    git(['push', '-q', bare(owner, name), 'main'], { cwd: work });
    if (tag) git(['--git-dir', bare(owner, name), 'tag', tag, 'main']);
    fs.rmSync(work, { recursive: true, force: true });
  }

  if (opts.seed !== false) {
    seedRepo('demo', 'artigo-1', { 'main.tex': ARTICLE, 'references.bib': EINSTEIN, '.gitignore': GITIGNORE, '.neoleaf/config.json': JSON.stringify({ mainFile: 'main.tex' }, null, 2) }, ['neoleaf', 'demo', 'latex']);
  }

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const notFound = () => json({ message: 'Not Found' }, 404);

  function loginOf(req: Request): string | null {
    const h = req.headers.get('authorization') || '';
    let token = '';
    if (h.startsWith('Bearer ')) token = h.slice(7);
    else if (h.startsWith('token ')) token = h.slice(6);
    else if (h.startsWith('Basic ')) token = Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':');
    return token.startsWith('fake-') && token.length > 5 ? token.slice(5) : null;
  }

  function permission(repo: Repo, login: string): 'admin' | 'write' | 'read' | null {
    if (repo.owner.toLowerCase() === login.toLowerCase()) return 'admin';
    const c = repo.collaborators.get(login.toLowerCase());
    if (!c && repo.public) return 'read'; // public repository (really copied): anyone can read
    return c ? (c === 'pull' || c === 'read' ? 'read' : c === 'admin' ? 'admin' : 'write') : null;
  }

  const base = () => `http://127.0.0.1:${server.port}`;
  const repoJson = (repo: Repo, login?: string, forgejo = false) => {
    const perm = login ? permission(repo, login) : null;
    return {
      ...(forgejo ? { topics: undefined } : {}),
      id: repo.id, name: repo.name, full_name: `${repo.owner}/${repo.name}`, owner: { login: repo.owner, avatar_url: null }, description: repo.description ?? null,
      html_url: `${base()}/${repo.owner}/${repo.name}`, updated_at: repo.updated_at, ...(forgejo ? {} : { topics: repo.topics }), default_branch: 'main', private: true,
      permissions: { admin: perm === 'admin', push: perm === 'admin' || perm === 'write', pull: !!perm },
    };
  };
  const profile = (login: string) => PROFILES[login] || { id: 1000 + [...login].reduce((n, c) => n + c.charCodeAt(0), 0), login, name: login, email: `${login}@fake.local`, created_at: '2024-01-01T00:00:00Z', html_url: `https://github.com/${login}` };

  // ---- Git protocol (git http-backend as CGI)
  async function gitBackend(req: Request, login: string, pathname: string, search: string): Promise<Response> {
    const m = pathname.match(/^\/([^/]+)\/([^/]+)\.git\//);
    const repo = m && repos.get(key(m[1], m[2]));
    const perm = repo && permission(repo, login);
    if (!repo || !perm) return new Response('Not Found', { status: 404 });
    const isPush = pathname.endsWith('git-receive-pack') || search.includes('service=git-receive-pack');
    if (isPush && perm === 'read') return new Response('Forbidden', { status: 403 });
    const body = new Uint8Array(await req.arrayBuffer());
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>), GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: pathname, REQUEST_METHOD: req.method,
      QUERY_STRING: search.replace(/^\?/, ''), CONTENT_TYPE: req.headers.get('content-type') || '', CONTENT_LENGTH: String(body.length), REMOTE_USER: login, REMOTE_ADDR: '127.0.0.1',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.receivepack', GIT_CONFIG_VALUE_0: 'true',
    };
    const enc = req.headers.get('content-encoding'); if (enc) env.HTTP_CONTENT_ENCODING = enc;
    const proto = req.headers.get('git-protocol'); if (proto) env.GIT_PROTOCOL = proto;
    const child = spawn('git', ['http-backend'], { env });
    const chunks: Buffer[] = [];
    child.stdout.on('data', d => chunks.push(d));
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(body));
    await new Promise(resolve => child.on('close', resolve));
    const out = Buffer.concat(chunks);
    const sep = out.indexOf('\r\n\r\n');
    const head = out.subarray(0, sep < 0 ? 0 : sep).toString();
    const payload = out.subarray(sep < 0 ? 0 : sep + 4);
    const headers = new Headers();
    let status = 200;
    for (const line of head.split('\r\n')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (k.toLowerCase() === 'status') status = parseInt(v, 10) || 200; else headers.set(k, v);
    }
    if (isPush && status === 200) repo.updated_at = new Date().toISOString();
    return new Response(payload, { status, headers });
  }

  const scholarLog: string[] = [];
  const requestLog: string[] = [];
  const oauth: FakeGithub['oauth'] = { refreshMode: 'ok', refreshAccepted: 0, refreshRequests: 0 };
  // single-use refresh tokens: token -> login (only the newest one of each chain stays valid)
  const refreshTokens = new Map<string, string>();
  const server = Bun.serve({
    port: opts.port || 0,
    hostname: '127.0.0.1',
    maxRequestBodySize: 512 * 1024 * 1024,
    async fetch(req) {
      const url = new URL(req.url);
      requestLog.push(`${req.method} ${url.pathname}${url.search}`);
      let p = url.pathname;
      const method = req.method;
      const forgejo = p.startsWith('/api/v1/');
      if (forgejo) p = p.slice('/api/v1'.length);

      // OAuth: "authorizes" by itself as the requested user (?login=) or as `demo`
      if (p === '/login/oauth/authorize') {
        const redirect = url.searchParams.get('redirect_uri') || '/';
        const login = url.searchParams.get('login') || 'demo';
        return Response.redirect(`${redirect}${redirect.includes('?') ? '&' : '?'}code=fake-${encodeURIComponent(login)}&state=${encodeURIComponent(url.searchParams.get('state') || '')}`, 302);
      }
      if (p === '/login/oauth/access_token' && method === 'POST') {
        const form = new URLSearchParams(await req.text());
        if (form.get('grant_type') === 'refresh_token') {
          oauth.refreshRequests++;
          await new Promise(r => setTimeout(r, 150)); // slow enough for parallel requests to overlap
          if (oauth.refreshMode === '503') return new Response('unavailable', { status: 503 });
          const old = form.get('refresh_token') || '';
          const owner = refreshTokens.get(old);
          if (oauth.refreshMode === 'revoked' || !owner) return json({ error: 'invalid_grant', error_description: 'refresh token is invalid' }, 400);
          refreshTokens.delete(old); // single use
          const next = `rt-${owner}-${++oauth.refreshAccepted}-${Math.random().toString(36).slice(2)}`;
          refreshTokens.set(next, owner);
          return json({ access_token: `fake-${owner}`, token_type: 'bearer', refresh_token: next, expires_in: 3600 });
        }
        const code = form.get('code') || '';
        const who = code.startsWith('fake-') ? code.slice(5) : 'demo';
        const out: Record<string, unknown> = { access_token: code.startsWith('fake-') ? code : 'fake-demo', token_type: 'bearer', scope: 'repo,user:email,read:user' };
        if (oauth.signInExpiresIn !== undefined) {
          const rt = `rt-${who}-0-${Math.random().toString(36).slice(2)}`;
          refreshTokens.set(rt, who);
          out.refresh_token = rt;
          out.expires_in = oauth.signInExpiresIn;
        }
        return json(out);
      }

      // fake arXiv and DBLP (the server reaches them through SCHOLAR_ARXIV_URL and SCHOLAR_DBLP_URL)
      if (p === '/scholar/arxiv' || p === '/scholar/dblp') {
        scholarLog.push(p.slice('/scholar/'.length) + '?' + url.searchParams.toString());
        const q = (url.searchParams.get('search_query') || url.searchParams.get('q') || '');
        if (q.includes('erro503')) return new Response('unavailable', { status: 503 });
        if (p === '/scholar/dblp') {
          return Response.json({ result: { hits: { hit: [
            { info: { title: 'Mining Test Smells in Dart.', authors: { author: [{ text: 'Ana Silva 0001' }, { text: 'Bruno Costa' }] }, venue: 'SBES', year: '2024', type: 'Conference and Workshop Papers', doi: '10.1000/dblp.1', ee: 'https://doi.org/10.1000/dblp.1', pages: '10-19' } },
            { info: { title: 'A Journal Article', authors: { author: { text: 'Carla Souza' } }, venue: 'J. Syst. Softw.', year: '2023', type: 'Journal Articles', volume: '200', number: '3', ee: 'https://exemplo.org/artigo' } },
          ] } } });
        }
        const atom = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<entry><id>http://arxiv.org/abs/2401.01234v2</id><published>2024-01-02T00:00:00Z</published><title>Deep   Learning
 for Test Smells</title><summary>Summary of the article about learning.</summary>
<author><name>Ana Silva</name></author><author><name>Bruno Costa</name></author>
<link href="http://arxiv.org/pdf/2401.01234v2" rel="related" type="application/pdf" title="pdf"/><arxiv:doi>10.1000/arxiv.1</arxiv:doi></entry></feed>`;
        return new Response(atom, { headers: { 'Content-Type': 'application/atom+xml' } });
      }

      const login = loginOf(req);
      if (/^\/[^/]+\/[^/]+\.git\//.test(p)) {
        if (!login) return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="fake"' } });
        return gitBackend(req, login, p, url.search);
      }
      if (!login) return json({ message: 'Bad credentials' }, 401);

      let m: RegExpMatchArray | null;
      if (p === '/user' && method === 'GET') {
        const u = profile(login);
        return json(forgejo ? { id: u.id + 70000, login: u.login, full_name: u.name, email: u.email, avatar_url: '', html_url: `${base()}/${u.login}`, created: u.created_at } : u);
      }
      if (p === '/user/emails') return json([{ email: profile(login).email, primary: true, verified: true }]);
      if (p === '/user/repos' && method === 'GET') {
        if (forgejo && Number(url.searchParams.get('page') || 1) > 1) return json([]);
        const mine = [...repos.values()].filter(r => permission(r, login)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return json(mine.map(r => repoJson(r, login, forgejo)));
      }
      if (p === '/user/repos' && method === 'POST') {
        const b: any = await req.json().catch(() => ({}));
        const name = String(b.name || '');
        if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) return json({ message: 'Repository creation failed.', errors: [{ field: 'name', code: 'invalid' }] }, 422);
        if (repos.has(key(login, name))) return json({ message: 'Repository creation failed.', errors: [{ field: 'name', message: 'name already exists on this account' }] }, 422);
        return json(repoJson(createRepo(login, name), login, forgejo), 201);
      }
      if (p === '/user/repository_invitations' && method === 'GET') {
        const out: any[] = [];
        for (const r of repos.values()) for (const i of r.invitations) if (i.invitee.toLowerCase() === login.toLowerCase()) out.push({ id: i.id, repository: repoJson(r), inviter: { login: r.owner, avatar_url: null }, permissions: i.permissions, created_at: i.created_at });
        return json(out);
      }
      if ((m = p.match(/^\/user\/repository_invitations\/(\d+)$/))) {
        const id = Number(m[1]);
        for (const r of repos.values()) {
          const i = r.invitations.find(x => x.id === id && x.invitee.toLowerCase() === login.toLowerCase());
          if (!i) continue;
          r.invitations = r.invitations.filter(x => x.id !== id);
          if (method === 'PATCH') r.collaborators.set(login.toLowerCase(), i.permissions);
          return new Response(null, { status: 204 });
        }
        return notFound();
      }
      if ((m = p.match(/^\/applications\/[^/]+\/grant$/)) && method === 'DELETE') return new Response(null, { status: 204 });

      if ((m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/))) {
        const repo = repos.get(key(m[1], m[2]));
        const perm = repo && permission(repo, login);
        if (!repo || !perm) return notFound();
        const rest = m[3] || '';
        if (rest === '' && method === 'GET') return json(repoJson(repo, login, forgejo));
        if (rest === '' && method === 'PATCH') {
          if (perm !== 'admin') return json({ message: 'Must have admin rights to Repository.' }, 403);
          const b: any = await req.json().catch(() => ({}));
          const name = String(b.name || repo.name);
          if (name !== repo.name) {
            if (repos.has(key(repo.owner, name))) return json({ message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] }, 422);
            fs.renameSync(bare(repo.owner, repo.name), bare(repo.owner, name));
            repos.delete(key(repo.owner, repo.name));
            repo.name = name;
            repos.set(key(repo.owner, name), repo);
          }
          if (typeof b.description === 'string') repo.description = b.description;
          repo.updated_at = new Date().toISOString();
          return json(repoJson(repo, login, forgejo));
        }
        if (rest === '/topics' && method === 'GET') return json(forgejo ? { topics: repo.topics } : { names: repo.topics });
        if (rest === '/topics' && method === 'PUT') {
          if (perm === 'read') return json({ message: 'Forbidden' }, 403);
          const b: any = await req.json().catch(() => ({}));
          const list = forgejo ? b.topics : b.names;
          repo.topics = Array.isArray(list) ? list.map(String) : [];
          return forgejo ? new Response(null, { status: 204 }) : json({ names: repo.topics });
        }
        if (rest === '/collaborators' && method === 'GET') return json([...repo.collaborators.keys()].map(l => ({ login: l, avatar_url: null })).concat(forgejo ? [] : [{ login: repo.owner, avatar_url: null }]));
        if (forgejo && (m = rest.match(/^\/collaborators\/([^/]+)\/permission$/)) && method === 'GET') {
          const who = decodeURIComponent(m[1]);
          const pm = permission(repo, who);
          return json({ permission: pm === 'admin' ? (who.toLowerCase() === repo.owner.toLowerCase() ? 'owner' : 'admin') : pm || 'none' });
        }
        if (forgejo && rest === '/invitations') return notFound();
        if (rest === '/invitations' && method === 'GET') return json(repo.invitations.map(i => ({ id: i.id, invitee: { login: i.invitee, avatar_url: null }, permissions: i.permissions })));
        if ((m = rest.match(/^\/collaborators\/([^/]+)$/))) {
          if (perm !== 'admin') return json({ message: 'Forbidden' }, 403);
          const who = decodeURIComponent(m[1]);
          if (method === 'PUT' && forgejo) {
            const b: any = await req.json().catch(() => ({}));
            repo.collaborators.set(who.toLowerCase(), String(b.permission || 'write'));
            return new Response(null, { status: 204 });
          }
          if (method === 'PUT') {
            const b: any = await req.json().catch(() => ({}));
            const inv = { id: nextId++, invitee: who, permissions: String(b.permission || 'push'), created_at: new Date().toISOString() };
            repo.invitations.push(inv);
            return json({ id: inv.id, invitee: { login: who }, permissions: inv.permissions }, 201);
          }
          if (method === 'DELETE') { repo.collaborators.delete(who.toLowerCase()); return new Response(null, { status: 204 }); }
        }
        if ((m = rest.match(/^\/invitations\/(\d+)$/))) {
          if (perm !== 'admin') return json({ message: 'Forbidden' }, 403);
          const id = Number(m[1]);
          if (method === 'DELETE') { repo.invitations = repo.invitations.filter(i => i.id !== id); return new Response(null, { status: 204 }); }
          if (method === 'PATCH') {
            const b: any = await req.json().catch(() => ({}));
            const i = repo.invitations.find(x => x.id === id);
            if (i) i.permissions = String(b.permissions || i.permissions);
            return json({ id });
          }
        }
        if ((m = rest.match(/^\/archive\/(.+)\.zip$/)) && method === 'GET' && forgejo) {
          const ref = decodeURIComponent(m[1]);
          const r = spawnSync('git', ['--git-dir', bare(repo.owner, repo.name), 'archive', '--format=zip', `--prefix=${repo.name}/`, ref], { maxBuffer: 256 * 1024 * 1024 });
          if (r.status !== 0) return notFound();
          return new Response(r.stdout, { status: 200, headers: { 'Content-Type': 'application/zip' } });
        }
        if ((m = rest.match(/^\/zipball(?:\/(.+))?$/)) && method === 'GET') {
          const ref = m[1] ? decodeURIComponent(m[1]) : 'main';
          const r = spawnSync('git', ['--git-dir', bare(repo.owner, repo.name), 'archive', '--format=zip', `--prefix=${repo.owner}-${repo.name}-${ref.replace(/[^A-Za-z0-9._-]/g, '_')}/`, ref], { maxBuffer: 256 * 1024 * 1024 });
          if (r.status !== 0) return json({ message: m[1] ? 'Not Found' : 'Git Repository is empty.' }, m[1] ? 404 : 409);
          return new Response(r.stdout, { status: 200, headers: { 'Content-Type': 'application/zip' } });
        }
        if ((m = rest.match(/^\/contents\/(.+)$/)) && method === 'GET') {
          const ref = url.searchParams.get('ref') || 'main';
          const r = git(['--git-dir', bare(repo.owner, repo.name), 'cat-file', '-t', `${ref}:${decodeURIComponent(m[1])}`]);
          if (r.status !== 0) return notFound();
          return json({ path: decodeURIComponent(m[1]), type: r.stdout.trim() === 'tree' ? 'dir' : 'file' });
        }
      }
      return notFound();
    },
  });

  const self: FakeGithub = {
    scholarLog,
    requestLog,
    oauth,
    url: `http://127.0.0.1:${server.port}`,
    root,
    stop: () => server.stop(true),
    file: (owner, repo, filePath, ref = 'main') => { const r = git(['--git-dir', bare(owner, repo), 'show', `${ref}:${filePath}`]); return r.status === 0 ? r.stdout : ''; },
    tree: (owner, repo, ref = 'main') => { const r = git(['--git-dir', bare(owner, repo), 'ls-tree', '-r', '--name-only', ref]); return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : []; },
    repoExists: (owner, repo) => repos.has(key(owner, repo)),
    topics: (owner, repo) => repos.get(key(owner, repo))?.topics || [],
    description: (owner, repo) => repos.get(key(owner, repo))?.description || '',
    setDescription: (owner, repo, description) => { const r = repos.get(key(owner, repo)); if (r) r.description = description; },
    seedRepo: (owner, name, files, topics = [], tag) => seedRepo(owner, name, files, topics, tag),
    importBare: (owner, name, srcBare) => {
      fs.mkdirSync(path.dirname(bare(owner, name)), { recursive: true });
      fs.cpSync(srcBare, bare(owner, name), { recursive: true });
      repos.set(key(owner, name), { owner, name, topics: [], collaborators: new Map(), invitations: [], updated_at: new Date().toISOString(), id: nextId++, public: true });
    },
  };
  return self;
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const f = await startFakeGithub({ port: Number(arg('port') || 4010), root: arg('root') });
  console.log(`Fake GitHub at ${f.url} (repositories in ${f.root})`);
}
