import { afterAll, describe, expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { newSession, openProject, type Session } from '../helpers';

// Typst in the browser (typst.ts, the Typst compiler in WebAssembly, in a Web Worker). The compiler and its fonts are served by NeoLeaf;
// these tests compile small documents straight through the worker (no Typst package is imported, so nothing leaves the machine).

const PNG = Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

const FONT_SHA = '328698d764ccdf7acf6bc1088aefd83a237f6a1d8b812de1e77ac5e4483bf3d1';
const FONT_URL = 'https://raw.githubusercontent.com/typst/typst-assets/v0.15.1/files/fonts/NewCM10-Regular.otf';
const FONT_MIRROR = 'https://cdn.jsdelivr.net/gh/typst/typst-assets@v0.15.1/files/fonts/NewCM10-Regular.otf';

// The real file, downloaded once from upstream and checked against the pinned hash.
async function upstreamFont(): Promise<Buffer> {
  const local = path.join(os.tmpdir(), 'neoleaf-e2e-typst-' + FONT_SHA);
  if (fs.existsSync(local)) return fs.readFileSync(local);
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error('cannot download the font: HTTP ' + res.status);
  const bytes = Buffer.from(await res.arrayBuffer());
  expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(FONT_SHA);
  fs.writeFileSync(local, bytes);
  return bytes;
}

let s: Session;
const upstream = { raw: 0, mirror: 0 };
afterAll(async () => { await s?.context.close(); });

async function compile(files: any[], main = 'main.typ') {
  return s.page.evaluate(async ([files, main]) => {
    const o = await (window as any).runTypst(files, main);
    return { pdfStart: o.pdf ? String.fromCharCode(...o.pdf.slice(0, 5)) : null, pdfSize: o.pdf ? o.pdf.length : 0, diags: o.diagnostics, error: o.error };
  }, [files, main] as any);
}

describe('Typst', () => {
  test('the engine is offered and the compiler produces a PDF', async () => {
    s = await newSession();
    const font = await upstreamFont();
    await s.context.route(url => url.href === FONT_URL || url.href === FONT_MIRROR, route => {
      if (route.request().url() === FONT_URL) upstream.raw++; else upstream.mirror++;
      return route.fulfill({ status: 200, contentType: 'font/otf', body: font });
    });
    await openProject(s.page);
    const options = await s.page.evaluate(() => Array.from(document.querySelectorAll('#engine-select option, select option')).map(o => (o as HTMLOptionElement).value));
    expect(options).toContain('wasm-typst');
    const r = await compile([{ path: 'main.typ', text: '= Title\nHello *world*.\n' }]);
    expect(r.error).toBeUndefined();
    expect(r.pdfStart).toBe('%PDF-');
    expect(r.diags.filter((d: any) => d.severity === 'error')).toHaveLength(0);
  }, 180000);

  test('errors come with a position counted from 1', async () => {
    const r = await compile([{ path: 'main.typ', text: '= Title\n#unknownfn(1)\n' }]);
    expect(r.pdfSize).toBe(0);
    const err = r.diags.find((d: any) => d.severity === 'error');
    expect(err.line).toBe(2);
    expect(err.file).toBe('main.typ');
    expect(err.message.length).toBeGreaterThan(0);
  }, 60000);

  test('included files, images, bibliography and Unicode work', async () => {
    const r = await compile([
      { path: 'main.typ', text: '#set text(lang: "pt")\n#include "chap/a.typ"\n#image("fig.png", width: 2cm)\nOlá, ção ü é. @knuth\n#bibliography("refs.bib")\n' },
      { path: 'chap/a.typ', text: '= Introdução\nTexto.\n' },
      { path: 'fig.png', bytes: new Uint8Array(PNG) },
      { path: 'refs.bib', text: '@book{knuth, author={Donald Knuth}, title={The TeXbook}, year={1984}, publisher={Addison-Wesley}}' },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.pdfStart).toBe('%PDF-');
  }, 60000);

  test('the editor knows .typ files', async () => {
    const lang = await s.page.evaluate(() => (window as any).LD.languageFor('main.typ'));
    expect(lang).toBe('typst');
    const found = await s.page.evaluate(() => (globalThis as any).eval("monaco.languages.getLanguages().some(l => l.id === 'typst')"));
    expect(found).toBe(true);
  }, 30000);

  test('the spell check reads the language from #set text', async () => {
    const lang = await s.page.evaluate(() => (window as any).SpellCheck.detectLanguage('#set text(lang: "pt", region: "br")\n= Olá\nTexto em português.', 'typst'));
    expect(lang).toBe('pt-BR');
    const none = await s.page.evaluate(() => (window as any).SpellCheck.detectLanguage('#set text(lang: "sv")\nHej och välkommen', 'typst'));
    expect(none).toBeNull();
  }, 30000);

  test('the compiler files and fonts are served with the right types', async () => {
    const res = await fetch(new URL('/static/js/typst-language.js', s.page.url()).href);
    expect(res.status).toBe(200);
    const font = await fetch(new URL('/static/typst/fonts/LibertinusSerif-Regular.otf', s.page.url()).href);
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/otf');
  }, 30000);

  test('NewCM10-Regular (GPL) is not served by NeoLeaf: the browser downloads it once, checks it and uses it', async () => {
    const served = await fetch(new URL('/static/typst/fonts/NewCM10-Regular.otf', s.page.url()).href);
    expect(served.status).toBe(404);
    expect(upstream.raw).toBe(1);
    expect(upstream.mirror).toBe(0);
    const names = await s.page.evaluate(async () => {
      const o = await (window as any).runTypst([{ path: 'main.typ', text: '#set text(font: "New Computer Modern")\nHello\n' }], 'main.typ');
      return Array.from(o.pdf as Uint8Array, (b: number) => String.fromCharCode(b)).join('');
    });
    expect(names).toContain('NewCM10-Regular');
  }, 60000);
});
