// ConTeXt language (.mkiv, .mkxl, .mkvi) in Monaco: syntax coloring, folding of \start...\stop... pairs, block closing,
// suggestions for commands, keys and values, and a hover with the command's shape. The command index (context-index.js, generated
// by scripts/build_context_index.py from the ConTeXt interface) is only downloaded when a ConTeXt file is opened.
(function () {
  'use strict';

  const EXT = ['mkiv', 'mkxl', 'mkvi'];
  const isContextName = name => EXT.includes(String(name || '').split('.').pop().toLowerCase());

  // Blocks whose content is literal text (up to the matching \stop...)
  const LITERAL = 'typing|TEX|tex|luacode|MPcode|MPpage|MPdefinitions|MPrun|lua|ctxfunction|xmlsetups|buffer|filecontents|code|text|comment|compressedtext';
  const MATH = 'formula|subformula|placeformula|mathmatrix|mathcases|mathalignment|mathmode|imath|dmath';

  const contextMonarch = {
    defaultToken: '',
    tokenPostfix: '.context',
    brackets: [
      { open: '{', close: '}', token: 'delimiter.curly' },
      { open: '[', close: ']', token: 'delimiter.square' },
      { open: '(', close: ')', token: 'delimiter.parenthesis' }
    ],
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/\\(?:[%$&#_{}\\ ,;:!>|/])/, 'keyword.escape'],

        // literal text
        [new RegExp('(\\\\start)(' + LITERAL + ')(?![a-zA-Z@!?])'), ['keyword.control', { token: 'variable.environment', next: '@literal.$2' }]],
        [/\\type\s*(\{)/, { token: 'keyword.command', next: '@typeInline' }],

        // math
        [/\$\$/, { token: 'string.math.delimiter', next: '@mathDisplay' }],
        [/\$/, { token: 'string.math.delimiter', next: '@mathInline' }],
        [new RegExp('(\\\\start)(' + MATH + ')(?![a-zA-Z@!?])'), ['keyword.control', { token: 'variable.environment', next: '@mathBlock.$2' }]],

        // structure (headings and structure blocks)
        [/\\(?:start|stop)?(?:part|chapter|section|subsection|subsubsection|subsubsubsection|title|subject|subsubject|subsubsubject|appendix)(?![a-zA-Z@!?])/, 'keyword.section'],
        [/\\(?:start|stop)(?:text|document|component|product|project|environment|front|body|back|appendices)(?![a-zA-Z@!?])/, 'keyword.section'],

        // other blocks
        [/\\(?:start|stop)[a-zA-Z@!?]+/, 'keyword.control'],

        // setup, definitions, modules and files
        [/\\(?:setup|define|use|enable|disable|reset|set|install|complete|restore)[a-zA-Z@!?]*/, 'keyword.preamble'],
        [/\\(?:component|product|project|environment|input|usemodule|usecomponent|environment|startproject)(?![a-zA-Z@!?])/, 'keyword.preamble'],

        // references
        [/\\(?:in|at|about|from|goto|reference|pagereference|textreference|cite|nocite|placebibliography|placelist|placecontent)(?![a-zA-Z@!?])/, 'keyword.reference'],

        // any other command
        [/\\[a-zA-Z@!?]+/, 'keyword.command'],
        [/\\./, 'keyword.escape'],

        [/#\d/, 'variable.parameter'],
        [/\[/, { token: '@brackets', next: '@options' }],
        [/[{}\]()]/, '@brackets']
      ],

      // [key=value, ...]
      options: [
        [/%.*$/, 'comment'],
        [/\]/, { token: '@brackets', next: '@pop' }],
        [/\[/, { token: '@brackets', next: '@options' }],
        [/[a-zA-Z_][\w\-:.]*(?=\s*=)/, 'attribute.name'],
        [/=/, 'operator'],
        [/,/, 'delimiter'],
        [/\\[a-zA-Z@!?]+/, 'keyword.command'],
        [/[{}()]/, '@brackets'],
        [/[^\]\[,=%\\{}()]+/, 'string.option']
      ],

      mathInline: [
        [/\\\$/, 'keyword.escape'],
        [/\$/, { token: 'string.math.delimiter', next: '@pop' }],
        { include: '@mathContent' }
      ],
      mathDisplay: [
        [/\$\$/, { token: 'string.math.delimiter', next: '@pop' }],
        { include: '@mathContent' }
      ],
      mathBlock: [
        [/(\\stop)([a-zA-Z]+)/, { cases: { '$2==$S2': ['keyword.control', { token: 'variable.environment', next: '@pop' }], '@default': ['keyword.control', 'variable.environment'] } }],
        { include: '@mathContent' }
      ],
      mathContent: [
        [/%.*$/, 'comment'],
        [/\\(?:[%$&#_{}\\ ,;:!>])/, 'keyword.escape'],
        [/\\[a-zA-Z@!?]+/, 'keyword.math'],
        [/\\./, 'keyword.math'],
        [/\d+(?:\.\d+)?/, 'number.math'],
        [/[\^_=+\-*\/<>|!]/, 'operator.math'],
        [/&/, 'operator.align'],
        [/[{}\[\]()]/, '@brackets'],
        [/[^\\$%&{}\[\]()\d\^_=+\-*\/<>|!]+/, 'string.math']
      ],

      literal: [
        [/(\\stop)([a-zA-Z]+)/, { cases: { '$2==$S2': ['keyword.control', { token: 'variable.environment', next: '@pop' }], '@default': 'string.verbatim' } }],
        [/[^\\]+/, 'string.verbatim'],
        [/\\/, 'string.verbatim']
      ],
      typeInline: [
        [/\}/, { token: 'keyword.command', next: '@pop' }],
        [/[^}]+/, 'string.verbatim']
      ]
    }
  };

  // ------------------------------------------------------------ folding \start...\stop...

  function foldingRanges(model, monaco) {
    const ranges = [];
    const stack = [];
    const n = model.getLineCount();
    for (let ln = 1; ln <= n; ln++) {
      const line = model.getLineContent(ln).replace(/(^|[^\\])%.*$/, '$1');
      const re = /\\(start|stop)([a-zA-Z@!?]+)/g;
      let m;
      while ((m = re.exec(line))) {
        if (m[1] === 'start') { stack.push({ name: m[2], line: ln }); continue; }
        let i = stack.length - 1;
        while (i >= 0 && stack[i].name !== m[2]) i--;
        if (i < 0) continue;
        const open = stack[i];
        stack.length = i;
        if (ln - 1 > open.line) ranges.push({ start: open.line, end: ln - 1, kind: monaco.languages.FoldingRangeKind.Region });
      }
    }
    return ranges;
  }

  // ------------------------------------------------------------ command index (loaded on demand)

  let indexPromise = null, byName = null, sorted = null;
  function loadIndex() {
    if (window.CTX_INDEX && byName) return Promise.resolve(byName);
    if (!indexPromise) {
      indexPromise = new Promise(resolve => {
        const done = () => {
          const idx = window.CTX_INDEX;
          if (idx && idx.commands) {
            byName = new Map(idx.commands.map(c => [c.n, c]));
            sorted = idx.commands;
          }
          resolve(byName);
        };
        if (window.CTX_INDEX) { done(); return; }
        const s = document.createElement('script');
        s.src = '/static/js/context-index.js?v=1';
        s.onload = done;
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
      });
    }
    return indexPromise;
  }

  // readable form: \externalfigure[...][...][key=value]
  function signatureText(c) {
    let out = '\\' + c.n;
    (c.s || []).forEach(a => {
      const opt = a[1];
      const body = a[0] === 'a' ? 'key=value' : (Array.isArray(a[2]) && a[2].length && a[2].length <= 4 ? a[2].join('|') : '...');
      const g = a[0] === 'c' ? '{' + body + '}' : a[0] === 'n' ? ' ' + body : '[' + body + ']';
      out += opt ? '(' + g + ')' : g;
    });
    if (c.e) out += ' ... \\stop' + c.n.slice(5);
    return out;
  }

  // insertion text (Monaco snippet): required arguments; if there is only one optional argument, it is included too
  function snippetFor(c) {
    const sig = c.s || [];
    const required = sig.filter(a => !a[1]);
    const use = required.length ? required : (sig.length === 1 ? sig : []);
    let i = 0;
    let out = '\\' + c.n;
    use.forEach(a => {
      i++;
      out += a[0] === 'c' ? '{$' + i + '}' : a[0] === 'n' ? ' $' + i : '[$' + i + ']';
    });
    if (c.e) {
      const stop = '\\stop' + c.n.slice(5);
      out += '\n\t$0\n' + stop;
    }
    return out;
  }

  // ------------------------------------------------------------ context of [ ... ] (keys and values)

  // Does the text before the cursor end inside a [ ... ] of a known command? Returns { name, group, inside }
  function bracketContext(before) {
    // finds the last '[' still open on the line
    let depth = 0, open = -1;
    for (let i = before.length - 1; i >= 0; i--) {
      const ch = before[i];
      if (ch === ']') depth++;
      else if (ch === '[') { if (depth === 0) { open = i; break; } depth--; }
    }
    if (open < 0) return null;
    const head = before.slice(0, open);
    const m = /\\([a-zA-Z@!?]+)((?:\s*\[[^\]]*\]|\s*\{[^}]*\})*)\s*$/.exec(head);
    if (!m) return null;
    const group = (m[2].match(/\[/g) || []).length;
    return { name: m[1], group, inside: before.slice(open + 1) };
  }

  function register(monaco) {
    if (monaco.languages.getLanguages().some(l => l.id === 'context')) return;
    monaco.languages.register({ id: 'context', extensions: EXT.map(e => '.' + e), aliases: ['ConTeXt', 'context'] });
    monaco.languages.setMonarchTokensProvider('context', contextMonarch);
    monaco.languages.setLanguageConfiguration('context', {
      comments: { lineComment: '%' },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '$', close: '$', notIn: ['comment'] }
      ],
      surroundingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '$', close: '$' }],
      wordPattern: /\\[a-zA-Z@!?]+|[A-Za-z0-9_À-ÿ]+/g,
      folding: { markers: { start: /^\s*%\s*region\b/, end: /^\s*%\s*endregion\b/ } },
      onEnterRules: [
        {
          beforeText: /^\s*\\start(?!text\b|document\b|component\b|product\b|project\b|environment\b)[a-zA-Z@!?]+.*$/,
          afterText: /^\s*\\stop[a-zA-Z@!?]+/,
          action: { indentAction: monaco.languages.IndentAction.IndentOutdent }
        },
        {
          beforeText: /^\s*\\start(?!text\b|document\b|component\b|product\b|project\b|environment\b)[a-zA-Z@!?]+.*$/,
          action: { indentAction: monaco.languages.IndentAction.Indent }
        }
      ]
    });
    // downloads the index as soon as a ConTeXt file is opened, so the first suggestion is already complete
    monaco.editor.onDidCreateModel(m => { if (m.getLanguageId() === 'context') loadIndex(); });
    monaco.editor.onDidChangeModelLanguage(e => { if (e.model.getLanguageId() === 'context') loadIndex(); });
    monaco.languages.registerFoldingRangeProvider('context', { provideFoldingRanges: model => foldingRanges(model, monaco) });

    monaco.languages.registerCompletionItemProvider('context', {
      triggerCharacters: ['\\', '[', ',', '='],
      async provideCompletionItems(model, position) {
        const idx = await loadIndex();
        if (!idx) return { suggestions: [] };
        const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);

        // 1) command name
        const cm = /\\([a-zA-Z@!?]*)$/.exec(before);
        if (cm) {
          const prefix = cm[1];
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column - prefix.length - 1, endColumn: position.column };
          const out = [];
          for (const c of sorted) {
            if (c.n.startsWith(prefix)) {
              out.push({
                label: '\\' + c.n,
                kind: c.e ? monaco.languages.CompletionItemKind.Struct : monaco.languages.CompletionItemKind.Function,
                insertText: snippetFor(c),
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: signatureText(c),
                documentation: c.c ? 'ConTeXt · ' + c.c : 'ConTeXt',
                sortText: (c.n.length < 10 ? '0' : '1') + c.n,
                filterText: '\\' + c.n,
                range
              });
              if (out.length >= 300) break;
            }
          }
          return { suggestions: out };
        }

        // 2) inside [ ... ]: keys, values and constants
        const bc = bracketContext(before);
        if (!bc) return { suggestions: [] };
        const cmd = idx.get(bc.name) || idx.get('start' + bc.name);
        if (!cmd) return { suggestions: [] };
        const brackets = (cmd.s || []).filter(a => a[0] === 'b' || a[0] === 'a');
        const arg = brackets[bc.group];
        if (!arg) return { suggestions: [] };
        const lastPart = bc.inside.split(',').pop();
        const eq = lastPart.indexOf('=');
        if (arg[0] === 'a') {
          const params = cmd.p || {};
          if (eq >= 0) {
            const key = lastPart.slice(0, eq).trim();
            const vals = params[key] || [];
            const typed = lastPart.slice(eq + 1).replace(/^\s*/, '');
            const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column - typed.length, endColumn: position.column };
            return { suggestions: vals.map(v => ({ label: v, kind: monaco.languages.CompletionItemKind.EnumMember, insertText: v, range, detail: key })) };
          }
          const used = new Set(bc.inside.split(',').map(p => p.split('=')[0].trim()).filter(Boolean));
          const typed = lastPart.replace(/^\s*/, '');
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column - typed.length, endColumn: position.column };
          return {
            suggestions: Object.keys(params).filter(k => !used.has(k) || k === typed).map(k => ({
              label: k, kind: monaco.languages.CompletionItemKind.Property, insertText: k + '=', range,
              detail: params[k].length ? params[k].slice(0, 6).join(' | ') : cmd.n, command: { id: 'editor.action.triggerSuggest', title: '' }
            }))
          };
        }
        const typed = lastPart.replace(/^\s*/, '');
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column - typed.length, endColumn: position.column };
        return { suggestions: (arg[2] || []).map(v => ({ label: v, kind: monaco.languages.CompletionItemKind.EnumMember, insertText: v, range, detail: cmd.n })) };
      }
    });

    monaco.languages.registerHoverProvider('context', {
      async provideHover(model, position) {
        const w = model.getWordAtPosition(position);
        if (!w || !w.word.startsWith('\\')) return null;
        const idx = await loadIndex();
        const name = w.word.slice(1);
        const c = idx && (idx.get(name) || null);
        if (!c) return null;
        return {
          range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn),
          contents: [{ value: '**`' + w.word + '`**' }, { value: '`' + signatureText(c) + '`' + (c.c ? '\n\nConTeXt · ' + c.c : '') }]
        };
      }
    });
  }

  window.LDContext = { register, isContextName, EXT, contextMonarch, foldingRanges, loadIndex, signatureText, snippetFor, bracketContext };
})();
