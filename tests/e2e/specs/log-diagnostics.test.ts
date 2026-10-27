import { afterAll, describe, expect, test } from 'bun:test';
import { newSession, openProject, type Session } from '../helpers';

// The compile log read from the engine holds the .log file and the console output: every message is in it twice, and the editor must list it once.

let s: Session;
afterAll(async () => { await s?.context.close(); });

const LOG = [
  '(./fancyhdr.sty',
  "LaTeX Warning: You have requested package `', but the package provides UTFPR'.",
  '! LaTeX Error: Command \\lhead already defined.',
  '',
  'l.200 \\newcommand{\\lhead}',
  '!  ==> Fatal error occurred, no output PDF file produced!',
].join('\n');

describe('log diagnostics', () => {
  test('a message that is in the log twice is listed once', async () => {
    s = await newSession();
    await openProject(s.page);
    const list = await s.page.evaluate(log => (globalThis as any).eval('parseLogToDiagnostics')(log + '\n' + log), LOG);
    expect(list.map((d: any) => d.message)).toEqual([
      "LaTeX Warning: You have requested package `', but the package provides UTFPR'.",
      'LaTeX Error: Command \\lhead already defined.',
      ' ==> Fatal error occurred, no output PDF file produced!',
    ]);
    expect(list.filter((d: any) => d.is_error)).toHaveLength(2);
  }, 120000);

  test('the same warning on different lines stays', async () => {
    const list = await s.page.evaluate(() => (globalThis as any).eval('parseLogToDiagnostics')(
      'LaTeX Warning: Float too large for page on input line 10.\nLaTeX Warning: Float too large for page on input line 20.\n'));
    expect(list).toHaveLength(2);
  }, 30000);
});
