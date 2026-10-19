// LaTeX completion items (commands, environments, math symbols, snippets) offered by the Monaco editor.
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// Comprehensive LaTeX Completion Items (Commands, Environments, Math Symbols, Snippets)
const LATEX_COMPLETIONS = [
  // Environments with snippet expansion
  {
    label: '\\begin{document}',
    kind: 14, // Snippet
    insertText: '\\begin{document}\n\t$0\n\\end{document}',
    insertTextRules: 4, // InsertAsSnippet
    documentation: 'Document root environment'
  },
  {
    label: '\\begin{equation}',
    kind: 14,
    insertText: '\\begin{equation}\n\t$0\n\\end{equation}',
    insertTextRules: 4,
    documentation: 'Numbered mathematical equation'
  },
  {
    label: '\\begin{align}',
    kind: 14,
    insertText: '\\begin{align}\n\t$1 &= $2 \\\\\n\\end{align}',
    insertTextRules: 4,
    documentation: 'Aligned mathematical equations'
  },
  {
    label: '\\begin{figure}',
    kind: 14,
    insertText: '\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\textwidth]{$1}\n\t\\caption{$2}\n\t\\label{fig:$3}\n\\end{figure}',
    insertTextRules: 4,
    documentation: 'Figure environment with caption and label'
  },
  {
    label: '\\begin{table}',
    kind: 14,
    insertText: '\\begin{table}[htbp]\n\t\\centering\n\t\\caption{$1}\n\t\\label{tab:$2}\n\t\\begin{tabular}{|c|c|}\n\t\t\\hline\n\t\t$3 & $4 \\\\\n\t\t\\hline\n\t\\end{tabular}\n\\end{table}',
    insertTextRules: 4,
    documentation: 'Table environment with tabular grid'
  },
  {
    label: '\\begin{itemize}',
    kind: 14,
    insertText: '\\begin{itemize}\n\t\\item $0\n\\end{itemize}',
    insertTextRules: 4,
    documentation: 'Bulleted list'
  },
  {
    label: '\\begin{enumerate}',
    kind: 14,
    insertText: '\\begin{enumerate}\n\t\\item $0\n\\end{enumerate}',
    insertTextRules: 4,
    documentation: 'Numbered list'
  },

  // Document Structure
  { label: '\\section', kind: 1, insertText: '\\section{$1}', insertTextRules: 4, documentation: 'Top-level section' },
  { label: '\\subsection', kind: 1, insertText: '\\subsection{$1}', insertTextRules: 4, documentation: 'Subsection' },
  { label: '\\subsubsection', kind: 1, insertText: '\\subsubsection{$1}', insertTextRules: 4, documentation: 'Sub-subsection' },
  { label: '\\paragraph', kind: 1, insertText: '\\paragraph{$1}', insertTextRules: 4, documentation: 'Paragraph heading' },
  { label: '\\tableofcontents', kind: 1, insertText: '\\tableofcontents', documentation: 'Generates table of contents' },
  { label: '\\maketitle', kind: 1, insertText: '\\maketitle', documentation: 'Generates title page header' },

  // References & Citations
  { label: '\\cite', kind: 1, insertText: '\\cite{$1}', insertTextRules: 4, documentation: 'Bibliographic citation' },
  { label: '\\ref', kind: 1, insertText: '\\ref{$1}', insertTextRules: 4, documentation: 'Cross-reference label' },
  { label: '\\label', kind: 1, insertText: '\\label{$1}', insertTextRules: 4, documentation: 'Anchor label for referencing' },
  { label: '\\pageref', kind: 1, insertText: '\\pageref{$1}', insertTextRules: 4, documentation: 'Page number reference' },

  // Text Formatting
  { label: '\\textbf', kind: 1, insertText: '\\textbf{$1}', insertTextRules: 4, documentation: 'Bold text' },
  { label: '\\textit', kind: 1, insertText: '\\textit{$1}', insertTextRules: 4, documentation: 'Italic text' },
  { label: '\\underline', kind: 1, insertText: '\\underline{$1}', insertTextRules: 4, documentation: 'Underlined text' },
  { label: '\\emph', kind: 1, insertText: '\\emph{$1}', insertTextRules: 4, documentation: 'Emphasized text' },
  { label: '\\texttt', kind: 1, insertText: '\\texttt{$1}', insertTextRules: 4, documentation: 'Monospace typewriter text' },

  // Math Commands & Symbols
  { label: '\\frac', kind: 14, insertText: '\\frac{$1}{$2}', insertTextRules: 4, documentation: 'Fraction: \\frac{numerator}{denominator}' },
  { label: '\\sqrt', kind: 14, insertText: '\\sqrt{$1}', insertTextRules: 4, documentation: 'Square root' },
  { label: '\\sum', kind: 1, insertText: '\\sum_{$1}^{$2}', insertTextRules: 4, documentation: 'Summation symbol' },
  { label: '\\int', kind: 1, insertText: '\\int_{$1}^{$2}', insertTextRules: 4, documentation: 'Integral symbol' },
  { label: '\\alpha', kind: 9, insertText: '\\alpha', documentation: 'Greek letter alpha (α)' },
  { label: '\\beta', kind: 9, insertText: '\\beta', documentation: 'Greek letter beta (β)' },
  { label: '\\gamma', kind: 9, insertText: '\\gamma', documentation: 'Greek letter gamma (γ)' },
  { label: '\\delta', kind: 9, insertText: '\\delta', documentation: 'Greek letter delta (δ)' },
  { label: '\\epsilon', kind: 9, insertText: '\\epsilon', documentation: 'Greek letter epsilon (ε)' },
  { label: '\\theta', kind: 9, insertText: '\\theta', documentation: 'Greek letter theta (θ)' },
  { label: '\\lambda', kind: 9, insertText: '\\lambda', documentation: 'Greek letter lambda (λ)' },
  { label: '\\sigma', kind: 9, insertText: '\\sigma', documentation: 'Greek letter sigma (σ)' },
  { label: '\\omega', kind: 9, insertText: '\\omega', documentation: 'Greek letter omega (ω)' },
  { label: '\\infty', kind: 9, insertText: '\\infty', documentation: 'Infinity symbol (∞)' },
  { label: '\\partial', kind: 9, insertText: '\\partial', documentation: 'Partial differential (∂)' },
  { label: '\\cdot', kind: 9, insertText: '\\cdot', documentation: 'Centered dot multiplication (·)' },
  { label: '\\times', kind: 9, insertText: '\\times', documentation: 'Times multiplication (×)' },
  { label: '\\leq', kind: 9, insertText: '\\leq', documentation: 'Less than or equal (≤)' },
  { label: '\\geq', kind: 9, insertText: '\\geq', documentation: 'Greater than or equal (≥)' },
  { label: '\\neq', kind: 9, insertText: '\\neq', documentation: 'Not equal (≠)' },
  { label: '\\approx', kind: 9, insertText: '\\approx', documentation: 'Approximately equal (≈)' },
  { label: '\\in', kind: 9, insertText: '\\in', documentation: 'Element of (∈)' },
  { label: '\\forall', kind: 9, insertText: '\\forall', documentation: 'For all (∀)' },
  { label: '\\exists', kind: 9, insertText: '\\exists', documentation: 'There exists (∃)' }
];
