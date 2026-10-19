import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BASE_URL, fake, newSession, openProject, type Session } from '../helpers';

describe('large ZIP import', () => {
  let s: Session;
  beforeAll(async () => { s = await newSession(); });
  afterAll(async () => { await s.context.close(); });

  test('~45 MB ZIP (above the old 25 MB limit) is imported and pushed', async () => {
    const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'neoleaf-big-')), 'g.zip');
    const py = `import zipfile,sys,os
with zipfile.ZipFile(sys.argv[1],'w') as z:
    z.writestr('big.tex', r'\\documentclass{article}\\begin{document}G\\end{document}')
    z.writestr('figs/a.bin', os.urandom(22*1024*1024))
    z.writestr('figs/b.bin', os.urandom(22*1024*1024))
`;
    expect(spawnSync('python3', ['-c', py, zip]).status).toBe(0);
    await s.page.goto(BASE_URL + '/');
    await s.page.waitForFunction(() => !!(window as any).ProjectImport);
    await s.page.evaluate(() => (window as any).openImportModal());
    await s.page.setInputFiles('#imp-file', zip);
    expect(await s.page.isVisible('#import-error')).toBe(false);
    const b64 = fs.readFileSync(zip).toString('base64');
    const id = await s.page.evaluate(async c => {
      const bin = Uint8Array.from(atob(c), x => x.charCodeAt(0));
      return (window as any).ProjectImport.start(new File([bin], 'g.zip'), 'e2e-big');
    }, b64);
    expect(id).toBe('demo__e2e-big');
    await openProject(s.page, id);
    const tree = () => fake.tree('demo', 'e2e-big');
    for (let i = 0; i < 100 && !tree().includes('figs/b.bin'); i++) await new Promise(r => setTimeout(r, 500));
    expect(tree()).toContain('figs/a.bin');
    expect(tree()).toContain('figs/b.bin');
  }, 120000);
});
