import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { fake, newSession, openInTree, openProject, poll, type Session } from '../helpers';

// Markdown files (.md and .markdown) open in the editor in Markdown mode, accept editing and write to the browser clone.
describe('Markdown editor', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  beforeAll(async () => {
    fake.seedRepo('demo', 'md-editor', {
      'main.tex': '\\\\documentclass{article}\\n\\\\begin{document}Oi\\n\\\\end{document}\\n',
      'README.md': '# Title\\n\\nText **strong** and `code`.\\n\\n- item\\n',
      'notes.markdown': '## Notes\\n\\nSomething.\\n',
    }, ['neoleaf']);
    s = await newSession();
    await openProject(s.page, 'demo__md-editor');
  });
  afterAll(async () => { await s.context.close(); });

  for (const file of ['README.md', 'notes.markdown']) {
    test(`${file}: opens in Markdown mode, is editable and writes to the clone`, async () => {
      await openInTree(s.page, file);
      expect(await ev<string>('editor.getModel().getLanguageId()')).toBe('markdown');
      expect(await ev<boolean>('editor.getOption(monaco.editor.EditorOption.readOnly)')).toBe(false);
      expect(await ev<string>('editor.getValue()')).toContain('#');
      const mark = `New line ${Date.now()}`;
      await ev(`editor.setValue(editor.getValue() + ${JSON.stringify('\n' + mark + '\n')})`);
      const saved = await poll(() => ev<string>(`BrowserGit.readFile(${JSON.stringify(file)})`), v => v.includes(mark), 20000);
      expect(saved).toContain(mark);
    });
  }

  test('going back to a .tex restores LaTeX mode', async () => {
    await openInTree(s.page, 'main.tex');
    expect(await ev<string>('editor.getModel().getLanguageId()')).toBe('latex');
  });
});
