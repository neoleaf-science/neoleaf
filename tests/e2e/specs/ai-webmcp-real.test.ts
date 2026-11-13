import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, poll, type Session } from '../helpers';

// Browser agents with the browser's REAL WebMCP API (no fake): needs a Chromium that has document.modelContext, for example
//   E2E_BROWSER_EXE=/path/to/browser E2E_BROWSER_ARGS=--enable-features=WebMCP E2E_WEBMCP_REAL=1 bun test specs/ai-webmcp-real.test.ts
// The tools are discovered with getTools() and run with executeTool(), as an agent of the browser does.

describe.skipIf(!process.env.E2E_WEBMCP_REAL)('browser agents with the real WebMCP API', () => {
  let s: Session;
  beforeAll(async () => {
    s = await newSession();
    s.page.on('dialog', d => d.accept());
    await openProject(s.page);
    await s.page.evaluate(async () => {
      await (window as any).BrowserGit.writeFile('sections/intro.tex', 'First line.\nThe quick brown fox.\nLast line.');
      await (window as any).FT.refreshFromBrowserGit();
    });
    await s.page.click('#tab-ai-btn');
    await s.page.waitForSelector('#ai-agent-card');
  });
  afterAll(async () => { await s.context.close(); });

  const tools = () => s.page.evaluate(async () => (await (document as any).modelContext.getTools()).map((t: any) => ({ name: t.name, annotations: t.annotations, origin: t.origin })));
  const exec = (name: string, args: any) => s.page.evaluate(async ({ name, args }) => {
    const t = (await (document as any).modelContext.getTools()).find((x: any) => x.name === name);
    try { return { ok: true, value: String(await (document as any).modelContext.executeTool(t, args)) }; } catch (e: any) { return { ok: false, value: String(e && e.message) }; }
  }, { name, args });

  test('the browser offers the API, and no tool is there until the person allows it', async () => {
    expect(await s.page.evaluate(() => typeof (document as any).modelContext?.registerTool)).toBe('function');
    expect(await s.page.evaluate(() => typeof (navigator as any).modelContext)).toBe('undefined');
    expect(await tools()).toEqual([]);
  });

  test('allowing it makes the seven tools discoverable by getTools()', async () => {
    await s.page.click('#ai-agent-toggle');
    await poll(tools, t => t.length === 7);
    const t = await tools();
    expect(t.map((x: any) => x.name).sort()).toEqual(['add_comment', 'add_suggestion', 'compile_log', 'list_comments', 'list_files', 'read_file', 'search']);
    expect(t.find((x: any) => x.name === 'read_file').annotations).toMatchObject({ readOnlyHint: true, untrustedContentHint: true });
    expect(t.find((x: any) => x.name === 'add_suggestion').annotations).toMatchObject({ readOnlyHint: false });
  });

  test('executeTool reads the project and makes a draft card, and the file stays as it was', async () => {
    const r = await exec('read_file', { path: 'sections/intro.tex' });
    expect(r.ok).toBe(true);
    expect(r.value).toContain('The quick brown fox.');
    expect((await exec('read_file', { path: '../x' })).ok).toBe(false);
    const d = await exec('add_suggestion', { path: 'sections/intro.tex', quote: 'quick brown', replacement: 'swift red' });
    expect(d.ok).toBe(true);
    await s.page.waitForSelector('#ai-agent-drafts .ai-draft');
    expect(await s.page.evaluate(() => (window as any).BrowserGit.readFile('sections/intro.tex'))).toContain('quick brown');
  });

  test('stopping removes the tools from the browser', async () => {
    await s.page.click('#ai-agent-toggle');
    await poll(tools, t => t.length === 0);
    // the browser logs a tool that refuses on purpose (the "../x" path above): that is expected, anything else is not
    expect(s.errors.filter(e => !e.includes('WebMCP tool execution failed'))).toEqual([]);
  });
});
