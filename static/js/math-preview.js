// Formula preview: rest the mouse on a formula in a LaTeX file ($...$, \(...\), \[...\], $$...$$ or an equation, align or gather environment) and a small
// panel shows it typeset. KaTeX does the drawing (static/vendor/katex, the same copy as the notebooks); it runs in the page, on the text of the open file.
//
// The text comes from the document, which collaborators can edit, so KaTeX runs with its safe settings (`trust: false`, bounded macro expansion and size):
// a formula cannot link anywhere or make the page spin. The project's own \newcommand, \def and \DeclareMathOperator lines that the formula uses are given
// to KaTeX first, so "\R" or "\norm{x}" show as they will in the PDF. What KaTeX does not know simply shows no panel.
//
// Personal preference (this browser): on by default; "Toggle formula preview" in the editor menu turns it off.
const MATHPREV_QUERY = (function () {
  try {
    const m = document.currentScript && /[?&]v=([^&#]+)/.exec(document.currentScript.src);
    return m ? '?v=' + m[1] : '';
  } catch (_) {
    return '';
  }
})();

(function () {
  'use strict';

  const KEY = 'neoleaf.editor.mathPreview';
  const DELAY_MS = 350;
  const MAX_FORMULA = 4000;     // characters: a longer one is not previewed
  const WINDOW_LINES = 60;      // how far around the mouse the formula is looked for
  // environments that are formulas; KaTeX draws most of them itself, the others are mapped to the closest one it has
  const MATH_ENVS = { equation: 1, 'equation*': 1, displaymath: 1, math: 1, align: 1, 'align*': 1, alignat: 1, 'alignat*': 1, flalign: 1, 'flalign*': 1, gather: 1, 'gather*': 1, multline: 1, 'multline*': 1, eqnarray: 1, 'eqnarray*': 1 };
  // (the numbered forms are shown without their numbers: the panel is for reading the formula, and the numbers would sit on top of it)
  const ENV_MAP = { align: 'align*', alignat: 'alignat*', gather: 'gather*', multline: 'gather*', 'multline*': 'gather*', eqnarray: 'align*', 'eqnarray*': 'align*', flalign: 'align*', 'flalign*': 'align*' };

  let panel = null;
  let timer = null;
  let shown = null;        // { startOffset, endOffset } of the formula on screen
  let katexReady = null;

  const enabled = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (_) { return true; } };
  const setEnabled = on => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {} };

  function loadKatex() {
    if (window.katex) return Promise.resolve(window.katex);
    if (katexReady) return katexReady;
    katexReady = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/static/vendor/katex/katex.min.css' + MATHPREV_QUERY;
      document.head.append(css);
      const js = document.createElement('script');
      js.src = '/static/vendor/katex/katex.min.js' + MATHPREV_QUERY;
      // KaTeX is a UMD file: with the editor's AMD loader (Monaco) on the page it would register itself as a module and leave no `katex` global
      const amd = window.define;
      const restore = () => { if (amd !== undefined) window.define = amd; };
      window.define = undefined;
      js.onload = () => { restore(); window.katex ? resolve(window.katex) : reject(new Error('KaTeX did not load')); };
      js.onerror = () => { restore(); katexReady = null; reject(new Error('KaTeX did not load')); };
      document.head.append(js);
    });
    return katexReady;
  }

  // ------------------------------------------------------------ finding the formula

  // Every formula of `t` (a piece of the file): { start, end, display, source } with offsets in `t`. Comments and escaped characters are skipped.
  function formulas(t) {
    const out = [];
    const n = t.length;
    const isEscaped = i => { let k = 0; while (i - 1 - k >= 0 && t[i - 1 - k] === '\\') k++; return k % 2 === 1; };
    let i = 0;
    while (i < n) {
      const c = t[i];
      if (c === '%' && !isEscaped(i)) { const e = t.indexOf('\n', i); i = e < 0 ? n : e + 1; continue; }
      if (c === '\\') {
        const nx = t[i + 1];
        if (nx === '(' || nx === '[') {
          const close = nx === '(' ? '\\)' : '\\]';
          const e = t.indexOf(close, i + 2);
          if (e > 0) { out.push({ start: i, end: e + 2, display: nx === '[', source: t.slice(i + 2, e) }); i = e + 2; continue; }
        } else if (t.startsWith('\\begin{', i)) {
          const m = /^\\begin\{([A-Za-z]+\*?)\}/.exec(t.slice(i, i + 40));
          if (m && MATH_ENVS[m[1]]) {
            const endTag = '\\end{' + m[1] + '}';
            const e = t.indexOf(endTag, i + m[0].length);
            if (e > 0) {
              const inner = t.slice(i + m[0].length, e);
              const env = ENV_MAP[m[1]] || m[1];
              const bare = env === 'equation' || env === 'equation*' || env === 'displaymath' || env === 'math';
              out.push({ start: i, end: e + endTag.length, display: m[1] !== 'math', source: bare ? inner : `\\begin{${env}}${inner}\\end{${env}}` });
              i = e + endTag.length;
              continue;
            }
          }
        }
        i += 2;
        continue;
      }
      if (c === '$') {
        const double = t[i + 1] === '$';
        const open = double ? 2 : 1;
        let j = i + open;
        let found = -1;
        const blank = /\n[ \t]*\n/y;
        for (; j < n; j++) {
          const d = t[j];
          if (d === '\\') { j++; continue; }
          if (d === '%') { const e = t.indexOf('\n', j); if (e < 0) break; j = e - 1; continue; }
          if (d === '\n') { blank.lastIndex = j; if (blank.test(t)) break; } // a blank line ends a paragraph: no formula crosses it
          if (d === '$' && (!double || t[j + 1] === '$')) { found = j; break; }
        }
        if (found > 0) { out.push({ start: i, end: found + open, display: double, source: t.slice(i + open, found) }); i = found + open; continue; }
        i += open;
        continue;
      }
      i++;
    }
    return out;
  }

  // the formula under `offset` in the model, or null
  function formulaAt(model, position) {
    // the paragraph of the mouse (a formula never crosses a blank line, and starting at its edge keeps a lone "$" from pairing up the wrong way)
    const blank = n => !model.getLineContent(n).trim();
    let first = position.lineNumber;
    while (first > 1 && position.lineNumber - first < WINDOW_LINES && !blank(first - 1)) first--;
    let last = position.lineNumber;
    while (last < model.getLineCount() && last - position.lineNumber < WINDOW_LINES && !blank(last + 1)) last++;
    const from = model.getOffsetAt({ lineNumber: first, column: 1 });
    const to = model.getOffsetAt({ lineNumber: last, column: model.getLineMaxColumn(last) });
    const text = model.getValue().slice(from, to);
    const at = model.getOffsetAt(position) - from;
    const hit = formulas(text).find(f => at >= f.start && at <= f.end);
    return hit ? { startOffset: from + hit.start, endOffset: from + hit.end, display: hit.display, source: hit.source } : null;
  }

  // ------------------------------------------------------------ the project's own commands

  // One KaTeX-readable definition from a line of the project (\newcommand{\R}{\mathbb{R}} becomes \def\R{\mathbb{R}}), or ''
  function definition(raw) {
    const line = String(raw || '').trim();
    let m = /^\\(?:re|provide)?newcommand\*?\s*\{?\s*(\\[A-Za-z]+)\s*\}?\s*(?:\[(\d)\])?\s*(\{[\s\S]*\})\s*$/.exec(line);
    if (m) {
      if (!balanced(m[3])) return '';
      const args = m[2] ? Array.from({ length: +m[2] }, (_, k) => '#' + (k + 1)).join('') : '';
      return `\\def${m[1]}${args}${m[3]}`;
    }
    m = /^\\DeclareMathOperator(\*?)\s*\{(\\[A-Za-z]+)\}\s*\{([^{}]*)\}\s*$/.exec(line);
    if (m) return `\\def${m[2]}{\\operatorname${m[1]}{${m[3]}}}`;
    m = /^\\[gex]?def\s*\\[A-Za-z]+(?:#\d)*\{[\s\S]*\}\s*$/.exec(line);
    return m && balanced(line.slice(line.indexOf('{'))) ? line.replace(/^\\[gex]def/, '\\def') : '';
  }
  function balanced(s) {
    let d = 0;
    for (let i = 0; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '{') d++; else if (s[i] === '}' && --d < 0) return false; }
    return d === 0;
  }

  // the definitions that `source` uses (and those they use in turn)
  function preambleFor(source) {
    let defs = [];
    try {
      const view = window.LD && LD.smart && editor.getModel() ? LD.smart.aggregate(editor.getModel()) : null;
      defs = ((view && view.macros) || []).map(m => ({ name: m.name, text: definition(m.body) })).filter(d => d.text);
    } catch (_) {}
    if (!defs.length) return '';
    const used = new Set();
    let scope = source;
    for (let round = 0; round < 3; round++) {
      let grew = false;
      for (const d of defs) {
        if (!used.has(d.name) && new RegExp('\\\\' + d.name + '(?![A-Za-z])').test(scope)) { used.add(d.name); scope += ' ' + d.text; grew = true; }
      }
      if (!grew) break;
    }
    return defs.filter(d => used.has(d.name)).map(d => d.text).join('\n') + '\n';
  }

  // ------------------------------------------------------------ the panel

  function ensurePanel() {
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'ld-mathprev';
      panel.setAttribute('role', 'tooltip');
      panel.style.display = 'none';
      document.body.append(panel);
    }
    return panel;
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    shown = null;
    if (panel) panel.style.display = 'none';
  }

  function clean(source) {
    return source.replace(/\\label\s*\{[^{}]*\}/g, '').replace(/\\(?:nonumber|notag)\b/g, '').trim();
  }

  async function render(hit) {
    const source = clean(hit.source);
    if (!source || source.length > MAX_FORMULA) return null;
    const katex = await loadKatex();
    const base = { displayMode: hit.display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 30, output: 'html' };
    const pre = preambleFor(source);
    for (const text of pre ? [pre + source, source] : [source]) {
      try { return katex.renderToString(text, base); } catch (_) { /* try without the project's commands */ }
    }
    return null;
  }

  async function show(model, hit, anchor) {
    const html = await render(hit);
    // the mouse may have moved on, or the text changed, while KaTeX loaded
    if (!html || !shown || shown.startOffset !== hit.startOffset || model.isDisposed()) return;
    const p = ensurePanel();
    p.innerHTML = html; // KaTeX output of a formula it parsed with trust off: markup it generated itself, not text of the document
    p.style.display = 'block';
    const box = editor.getDomNode().getBoundingClientRect();
    const pos = editor.getScrolledVisiblePosition(anchor);
    if (!pos) { hide(); return; }
    const height = p.offsetHeight;
    const lineHeight = pos.height || 20;
    let top = box.top + pos.top + lineHeight + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, box.top + pos.top - height - 6);
    let left = box.left + Math.max(pos.left, 0);
    left = Math.min(left, window.innerWidth - p.offsetWidth - 12);
    p.style.top = Math.max(8, top) + 'px';
    p.style.left = Math.max(8, left) + 'px';
  }

  function onMove(e) {
    if (!enabled() || !e.target || !e.target.position || e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) { hide(); return; }
    const model = editor.getModel();
    if (!model || model.getLanguageId() !== 'latex') { hide(); return; }
    const position = e.target.position;
    if (shown) {
      const off = model.getOffsetAt(position);
      if (off >= shown.startOffset && off <= shown.endOffset) return; // still on the same formula
      hide();
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      let hit = null;
      try { hit = formulaAt(model, position); } catch (_) {}
      if (!hit) return;
      shown = { startOffset: hit.startOffset, endOffset: hit.endOffset };
      show(model, hit, model.getPositionAt(hit.startOffset));
    }, DELAY_MS);
  }

  window.addEventListener('editor-ready', function () {
    if (typeof editor === 'undefined' || !editor || !window.monaco) return;
    editor.onMouseMove(onMove);
    editor.onMouseLeave(hide);
    editor.onDidScrollChange(hide);
    editor.onDidChangeModelContent(hide);
    editor.onDidChangeModel(hide);
    editor.onKeyDown(hide);
    editor.onDidBlurEditorText(hide);
    editor.addAction({
      id: 'ld.mathPreview',
      label: T('Toggle formula preview'),
      contextMenuGroupId: 'modification',
      contextMenuOrder: 2.7,
      run: function () {
        setEnabled(!enabled());
        hide();
        if (typeof updateStatus === 'function') updateStatus('saved', enabled() ? T('Formula preview: on') : T('Formula preview: off'));
      }
    });
  });

  window.MathPreview = { formulas, formulaAt: (model, position) => formulaAt(model, position), definition, preambleFor, render, enabled, setEnabled, hide };
})();
