import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startFakeGithub, type FakeGithub } from '../fake-github/server';

export const PORT = Number(process.env.E2E_PORT || 3001);
export const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
export const DEMO_PROJECT = 'demo__artigo-1';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let server: ChildProcess | null = null;
let workDir = '';
/** The tests' fake "GitHub" (API, OAuth and Git). */
export let fake: FakeGithub;
const POOL = 200;
const poolSid = (i: number) => `e2e-pool-${String(i).padStart(3, '0')}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
let nextSession = 0;

/** Temporary folder of the test server (sessions, blocked list, workspace). */
export const testWorkDir = () => workDir;

/** Content of a file on the main branch of the repository in the fake GitHub ('demo__artigo-1'), or '' if it does not exist. */
export function demoRemoteFile(project: string, file: string): string {
  const [owner, repo] = project.split('__');
  return fake.file(owner, repo, file);
}

/** Person who will delete their own account in the tests. */
export const DELETEE = { sid: 'e2e-deletee-session-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', login: 'student-delete', id: 555002 };
/** Regular (non-admin) person that no other test blocks or deletes. */
export const COMMON = { sid: 'e2e-common-session-cccccccccccccccccccccccccccccccccccc', login: 'student-common', id: 555003 };
/** A person whose display name is an attack on the admin panel (see security-xss.test.ts). */
export const XSSER = { sid: 'e2e-xsser-session-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', login: 'student-xss', id: 555005, name: '</script><script>window.__pwned=1</script>' };
/** Person that the live-edit security spec blocks (nobody else uses it). */
export const LISTENER = { sid: 'e2e-listener-session-dddddddddddddddddddddddddddddddddd', login: 'student-listener', id: 555004 };
/** Second person, with a session already created on the test server (to test blocking another user). */
export const VICTIM = { sid: 'e2e-victim-session-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', login: 'student-e2e', id: 555001 };
let browser: Browser | null = null;

async function waitForServer(url: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return true;
    } catch (_) {}
    await sleep(500);
  }
  return false;
}

/** Starts the server with workspace and sessions in a temporary directory (does not touch ~/.cache/neoleaf). */
/** Key the test server encrypts `sessions.json` with (same format as `src/session.rs`: "NLS1", 12-byte nonce, AES-256-GCM ciphertext + tag). */
const SESSION_KEY = Buffer.alloc(32, 7);

function sealSessions(plain: string): Buffer {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, nonce);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('NLS1'), nonce, ct, cipher.getAuthTag()]);
}

/** Decrypted content of the test server's `sessions.json` (as text), for tests that look at what is stored. */
export function readSessionsFile(): string {
  const raw = fs.readFileSync(path.join(testWorkDir(), 'sessions.json'));
  const body = raw.subarray(16, raw.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, raw.subarray(4, 16));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export async function startServer() {
  if (process.env.E2E_BASE_URL) return; // server already running
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-e2e-'));
  fake = await startFakeGithub({ root: path.join(workDir, 'github') });
  const t = Math.floor(Date.now() / 1000);
  const demo = { id: 1, login: 'demo', name: 'Demo User', email: 'demo@neoleaf.local' };
  const sessions: Record<string, unknown> = {
    [VICTIM.sid]: { user: { id: VICTIM.id, login: VICTIM.login, name: 'Student E2E' }, access_token: `fake-${VICTIM.login}`, refresh_token: null, expires_at: t + 86400 * 30, created_at: t },
    [COMMON.sid]: { user: { id: COMMON.id, login: COMMON.login, name: 'Common Student' }, access_token: `fake-${COMMON.login}`, refresh_token: null, expires_at: t + 86400 * 30, created_at: t },
    [XSSER.sid]: { user: { id: XSSER.id, login: XSSER.login, name: XSSER.name, email: 'x@example.test' }, access_token: `fake-${XSSER.login}`, refresh_token: null, expires_at: t + 86400 * 30, created_at: t },
    [LISTENER.sid]: { user: { id: LISTENER.id, login: LISTENER.login, name: 'Listener Student' }, access_token: `fake-${LISTENER.login}`, refresh_token: null, expires_at: t + 86400 * 30, created_at: t },
    [DELETEE.sid]: { user: { id: DELETEE.id, login: DELETEE.login, name: 'Student Delete' }, access_token: `fake-${DELETEE.login}`, refresh_token: null, expires_at: t + 86400 * 30, created_at: t },
  };
  // ready-made sessions for the `demo` user (owner of the sample project): each test uses its own
  for (let i = 0; i < POOL; i++) sessions[poolSid(i)] = { user: demo, access_token: 'fake-demo', refresh_token: null, expires_at: t + 86400 * 30, created_at: t };
  fs.writeFileSync(path.join(workDir, 'sessions.json'), sealSessions(JSON.stringify(sessions)), { mode: 0o600 });
  server = spawn('cargo', ['run', '--quiet'], {
    cwd: path.resolve(import.meta.dir, '../..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      GITHUB_API_URL: fake.url,
      GITHUB_WEB_URL: fake.url,
      CODEBERG_URL: fake.url, // the same fake server also answers as Codeberg (Forgejo, API at /api/v1)
      CODEBERG_CLIENT_ID: 'fake-cb-client',
      CODEBERG_CLIENT_SECRET: 'fake-cb-secret',
      SCHOLAR_ARXIV_URL: `${fake.url}/scholar/arxiv`, // article search: arXiv and DBLP are fake too
      SCHOLAR_DBLP_URL: `${fake.url}/scholar/dblp`,
      GITHUB_CLIENT_ID: 'fake-client',
      GITHUB_CLIENT_SECRET: 'fake-secret',
      REDIRECT_URI: `${BASE_URL}/auth/callback`,
      NEOLEAF_WORKSPACE_DIR: path.join(workDir, 'repos'),
      TL_CACHE_DIR: path.join(workDir, 'tlcache'),
      SESSIONS_FILE: path.join(workDir, 'sessions.json'),
      SESSION_KEY: SESSION_KEY.toString('base64'),
      BLOCKLIST_FILE: path.join(workDir, 'blocked.json'),
      TEMPLATES_FILE: path.join(workDir, 'templates.json'),
      COLLAB_RECHECK_SECS: '2', // live-edit access re-check (default 30 s)
      ADMIN_EMAILS: 'demo@neoleaf.local,e2e-other-admin', // the demo user becomes an admin in the tests, plus a second admin login
      MAX_SESSIONS_PER_USER: '1000', // the ready-made pool holds 200 `demo` sessions; the per-person cap (default 8) is covered by unit tests
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  server.stderr?.on('data', d => { if (String(d).includes('error')) console.error(String(d)); });
  if (!(await waitForServer(BASE_URL + '/', 240000))) throw new Error(`Server did not respond at ${BASE_URL}`);
}

export async function stopServer() {
  if (browser) await browser.close().catch(() => {});
  browser = null;
  if (server?.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch (_) {}
    await sleep(500);
    try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {}
  }
  server = null;
  try { fake?.stop(); } catch (_) {}
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
}

export async function getBrowser() {
  browser ??= await chromium.launch({ headless: process.env.HEADED !== '1', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  return browser;
}

export interface Session { context: BrowserContext; page: Page; errors: string[] }

/** Isolated context (own cookies/IndexedDB) already authenticated as the `demo` user (one session of its own from the ready-made pool). */
export async function newSession(): Promise<Session> {
  const context = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (!/favicon|ERR_BLOCKED_BY_CLIENT|WebSocket|Failed to load resource|:47474/.test(t)) errors.push(t);
  });
  if (nextSession >= POOL) throw new Error('the tests ran out of ready-made sessions');
  await context.addCookies([{ name: 'latex_session', value: poolSid(nextSession++), url: BASE_URL }]);
  return { context, page, errors };
}

export async function openProject(page: Page, id = DEMO_PROJECT) {
  await page.goto(`${BASE_URL}/project/${id}`);
  await page.waitForSelector('.monaco-editor');
  await page.waitForFunction(() => (globalThis as any).eval('typeof currentFileId !== "undefined" && !!currentFileId'));
  // the local repository (BrowserGit) is filled asynchronously; wait until it has the project files
  await poll(
    () => page.evaluate(async () => {
      const bg = (window as any).BrowserGit;
      return !!bg && (await bg.isCloned()) ? (await bg.listFiles()).filter((f: any) => !f.is_folder).length : 0;
    }),
    n => n >= 2,
    30000,
  ).catch(() => {});
  await page.waitForSelector('#file-tree .tree-row');
  await settled(page);
}

/** Waits for live editing to sync (or give up) so the editor is stable. */
export async function settled(page: Page) {
  await page.waitForFunction(() => !(globalThis as any).eval('editor.getOption(monaco.editor.EditorOption.readOnly)'), null, { timeout: 15000 }).catch(() => {});
  await sleep(300);
}

export const editorValue = (page: Page): Promise<string> => page.evaluate(() => (globalThis as any).eval('editor.getValue()'));
export const currentFile = (page: Page): Promise<string> => page.evaluate(() => (globalThis as any).eval('currentFileId'));

/** Clicks a row in the file tree and waits for the editor to switch files. */
export async function openInTree(page: Page, name: string) {
  await page.locator('#file-tree .tree-row', { hasText: name }).first().click();
  await page.waitForFunction(n => (globalThis as any).eval('currentFileId').endsWith(n), name);
  await settled(page);
}

/** Repeats `fn` until the result satisfies `ok` (bun:test has no expect.poll). */
export async function poll<T>(fn: () => Promise<T> | T, ok: (v: T) => boolean, timeoutMs = 15000): Promise<T> {
  const start = Date.now();
  let v = await fn();
  while (!ok(v)) {
    if (Date.now() - start > timeoutMs) throw new Error(`poll: timed out (last value: ${JSON.stringify(v)})`);
    await sleep(200);
    v = await fn();
  }
  return v;
}
