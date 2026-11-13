// AI assistant, what it can read and propose (docs/ai-assistant-plan.md). Seven tools only read the open project, from this browser;
// the answers go to the provider the person chose and nowhere else. Two tools (add_comment, add_suggestion) make a DRAFT: nothing is
// written anywhere until the person clicks Accept now or Keep on the draft (ai-chat.js). There is no tool that writes a file.
//
// Limits, enforced here and shown to the person ("What was sent"): a path must be a file of the project tree (hidden folders such as
// .neoleaf/ and .git are not in it); text files only; at most MAX_READ characters per answer and MAX_TOTAL per question; files over
// MAX_FILE bytes are named but never sent. The file that is open in the editor is read from the editor (unsaved text and live edits
// included), the others from the local clone, so a quote always refers to what is on the screen.
// Depends on globals: BrowserGit, Project, editor, currentFileId, __PS.
function makeTools() {
  const MAX_READ = 60000, MAX_TOTAL = 400000, MAX_FILE = 1024 * 1024, MAX_HITS = 50, MAX_LOG = 20000, MAX_SELECTION = 4000;
  // the same limits comments.json has (project-store.js): a draft that could not be kept is never offered
  const MAX_DRAFTS = 20, MAX_QUOTE = 2000, MAX_TEXT = 4000;

  const TEXT_EXTRA = ['ipynb', 'gitignore', 'latexmkrc', 'log', 'html', 'css', 'js', 'r', 'jl', 'sh', 'tikz', 'pgf', 'gp', 'svg'];
  const ext = p => { const n = p.split('/').pop(); const i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase(); };
  const isText = p => (window.__PS && __PS.isText(p)) || TEXT_EXTRA.includes(ext(p));

  let ledger = [], total = 0, drafts = [];

  /** Starts a new question: the per-question total and the "What was sent" list start again. */
  function begin() { ledger = []; total = 0; drafts = []; }
  const sent = () => ledger.map(e => ({ ...e }));

  class ToolError extends Error {}

  /** Counts an answer against the limits and records it; what does not fit is cut at a line end, and the answer says so. */
  function deliver(tool, text, path) {
    const room = Math.min(MAX_READ, MAX_TOTAL - total);
    if (room <= 0) throw new ToolError('The reading limit for this question was reached. Answer with what you already have, or ask the person to start a new question.');
    let out = text, cut = false;
    if (out.length > room) {
      const at = out.lastIndexOf('\n', room);
      out = out.slice(0, at > 0 ? at : room);
      cut = true;
    }
    total += out.length;
    ledger.push({ tool, path: path || '', chars: out.length });
    return { out, cut };
  }

  async function files() {
    return (await BrowserGit.listFiles()).filter(f => !f.is_folder);
  }

  /** A path the model gave: it must be exactly one of the project's files (so no `..`, no absolute path, no hidden folder). */
  async function fileOf(path) {
    if (typeof path !== 'string' || !path) throw new ToolError('Give the path of a file, as list_files shows it.');
    const f = (await files()).find(x => x.path === path);
    if (!f) throw new ToolError(`There is no file "${String(path).slice(0, 200)}" in the project. Use list_files to see the files.`);
    if (!isText(f.path)) throw new ToolError(`"${f.path}" is not a text file and cannot be read.`);
    if (f.size > MAX_FILE) throw new ToolError(`"${f.path}" is too large to be read (${f.size} bytes).`);
    return f;
  }

  /** The text of a file as the person sees it: from the editor when it is the open file, otherwise from the local clone. */
  async function textOf(path) {
    if (typeof currentFileId !== 'undefined' && currentFileId === path && typeof editor !== 'undefined' && editor && editor.getModel()) return editor.getValue();
    return String(await BrowserGit.readFile(path));
  }

  /** Where `quote` is in `text`: how many times, and the 1-based line and column (UTF-16 units, as the editor counts) of the first one. */
  function whereIs(text, quote) {
    const first = text.indexOf(quote);
    if (first < 0) return { count: 0 };
    let count = 1;
    for (let i = text.indexOf(quote, first + 1); i >= 0 && count < 3; i = text.indexOf(quote, i + 1)) count++;
    const pos = off => {
      const before = text.slice(0, off);
      const nl = before.lastIndexOf('\n');
      return { line: before.split('\n').length, col: off - (nl + 1) + 1 };
    };
    const a = pos(first), b = pos(first + quote.length);
    return { count, range: { sl: a.line, sc: a.col, el: b.line, ec: b.col } };
  }

  /** Checks a proposal against the file as it is on the screen and keeps it as a draft. */
  async function propose(kind, a) {
    if (drafts.length >= MAX_DRAFTS) throw new ToolError(`At most ${MAX_DRAFTS} proposals per question were reached. Stop proposing and tell the person what is left.`);
    const f = await fileOf(a.path);
    const quote = a.quote;
    if (!quote.trim()) throw new ToolError('The quote is empty. Quote the exact passage the proposal is about.');
    if ([...quote].length > MAX_QUOTE) throw new ToolError(`The quote is longer than ${MAX_QUOTE} characters. Propose smaller changes, one passage at a time.`);
    const text = typeof a.text === 'string' ? a.text.trim() : '';
    if ([...text].length > MAX_TEXT) throw new ToolError(`The text is longer than ${MAX_TEXT} characters.`);
    if (kind === 'comment' && !text) throw new ToolError('A comment needs its text.');
    let replacement = '';
    if (kind === 'suggestion') {
      replacement = a.replacement;
      if ([...replacement].length > MAX_TEXT) throw new ToolError(`The replacement is longer than ${MAX_TEXT} characters. Propose smaller changes.`);
      if (replacement === quote) throw new ToolError('The replacement is the same as the quote: there is nothing to change.');
    }
    const w = whereIs(await textOf(f.path), quote);
    if (w.count === 0) throw new ToolError(`The quote was not found in "${f.path}". Copy it exactly as read_file shows it (same spaces, line breaks and symbols).`);
    if (w.count > 1) throw new ToolError(`The quote appears more than once in "${f.path}". Use a longer passage that appears only once.`);
    if (drafts.some(d => d.kind === kind && d.file === f.path && d.quote === quote)) throw new ToolError('This passage already has a proposal of this kind in this question.');
    drafts.push({ id: 'd' + (drafts.length + 1), kind, file: f.path, quote, replacement, text, range: w.range, status: 'pending' });
    return `Draft ${kind === 'comment' ? 'comment' : 'suggestion'} saved for ${f.path}, line ${w.range.sl}. The person will review it; nothing was changed.`;
  }

  const TOOLS = {
    list_files: {
      description: 'Lists the files of the project with their sizes. Files that are not text, or are too large, are listed but cannot be read.',
      schema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        const all = await files();
        if (!all.length) return deliver('list_files', 'The project has no files.');
        const lines = all.map(f => `${f.path} (${f.size} bytes${!isText(f.path) ? ', not text' : f.size > MAX_FILE ? ', too large' : ''})`);
        const { out, cut } = deliver('list_files', lines.join('\n'));
        return out + (cut ? '\n[the list was cut: the project has more files]' : '');
      },
    },
    read_file: {
      description: 'Reads a text file of the project, or a range of its lines (1 is the first line). Long files come in parts: ask for the next lines with from_line.',
      schema: { type: 'object', properties: { path: { type: 'string', description: 'Path as list_files shows it' }, from_line: { type: 'integer', minimum: 1 }, to_line: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false },
      async run(a) {
        const f = await fileOf(a.path);
        const lines = (await textOf(f.path)).split('\n');
        const from = Math.max(1, a.from_line || 1), to = Math.min(lines.length, a.to_line || lines.length);
        if (from > lines.length) throw new ToolError(`"${f.path}" has ${lines.length} lines.`);
        if (to < from) throw new ToolError('to_line is before from_line.');
        const { out, cut } = deliver('read_file', lines.slice(from - 1, to).join('\n'), f.path);
        const last = cut ? from + out.split('\n').length - 1 : to;
        return `[${f.path}, lines ${from} to ${last} of ${lines.length}]\n${out}` + (cut ? `\n[cut here: read on with from_line ${last + 1}]` : '');
      },
    },
    search: {
      description: 'Finds a piece of text (exact words, upper or lower case) in the text files of the project. Returns path, line number and the line.',
      schema: { type: 'object', properties: { text: { type: 'string', minLength: 1 } }, required: ['text'], additionalProperties: false },
      async run(a) {
        if (typeof a.text !== 'string' || !a.text) throw new ToolError('Give the text to look for.');
        const needle = a.text.toLowerCase();
        const hits = [];
        let more = false;
        for (const f of await files()) {
          if (!isText(f.path) || f.size > MAX_FILE) continue;
          const lines = (await textOf(f.path)).split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (!lines[i].toLowerCase().includes(needle)) continue;
            if (hits.length >= MAX_HITS) { more = true; break; }
            hits.push(`${f.path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          }
          if (more) break;
        }
        if (!hits.length) return deliver('search', 'No match.').out;
        const { out, cut } = deliver('search', hits.join('\n'));
        return out + (more || cut ? `\n[only the first matches are shown]` : '');
      },
    },
    open_file_and_selection: {
      description: 'Tells which file is open in the editor, where the cursor is and what text the person has selected.',
      schema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        if (typeof editor === 'undefined' || !editor || !editor.getModel() || !currentFileId) return deliver('open_file_and_selection', 'No file is open.').out;
        const sel = editor.getSelection();
        const text = sel && !sel.isEmpty() ? editor.getModel().getValueInRange(sel) : '';
        let msg = `Open file: ${currentFileId}\nCursor at line ${sel ? sel.positionLineNumber : 1}.`;
        msg += text ? `\nSelected text (lines ${sel.startLineNumber} to ${sel.endLineNumber}):\n${text.slice(0, MAX_SELECTION)}` + (text.length > MAX_SELECTION ? '\n[selection cut]' : '') : '\nNothing is selected.';
        return deliver('open_file_and_selection', msg, currentFileId).out;
      },
    },
    compile_log: {
      description: 'The result of the last compilation in this session: whether it worked, the main file and the end of the compiler log.',
      schema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        const r = window.lastCompileResult;
        if (!r) return deliver('compile_log', 'The project was not compiled in this session yet.').out;
        const log = String(r.log || '');
        const tail = log.length > MAX_LOG ? '[the beginning of the log was left out]\n' + log.slice(-MAX_LOG) : log;
        return deliver('compile_log', `Compilation ${r.success ? 'succeeded' : 'failed'}. Main file: ${r.mainFile || '?'}\n\n${tail}`).out;
      },
    },
    list_comments: {
      description: 'The open comments and suggestions of the project: file, line, the passage and what was said.',
      schema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        const doc = await Project.comments.load();
        const open = (doc.threads || []).filter(t => !t.resolved).slice(0, 100);
        if (!open.length) return deliver('list_comments', 'There are no open comments.').out;
        // names only: e-mail addresses of the collaborators are not sent
        const who = a => (a && a.name) || 'someone';
        const txt = open.map(t => {
          let s = `${t.kind === 'suggestion' ? 'Suggestion' : 'Comment'} at ${t.file}:${t.range && t.range.sl} by ${who(t.author)}\n  passage: ${JSON.stringify(String(t.quote || '').slice(0, 300))}`;
          if (t.kind === 'suggestion' && t.suggestion) s += `\n  proposed: ${JSON.stringify(String(t.suggestion.replacement || '').slice(0, 300))}`;
          for (const m of t.messages || []) s += `\n  ${who(m.author)}: ${String(m.text || '').slice(0, 500)}`;
          return s;
        }).join('\n\n');
        const { out, cut } = deliver('list_comments', txt);
        return out + (cut ? '\n[cut]' : '');
      },
    },
    add_comment: {
      description: 'Proposes a comment on a passage of a file. It is only a draft: the person decides whether to keep it. Quote the passage exactly as read_file shows it, as short as it can be while appearing only once in the file.',
      schema: { type: 'object', properties: { path: { type: 'string' }, quote: { type: 'string', description: 'The exact passage the comment is about' }, text: { type: 'string', description: 'The comment' } }, required: ['path', 'quote', 'text'], additionalProperties: false },
      run: a => propose('comment', a),
    },
    add_suggestion: {
      description: 'Proposes replacing a passage of a file with new text (an empty replacement deletes it; to insert, quote the line after which the text goes and repeat it in the replacement). It is only a draft: the person decides whether to accept it. Quote the passage exactly as read_file shows it, as short as it can be while appearing only once in the file, and keep each suggestion small.',
      schema: { type: 'object', properties: { path: { type: 'string' }, quote: { type: 'string', description: 'The exact passage to replace' }, replacement: { type: 'string', description: 'The new text for that passage' }, text: { type: 'string', description: 'Why, in one or two sentences (optional)' } }, required: ['path', 'quote', 'replacement'], additionalProperties: false },
      run: a => propose('suggestion', a),
    },
    changed_files: {
      description: 'The files that were added, changed or deleted since the last commit of the project.',
      schema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        const st = await BrowserGit.status();
        const ch = (st.changes || []).filter(c => !c.file.startsWith('.'));
        if (!ch.length) return deliver('changed_files', 'Nothing changed since the last commit.').out;
        return deliver('changed_files', ch.map(c => `${c.isDeleted ? 'deleted' : c.isNew ? 'new' : 'changed'}: ${c.file}`).join('\n')).out;
      },
    },
  };

  const defs = () => Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, schema: t.schema }));

  /** Arguments must match the tool's schema (only what the schemas here use): unknown or mistyped fields are refused. */
  function check(schema, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'the arguments must be an object';
    for (const k of Object.keys(input)) if (!(k in schema.properties)) return `unknown argument "${k}"`;
    for (const k of schema.required || []) if (!(k in input)) return `missing argument "${k}"`;
    for (const [k, v] of Object.entries(input)) {
      const p = schema.properties[k];
      if (p.type === 'string' && typeof v !== 'string') return `"${k}" must be text`;
      if (p.type === 'integer' && !(Number.isInteger(v) && v >= (p.minimum || -Infinity))) return `"${k}" must be a whole number from ${p.minimum} up`;
    }
    return null;
  }

  /** Runs one tool call of the model ({ name, input, invalid }) and returns { content, isError }. It never throws. */
  async function run(call) {
    const t = Object.prototype.hasOwnProperty.call(TOOLS, call && call.name) ? TOOLS[call.name] : null;
    if (!t) return { content: `There is no tool called "${String(call && call.name).slice(0, 80)}".`, isError: true };
    if (call.invalid) return { content: 'The arguments were not valid JSON. Send the call again.', isError: true };
    const bad = check(t.schema, call.input);
    if (bad) return { content: `Invalid arguments: ${bad}.`, isError: true };
    try {
      return { content: await t.run(call.input), isError: false };
    } catch (e) {
      if (e instanceof ToolError) return { content: e.message, isError: true };
      return { content: 'The project could not be read: ' + String((e && e.message) || e).slice(0, 300), isError: true };
    }
  }

  return { defs, run, begin, sent, drafts: () => drafts.map(d => ({ ...d, range: { ...d.range } })), total: () => total, limits: { MAX_READ, MAX_TOTAL, MAX_FILE, MAX_DRAFTS, MAX_QUOTE, MAX_TEXT } };
}
// the conversation uses this one; a browser agent (ai-webmcp.js) makes its own with AITools.create(), so the two never share a budget or drafts
window.AITools = makeTools();
window.AITools.create = makeTools;
