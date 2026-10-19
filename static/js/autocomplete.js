// Smart LaTeX autocomplete: understands the PROJECT (labels, .bib citations, images, .tex files,
// commands and environments you defined), suggests according to the command the cursor is in, warns about
// missing labels, citations and files, and supports Ctrl+click to jump to the definition.
//
// Usage (monaco-latex.js): LD.smart.register(monaco) once; LD.smart.attach(editor) after creating the editor.

(function () {
  window.LD = window.LD || {};

  // ================================================================== static data

  // [name, arguments (snippet), documentation]
  const COMMANDS = [
    // structure
    ['part', '{$1}', 'Document part'], ['chapter', '{$1}', 'Chapter'], ['section', '{$1}', 'Section'],
    ['subsection', '{$1}', 'Subsection'], ['subsubsection', '{$1}', 'Subsubsection'], ['paragraph', '{$1}', 'Titled paragraph'],
    ['subparagraph', '{$1}', 'Subparagraph'], ['section*', '{$1}', 'Unnumbered section'], ['chapter*', '{$1}', 'Unnumbered chapter'],
    ['subsection*', '{$1}', 'Unnumbered subsection'], ['title', '{$1}', 'Document title'], ['author', '{$1}', 'Author(s)'],
    ['date', '{$1}', 'Date'], ['maketitle', '', 'Generates the title'], ['tableofcontents', '', 'Table of contents'],
    ['listoffigures', '', 'List of figures'], ['listoftables', '', 'List of tables'], ['appendix', '', 'Start of the appendices'],
    ['frontmatter', '', 'Front matter'], ['mainmatter', '', 'Main matter of the book'], ['backmatter', '', 'Back matter'],
    // text
    ['textbf', '{$1}', 'Bold'], ['textit', '{$1}', 'Italic'], ['emph', '{$1}', 'Emphasis'], ['underline', '{$1}', 'Underline'],
    ['texttt', '{$1}', 'Monospace'], ['textsc', '{$1}', 'Small caps'], ['textsf', '{$1}', 'Sans serif'], ['textrm', '{$1}', 'Serif'],
    ['textsl', '{$1}', 'Slanted'], ['textup', '{$1}', 'Upright'], ['textnormal', '{$1}', 'Normal font'], ['mbox', '{$1}', 'Box without line breaks'],
    ['footnote', '{$1}', 'Footnote'], ['footnotemark', '', 'Note mark'], ['footnotetext', '{$1}', 'Note text'],
    ['textcolor', '{${1:red}}{$2}', 'Colored text (xcolor)'], ['colorbox', '{${1:yellow}}{$2}', 'Box with colored background'],
    ['fbox', '{$1}', 'Framed box'], ['framebox', '[${1:width}][${2:c}]{$3}', 'Frame with width'],
    ['hspace', '{${1:1cm}}', 'Horizontal space'], ['hspace*', '{${1:1cm}}', 'Horizontal space (never removed)'], ['vspace', '{${1:1cm}}', 'Vertical space'],
    ['vspace*', '{${1:1cm}}', 'Vertical space (never removed)'], ['hfill', '', 'Stretchable horizontal space'], ['vfill', '', 'Stretchable vertical space'],
    ['noindent', '', 'No paragraph indent'], ['indent', '', 'Paragraph indent'], ['newline', '', 'New line'], ['linebreak', '', 'Line break'],
    ['pagebreak', '', 'Page break'], ['newpage', '', 'New page'], ['clearpage', '', 'New page (flushes pending figures)'],
    ['cleardoublepage', '', 'New odd page'], ['centering', '', 'Centers'], ['raggedright', '', 'Aligns left'], ['raggedleft', '', 'Aligns right'],
    ['quad', '', '1 em space'], ['qquad', '', '2 em space'], ['ldots', '', 'Ellipsis'], ['dots', '', 'Ellipsis'], ['today', '', 'Date of today'],
    ['LaTeX', '', 'LaTeX logo'], ['TeX', '', 'TeX logo'], ['item', ' $0', 'List item'], ['bigskip', '', 'Large vertical space'],
    ['medskip', '', 'Medium vertical space'], ['smallskip', '', 'Small vertical space'], ['phantom', '{$1}', 'Reserves the space of the text without showing it'],
    ['hphantom', '{$1}', 'Reserves width'], ['vphantom', '{$1}', 'Reserves height'], ['rule', '{${1:1cm}}{${2:1pt}}', 'Rule or bar'],
    ['makebox', '[${1:width}][${2:c}]{$3}', 'Fixed-width box'], ['parbox', '[${1:t}]{${2:5cm}}{$3}', 'Paragraph box'],
    ['raisebox', '{${1:2pt}}{$2}', 'Raises the content'], ['resizebox', '{${1:\\linewidth}}{${2:!}}{$3}', 'Resizes the content (graphicx)'],
    ['scalebox', '{${1:0.8}}{$2}', 'Scales the content'], ['rotatebox', '{${1:90}}{$2}', 'Rotates the content'], ['ensuremath', '{$1}', 'Ensures math mode'],
    ['xspace', '', 'Smart space after macros'], ['verb', '|$1|', 'Inline literal text'], ['lstinline', '|$1|', 'Inline code (listings)'],
    ['texorpdfstring', '{${1:tex}}{${2:pdf}}', 'Different text in TeX and in PDF bookmarks'],
    // sizes
    ['tiny', '', 'Tiny size'], ['scriptsize', '', 'Script size'], ['footnotesize', '', 'Footnote size'], ['small', '', 'Small'],
    ['normalsize', '', 'Normal'], ['large', '', 'Large'], ['Large', '', 'Larger'], ['LARGE', '', 'Very large'], ['huge', '', 'Huge'], ['Huge', '', 'Giant'],
    // references
    ['label', '{${1:sec:}}', 'Label for cross-reference'], ['ref', '{$1}', 'Reference to a label'], ['eqref', '{$1}', 'Equation reference: (n)'],
    ['pageref', '{$1}', 'Page of a label'], ['autoref', '{$1}', 'Reference with the type (hyperref)'], ['cref', '{$1}', 'Smart reference (cleveref)'],
    ['Cref', '{$1}', 'Smart reference with capital initial'], ['nameref', '{$1}', 'Name of the referenced section (hyperref)'], ['vref', '{$1}', 'Reference with page (varioref)'],
    ['cite', '{$1}', 'Citation'], ['citep', '{$1}', 'Parenthetical citation (natbib)'], ['citet', '{$1}', 'In-text citation (natbib)'],
    ['citeauthor', '{$1}', 'Name of the cited author'], ['citeyear', '{$1}', 'Year of the citation'], ['nocite', '{$1}', 'Adds to the bibliography without citing'],
    ['parencite', '{$1}', 'Parenthetical citation (biblatex)'], ['textcite', '{$1}', 'In-text citation (biblatex)'], ['autocite', '{$1}', 'Automatic citation (biblatex)'],
    ['footcite', '{$1}', 'Footnote citation (biblatex)'], ['bibliography', '{$1}', '.bib file(s) (BibTeX)'], ['bibliographystyle', '{$1}', 'Bibliography style (BibTeX)'],
    ['addbibresource', '{$1.bib}', '.bib file (biblatex)'], ['printbibliography', '', 'Prints the bibliography (biblatex)'], ['bibitem', '{$1} $0', 'Manual bibliography item'],
    ['url', '{$1}', 'Web address'], ['href', '{${1:url}}{${2:text}}', 'Link with text (hyperref)'], ['hyperref', '[${1:label}]{$2}', 'Link to a label'],
    ['caption', '{$1}', 'Caption'], ['captionof', '{${1:figure}}{$2}', 'Caption outside a floating environment'],
    // files
    ['includegraphics', '[width=${1:\\linewidth}]{$2}', 'Inserts an image'], ['input', '{$1}', 'Includes another .tex file'], ['include', '{$1}', 'Includes a file on a new page'],
    ['includeonly', '{$1}', 'Compiles only these files'], ['subfile', '{$1}', 'Includes a subfile (subfiles)'], ['graphicspath', '{{${1:figures/}}}', 'Image folders'],
    ['includepdf', '[pages=${1:-}]{$2}', 'Inserts pages from a PDF (pdfpages)'],
    // preamble
    ['documentclass', '[${1:12pt,a4paper}]{${2:article}}', 'Document class'], ['usepackage', '[$1]{$2}', 'Loads a package'], ['RequirePackage', '[$1]{$2}', 'Loads a package (in classes)'],
    ['newcommand', '{\\\\${1:name}}[${2:1}]{$3}', 'Defines a command'], ['renewcommand', '{\\\\${1:name}}[${2:1}]{$3}', 'Redefines a command'], ['providecommand', '{\\\\${1:name}}[${2:1}]{$3}', 'Defines a command if it does not exist'],
    ['newenvironment', '{${1:name}}[${2:0}]{$3}{$4}', 'Defines an environment'], ['renewenvironment', '{${1:name}}[${2:0}]{$3}{$4}', 'Redefines an environment'],
    ['newtheorem', '{${1:theorem}}{${2:Theorem}}', 'Defines a theorem environment'], ['theoremstyle', '{${1:definition}}', 'Theorem style'],
    ['setlength', '{\\\\${1:parindent}}{${2:0pt}}', 'Sets a length'], ['addtolength', '{\\\\${1:textwidth}}{${2:1cm}}', 'Adds to a length'],
    ['setcounter', '{${1:section}}{${2:0}}', 'Sets a counter'], ['addtocounter', '{${1:section}}{${2:1}}', 'Adds to a counter'], ['newcounter', '{$1}', 'Creates a counter'],
    ['pagestyle', '{${1:fancy}}', 'Page style'], ['thispagestyle', '{${1:empty}}', 'Style of this page'], ['pagenumbering', '{${1:arabic}}', 'Page numbering'],
    ['geometry', '{${1:margin=2.5cm}}', 'Margins (geometry)'], ['hypersetup', '{${1:colorlinks=true}}', 'hyperref options'],
    ['DeclareMathOperator', '{\\\\${1:op}}{${2:op}}', 'Math operator'], ['usetikzlibrary', '{$1}', 'TikZ libraries'],
    ['definecolor', '{${1:name}}{${2:rgb}}{${3:0,0,0}}', 'Defines a color (xcolor)'], ['setcitestyle', '{${1:numbers}}', 'Citation style (natbib)'],
    // tables
    ['hline', '', 'Horizontal rule'], ['cline', '{${1:1-2}}', 'Partial rule'], ['multicolumn', '{${1:2}}{${2:c}}{$3}', 'Cell spanning several columns'],
    ['multirow', '{${1:2}}{${2:*}}{$3}', 'Cell spanning several rows (multirow)'], ['toprule', '', 'Top rule (booktabs)'], ['midrule', '', 'Middle rule (booktabs)'],
    ['bottomrule', '', 'Bottom rule (booktabs)'], ['cmidrule', '{${1:1-2}}', 'Partial rule (booktabs)'],
    // math
    ['frac', '{$1}{$2}', 'Fraction'], ['dfrac', '{$1}{$2}', 'Large fraction'], ['tfrac', '{$1}{$2}', 'Small fraction'], ['sqrt', '{$1}', 'Square root'], ['sqrt[]', '[${1:n}]{$2}', 'nth root'],
    ['sum', '_{${1:i=1}}^{${2:n}}', 'Summation'], ['prod', '_{${1:i=1}}^{${2:n}}', 'Product'], ['int', '_{${1:a}}^{${2:b}}', 'Integral'], ['oint', '', 'Line integral'],
    ['lim', '_{${1:x \\to \\infty}}', 'Limit'], ['binom', '{$1}{$2}', 'Binomial coefficient'], ['partial', '', 'Partial derivative'], ['nabla', '', 'Nabla'], ['infty', '', 'Infinity'],
    ['cdot', '', 'Centered dot'], ['cdots', '', 'Centered ellipsis'], ['vdots', '', 'Vertical ellipsis'], ['ddots', '', 'Diagonal ellipsis'], ['times', '', 'Multiplication ×'],
    ['div', '', 'Division ÷'], ['pm', '', '±'], ['mp', '', '∓'], ['leq', '', '≤'], ['geq', '', '≥'], ['neq', '', '≠'], ['approx', '', '≈'], ['equiv', '', '≡'], ['sim', '', '∼'],
    ['simeq', '', '≃'], ['propto', '', '∝'], ['in', '', '∈'], ['notin', '', '∉'], ['subset', '', '⊂'], ['subseteq', '', '⊆'], ['supset', '', '⊃'], ['supseteq', '', '⊇'], ['cup', '', '∪'],
    ['cap', '', '∩'], ['setminus', '', '∖'], ['emptyset', '', '∅'], ['forall', '', '∀'], ['exists', '', '∃'], ['neg', '', '¬'], ['land', '', '∧'], ['lor', '', '∨'],
    ['rightarrow', '', '→'], ['Rightarrow', '', '⇒'], ['leftarrow', '', '←'], ['Leftarrow', '', '⇐'], ['leftrightarrow', '', '↔'], ['Leftrightarrow', '', '⇔'], ['mapsto', '', '↦'],
    ['to', '', '→'], ['implies', '', '⟹'], ['iff', '', '⟺'], ['mathbf', '{$1}', 'Math bold'], ['mathit', '{$1}', 'Math italic'], ['mathrm', '{$1}', 'Math roman'],
    ['mathcal', '{$1}', 'Calligraphic'], ['mathbb', '{$1}', 'Blackboard bold (ℝ, ℕ...)'], ['mathfrak', '{$1}', 'Fraktur'], ['mathsf', '{$1}', 'Math sans serif'],
    ['mathtt', '{$1}', 'Math monospace'], ['boldsymbol', '{$1}', 'Bold symbol'], ['text', '{$1}', 'Text inside a formula'], ['operatorname', '{$1}', 'Operator name'],
    ['hat', '{$1}', 'Hat accent'], ['bar', '{$1}', 'Bar'], ['tilde', '{$1}', 'Tilde'], ['vec', '{$1}', 'Vector'], ['dot', '{$1}', 'Dot above'], ['ddot', '{$1}', 'Two dots above'],
    ['overline', '{$1}', 'Overline'], ['overbrace', '{$1}', 'Overbrace'], ['underbrace', '{$1}', 'Underbrace'], ['left', '(', 'Auto-sizing delimiter'], ['right', ')', 'Auto-sizing delimiter'],
    ['langle', '', '⟨'], ['rangle', '', '⟩'], ['lfloor', '', '⌊'], ['rfloor', '', '⌋'], ['lceil', '', '⌈'], ['rceil', '', '⌉'],
    ['sin', '', 'Sine'], ['cos', '', 'Cosine'], ['tan', '', 'Tangent'], ['log', '', 'Logarithm'], ['ln', '', 'Natural logarithm'], ['exp', '', 'Exponential'],
    ['max', '', 'Maximum'], ['min', '', 'Minimum'], ['sup', '', 'Supremum'], ['inf', '', 'Infimum'],
    // tables and numbers (siunitx)
    ['SI', '{${1:10}}{${2:\\meter}}', 'Number with unit (siunitx)'], ['num', '{$1}', 'Formatted number (siunitx)'], ['si', '{$1}', 'Unit (siunitx)']
  ];

  const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho',
    'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega'];
  GREEK.forEach(g => COMMANDS.push([g, '', 'Greek letter']));

  // environments: [name, body (snippet), documentation]
  const FIG_BODY = '[htbp]\n\t\\centering\n\t\\includegraphics[width=${1:0.8}\\linewidth]{${2:file}}\n\t\\caption{${3:Caption}}\n\t\\label{fig:${4:label}}';
  const TAB_BODY = '[htbp]\n\t\\centering\n\t\\caption{${1:Caption}}\n\t\\label{tab:${2:label}}\n\t\\begin{tabular}{${3:ll}}\n\t\t\\toprule\n\t\t$0\n\t\t\\bottomrule\n\t\\end{tabular}';
  const ENVIRONMENTS = [
    ['itemize', '\\item $0', 'Bulleted list'], ['enumerate', '\\item $0', 'Numbered list'], ['description', '\\item[$1] $0', 'Description list'],
    ['equation', '$0', 'Numbered equation'], ['equation*', '$0', 'Unnumbered equation'], ['align', '$0', 'Aligned equations'], ['align*', '$0', 'Unnumbered aligned equations'],
    ['gather', '$0', 'Centered equations'], ['gather*', '$0', 'Unnumbered centered equations'], ['multline', '$0', 'Long equation over several lines'], ['split', '$0', 'Splits an equation'],
    ['cases', '$0', 'Definition by cases'], ['array', '{${1:cc}}\n\t$0', 'Matrix/table in a formula'], ['matrix', '$0', 'Matrix'], ['pmatrix', '$0', 'Matrix with parentheses'],
    ['bmatrix', '$0', 'Matrix with brackets'], ['vmatrix', '$0', 'Determinant'], ['figure', FIG_BODY, 'Floating figure'], ['figure*', FIG_BODY, 'Two-column figure'],
    ['table', TAB_BODY, 'Floating table'], ['table*', TAB_BODY, 'Two-column table'], ['tabular', '{${1:ll}}\n\t$0', 'Table'], ['tabularx', '{${1:\\linewidth}}{${2:XX}}\n\t$0', 'Table with width (tabularx)'],
    ['longtable', '{${1:ll}}\n\t$0', 'Multi-page table'], ['center', '$0', 'Centers'], ['flushleft', '$0', 'Aligns left'], ['flushright', '$0', 'Aligns right'],
    ['quote', '$0', 'Short quotation'], ['quotation', '$0', 'Long quotation'], ['verse', '$0', 'Verse'], ['verbatim', '$0', 'Literal text'], ['lstlisting', '[language=${1:Python}]\n$0', 'Code (listings)'],
    ['minted', '{${1:python}}\n$0', 'Code (minted)'], ['minipage', '{${1:0.5\\linewidth}}\n\t$0', 'Side-by-side box'], ['abstract', '$0', 'Abstract'], ['document', '$0', 'Document body'],
    ['theorem', '$0', 'Theorem'], ['lemma', '$0', 'Lemma'], ['proposition', '$0', 'Proposition'], ['corollary', '$0', 'Corollary'], ['definition', '$0', 'Definition'],
    ['proof', '$0', 'Proof'], ['remark', '$0', 'Remark'], ['example', '$0', 'Example'], ['tikzpicture', '$0', 'TikZ drawing'], ['thebibliography', '{99}\n\t\\bibitem{${1:key}} $0', 'Manual bibliography'],
    ['frame', '\n\t\\frametitle{${1:Title}}\n\t$0', 'Slide (beamer)'], ['columns', '$0', 'Columns (beamer)'], ['column', '{${1:0.5\\textwidth}}\n\t$0', 'Column (beamer)'],
    ['block', '{${1:Title}}\n\t$0', 'Block (beamer)'], ['wrapfigure', '{${1:r}}{${2:0.4\\textwidth}}\n\t\\centering\n\t\\includegraphics[width=\\linewidth]{${3:file}}\n\t\\caption{${4:Caption}}', 'Figure with text wrapped around'],
    ['titlepage', '$0', 'Title page'], ['algorithm', '[H]\n\t\\caption{${1:Title}}\n\t$0', 'Algorithm'], ['algorithmic', '$0', 'Pseudocode'], ['filecontents', '{${1:file.bib}}\n$0', 'Creates a file'],
    ['sloppypar', '$0', 'More tolerant line breaking'], ['comment', '$0', 'Commented block']
  ];

  const PACKAGES = ['amsmath', 'amssymb', 'amsfonts', 'amsthm', 'mathtools', 'graphicx', 'xcolor', 'color', 'hyperref', 'url', 'cite', 'natbib', 'biblatex', 'babel', 'inputenc', 'fontenc',
    'geometry', 'fancyhdr', 'setspace', 'lipsum', 'booktabs', 'multirow', 'array', 'tabularx', 'longtable', 'caption', 'subcaption', 'subfig', 'float', 'wrapfig', 'enumitem',
    'listings', 'minted', 'tikz', 'pgfplots', 'algorithm', 'algorithmic', 'algpseudocode', 'algorithm2e', 'siunitx', 'cleveref', 'todonotes', 'comment', 'verbatim', 'xspace', 'ifthen',
    'etoolbox', 'titlesec', 'tocloft', 'appendix', 'soul', 'ulem', 'cancel', 'bm', 'lmodern', 'times', 'mathptmx', 'helvet', 'courier', 'palatino', 'charter', 'microtype', 'textcomp',
    'epstopdf', 'pdfpages', 'rotating', 'lscape', 'pdflscape', 'adjustbox', 'chngcntr', 'makeidx', 'glossaries', 'xparse', 'calc', 'csquotes', 'authblk', 'balance', 'flushend',
    'multicol', 'paralist', 'enumerate', 'mdframed', 'tcolorbox', 'framed', 'fullpage', 'parskip', 'indentfirst', 'ragged2e', 'upquote', 'stmaryrd', 'bbm', 'dsfont', 'mathrsfs',
    'esint', 'physics', 'mhchem', 'braket', 'thmtools', 'ntheorem', 'empheq', 'nicefrac', 'units', 'bookmark', 'hypcap', 'varioref', 'textgreek', 'subfiles', 'standalone',
    'colortbl', 'diagbox', 'makecell', 'threeparttable', 'tablefootnote', 'lastpage', 'hyphenat', 'orcidlink', 'newtxmath', 'newtxtext', 'libertine', 'inconsolata', 'fontaxes',
    'ccicons', 'cmap', 'draftwatermark', 'environ', 'trimspaces', 'xstring', 'zref', 'listingsutf8', 'fvextra', 'pgf', 'pgfplotstable', 'circuitikz', 'forest'];

  const TIKZ_LIBS = ['arrows', 'arrows.meta', 'positioning', 'calc', 'shapes', 'shapes.geometric', 'shapes.misc', 'shapes.arrows', 'shapes.symbols', 'decorations.pathmorphing',
    'decorations.markings', 'decorations.text', 'fit', 'backgrounds', 'matrix', 'trees', 'mindmap', 'patterns', 'intersections', 'through', 'automata', 'petri', 'chains', 'graphs',
    'quotes', 'angles', 'external', '3d', 'perspective', 'shadows', 'folding', 'fadings', 'calendar', 'plotmarks'];

  const STD_BST = ['plain', 'unsrt', 'abbrv', 'alpha', 'plainnat', 'unsrtnat', 'abbrvnat', 'apalike', 'ieeetr', 'IEEEtran', 'acm', 'siam', 'ACM-Reference-Format', 'spbasic', 'splncs04',
    'elsarticle-num', 'elsarticle-harv', 'abntex2-num', 'abntex2-alf', 'sbc', 'agsm', 'dcu', 'named'];

  const CLASSES = ['article', 'report', 'book', 'letter', 'beamer', 'memoir', 'scrartcl', 'scrreprt', 'scrbook', 'IEEEtran', 'acmart', 'llncs', 'elsarticle', 'amsart', 'amsbook',
    'revtex4-2', 'abntex2', 'standalone', 'exam', 'moderncv'];

  const GRAPHICS_OPTS = ['width=', 'height=', 'scale=', 'angle=', 'trim=', 'clip', 'page=', 'keepaspectratio', 'origin=', 'draft'];

  const IMG_EXT = ['png', 'jpg', 'jpeg', 'pdf', 'eps', 'svg'];

  const REF_CMDS = 'ref|eqref|pageref|autoref|cref|Cref|nameref|vref|labelcref|crefrange|Crefrange';
  const CITE_CMDS = 'cite[a-zA-Z]*|footcite[a-zA-Z]*|parencite[a-zA-Z]*|textcite[a-zA-Z]*|autocite[a-zA-Z]*|nocite|fullcite|smartcite';

  const RE_REF = new RegExp('\\\\(?:' + REF_CMDS + ')\\*?(?:\\[[^\\]]*\\])?\\{([^{}]*)\\}', 'g');
  const RE_CITE = new RegExp('\\\\(?:' + CITE_CMDS + ')\\*?(?:\\[[^\\]]*\\]){0,2}\\{([^{}]*)\\}', 'g');
  const RE_INPUT = /\\(?:input|include|subfile)\s*\{([^{}]*)\}/g;
  const RE_IMAGE = /\\includegraphics\*?(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g;
  const RE_BIBFILE = /\\bibliography\s*\{([^{}]*)\}/g;
  const RE_BIBRES = /\\addbibresource(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g;

  // ================================================================== utilities

  function stripComment(line) {
    let prev = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '%' && !prev) return line.slice(0, i);
      prev = c === '\\' && !prev;
    }
    return line;
  }

  function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    return starts;
  }

  function lineOf(starts, index) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= index) lo = mid; else hi = mid - 1; }
    return lo + 1;
  }

  const baseName = p => String(p).split('/').pop();
  const extOf = p => (baseName(p).includes('.') ? baseName(p).split('.').pop().toLowerCase() : '');
  const noExt = p => p.replace(/\.[^./]+$/, '');

  // ================================================================== file analysis

  function readBraced(text, i) {       // i points to '{'; returns [content, index after the '}']
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return [text.slice(i + 1, j), j + 1]; }
    }
    return [text.slice(i + 1), text.length];
  }

  function cleanTex(v) {
    return String(v || '').replace(/\\[a-zA-Z]+\s*/g, ' ').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
  }

  function parseBib(path, text) {
    const out = [];
    const starts = lineStarts(text);
    const re = /@([A-Za-z]+)\s*[{(]\s*([^,\s{}()]+)\s*,/g;
    let m;
    while ((m = re.exec(text))) {
      const type = m[1].toLowerCase();
      if (type === 'comment' || type === 'preamble' || type === 'string') continue;
      let depth = 1, i = re.lastIndex;
      const bodyStart = i;
      while (i < text.length && depth > 0) {
        const c = text[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '{') depth++; else if (c === '}') depth--;
        i++;
      }
      const body = text.slice(bodyStart, i - 1);
      const fields = {};
      const fre = /([A-Za-z]+)\s*=\s*/g;
      let f;
      while ((f = fre.exec(body))) {
        const name = f[1].toLowerCase();
        const p = fre.lastIndex;
        let val = '';
        if (body[p] === '{') val = readBraced(body, p)[0];
        else if (body[p] === '"') { const e = body.indexOf('"', p + 1); val = body.slice(p + 1, e < 0 ? body.length : e); }
        else { const t = /^[A-Za-z0-9_:.\-]+/.exec(body.slice(p)); val = t ? t[0] : ''; }
        if (!(name in fields)) fields[name] = cleanTex(val);
      }
      out.push({
        key: m[2], type, path, line: lineOf(starts, m.index),
        author: fields.author || fields.editor || '', title: fields.title || '', year: fields.year || (fields.date || '').slice(0, 4),
        venue: fields.journal || fields.booktitle || fields.publisher || ''
      });
    }
    return out;
  }

  function shortAuthors(a) {
    if (!a) return '';
    const names = a.split(/\s+and\s+/i).map(n => (n.includes(',') ? n.split(',')[0] : n.trim().split(/\s+/).pop()).trim()).filter(Boolean);
    if (names.length <= 2) return names.join(' & ');
    return names[0] + ' et al.';
  }

  function parseTex(path, text) {
    const labels = [], macros = [], envs = [], bib = [], uses = [], graphicsPaths = [];
    const lines = text.split('\n');
    lines.forEach((raw, idx) => {
      const line = stripComment(raw);
      if (!line.includes('\\')) return;
      const n = idx + 1;
      for (const m of line.matchAll(/\\label\s*\{([^{}]+)\}/g)) labels.push({ name: m[1].trim(), path, line: n, context: raw.trim().slice(0, 160) });
      for (const m of line.matchAll(/\\(?:re)?newcommand\*?\s*\{?\s*(\\[a-zA-Z@]+)\s*\}?\s*(?:\[(\d)\])?/g)) macros.push({ name: m[1].slice(1), args: +(m[2] || 0), path, line: n, body: raw.trim().slice(0, 140) });
      for (const m of line.matchAll(/\\(?:providecommand|DeclareRobustCommand)\*?\s*\{?\s*(\\[a-zA-Z@]+)\s*\}?\s*(?:\[(\d)\])?/g)) macros.push({ name: m[1].slice(1), args: +(m[2] || 0), path, line: n, body: raw.trim().slice(0, 140) });
      for (const m of line.matchAll(/\\[gex]?def\s*(\\[a-zA-Z@]+)((?:#\d)*)/g)) macros.push({ name: m[1].slice(1), args: (m[2].match(/#/g) || []).length, path, line: n, body: raw.trim().slice(0, 140) });
      for (const m of line.matchAll(/\\DeclareMathOperator\*?\s*\{(\\[a-zA-Z]+)\}/g)) macros.push({ name: m[1].slice(1), args: 0, path, line: n, body: raw.trim().slice(0, 140) });
      for (const m of line.matchAll(/\\(?:re)?newenvironment\*?\s*\{([A-Za-z*]+)\}\s*(?:\[(\d)\])?/g)) envs.push({ name: m[1], args: +(m[2] || 0), path, line: n });
      for (const m of line.matchAll(/\\newtheorem\*?\s*\{([A-Za-z*]+)\}/g)) envs.push({ name: m[1], args: 0, path, line: n });
      for (const m of line.matchAll(/\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)) bib.push({ key: m[1].trim(), type: 'bibitem', path, line: n, author: '', title: '', year: '', venue: '' });
      for (const m of line.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)) m[1].split(',').forEach(p => p.trim() && uses.push(p.trim()));
      for (const m of line.matchAll(/\\graphicspath\s*\{((?:\{[^{}]*\}\s*)+)\}/g)) for (const d of m[1].matchAll(/\{([^{}]*)\}/g)) graphicsPaths.push(d[1]);
    });
    return { labels, macros, envs, bib, uses, graphicsPaths };
  }

  function parseFile(path, text) {
    if (extOf(path) === 'bib') return { labels: [], macros: [], envs: [], bib: parseBib(path, text), uses: [], graphicsPaths: [] };
    return parseTex(path, text);
  }

  // ================================================================== project index

  const state = {
    parsed: new Map(),        // path -> analysis result (files other than the one currently open)
    loadedAt: 0,
    loading: null,
    texmfNames: [],
    epoch: 0,
    liveMemo: null            // { key, value }
  };

  const projectPaths = () => ((window.FT && FT.entries()) || []).filter(e => !e.dir).map(e => e.path);

  function currentPath() {
    const id = typeof currentFileId !== 'undefined' && currentFileId ? currentFileId : (typeof activeFileId !== 'undefined' ? activeFileId : null);
    const e = ((window.FT && FT.entries()) || []).find(x => x.id === id);
    return e ? e.path : null;
  }

  async function refreshIndex(force) {
    if (state.loading) return state.loading;
    if (!force && Date.now() - state.loadedAt < 15000) return;
    state.loading = (async () => {
      try {
        const data = await Project.texts();
        const next = new Map();
        for (const f of data.files || []) next.set(f.path, parseFile(f.path, f.text));
        state.parsed = next;
        state.loadedAt = Date.now();
        state.epoch++;
        // bibliography keys also for the \cite of latex-language.js (compatibility)
        LD.bibKeys = aggregate(null).bib.map(b => b.key);
        lintSoon();
      } catch (_) {
        /* no network: keep the previous index */
      } finally {
        state.loading = null;
      }
    })();
    return state.loading;
  }

  async function loadTexmfNames() {
    try {
      const d = await Project.texmf.list();
      state.texmfNames = [...(d.project || []), ...(d.global || [])].map(i => i.name.replace(/\.zip$/i, '').replace(/\.(sty|cls)$/i, ''));
    } catch (_) {}
  }

  // aggregated view: project files + the live text of the open file
  function aggregate(model) {
    const cur = currentPath();
    let live = null;
    if (model && cur) {
      const key = cur + ':' + model.getVersionId() + ':' + state.epoch;
      if (state.liveMemo && state.liveMemo.key === key) return state.liveMemo.value;
      live = parseFile(cur, model.getValue());
    }
    const all = { labels: [], macros: [], envs: [], bib: [], uses: [], graphicsPaths: [] };
    const add = r => { for (const k of Object.keys(all)) all[k].push(...r[k]); };
    if (live) add(live);
    for (const [path, r] of state.parsed) if (path !== cur || !live) add(r);
    if (model && cur) state.liveMemo = { key: cur + ':' + model.getVersionId() + ':' + state.epoch, value: all };
    return all;
  }

  // ================================================================== scanning references in the text

  // Finds, in the text of a line, the names used by \ref, \cite, \input, \includegraphics, \bibliography...
  function scanLine(line) {
    const out = [];
    const code = stripComment(line);
    const push = (kind, re) => {
      for (const m of code.matchAll(re)) {
        const argStart = m.index + m[0].lastIndexOf('{' + m[1] + '}') + 1;
        let offset = 0;
        for (const part of kind === 'ref' || kind === 'cite' || kind === 'bibfile' ? m[1].split(',') : [m[1]]) {
          const name = part.trim();
          const lead = part.length - part.trimStart().length;
          if (name) out.push({ kind, name, start: argStart + offset + lead, end: argStart + offset + lead + name.length });
          offset += part.length + 1;
        }
      }
    };
    push('ref', RE_REF); push('cite', RE_CITE); push('input', RE_INPUT); push('image', RE_IMAGE); push('bibfile', RE_BIBFILE); push('bibres', RE_BIBRES);
    return out;
  }

  function scanModel(model) {
    const out = [];
    const total = model.getLineCount();
    for (let n = 1; n <= total; n++) {
      const text = model.getLineContent(n);
      if (!text.includes('\\')) continue;
      scanLine(text).forEach(r => out.push({ ...r, line: n }));
    }
    return out;
  }

  // ================================================================== resolution (name -> target)

  function pathSet() { return new Set(projectPaths()); }

  function resolveFile(kind, name, curPath, graphicsPaths) {
    const paths = pathSet();
    const tryList = [];
    const dirs = [''];
    if (kind === 'image') (graphicsPaths || []).forEach(d => dirs.push(d.replace(/^\.\//, '')));
    const curDir = curPath && curPath.includes('/') ? curPath.slice(0, curPath.lastIndexOf('/') + 1) : '';
    if (curDir) dirs.push(curDir);
    const exts = kind === 'image' ? ['', ...IMG_EXT.map(e => '.' + e)] : kind === 'input' ? ['', '.tex'] : kind === 'bibfile' ? ['.bib', ''] : [''];
    for (const d of dirs) for (const e of exts) tryList.push(d + name + e);
    return tryList.find(p => paths.has(p)) || null;
  }

  function hoverFor(item, view, curPath) {
    if (item.kind === 'ref') {
      const l = view.labels.find(x => x.name === item.name);
      if (!l) return null;
      return T('**Label** `{0}`', l.name) + `\n\n${l.path}:${l.line}\n\n\`${l.context}\``;
    }
    if (item.kind === 'cite') {
      const b = view.bib.find(x => x.key === item.name);
      if (!b) return null;
      const head = b.title ? `**${b.title}**` : `**${b.key}**`;
      const meta = [shortAuthors(b.author), b.year, b.venue].filter(Boolean).join(' · ');
      return `${head}\n\n${meta}\n\n_${b.type}_ · ${b.path}:${b.line}`;
    }
    const target = resolveFile(item.kind, item.name, curPath, view.graphicsPaths);
    return target ? T('**File** `{0}`\n\nCtrl+click to open', target) : null;
  }

  function targetFor(item, view, curPath) {
    if (item.kind === 'ref') { const l = view.labels.find(x => x.name === item.name); return l ? { path: l.path, line: l.line } : null; }
    if (item.kind === 'cite') { const b = view.bib.find(x => x.key === item.name); return b ? { path: b.path, line: b.line } : null; }
    const p = resolveFile(item.kind, item.name, curPath, view.graphicsPaths);
    return p ? { path: p, line: 1 } : null;
  }

  // ================================================================== go to definition

  function goTo(path, line) {
    const entry = ((window.FT && FT.entries()) || []).find(e => e.path === path);
    if (!entry) return;
    const reveal = () => {
      if (!editor) return;
      const n = Math.min(Math.max(1, line || 1), editor.getModel().getLineCount());
      editor.revealLineInCenter(n);
      editor.setPosition({ lineNumber: n, column: 1 });
      editor.focus();
    };
    if (!entry.text) { if (window.FT) FT.openPath(path); return; }
    if (entry.id === currentFileId) { reveal(); return; }
    if (window.Tabs) Tabs.open(entry, { pin: false }); else switchFile(entry.id, entry.path);
    // wait for the file to load (and collaboration to sync) before positioning
    const started = Date.now();
    const timer = setInterval(() => {
      if (currentFileId === entry.id && (window.collabActive || Date.now() - started > 2500) && editor.getModel().getLineCount() >= (line || 1)) { clearInterval(timer); reveal(); }
      else if (Date.now() - started > 6000) clearInterval(timer);
    }, 150);
  }

  // ================================================================== cursor context

  // text of the line up to the cursor
  const beforeCursor = (model, pos) => model.getValueInRange({ startLineNumber: pos.lineNumber, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column });

  function argContext(before) {
    const m = /\\([a-zA-Z]+)\*?\s*(?:\[[^\]]*\]\s*)*\{([^{}]*)$/.exec(before);
    if (m) return { cmd: m[1], typed: m[2], optional: false };
    const o = /\\([a-zA-Z]+)\*?\s*\[([^\[\]]*)$/.exec(before);
    if (o) return { cmd: o[1], typed: o[2], optional: true };
    return null;
  }

  function openEnvironments(model, pos) {
    const text = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column });
    const stack = [];
    for (const m of stripComments(text).matchAll(/\\(begin|end)\s*\{([^{}]*)\}/g)) {
      if (m[1] === 'begin') stack.push(m[2]);
      else { const i = stack.lastIndexOf(m[2]); if (i >= 0) stack.splice(i, 1); }
    }
    return stack;
  }

  const stripComments = text => text.split('\n').map(stripComment).join('\n');

  // ================================================================== suggestion items

  let monacoRef = null;
  const K = () => monacoRef.languages.CompletionItemKind;

  function snippetItem(label, insert, kind, extra) {
    return { label, kind, insertText: insert, insertTextRules: monacoRef.languages.CompletionItemInsertTextRule.InsertAsSnippet, ...extra };
  }


  function commandItems(range, view) {
    const items = [];
    const seen = new Set();
    // commands defined by the project itself come first
    for (const m of view.macros) {
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      const args = Array.from({ length: m.args }, (_, i) => `{$${i + 1}}`).join('');
      items.push(snippetItem('\\' + m.name, '\\' + m.name + args, K().Function, {
        detail: T('project command'), documentation: { value: `\`${m.body}\`\n\n${m.path}:${m.line}` }, sortText: '0' + m.name, range
      }));
    }
    for (const [name, args, doc] of COMMANDS) {
      if (seen.has(name)) continue;
      items.push(snippetItem('\\' + name, '\\' + name + args, K().Function, { detail: doc, documentation: doc, sortText: '1' + name, range }));
    }
    for (const [name, body, doc] of ENVIRONMENTS) {
      items.push(snippetItem('\\begin{' + name + '}', '\\begin{' + name + '}' + (body.startsWith('\n') || body.startsWith('{') || body.startsWith('[') ? body : '\n\t' + body) + '\n\\end{' + name + '}', K().Snippet, { detail: doc, documentation: 'Environment ' + name, sortText: '2' + name, range }));
    }
    return items;
  }

  function envItems(range, view, afterBrace, pos) {
    const items = [];
    const seen = new Set();
    const make = (name, body, doc, group) => {
      if (seen.has(name)) return;
      seen.add(name);
      const inner = body.startsWith('\n') || body.startsWith('{') || body.startsWith('[') ? body : '\n\t' + body;
      // the name is completed and the matching \end{...} is inserted; the (auto-closed) closing brace is reused
      items.push(snippetItem(name, name + '}' + inner + '\n\\end{' + name + '}', K().Class, { detail: doc, sortText: group + name, range, filterText: name }));
    };
    for (const e of view.envs) make(e.name, e.args ? '{$1}' + ' '.repeat(0) + '\n\t$0' : '$0', T('project environment'), '0');
    for (const [name, body, doc] of ENVIRONMENTS) make(name, body, doc, '1');
    return items;
  }

  function labelItems(range, view, curPath) {
    const items = [];
    const seen = new Set();
    for (const l of view.labels) {
      if (seen.has(l.name)) continue;
      seen.add(l.name);
      items.push({
        label: { label: l.name, description: `${baseName(l.path)}:${l.line}` }, kind: K().Reference, insertText: l.name, range,
        detail: l.context, documentation: { value: `${l.path}:${l.line}\n\n\`${l.context}\`` }, sortText: (l.path === curPath ? '0' : '1') + l.name
      });
    }
    return items;
  }

  function citeItems(range, view) {
    const items = [];
    const seen = new Set();
    for (const b of view.bib) {
      if (seen.has(b.key)) continue;
      seen.add(b.key);
      const who = shortAuthors(b.author);
      const meta = [who, b.year].filter(Boolean).join(' ');
      const doc = [b.title ? `**${b.title}**` : '', [who, b.year, b.venue].filter(Boolean).join(' · '), `_${b.type}_ · ${b.path}:${b.line}`].filter(Boolean).join('\n\n');
      items.push({
        label: { label: b.key, description: meta }, kind: K().Constant, insertText: b.key, range,
        detail: b.title || b.type, documentation: { value: doc }, sortText: b.key,
        filterText: `${b.key} ${b.author} ${b.title} ${b.year}`
      });
    }
    return items;
  }

  function fileItems(range, paths, mode) {
    const items = [];
    for (const p of paths) {
      let ins = p;
      if (mode === 'tex') ins = p.replace(/\.tex$/i, '');
      if (mode === 'bib') ins = p.replace(/\.bib$/i, '');
      if (mode === 'bibres') ins = p;
      if (mode === 'bst') ins = p.replace(/\.bst$/i, '');
      items.push({ label: ins, kind: K().File, insertText: ins, range, detail: p, sortText: '0' + p, filterText: ins + ' ' + baseName(p) });
    }
    return items;
  }

  function simpleItems(range, names, kind, detail, group) {
    return names.map(n => ({ label: n, kind, insertText: n, range, detail, sortText: (group || '1') + n }));
  }

  // ================================================================== the provider

  function complete(model, pos) {
    const before = beforeCursor(model, pos);
    const view = aggregate(model);
    const curPath = currentPath();
    const col = pos.column;
    const mkRange = len => ({ startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: col - len, endColumn: col });

    const ctx = argContext(before);
    if (ctx && !ctx.optional) {
      const last = ctx.typed.slice(ctx.typed.lastIndexOf(',') + 1).trimStart();
      const range = mkRange(last.length);
      const cmd = ctx.cmd;
      const paths = projectPaths();

      if (new RegExp('^(?:' + REF_CMDS + ')$').test(cmd)) return labelItems(range, view, curPath);
      if (new RegExp('^(?:' + CITE_CMDS + ')$').test(cmd)) return citeItems(range, view);

      if (cmd === 'includegraphics') return fileItems(mkRange(ctx.typed.length), paths.filter(p => IMG_EXT.includes(extOf(p))), 'raw');
      if (cmd === 'input' || cmd === 'include' || cmd === 'subfile' || cmd === 'includeonly') return fileItems(mkRange(ctx.typed.length), paths.filter(p => extOf(p) === 'tex'), 'tex');
      if (cmd === 'bibliography') return fileItems(range, paths.filter(p => extOf(p) === 'bib'), 'bib');
      if (cmd === 'addbibresource') return fileItems(mkRange(ctx.typed.length), paths.filter(p => extOf(p) === 'bib'), 'bibres');
      if (cmd === 'bibliographystyle') {
        const local = paths.filter(p => extOf(p) === 'bst').map(p => p.replace(/\.bst$/i, ''));
        return [...simpleItems(mkRange(ctx.typed.length), local, K().File, T('project style'), '0'), ...simpleItems(mkRange(ctx.typed.length), STD_BST.filter(s => !local.includes(s)), K().Value, T('standard style'))];
      }
      if (cmd === 'documentclass') {
        const local = paths.filter(p => extOf(p) === 'cls').map(p => noExt(baseName(p)));
        return [...simpleItems(range, local, K().File, T('project class'), '0'), ...simpleItems(range, CLASSES.filter(c => !local.includes(c)), K().Class, T('class'))];
      }
      if (cmd === 'usepackage' || cmd === 'RequirePackage') {
        const local = paths.filter(p => extOf(p) === 'sty').map(p => noExt(baseName(p)));
        const used = view.uses;
        const rest = PACKAGES.filter(p => !local.includes(p));
        return [...simpleItems(range, local, K().File, T('project package'), '0'),
          ...simpleItems(range, state.texmfNames.filter(n => !local.includes(n)), K().Module, T('package installed in the project'), '0'),
          ...simpleItems(range, rest.filter(p => !used.includes(p)), K().Module, T('package')),
          ...simpleItems(range, rest.filter(p => used.includes(p)), K().Module, T('already loaded'), '9')];
      }
      if (cmd === 'usetikzlibrary') return simpleItems(range, TIKZ_LIBS, K().Module, T('TikZ library'));
      if (cmd === 'begin') return envItems(mkRange(ctx.typed.length), view, true, pos);
      if (cmd === 'end') {
        const open = openEnvironments(model, pos);
        const names = [...new Set([...open.reverse(), ...ENVIRONMENTS.map(e => e[0])])];
        return names.map((n, i) => ({ label: n, kind: K().Class, insertText: n, range: mkRange(ctx.typed.length), detail: i < open.length ? T('open environment') : '', sortText: (i < open.length ? '0' : '1') + n }));
      }
      return [];
    }

    if (ctx && ctx.optional && ctx.cmd === 'includegraphics') {
      const last = ctx.typed.slice(ctx.typed.lastIndexOf(',') + 1).trimStart();
      return simpleItems(mkRange(last.length), GRAPHICS_OPTS, K().Property, T('includegraphics option'));
    }

    // command name: \abc|
    const cm = /\\([a-zA-Z@]*)$/.exec(before);
    if (cm) return commandItems(mkRange(cm[0].length), view);
    return [];
  }

  // ================================================================== warnings (lint)

  let lintTimer = null;
  let attached = null;

  function lintSoon() {
    clearTimeout(lintTimer);
    lintTimer = setTimeout(lint, 700);
  }

  function lint() {
    if (!attached || !state.loadedAt) return;
    const editor2 = attached;
    const model = editor2.getModel();
    if (!model || model.getLanguageId() !== 'latex') { monacoRef.editor.setModelMarkers(model, 'ld-lint', []); return; }
    const view = aggregate(model);
    const curPath = currentPath();
    const labelSet = new Set(view.labels.map(l => l.name));
    const bibSet = new Set(view.bib.map(b => b.key));
    const hasBib = bibSet.size > 0;
    const markers = [];
    const warn = (r, line, msg) => markers.push({ severity: monacoRef.MarkerSeverity.Warning, message: msg, startLineNumber: line, endLineNumber: line, startColumn: r.start + 1, endColumn: r.end + 1, source: 'NeoLeaf' });

    for (const r of scanModel(model)) {
      if (/[\\#*]/.test(r.name)) continue;                 // dynamic names or \nocite{*}
      if (r.kind === 'ref' && !labelSet.has(r.name)) warn(r, r.line, T('Label "{0}" not found in any project file', r.name));
      else if (r.kind === 'cite' && hasBib && !bibSet.has(r.name)) warn(r, r.line, T('Reference "{0}" is not in any .bib file of the project', r.name));
      else if ((r.kind === 'input' || r.kind === 'image' || r.kind === 'bibfile' || r.kind === 'bibres')) {
        if (!resolveFile(r.kind, r.name, curPath, view.graphicsPaths)) {
          const msg = r.kind === 'image' ? 'Image "{0}" not found in the project' : r.kind === 'input' ? 'File "{0}" not found in the project' : 'Bibliography "{0}" not found in the project';
          warn(r, r.line, T(msg, r.name));
        }
      }
    }
    monacoRef.editor.setModelMarkers(model, 'ld-lint', markers);
  }

  // ================================================================== Monaco registration

  function register(monaco) {
    monacoRef = monaco;

    monaco.languages.registerCompletionItemProvider('latex', {
      triggerCharacters: ['\\', '{', ',', '[', '/'],
      provideCompletionItems(model, position) {
        let suggestions = [];
        try { suggestions = complete(model, position); } catch (e) { console.warn('autocomplete:', e); }
        return { suggestions };
      }
    });

    // hover tooltip: details of the reference, label or file; and known commands
    const docs = {};
    COMMANDS.forEach(([n, , d]) => { docs['\\' + n] = d; });
    monaco.languages.registerHoverProvider('latex', {
      provideHover(model, position) {
        const view = aggregate(model);
        const curPath = currentPath();
        const items = scanLine(model.getLineContent(position.lineNumber));
        const col0 = position.column - 1;
        const hit = items.find(i => col0 >= i.start && col0 <= i.end);
        if (hit) {
          const md = hoverFor(hit, view, curPath);
          if (md) return { range: new monaco.Range(position.lineNumber, hit.start + 1, position.lineNumber, hit.end + 1), contents: [{ value: md }] };
        }
        const w = model.getWordAtPosition(position);
        if (w && w.word.startsWith('\\')) {
          const name = w.word.replace(/\*$/, '');
          const macro = view.macros.find(m => '\\' + m.name === name);
          const doc = macro ? T('Project command: `{0}` ({1})', macro.body, macro.path + ':' + macro.line) : null;
          if (doc) return { range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn), contents: [{ value: '**`' + w.word + '`**' }, { value: doc }] };
        }
        return null;
      }
    });

    // Ctrl+click: go to the label, the reference, the file or the image
    monaco.languages.registerLinkProvider('latex', {
      provideLinks(model) {
        const view = aggregate(model);
        const curPath = currentPath();
        const links = [];
        for (const r of scanModel(model)) {
          const t = targetFor(r, view, curPath);
          if (!t) continue;
          links.push({
            range: new monaco.Range(r.line, r.start + 1, r.line, r.end + 1),
            url: monaco.Uri.parse('ldgo:' + encodeURIComponent(t.path) + '?line=' + t.line),
            tooltip: T('Ctrl+click to open {0}', t.path + (t.line > 1 ? ':' + t.line : ''))
          });
        }
        return { links };
      }
    });
    if (monaco.editor.registerLinkOpener) {
      monaco.editor.registerLinkOpener({
        open(uri) {
          if (uri.scheme !== 'ldgo') return false;
          const line = parseInt((/line=(\d+)/.exec(uri.query) || [])[1] || '1', 10);
          goTo(decodeURIComponent(uri.path), line);
          return true;
        }
      });
    }
  }

  function attach(editor2) {
    attached = editor2;
    refreshIndex(true);
    loadTexmfNames();
    editor2.onDidChangeModelContent(lintSoon);
    editor2.onDidChangeModel(lintSoon);
    // keeps the index up to date: when switching files, after compiling and from time to time
    window.addEventListener('collab-synced', () => { refreshIndex(false); lintSoon(); });
    window.addEventListener('tree-refreshed', () => { refreshIndex(true); loadTexmfNames(); });
    setInterval(() => { if (document.visibilityState === 'visible') refreshIndex(false); }, 60000);
  }

  LD.smart = { register, attach, refreshIndex, complete, lint, goTo, aggregate, parseBib, parseTex, scanLine, argContext, state };
})();
