// LaTeX and BibTeX languages for Monaco: syntax coloring, theme, editor behavior,
// section/environment folding, hover tips and \ref and \cite suggestions.
//
// Usage: window.LD.register(monaco) once (after loading Monaco); window.LD.languageFor(name).

(function () {

  // Extensions of each language
  const LATEX_EXT = ['tex', 'sty', 'cls', 'clo', 'ltx', 'def', 'cfg', 'ldf', 'fd', 'sto', 'dtx', 'ins', 'bbx', 'cbx', 'lbx', 'rtx'];

  function languageFor(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (LATEX_EXT.includes(ext)) return 'latex';
    if (window.LDContext && LDContext.EXT.includes(ext)) return 'context';
    if (window.LDTypst && LDTypst.EXT.includes(ext)) return 'typst';
    if (ext === 'bib') return 'bibtex';
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    if (ext === 'mmd' || ext === 'mermaid') return 'mermaid';
    if (ext === 'csv' || ext === 'tsv') return 'csv';
    if (ext === 'py') return 'python';
    return 'plaintext';
  }

  // Environments whose content is literal text (no commands)
  const VERBATIM_ENVS = 'verbatim\\*?|Verbatim\\*?|lstlisting|minted|comment|filecontents\\*?|alltt';
  // Math environments
  const MATH_ENVS = 'equation|align|alignat|gather|multline|flalign|eqnarray|displaymath|math|split|array|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|smallmatrix';

  const latexMonarch = {
    defaultToken: '',
    tokenPostfix: '.latex',
    brackets: [
      { open: '{', close: '}', token: 'delimiter.curly' },
      { open: '[', close: ']', token: 'delimiter.square' },
      { open: '(', close: ')', token: 'delimiter.parenthesis' }
    ],
    tokenizer: {
      root: [
        // comments and escapes
        [/%.*$/, 'comment'],
        [/\\(?:[%$&#_{}\\ ,;:!>])/, 'keyword.escape'],

        // literal text
        [new RegExp('(\\\\begin)(\\s*\\{)(' + VERBATIM_ENVS + ')(\\})'), ['keyword.control', 'delimiter.curly', 'variable.environment', { token: 'delimiter.curly', next: '@verbatim' }]],
        [/\\verb\*?(.)/, { token: 'keyword.command', next: '@verbInline.$1' }],
        [/\\lstinline\s*(?:\[[^\]]*\])?\s*(.)/, { token: 'keyword.command', next: '@verbInline.$1' }],

        // math
        [/\$\$/, { token: 'string.math.delimiter', next: '@mathDisplay' }],
        [/\$/, { token: 'string.math.delimiter', next: '@mathInline' }],
        [/\\\[/, { token: 'string.math.delimiter', next: '@mathBracket' }],
        [/\\\(/, { token: 'string.math.delimiter', next: '@mathParen' }],
        [new RegExp('(\\\\begin)(\\s*\\{)((?:' + MATH_ENVS + ')\\*?)(\\})'), ['keyword.control', 'delimiter.curly', 'variable.environment', { token: 'delimiter.curly', next: '@mathEnv' }]],

        // \begin{environment} and \end{environment}
        [/(\\(?:begin|end))(\s*\{)([^}]*)(\})/, ['keyword.control', 'delimiter.curly', 'variable.environment', 'delimiter.curly']],

        // document structure
        [/\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?![a-zA-Z@])/, 'keyword.section'],
        [/\\(?:documentclass|usepackage|RequirePackage|LoadClass|input|include|includeonly|bibliography|bibliographystyle|addbibresource|newcommand|renewcommand|providecommand|DeclareRobustCommand|newenvironment|renewenvironment|def|edef|gdef|xdef|let|newtheorem|DeclareMathOperator|setlength|usetikzlibrary|geometry|hypersetup|pagestyle|title|author|date|maketitle|tableofcontents|appendix|printbibliography)(?![a-zA-Z@])/, 'keyword.preamble'],

        // references and citations: the argument (key) gets its own color
        [/\\(?:label|ref|eqref|pageref|autoref|cref|Cref|nameref|vref|cite[a-zA-Z]*|footcite[a-zA-Z]*|parencite|textcite|autocite|nocite)\*?(?![a-zA-Z@])/, { token: 'keyword.reference', next: '@refArgs' }],
        [/\\(?:url|href|path)(?![a-zA-Z@])/, { token: 'keyword.reference', next: '@urlArg' }],

        // any other command
        [/\\[a-zA-Z@]+\*?/, 'keyword.command'],
        [/\\./, 'keyword.escape'],

        [/&/, 'operator.align'],
        [/#\d/, 'variable.parameter'],
        [/[{}\[\]()]/, '@brackets']
      ],

      // ---- math (each form ends at its own delimiter)
      mathInline: [
        [/\\\$/, 'keyword.escape'],
        [/\$/, { token: 'string.math.delimiter', next: '@pop' }],
        { include: '@mathContent' }
      ],
      mathDisplay: [
        [/\$\$/, { token: 'string.math.delimiter', next: '@pop' }],
        { include: '@mathContent' }
      ],
      mathBracket: [
        [/\\\]/, { token: 'string.math.delimiter', next: '@pop' }],
        { include: '@mathContent' }
      ],
      mathParen: [
        [/\\\)/, { token: 'string.math.delimiter', next: '@pop' }],
        { include: '@mathContent' }
      ],
      mathEnv: [
        [/(\\end)(\s*\{)([^}]*)(\})/, ['keyword.control', 'delimiter.curly', 'variable.environment', { token: 'delimiter.curly', next: '@pop' }]],
        { include: '@mathContent' }
      ],
      mathContent: [
        [/%.*$/, 'comment'],
        [/\\(?:text|textbf|textit|mathrm|mathbf|mathit|mathcal|mathbb|mathfrak|operatorname|mbox|hbox)(?![a-zA-Z@])/, 'keyword.command'],
        [/\\(?:[%$&#_{}\\ ,;:!>])/, 'keyword.escape'],
        [/\\[a-zA-Z@]+\*?/, 'keyword.math'],
        [/\\./, 'keyword.math'],
        [/\d+(?:\.\d+)?/, 'number.math'],
        [/[\^_=+\-*\/<>|!]/, 'operator.math'],
        [/&/, 'operator.align'],
        [/[{}\[\]()]/, '@brackets'],
        [/[^\\$%&{}\[\]()\d\^_=+\-*\/<>|!]+/, 'string.math']
      ],

      // ---- literal text
      verbatim: [
        [new RegExp('(\\\\end)(\\s*\\{)(' + VERBATIM_ENVS + ')(\\})'), ['keyword.control', 'delimiter.curly', 'variable.environment', { token: 'delimiter.curly', next: '@pop' }]],
        [/[^\\]+/, 'string.verbatim'],
        [/\\/, 'string.verbatim']
      ],
      verbInline: [
        [/[^\\]/, { cases: { '$0==$S2': { token: 'keyword.command', next: '@pop' }, '@default': 'string.verbatim' } }],
        [/\\/, 'string.verbatim']
      ],

      // ---- arguments of \ref, \cite...
      refArgs: [
        [/\s*\[[^\]]*\]/, 'string.option'],
        [/\s*\{/, { token: 'delimiter.curly', switchTo: '@refKey' }],
        [/(?=.|$)/, { token: '', next: '@pop' }]
      ],
      refKey: [
        [/[^},%]+/, 'string.reference'],
        [/,/, 'delimiter'],
        [/\}/, { token: 'delimiter.curly', next: '@pop' }],
        [/%.*$/, 'comment']
      ],
      urlArg: [
        [/\s*\{/, { token: 'delimiter.curly', switchTo: '@urlBody' }],
        [/(?=.|$)/, { token: '', next: '@pop' }]
      ],
      urlBody: [
        [/[^}]+/, 'string.link'],
        [/\}/, { token: 'delimiter.curly', next: '@pop' }]
      ]
    }
  };

  const bibtexMonarch = {
    defaultToken: '',
    tokenPostfix: '.bibtex',
    brackets: [
      { open: '{', close: '}', token: 'delimiter.curly' },
      { open: '(', close: ')', token: 'delimiter.parenthesis' }
    ],
    tokenizer: {
      // outside the entries, BibTeX treats everything as a comment
      root: [
        [/@(?:comment)\b.*$/i, 'comment'],
        [/@(?:string|preamble)\b/i, { token: 'keyword.entry', next: '@entryOpen' }],
        [/@[a-zA-Z]+/, { token: 'keyword.entry', next: '@entryOpen' }],
        [/[^@]+/, 'comment']
      ],
      entryOpen: [
        [/\s+/, ''],
        [/\{/, { token: 'delimiter.curly', switchTo: '@entryKey' }],
        [/\(/, { token: 'delimiter.parenthesis', switchTo: '@entryKey' }],
        [/(?=.|$)/, { token: '', next: '@pop' }]
      ],
      // entry key (or @string name): up to the comma
      entryKey: [
        [/\s+/, ''],
        [/[^,={}()\s]+/, 'type.identifier'],
        [/,/, { token: 'delimiter', switchTo: '@fields' }],
        [/=/, { token: 'operator', switchTo: '@fields' }],
        [/[})]/, { token: '@brackets', next: '@pop' }]
      ],
      fields: [
        [/\s+/, ''],
        [/%.*$/, 'comment'],
        [/[a-zA-Z_][\w\-:.]*(?=\s*=)/, 'attribute.name'],
        [/=/, 'operator'],
        [/#/, 'operator'],
        [/,/, 'delimiter'],
        [/\{/, { token: 'string', next: '@braceValue' }],
        [/"/, { token: 'string', next: '@quoteValue' }],
        [/\d+/, 'number'],
        [/[a-zA-Z_][\w\-:.]*/, 'variable.name'],
        [/[})]/, { token: '@brackets', next: '@pop' }]
      ],
      braceValue: [
        [/\\./, 'string.escape'],
        [/\{/, { token: 'string', next: '@braceValue' }],
        [/\}/, { token: 'string', next: '@pop' }],
        [/[^\\{}]+/, 'string']
      ],
      quoteValue: [
        [/\\./, 'string.escape'],
        [/\{/, { token: 'string', next: '@braceValue' }],
        [/"/, { token: 'string', next: '@pop' }],
        [/[^\\{"]+/, 'string']
      ]
    }
  };

  // ------------------------------------------------------------ theme

  const themeRules = [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword.command', foreground: '569CD6' },
    { token: 'keyword.control', foreground: 'C586C0', fontStyle: 'bold' },
    { token: 'variable.environment', foreground: '4EC9B0' },
    { token: 'keyword.section', foreground: 'DCDCAA', fontStyle: 'bold' },
    { token: 'keyword.preamble', foreground: 'C586C0' },
    { token: 'keyword.reference', foreground: 'D7BA7D' },
    { token: 'string.reference', foreground: 'CE9178' },
    { token: 'string.link', foreground: '3794FF', fontStyle: 'underline' },
    { token: 'string.option', foreground: 'D19A66' },
    { token: 'string.math.delimiter', foreground: 'D7BA7D', fontStyle: 'bold' },
    { token: 'string.math', foreground: 'E5C07B' },
    { token: 'keyword.math', foreground: '9CDCFE' },
    { token: 'number.math', foreground: 'B5CEA8' },
    { token: 'operator.math', foreground: 'D4D4D4' },
    { token: 'string.verbatim', foreground: 'CE9178' },
    { token: 'keyword.escape', foreground: 'D19A66' },
    { token: 'operator.align', foreground: 'D4D4D4', fontStyle: 'bold' },
    { token: 'variable.parameter', foreground: '9CDCFE' },
    // BibTeX
    { token: 'keyword.entry', foreground: '569CD6', fontStyle: 'bold' },
    { token: 'type.identifier', foreground: '4EC9B0' },
    { token: 'attribute.name', foreground: '9CDCFE' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'string.escape', foreground: 'D19A66' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'variable.name', foreground: 'DCDCAA' }
  ];

  // ------------------------------------------------------------ folding (sections and environments)

  const SECTION_LEVEL = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };

  function stripComment(line) {
    let prevBackslash = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '%' && !prevBackslash) return line.slice(0, i);
      prevBackslash = c === '\\' && !prevBackslash;
    }
    return line;
  }

  function foldingRanges(model, monaco) {
    const ranges = [];
    const envStack = [];
    const open = []; // open sections: { level, line }
    const total = model.getLineCount();
    let commentStart = null;

    const closeSections = (fromLevel, endLine) => {
      while (open.length && open[open.length - 1].level >= fromLevel) {
        const s = open.pop();
        if (endLine > s.line) ranges.push({ start: s.line, end: endLine });
      }
    };

    for (let n = 1; n <= total; n++) {
      const raw = model.getLineContent(n);

      // comment blocks
      if (/^\s*%/.test(raw)) {
        if (commentStart === null) commentStart = n;
      } else if (commentStart !== null) {
        if (n - 1 > commentStart) ranges.push({ start: commentStart, end: n - 1, kind: monaco.languages.FoldingRangeKind.Comment });
        commentStart = null;
      }

      const line = stripComment(raw);
      const sec = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\])?\s*\{/.exec(line);
      if (sec) {
        const level = SECTION_LEVEL[sec[1]];
        closeSections(level, n - 1);
        open.push({ level, line: n });
      }

      for (const m of line.matchAll(/\\(begin|end)\s*\{([^}]*)\}/g)) {
        const env = m[2];
        if (m[1] === 'begin') {
          envStack.push({ env, line: n });
        } else {
          if (env === 'document') closeSections(0, n - 1);
          // closes the matching environment (ignores \end without \begin)
          for (let i = envStack.length - 1; i >= 0; i--) {
            if (envStack[i].env === env) {
              const b = envStack.splice(i, 1)[0];
              if (n - 1 > b.line) ranges.push({ start: b.line, end: n - 1 });
              break;
            }
          }
        }
      }
    }
    if (commentStart !== null && total > commentStart) ranges.push({ start: commentStart, end: total, kind: monaco.languages.FoldingRangeKind.Comment });
    closeSections(0, total);
    return ranges;
  }

  // ------------------------------------------------------------ \ref and \cite suggestions

  function labelsOf(model) {
    const out = new Set();
    for (const m of model.getValue().matchAll(/\\label\s*\{([^}]+)\}/g)) out.add(m[1].trim());
    return [...out];
  }

  // Project bibliography keys: filled by monaco-latex.js on each compilation (window.LD.bibKeys)
  function bibKeys() {
    return (window.LD && window.LD.bibKeys) || [];
  }

  function argumentContext(model, position) {
    // text of the line up to the cursor: \cite{a, b|  or  \ref{sec:|
    const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
    const m = /\\([a-zA-Z]+)\*?\s*(?:\[[^\]]*\]\s*)*\{([^{}]*)$/.exec(before);
    if (!m) return null;
    const cmd = m[1];
    const typed = m[2];
    // start of the passage the user is typing (after the last comma, without spaces)
    const last = typed.slice(typed.lastIndexOf(',') + 1).trimStart();
    const start = position.column - last.length;
    if (/^(?:ref|eqref|pageref|autoref|cref|Cref|nameref|vref)$/.test(cmd)) return { kind: 'ref', start };
    if (/^(?:cite[a-zA-Z]*|footcite[a-zA-Z]*|parencite|textcite|autocite|nocite)$/.test(cmd)) return { kind: 'cite', start };
    return null;
  }

  // Mermaid (.mmd, .mermaid): simple coloring; the preview is in mermaid-preview.js
  const mermaidMonarch = {
    defaultToken: '',
    tokenPostfix: '.mermaid',
    keywords: ['graph', 'flowchart', 'subgraph', 'end', 'direction', 'sequenceDiagram', 'participant', 'actor', 'autonumber', 'activate', 'deactivate',
      'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect', 'note', 'over', 'classDiagram', 'class', 'stateDiagram', 'stateDiagram-v2', 'state',
      'erDiagram', 'gantt', 'title', 'dateFormat', 'axisFormat', 'section', 'pie', 'showData', 'journey', 'gitGraph', 'commit', 'branch', 'checkout',
      'merge', 'mindmap', 'timeline', 'quadrantChart', 'xychart-beta', 'sankey-beta', 'block-beta', 'classDef', 'style', 'linkStyle', 'click', 'link'],
    tokenizer: {
      root: [
        [/%%.*$/, 'comment'],
        [/"[^"]*"/, 'string'],
        [/(?:<)?(?:-{2,}|={2,}|-\.+-|~{3,})(?:>|x|o)?(?:\|[^|]*\|)?/, 'operator'],
        [/[\[\](){}|]/, 'delimiter.bracket'],
        [/:::?[\w-]+/, 'type'],
        [/#[0-9a-fA-F]{3,8}\b/, 'number.hex'],
        [/\d+(?:\.\d+)?/, 'number'],
        [/[A-Za-z_][\w-]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      ],
    },
  };

  // CSV and TSV: simple coloring (quoted text, numbers and separators); the table is in csv-preview.js
  const csvMonarch = {
    defaultToken: '',
    tokenPostfix: '.csv',
    tokenizer: {
      root: [
        [/"(?:[^"]|"")*"/, 'string'],
        [/-?\d+(?:[.,]\d+)?(?=\s*(?:[,;\t|]|$))/, 'number'],
        [/[,;\t|]/, 'delimiter'],
      ],
    },
  };

  // ------------------------------------------------------------ registration

  let registered = false;

  function register(monaco, hoverDocs) {
    if (registered) return;
    registered = true;

    monaco.languages.register({ id: 'latex', extensions: LATEX_EXT.map(e => '.' + e), aliases: ['LaTeX', 'latex'] });
    monaco.languages.register({ id: 'bibtex', extensions: ['.bib'], aliases: ['BibTeX', 'bibtex'] });
    monaco.languages.register({ id: 'mermaid', extensions: ['.mmd', '.mermaid'], aliases: ['Mermaid', 'mermaid'] });
    monaco.languages.register({ id: 'csv', extensions: ['.csv', '.tsv'], aliases: ['CSV', 'csv'] });

    if (window.LDContext) LDContext.register(monaco);   // ConTeXt: .mkiv, .mkxl, .mkvi
    if (window.LDTypst) LDTypst.register(monaco);       // Typst: .typ
    monaco.languages.setMonarchTokensProvider('latex', latexMonarch);
    monaco.languages.setMonarchTokensProvider('bibtex', bibtexMonarch);
    monaco.languages.setMonarchTokensProvider('mermaid', mermaidMonarch);
    monaco.languages.setMonarchTokensProvider('csv', csvMonarch);
    monaco.languages.setLanguageConfiguration('mermaid', {
      comments: { lineComment: '%%' },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '"', close: '"' }],
    });

    monaco.languages.setLanguageConfiguration('latex', {
      comments: { lineComment: '%' },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '$', close: '$', notIn: ['comment'] },
        { open: '`', close: "'", notIn: ['comment'] }
      ],
      surroundingPairs: [
        { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
        { open: '$', close: '$' }, { open: '`', close: "'" }
      ],
      wordPattern: /\\[a-zA-Z@]+\*?|[A-Za-z0-9_À-ÿ]+/g,
      folding: { markers: { start: /^\s*%\s*region\b/, end: /^\s*%\s*endregion\b/ } },
      onEnterRules: [
        {
          // \begin{x}|\end{x}  ->  indent with the \end on the line below
          beforeText: /^\s*\\begin\{(?!document\})([^}]*)\}\s*$/,
          afterText: /^\s*\\end\{[^}]*\}/,
          action: { indentAction: monaco.languages.IndentAction.IndentOutdent }
        },
        {
          beforeText: /^\s*\\begin\{(?!document\})[^}]*\}.*$/,
          action: { indentAction: monaco.languages.IndentAction.Indent }
        },
        {
          beforeText: /^\s*\\item\b.*$/,
          action: { indentAction: monaco.languages.IndentAction.None, appendText: '\\item ' }
        }
      ]
    });

    monaco.languages.setLanguageConfiguration('bibtex', {
      comments: { lineComment: '%' },
      brackets: [['{', '}'], ['(', ')']],
      autoClosingPairs: [{ open: '{', close: '}' }, { open: '(', close: ')' }, { open: '"', close: '"', notIn: ['string'] }],
      surroundingPairs: [{ open: '{', close: '}' }, { open: '"', close: '"' }]
    });

    // themes (light, dark, Catppuccin, Dracula...) defined in theme.js from the palettes
    if (window.LDTheme) LDTheme.defineMonaco(monaco);

    // folding of sections, environments and comment blocks
    monaco.languages.registerFoldingRangeProvider('latex', {
      provideFoldingRanges: model => foldingRanges(model, monaco)
    });

    // hover tip on a known command
    if (hoverDocs) {
      monaco.languages.registerHoverProvider('latex', {
        provideHover(model, position) {
          const w = model.getWordAtPosition(position);
          if (!w || !w.word.startsWith('\\')) return null;
          const doc = hoverDocs[w.word.replace(/\*$/, '')];
          if (!doc) return null;
          return {
            range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn),
            contents: [{ value: '**`' + w.word + '`**' }, { value: doc }]
          };
        }
      });
    }

    // suggestions for \ref{...} (labels of the file) and \cite{...} (keys of the project's .bib files)
    monaco.languages.registerCompletionItemProvider('latex', {
      triggerCharacters: ['{', ','],
      provideCompletionItems(model, position) {
        const ctx = argumentContext(model, position);
        if (!ctx || (window.LD && LD.smart)) return { suggestions: [] };   // autocomplete.js takes over
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: ctx.start, endColumn: position.column };
        const items = ctx.kind === 'ref' ? labelsOf(model) : bibKeys();
        return {
          suggestions: items.map(k => ({
            label: k,
            kind: ctx.kind === 'ref' ? monaco.languages.CompletionItemKind.Reference : monaco.languages.CompletionItemKind.Value,
            insertText: k,
            detail: ctx.kind === 'ref' ? T('label (\\label)') : T('reference (.bib)'),
            range
          }))
        };
      }
    });
  }

  window.LD = Object.assign(window.LD || {}, { register, languageFor, latexMonarch, bibtexMonarch, foldingRanges, argumentContext, bibKeys: [] });
  Object.defineProperty(window.LD, 'THEME', { get: () => (window.LDTheme ? LDTheme.monacoId() : 'vs-dark') });
})();
