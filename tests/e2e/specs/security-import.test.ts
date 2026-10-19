import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { BASE_URL, newSession, openProject, type Session } from '../helpers';

// Data that comes from other people (ZIPs, repositories, third-party metadata) must not escape its place.
function zipB64(py: string): string {
  const r = spawnSync('python3', ['-c', `import zipfile,io,base64,sys\nb=io.BytesIO()\nz=zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED)\n${py}\nz.close()\nsys.stdout.write(base64.b64encode(b.getvalue()).decode())`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

describe('security: ZIP import, BrowserGit paths and BibTeX', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); await openProject(s.page); });
  afterAll(async () => { await s.context.close(); });

  const run = (b64: string, fn: string) => s.page.evaluate(async ([b, f]) => {
    const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0));
    try { return await (new Function('bytes', 'return (async () => {' + f + '})()'))(bytes); } catch (e: any) { return { error: String(e.message || e) }; }
  }, [b64, fn] as [string, string]);

  test('hidden files are skipped even with a leading space or a Mac folder', async () => {
    const b64 = zipB64(`z.writestr('main.tex','x')\nz.writestr(' .git/config','x')\nz.writestr(' .env','x')\nz.writestr('a/ __MACOSX/x.tex','x')`);
    await s.page.goto(BASE_URL + '/');
    await s.page.waitForFunction(() => !!(window as any).ProjectImport);
    const r = await run(b64, `const { files } = await ProjectImport.extract(bytes); return files.map(f => f.path);`);
    expect(r).toEqual(['main.tex']);
  });

  test('an entry that announces a small size but inflates huge is refused', async () => {
    const b64 = zipB64(`z.writestr('big.bin', bytes(30*1024*1024))`);
    // patch the announced size (central directory) to 100 bytes
    const patched = spawnSync('python3', ['-c', `import base64,sys,struct\nd=bytearray(base64.b64decode(sys.argv[1]))\ni=d.rfind(b'PK\\x01\\x02')\nstruct.pack_into('<I',d,i+24,100)\nsys.stdout.write(base64.b64encode(bytes(d)).decode())`, b64], { encoding: 'utf8' }).stdout;
    const r = await run(patched, `const e = await Zip.read(bytes, { maxTotal: 1024 }); return e.length;`);
    expect(r.error).toMatch(/too large|Corrupted/i);
  });

  test('BrowserGit refuses paths that leave the clone and writes inside .git', async () => {
    await openProject(s.page);
    const r = await s.page.evaluate(async () => {
      const out: string[] = [];
      for (const p of ['../x.tex', 'a/../../x', '', 'a//b']) { try { await (window as any).BrowserGit.writeFile(p, 'x'); out.push('ok:' + p); } catch (_) { out.push('refused'); } }
      for (const p of ['.git/config', 'a/.GIT/hooks']) { try { await (window as any).BrowserGit.writeFile(p, 'x'); out.push('ok:' + p); } catch (_) { out.push('refused'); } }
      try { await (window as any).BrowserGit.writeFile('sections/ok.tex', 'x'); out.push('written'); } catch (_) { out.push('failed'); }
      return out;
    });
    expect(r).toEqual(['refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'written']);
  });

  test('BibTeX from third-party metadata keeps backslashes and dollars as text', async () => {
    await openProject(s.page);
    const bib = await s.page.evaluate(() => (window as any).RefSources.toBibtex({ title: '\\input /etc/passwd $x^2$ ~', authors: ['A \\write18 B'], year: 2024, venue: 'V', type: 'journal-article', doi: '10.1/a b}\\x', url: 'https://e.org/a b' }, 'k'));
    expect(bib).not.toMatch(/(^|[^\\])\\input/);
    expect(bib).toContain('\\textbackslash{}input');
    expect(bib).not.toMatch(/[^\\]\$/);
    expect(bib).toContain('doi = {10.1/ab\\x}'.replace('\\x', 'x'));
  });
});
