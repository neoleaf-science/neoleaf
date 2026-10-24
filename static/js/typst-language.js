// Typst language (.typ) in Monaco: syntax coloring (markup, code after #, math between $...$, raw text, comments, labels and references),
// folding of sections by heading level, bracket handling and suggestions for the functions people use most.
(function () {
  'use strict';

  const EXT = ['typ'];
  const isTypstName = name => EXT.includes(String(name || '').split('.').pop().toLowerCase());

  // Keywords of the code mode (#let, #set, #show, #import, #include, #if...)
  const KEYWORDS = ['let', 'set', 'show', 'import', 'include', 'if', 'else', 'for', 'while', 'break', 'continue', 'return', 'context', 'in', 'not', 'and', 'or', 'as'];
  const STATEMENTS = 'let|set|show|import|include|if|else|for|while|break|continue|return|context';

  const typstMonarch = {
    defaultToken: '',
    tokenPostfix: '.typst',
    brackets: [
      { open: '{', close: '}', token: 'delimiter.curly' },
      { open: '[', close: ']', token: 'delimiter.square' },
      { open: '(', close: ')', token: 'delimiter.parenthesis' }
    ],
    keywords: KEYWORDS,
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],

        // raw text
        [/`{3,}/, { token: 'string.verbatim', next: '@rawBlock' }],
        [/`[^`\n]*`/, 'string.verbatim'],

        // headings and list markers, at the start of a line
        [/^\s*=+(?=\s)/, { token: 'keyword.section', next: '@heading' }],
        [/^\s*(?:[-+]|\d+\.)(?=\s)/, 'keyword.control'],
        [/^\s*\/(?=\s)/, 'keyword.control'],

        // math
        [/\$/, { token: 'string.math.delimiter', next: '@math' }],

        // code mode: statements run to the end of the line (or the end of their brackets)
        [new RegExp('#(?:' + STATEMENTS + ')(?![\\w-])'), { token: 'keyword.control', next: '@statement' }],
        [/#(?=[a-zA-Z_][\w-]*[.(])/, { token: 'keyword.command', next: '@expression' }],
        [/#[a-zA-Z_][\w-]*/, 'variable.name'],
        [/#(?=[({])/, { token: 'keyword.command', next: '@expression' }],

        // labels and references
        [/<[a-zA-Z_][\w.:-]*>/, 'keyword.reference'],
        [/@[a-zA-Z_][\w.:-]*/, 'keyword.reference'],

        [/\\[\s\S]/, 'keyword.escape'],
        [/https?:\/\/[^\s\])]+/, 'string.link'],

        [/[\[\]]/, '@brackets']
      ],

      comment: [
        [/[^/*]+/, 'comment'],
        [/\/\*/, 'comment', '@push'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment']
      ],

      rawBlock: [
        [/`{3,}/, { token: 'string.verbatim', next: '@pop' }],
        [/[^`]+/, 'string.verbatim'],
        [/`/, 'string.verbatim']
      ],

      heading: [
        [/$/, '', '@pop'],
        [/<[a-zA-Z_][\w.:-]*>/, 'keyword.reference'],
        [/#[a-zA-Z_][\w-]*/, 'keyword.command'],
        [/\/\/.*$/, 'comment'],
        [/[^<#/\n]+/, 'keyword.section'],
        [/[<#/]/, 'keyword.section']
      ],

      math: [
        [/\\[\s\S]/, 'keyword.escape'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/\$/, { token: 'string.math.delimiter', next: '@pop' }],
        [/#[a-zA-Z_][\w-]*/, 'keyword.command'],
        [/[a-zA-Z][\w.]*(?=\()/, 'keyword.math'],
        [/\d+(?:\.\d+)?/, 'number.math'],
        [/[+\-*/=<>^_&|!~:]+/, 'operator.math'],
        [/./, 'string.math']
      ],

      // `#let x = ...`, `#set text(...)`: code up to the end of the line, or the end of its brackets
      statement: [
        [/$/, '', '@pop'],
        { include: 'code' }
      ],
      // `#figure(...)[...]`, `#{ ... }`: the expression and what hangs from it
      expression: [
        [/[a-zA-Z_][\w-]*/, { cases: { '@keywords': 'keyword.control', '@default': 'variable.name' } }],
        [/\./, 'delimiter'],
        [/\(/, { token: '@brackets', next: '@args' }],
        [/\{/, { token: '@brackets', next: '@block' }],
        [/\[/, { token: '@brackets', next: '@content' }],
        ['', '', '@pop']
      ],
      args: [
        [/\)/, { token: '@brackets', next: '@pop' }],
        { include: 'code' }
      ],
      block: [
        [/\}/, { token: '@brackets', next: '@pop' }],
        { include: 'code' }
      ],
      // [markup inside code]
      content: [
        [/\]/, { token: '@brackets', next: '@pop' }],
        { include: 'root' }
      ],

      code: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/\d+(?:\.\d+)?(?:%|[a-zA-Z]+)?/, 'number'],
        [/<[a-zA-Z_][\w.:-]*>/, 'keyword.reference'],
        [/\$/, { token: 'string.math.delimiter', next: '@math' }],
        [/[a-zA-Z_][\w-]*(?=\s*:(?!:))/, 'attribute.name'],
        [/[a-zA-Z_][\w-]*(?=\()/, { cases: { '@keywords': 'keyword.control', '@default': 'keyword.command' } }],
        [/[a-zA-Z_][\w-]*/, { cases: { '@keywords': 'keyword.control', '@default': 'variable.name' } }],
        [/\(/, { token: '@brackets', next: '@args' }],
        [/\{/, { token: '@brackets', next: '@block' }],
        [/\[/, { token: '@brackets', next: '@content' }],
        [/[)}\]]/, { token: '@brackets', next: '@pop' }],
        [/[=+\-*/<>!.,:;]+/, 'operator.math']
      ]
    }
  };

  // ---- sections: a heading (= Title) closes at the next heading of the same level or higher
  function headings(text) {
    const out = [];
    const lines = String(text || '').split('\n');
    let inRaw = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*`{3,}/.test(line)) { inRaw = !inRaw; continue; }
      if (inRaw) continue;
      const m = /^\s*(=+)\s+(.*?)\s*$/.exec(line);
      if (m) out.push({ level: m[1].length, title: m[2].replace(/\s*<[^>]+>\s*$/, ''), line: i + 1 });
    }
    return out;
  }

  function foldingRanges(model, monaco) {
    const total = model.getLineCount();
    const hs = headings(model.getValue());
    const ranges = [];
    for (let i = 0; i < hs.length; i++) {
      let end = total;
      for (let j = i + 1; j < hs.length; j++) {
        if (hs[j].level <= hs[i].level) { end = hs[j].line - 1; break; }
      }
      while (end > hs[i].line && model.getLineContent(end).trim() === '') end--;
      if (end > hs[i].line) ranges.push({ start: hs[i].line, end: end, kind: monaco.languages.FoldingRangeKind.Region });
    }
    return ranges;
  }

  // ---- suggestions: the functions people use most, as snippets
  const SNIPPETS = [
    ['set', 'set ${1:text}(${2:size}: ${3:11pt})', 'Set rule'],
    ['show', 'show ${1:heading}: ${2:it} => ${3:it}', 'Show rule'],
    ['let', 'let ${1:name} = ${2:value}', 'Define a variable or function'],
    ['import', 'import "@preview/${1:package}:${2:0.1.0}": ${3:*}', 'Import a package'],
    ['include', 'include "${1:chapter.typ}"', 'Include a file'],
    ['figure', 'figure(\n  image("${1:figure.png}", width: ${2:80%}),\n  caption: [${3:Caption}],\n) <${4:fig:label}>', 'Figure with caption and label'],
    ['image', 'image("${1:figure.png}", width: ${2:80%})', 'Image'],
    ['table', 'table(\n  columns: ${1:2},\n  [${2:A}], [${3:B}],\n)', 'Table'],
    ['grid', 'grid(\n  columns: (${1:1fr, 1fr}),\n  gutter: ${2:1em},\n  [${3:left}], [${4:right}],\n)', 'Grid'],
    ['align', 'align(${1:center})[${2:content}]', 'Align content'],
    ['link', 'link("${1:https://example.com}")[${2:text}]', 'Link'],
    ['cite', 'cite(<${1:key}>)', 'Citation'],
    ['bibliography', 'bibliography("${1:refs.bib}")', 'Bibliography'],
    ['heading', 'heading(level: ${1:1})[${2:Title}]', 'Heading'],
    ['text', 'text(${1:fill}: ${2:red})[${3:content}]', 'Text with settings'],
    ['par', 'par(justify: ${1:true})[${2:content}]', 'Paragraph settings'],
    ['page', 'page(paper: "${1:a4}", margin: ${2:2.5cm})', 'Page settings'],
    ['pagebreak', 'pagebreak()', 'Page break'],
    ['outline', 'outline()', 'Table of contents'],
    ['footnote', 'footnote[${1:note}]', 'Footnote'],
    ['lorem', 'lorem(${1:50})', 'Placeholder text'],
    ['raw', 'raw("${1:code}", lang: "${2:python}")', 'Raw text'],
    ['quote', 'quote(block: true, attribution: [${1:Author}])[${2:text}]', 'Quotation'],
    ['box', 'box(width: ${1:50%})[${2:content}]', 'Inline box'],
    ['block', 'block(inset: ${1:8pt}, fill: ${2:luma(240)})[${3:content}]', 'Block'],
    ['rect', 'rect(width: ${1:100%}, inset: ${2:8pt})[${3:content}]', 'Rectangle'],
    ['stack', 'stack(dir: ${1:ltr}, spacing: ${2:1em}, ${3:[a]}, ${4:[b]})', 'Stack'],
    ['columns', 'columns(${1:2})[${2:content}]', 'Columns'],
    ['v', 'v(${1:1em})', 'Vertical space'],
    ['h', 'h(${1:1em})', 'Horizontal space'],
    ['datetime', 'datetime.today().display()', 'Today\'s date'],
    ['numbering', 'set heading(numbering: "${1:1.1}")', 'Number the headings'],
    ['title', 'align(center, text(17pt)[*${1:Title}*])', 'Centered title']
  ];

  function labelsOf(model) {
    const set = new Set();
    for (const m of model.getValue().matchAll(/<([a-zA-Z_][\w.:-]*)>/g)) set.add(m[1]);
    return [...set];
  }

  function register(monaco) {
    monaco.languages.register({ id: 'typst', extensions: EXT.map(e => '.' + e), aliases: ['Typst', 'typst'] });
    monaco.languages.setMonarchTokensProvider('typst', typstMonarch);
    monaco.languages.setLanguageConfiguration('typst', {
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
        { open: '"', close: '"', notIn: ['string', 'comment'] }, { open: '$', close: '$', notIn: ['string', 'comment'] },
        { open: '`', close: '`', notIn: ['string', 'comment'] }
      ],
      surroundingPairs: [
        { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '"', close: '"' },
        { open: '$', close: '$' }, { open: '*', close: '*' }, { open: '_', close: '_' }, { open: '`', close: '`' }
      ],
      wordPattern: /[a-zA-Z_][\w-]*|\d+(?:\.\d+)?/,
      indentationRules: { increaseIndentPattern: /[\[{(]\s*$/, decreaseIndentPattern: /^\s*[\]})]/ }
    });
    monaco.languages.registerFoldingRangeProvider('typst', { provideFoldingRanges: model => foldingRanges(model, monaco) });

    monaco.languages.registerCompletionItemProvider('typst', {
      triggerCharacters: ['#', '@'],
      provideCompletionItems(model, position) {
        const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const T = window.T || (s => s);
        if (/@[\w.:-]*$/.test(before)) {
          return { suggestions: labelsOf(model).map(l => ({ label: l, kind: monaco.languages.CompletionItemKind.Reference, insertText: l, range, detail: T('Label') })) };
        }
        if (!/#[\w-]*$/.test(before)) return { suggestions: [] };
        return {
          suggestions: SNIPPETS.map(([label, body, doc]) => ({
            label: label, kind: monaco.languages.CompletionItemKind.Snippet, insertText: body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: doc, detail: '#' + label, range
          }))
        };
      }
    });
  }

  window.LDTypst = { register, isTypstName, EXT, typstMonarch, headings, foldingRanges, KEYWORDS };
})();
