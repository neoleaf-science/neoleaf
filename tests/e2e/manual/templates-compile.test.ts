import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BASE_URL, fake, newSession, poll, type Session } from '../helpers';

// MANUAL check (only runs with TEMPLATES_SRC set; otherwise it is skipped): creates a project from each template (the 3 built-in ones and the 14 suggested ones from the catalog)
// and compiles each in the browser (WebAssembly), as a person would. Needs internet (CTAN packages through the server) and
// copies of the source repositories (git clone --bare) in the TEMPLATES_SRC folder, laid out as <owner>/<repo>.git.
//   TEMPLATES_SRC=/path bun test --timeout 400000 manual/templates-compile.test.ts
// The result goes to TEMPLATES_OUT (default /tmp/templates-compile.json).
const SRC = process.env.TEMPLATES_SRC || '';
const OUT = process.env.TEMPLATES_OUT || '/tmp/templates-compile.json';
const ONLY = (process.env.TEMPLATES_ONLY || '').split(',').filter(Boolean);

interface Result { id: string; ok: boolean; engine: string; seconds: number; errors: string[]; tail: string; failure?: string }

describe.skipIf(!SRC)('all templates create a project and compile', () => {
  let s: Session;
  const results: Result[] = [];
  const warnings: string[] = [];
  const templates: { id: string; source: string }[] = [];

  beforeAll(async () => {
    expect(SRC).not.toBe('');
    for (const owner of fs.readdirSync(SRC)) for (const repo of fs.readdirSync(path.join(SRC, owner))) fake.importBare(owner, repo.replace(/\.git$/, ''), path.join(SRC, owner, repo));
    s = await newSession();
    s.page.on('dialog', d => { warnings.push(d.message()); d.accept(); });
    await s.page.goto(`${BASE_URL}/admin`);
    await s.page.click('#tabbtn-models');
    await s.page.waitForSelector('#suggest-all');
    await s.page.click('#suggest-all');
    await poll(async () => (await (await s.page.request.get(`${BASE_URL}/api/admin/templates`)).json()).templates.length, n => n >= 14, 30000);
    const all = (await (await s.page.request.get(`${BASE_URL}/api/admin/templates`)).json()).templates;
    for (const m of all) {
      const r = await (await s.page.request.post(`${BASE_URL}/api/admin/templates/save`, { data: { ...m, enabled: true } })).json();
      expect(r.error).toBeUndefined();
      templates.push({ id: m.id, source: m.source });
    }
  });
  afterAll(async () => {
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
    console.log('\n' + results.map(r => `${r.ok ? 'OK   ' : 'FAIL '} ${r.id.padEnd(28)} ${r.engine.padEnd(14)} ${String(r.seconds).padStart(4)}s ${r.failure || r.errors[0] || ''}`).join('\n'));
    const adm = await (await s.page.request.get(`${BASE_URL}/admin`)).text();
    console.log('TL-CACHE:', (adm.match(/TeX Live package cache<\/span>\s*<span class="meta-val">([^<]*)</) || [])[1]);
    await s.context.close();
  });

  async function createAndCompile(value: string, id: string) {
    warnings.length = 0;
    const t0 = Date.now();
    const r: Result = { id, ok: false, engine: '', seconds: 0, errors: [], tail: '' };
    try {
      await s.page.goto(`${BASE_URL}/`);
      await s.page.evaluate(() => (window as any).openNewProjectModal());
      await s.page.waitForSelector(`#tpl-gallery .tpl-card[data-value="${value}"]`);
      await s.page.click(`#tpl-gallery .tpl-card[data-value="${value}"]`);
      const name = `m-${id}`.slice(0, 40);
      await s.page.fill('#proj-name', name);
      await s.page.click('#btn-create-submit');
      await s.page.waitForURL(new RegExp(`/project/demo__${name}`), { timeout: 60000 });
      await s.page.waitForSelector('.monaco-editor', { timeout: 60000 });
      await poll(() => s.page.evaluate(async () => { const bg = (window as any).BrowserGit; return !!bg && (await bg.isCloned()) ? (await bg.listFiles()).filter((f: any) => !f.is_folder).length : 0; }), n => n >= 1, 90000);
      await s.page.waitForSelector('#file-tree .tree-row', { timeout: 60000 });
      await s.page.waitForTimeout(1500);
      const ed = JSON.parse(process.env.TEMPLATES_EDIT || '{}')[id];
      if (ed) await s.page.evaluate(([a, b]) => { const e = (globalThis as any).eval('editor'); e.setValue(e.getValue().replace(a, b)); }, ed as [string, string]);
      for (const f of (JSON.parse(process.env.TEMPLATES_DEL || '{}')[id] || []) as string[]) await s.page.evaluate(n => (window as any).BrowserGit.deleteFile(n), f);
      if (process.env.TEMPLATES_FAMS) { await s.page.evaluate(f => { localStorage.setItem('ld-font-families-' + (globalThis as any).eval('projectId'), f); }, process.env.TEMPLATES_FAMS); await s.page.reload(); await s.page.waitForSelector('.monaco-editor'); await poll(() => s.page.evaluate(async () => { const bg = (window as any).BrowserGit; return !!bg && (await bg.isCloned()) ? 1 : 0; }), n => n >= 1, 60000); await s.page.waitForTimeout(2500); }
      await s.page.evaluate(() => {
        const w = window as any; const orig = w.renderCompileResult;
        w.__res = null; w.renderCompileResult = (x: any) => { w.__res = x; return orig(x); };
      });
      r.engine = await s.page.evaluate(() => (document.getElementById('engine-select') as HTMLSelectElement)?.value || '');
      await s.page.click('#compile-btn');
      await s.page.waitForFunction(() => !!(window as any).__res, null, { timeout: 360000 });
      const res = await s.page.evaluate(() => { const x = (window as any).__res; return { success: !!x.success, partial: !!x.partial, log: String(x.log || ''), diag: (x.diagnostics || []).filter((d: any) => d.is_error).map((d: any) => `${d.file || ''}:${d.line} ${d.message}`) }; });
      r.ok = res.success && !res.partial;
      r.errors = res.diag.slice(0, 5);
      r.tail = res.log.slice(0, 300) + ' [...] ' + res.log.slice(-500);
      if (res.partial) r.failure = 'partial compilation';
    } catch (e: any) {
      if (value.startsWith('model:')) { const z = await s.page.request.get(`${BASE_URL}/api/templates/${id}/zip`); warnings.push(`zip ${z.status()} ${(await z.text()).slice(0, 150)}`); }
      const modal = await s.page.evaluate(() => (document.getElementById('new-project-modal')?.innerText || '').replace(/\s+/g, ' ').slice(-300)).catch(() => '');
      r.failure = (String(e.message || e).split('\n')[0].slice(0, 120) + ' | ' + modal + ' | warnings: ' + warnings.slice(-2).join(' / ')).slice(0, 500);
    }
    r.seconds = Math.round((Date.now() - t0) / 1000);
    results.push(r);
    return r;
  }

  for (const [value, id] of [['article', 'builtin-article'], ['report', 'builtin-report'], ['beamer', 'builtin-beamer']] as const) {
    if (ONLY.length && !ONLY.includes(id)) continue;
    test(`built-in template: ${id}`, async () => { expect((await createAndCompile(value, id)).ok).toBe(true); }, 420000);
  }
  const ids = ['abntex2-academic-work', 'abntex2-research-project', 'abntex2-technical-report', 'sbc-article-classic', 'sbc-article-modular', 'acm-sigconf', 'acm-sigplan', 'acm-acmsmall', 'acm-acmtog', 'ieee-conference', 'ieee-journal', 'elsevier-numeric', 'elsevier-author-year', 'springer-lncs'];
  for (const id of ids) {
    if (ONLY.length && !ONLY.includes(id)) continue;
    test(`catalog template: ${id}`, async () => { expect((await createAndCompile(`model:${id}`, id)).ok).toBe(true); }, 420000);
  }
});
