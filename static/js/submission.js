// Prepare for submission: checks the project the way a journal or arXiv will meet it, and builds a clean ZIP of only the files the document needs.
// Everything runs in the browser, on the project's files and on the log of the last compilation; nothing is sent anywhere.
//
//   analyze()    follows \input, \include, \includegraphics, \bibliography, local .sty/.cls... from the main file, and lists what the document uses,
//                what is missing, what is not defined (references, citations), and what usually gets a submission rejected (see the codes below)
//   buildZip()   the ZIP: the files that are used (comments taken out of the .tex files if asked), the .bbl of the last compilation, nothing else
//
// The checks read the text with comments and verbatim material masked, so a commented \input or a listing that shows a command does not count.
(function () {
  'use strict';

  const TEXT = ['tex', 'sty', 'cls', 'clo', 'bib', 'bst', 'bbl', 'def', 'cfg', 'ldf', 'fd', 'bbx', 'cbx', 'lbx', 'tikz', 'pgf', 'ltx'];
  const PARSED = ['tex', 'sty', 'cls', 'clo', 'def', 'cfg', 'ldf', 'fd', 'bbx', 'cbx', 'lbx', 'tikz', 'pgf', 'ltx'];
  const IMAGE_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'eps', 'mps', 'svg', 'gif'];
  const OUTPUT_EXT = ['aux', 'log', 'out', 'toc', 'lof', 'lot', 'fls', 'fdb_latexmk', 'blg', 'nav', 'snm', 'vrb', 'bcf', 'synctex', 'gz', 'idx', 'ind', 'ilg', 'glo', 'gls', 'run.xml', 'pdf'];
  const STANDARD_STYLES = new Set(['plain', 'unsrt', 'alpha', 'abbrv', 'plainnat', 'abbrvnat', 'unsrtnat', 'ieeetr', 'ieeetran', 'IEEEtran', 'siam', 'acm', 'apalike', 'apacite', 'chicago', 'amsplain', 'amsalpha', 'spbasic', 'spmpsci', 'splncs04', 'elsarticle-num', 'elsarticle-harv', 'elsarticle-num-names', 'ACM-Reference-Format', 'agu', 'agsm', 'dcu', 'named', 'kluwer', 'phiaip', 'siam', 'jmr', 'aaai-named', 'ieeetr', 'plainurl', 'unsrturl', 'abbrvurl', 'alphaurl']);
  // packages that do not work where papers are built (no shell-escape, no Inkscape, no Python)
  const PROBLEM_PACKAGES = { minted: 'needs shell-escape', svg: 'needs Inkscape', pythontex: 'needs Python', sagetex: 'needs Sage', gnuplottex: 'needs shell-escape' };
  const DRAFT_PACKAGES = { todonotes: 1, fixme: 1, showkeys: 1, lineno: 1 };

  const ext = n => { const m = /\.([A-Za-z0-9]+)$/.exec(n); return m ? m[1].toLowerCase() : ''; };
  const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const join = (dir, rel) => {
    const out = dir ? dir.split('/') : [];
    for (const seg of String(rel).split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }
    return out.join('/');
  };

  // ------------------------------------------------------------ reading the text

  // `text` with the comments (and the contents of verbatim material) replaced by spaces: the offsets and the lines stay the same
  function mask(text) {
    const blank = s => s.replace(/[^\n]/g, ' ');
    let t = String(text);
    // verbatim-like environments first (a % inside them is not a comment)
    t = t.replace(/\\begin\{(verbatim\*?|lstlisting|minted|Verbatim\*?|comment)\}[\s\S]*?\\end\{\1\}/g, blank);
    t = t.replace(/\\verb\*?([^A-Za-z\s*])[^\n]*?\1/g, blank);
    // % to the end of the line (not \%)
    return t.split('\n').map(line => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') { i++; continue; }
        if (line[i] === '%') return line.slice(0, i) + ' '.repeat(line.length - i);
      }
      return line;
    }).join('\n');
  }

  function lineStarts(text) {
    const s = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') s.push(i + 1);
    return s;
  }
  function lineAt(starts, offset) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  }

  const names = list => String(list).split(',').map(s => s.trim()).filter(Boolean);

  // every match of `re` (group 1 is the argument) as { value, line }
  function find(masked, starts, re) {
    const out = [];
    for (const m of masked.matchAll(re)) out.push({ value: m[1], line: lineAt(starts, m.index), all: m });
    return out;
  }

  // ------------------------------------------------------------ the analysis

  /** files: [{ path, text|null, size }]; main: path; bbl: text or null (the .bbl of the last compilation); log: text of the last compilation or null.
   *  Returns { used: Set, unused: [path], problems: [{ level, code, message, file, line, args }] }. */
  function analyze({ files, main, bbl, log }) {
    const byPath = new Map(files.map(f => [f.path, f]));
    const lower = new Map(files.map(f => [f.path.toLowerCase(), f.path]));
    const problems = [];
    const add = (level, code, file, line, args) => problems.push({ level, code, file: file || '', line: line || 0, args: args || [] });
    const used = new Set();
    const base = dirOf(main);

    if (!byPath.has(main)) { add('error', 'main-missing', main, 0, [main]); return { used, unused: files.map(f => f.path), problems }; }

    // the file a name stands for: exact, then with the extensions tried; from the folder of the main file (where LaTeX runs), else from the root of the project
    // or from the folder of the file that asks. A name that matches only in another case is reported as such (it works here and not where files are case sensitive).
    function resolve(name, exts, from, dirs) {
      const roots = [];
      for (const d of dirs && dirs.length ? dirs : ['']) roots.push(join(base, join(d, name)));
      roots.push(join('', name), join(dirOf(from), name));
      const tries = [];
      for (const r of roots) { tries.push(r); for (const e of exts) tries.push(r + '.' + e); }
      for (const t of tries) if (byPath.has(t)) return { path: t };
      for (const t of tries) { const hit = lower.get(t.toLowerCase()); if (hit) return { path: hit, caseOnly: t }; }
      return null;
    }
    // "../x" that climbs out of the project
    const escapes = rel => { let d = 0; for (const seg of String(rel).split('/')) { if (seg === '..') { if (--d < 0) return true; } else if (seg && seg !== '.') d++; } return false; };

    const labels = new Map();     // name -> { file, line }
    const refs = [];              // { name, file, line }
    const cites = [];
    const bibKeys = new Map();    // key -> { file, line }
    const bibItems = new Set();   // \bibitem keys (a hand-made list)
    let usesBibliography = false;
    let hasIncludeOnly = false;
    const graphicsDirs = [];
    const queue = [main];
    const seen = new Set([main]);
    used.add(main);

    function useFile(path) {
      if (!used.has(path)) used.add(path);
      if (PARSED.includes(ext(path)) && !seen.has(path)) { seen.add(path); queue.push(path); }
    }

    function reach(value, exts, from, line, dirs, label) {
      const name = String(value).trim();
      if (!name) return;
      if (/[#\\]/.test(name)) return;                     // built by a macro: cannot be followed
      if (/^(?:[A-Za-z]:|\/|~)/.test(name)) { add('error', 'absolute-path', from, line, [name]); return; }
      if (escapes(name)) { add('error', 'absolute-path', from, line, [name]); return; }
      const hit = resolve(name, exts, from, dirs);
      if (!hit) { add('error', 'file-missing', from, line, [name]); return; }
      if (hit.caseOnly) add('error', 'case-mismatch', from, line, [name, hit.path]);
      useFile(hit.path);
    }

    while (queue.length) {
      const path = queue.shift();
      const f = byPath.get(path);
      if (!f || typeof f.text !== 'string') continue;
      const text = f.text;
      const masked = mask(text);
      const starts = lineStarts(text);

      // \graphicspath{{a/}{b/}} comes before the figures that use it
      for (const g of find(masked, starts, /\\graphicspath\s*\{((?:\s*\{[^{}]*\}\s*)+)\}/g)) for (const d of g.value.matchAll(/\{([^{}]*)\}/g)) graphicsDirs.push(d[1].replace(/\/+$/, ''));

      for (const m of find(masked, starts, /\\(?:input|include|subfile|InputIfFileExists)\s*\{([^{}]*)\}/g)) reach(m.value, ['tex'], path, m.line);
      for (const m of find(masked, starts, /\\import\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g)) reach(join(m.value, m.all[2]), ['tex'], path, m.line);
      for (const m of find(masked, starts, /\\includegraphics\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)) reach(m.value, IMAGE_EXT, path, m.line, graphicsDirs);
      for (const m of find(masked, starts, /\\(?:lstinputlisting|verbatiminput|VerbatimInput)\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)) reach(m.value, [], path, m.line);
      for (const m of find(masked, starts, /\\inputminted\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}\s*\{([^{}]*)\}/g)) reach(m.value, [], path, m.line);
      for (const m of find(masked, starts, /\\(?:includepdf|pgfplotstableread|csvautotabular|csvreader)\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)) reach(m.value, ['pdf', 'csv', 'dat'], path, m.line);
      for (const m of find(masked, starts, /\\bibliography\s*\{([^{}]*)\}/g)) { usesBibliography = true; for (const n of names(m.value)) reach(n, ['bib'], path, m.line); }
      for (const m of find(masked, starts, /\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)) { usesBibliography = true; reach(m.value, [], path, m.line); }
      for (const m of find(masked, starts, /\\bibliographystyle\s*\{([^{}]*)\}/g)) {
        const local = resolve(m.value.trim(), ['bst'], path);
        if (local) useFile(local.path);
        else if (!STANDARD_STYLES.has(m.value.trim()) && !/^[a-z]+$/.test(m.value.trim())) add('warning', 'style-unknown', path, m.line, [m.value.trim()]);
      }
      for (const m of find(masked, starts, /\\(?:documentclass|usepackage|RequirePackage|LoadClass|usetikzlibrary)\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)) {
        const isClass = /^\\(?:documentclass|LoadClass)/.test(m.all[0]);
        for (const n of names(m.value)) {
          const local = resolve(n, [isClass ? 'cls' : 'sty'], path);
          if (local && !local.caseOnly && ['sty', 'cls'].includes(ext(local.path))) useFile(local.path);
          if (PROBLEM_PACKAGES[n]) add('warning', 'package-problem', path, m.line, [n, PROBLEM_PACKAGES[n]]);
          if (DRAFT_PACKAGES[n]) add('warning', 'draft-package', path, m.line, [n]);
        }
      }
      if (/\\includeonly\s*\{/.test(masked)) { hasIncludeOnly = true; add('warning', 'includeonly', path, lineAt(starts, masked.search(/\\includeonly\s*\{/)), []); }
      for (const m of find(masked, starts, /\\(todo|listoftodos)\b/g)) add('warning', 'todo', path, m.line, [m.value]);

      for (const m of find(masked, starts, /\\label\s*\{([^{}]*)\}/g)) {
        if (/[#\\]/.test(m.value)) continue;
        if (labels.has(m.value)) add('warning', 'label-duplicate', path, m.line, [m.value, labels.get(m.value).file + ':' + labels.get(m.value).line]);
        else labels.set(m.value, { file: path, line: m.line });
      }
      for (const m of find(masked, starts, /\\(?:ref|eqref|pageref|autoref|nameref|vref|vpageref|cref|Cref|cpageref|labelcref|subref|zcref)\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)) for (const n of names(m.value)) if (!/[#\\*]/.test(n)) refs.push({ name: n, file: path, line: m.line });
      for (const m of find(masked, starts, /\\(?:[Cc]ite|[Pp]arencite|[Tt]extcite|[Aa]utocite|[Ff]ootcite|[Ss]martcite|[Ss]upercite|[Ff]ullcite|[Cc]ites|nocite)[A-Za-z]*\*?\s*(?:\[[^\]]*\]){0,2}\s*\{([^{}]*)\}/g)) for (const n of names(m.value)) if (!/[#\\*]/.test(n)) cites.push({ name: n, file: path, line: m.line });
      for (const m of find(masked, starts, /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)) bibItems.add(m.value.trim());
    }

    // bibliography files that are used: their keys
    for (const p of used) {
      if (ext(p) !== 'bib') continue;
      const t = byPath.get(p).text || '';
      const starts = lineStarts(t);
      for (const m of t.matchAll(/@(?!comment\b|string\b|preamble\b)[A-Za-z]+\s*[{(]\s*([^,\s]+)\s*,/gi)) {
        if (bibKeys.has(m[1])) add('warning', 'bibkey-duplicate', p, lineAt(starts, m.index), [m[1]]);
        else bibKeys.set(m[1], { file: p, line: lineAt(starts, m.index) });
      }
    }
    // a .bbl in the project (or from the last compilation) defines the keys too
    const bblText = bbl || (byPath.get(join(base, main.split('/').pop().replace(/\.[^.]+$/, '') + '.bbl')) || {}).text || '';
    for (const m of String(bblText).matchAll(/\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)) bibItems.add(m[1].trim());
    for (const m of String(bblText).matchAll(/\\entry\{([^}]*)\}/g)) bibItems.add(m[1].trim());

    for (const r of refs) if (!labels.has(r.name)) add('error', 'ref-undefined', r.file, r.line, [r.name]);
    const haveBib = bibKeys.size > 0 || bibItems.size > 0;
    if (cites.length && !haveBib) add('error', 'cite-no-bibliography', main, cites[0].line, []);
    else for (const c of cites) if (!bibKeys.has(c.name) && !bibItems.has(c.name)) add('error', 'cite-undefined', c.file, c.line, [c.name]);

    // the .bbl: journals and arXiv ask for it when the bibliography comes from BibTeX or biber
    const bblPath = join(base, main.split('/').pop().replace(/\.[^.]+$/, '') + '.bbl');
    const bblInProject = byPath.has(bblPath);
    if (usesBibliography && !bbl && !bblInProject) add('warning', 'bbl-missing', main, 0, []);

    // the files themselves
    let total = 0;
    for (const f of files) {
      if (!used.has(f.path)) continue;
      total += f.size || 0;
      if (!/^[A-Za-z0-9_.+=,@\-\/]+$/.test(f.path)) add('warning', 'file-name', f.path, 0, [f.path]);
      if ((f.size || 0) > 10 * 1024 * 1024) add('warning', 'file-large', f.path, 0, [(f.size / 1048576).toFixed(1)]);
    }
    if (total > 50 * 1024 * 1024) add('warning', 'total-large', '', 0, [(total / 1048576).toFixed(0)]);
    const lowerNames = new Map();
    for (const p of used) { const k = p.toLowerCase(); if (lowerNames.has(k)) add('error', 'name-clash', p, 0, [lowerNames.get(k), p]); else lowerNames.set(k, p); }

    // what the last compilation said about the PDF
    if (typeof log === 'string' && log) {
      if (/! LaTeX Error|Fatal error occurred|Emergency stop/.test(log)) add('error', 'pdf-failed', '', 0, []);
      const refW = new Set(), citeW = new Set();
      for (const m of log.matchAll(/LaTeX Warning: Reference `([^']+)' on page \d+ undefined/g)) refW.add(m[1]);
      for (const m of log.matchAll(/(?:LaTeX|Package natbib) Warning: Citation `([^']+)' on page \d+ undefined/g)) citeW.add(m[1]);
      if (refW.size) add('error', 'pdf-refs', '', 0, [[...refW].slice(0, 6).join(', ') + (refW.size > 6 ? ', ...' : '')]);
      if (citeW.size) add('error', 'pdf-cites', '', 0, [[...citeW].slice(0, 6).join(', ') + (citeW.size > 6 ? ', ...' : '')]);
      if (/Label\(s\) may have changed\. Rerun/.test(log)) add('warning', 'pdf-rerun', '', 0, []);
      const glyphs = new Set();
      for (const m of log.matchAll(/Missing character: There is no (.{1,12}?) in font/g)) glyphs.add(m[1]);
      if (glyphs.size) add('warning', 'pdf-glyphs', '', 0, [[...glyphs].slice(0, 6).join(' ')]);
      let overfull = 0;
      for (const m of log.matchAll(/Overfull \\hbox \(([\d.]+)pt too wide\)/g)) if (parseFloat(m[1]) >= 10) overfull++;
      if (overfull) add('info', 'pdf-overfull', '', 0, [String(overfull)]);
    } else {
      add('info', 'pdf-not-checked', '', 0, []);
    }

    // what is not used: it stays out of the ZIP (outputs, hidden files and the like are not worth listing)
    const unused = files.map(f => f.path).filter(p => !used.has(p) && !OUTPUT_EXT.includes(ext(p)) && !/(^|\/)(README(\.md)?|LICENSE[^/]*|\.[^/]*)$/i.test(p));
    const order = { error: 0, warning: 1, info: 2 };
    problems.sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file) || a.line - b.line);
    return { used, unused, problems, bblPath, usesBibliography };
  }

  // ------------------------------------------------------------ taking the comments out

  /** The text of a .tex file without its comments: a line that is only a comment goes, a comment after text becomes a bare % (so a line that ended with
   *  % to join two lines still joins them). Verbatim material, \verb and \% are left alone. */
  function stripComments(text) {
    const guard = [];
    let t = String(text).replace(/\\begin\{(verbatim\*?|lstlisting|minted|Verbatim\*?|comment)\}[\s\S]*?\\end\{\1\}|\\verb\*?([^A-Za-z\s*])[^\n]*?\2/g, m => { guard.push(m); return `\u0000${guard.length - 1}\u0000`; });
    const out = [];
    for (const line of t.split('\n')) {
      let cut = -1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') { i++; continue; }
        if (line[i] === '%') { cut = i; break; }
      }
      if (cut < 0) { out.push(line); continue; }
      const before = line.slice(0, cut);
      if (!before.trim()) continue;            // only a comment: the line goes
      out.push(before + '%');                  // the comment is gone; the % stays, so the end of the line still joins to the next one as before
    }
    t = out.join('\n');
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => guard[+i]);
  }

  // ------------------------------------------------------------ the project

  const MAX_PARSED = 2 * 1024 * 1024;

  /** The project as analyze() wants it. */
  async function gather() {
    const cfg = (typeof projectConfig !== 'undefined' && projectConfig) || {};
    const main = cfg.mainFile || 'main.tex';
    const listed = (await BrowserGit.listFiles()).filter(f => !f.is_folder);
    const files = [];
    for (const f of listed) {
      let text = null;
      if (TEXT.includes(ext(f.path)) && (f.size || 0) <= MAX_PARSED) {
        const live = typeof currentFileId !== 'undefined' && f.path === currentFileId && typeof editor !== 'undefined' && editor;
        text = live ? editor.getValue() : await BrowserGit.readFile(f.path);
      }
      files.push({ path: f.path, size: f.size || 0, text: typeof text === 'string' ? text : null });
    }
    let bbl = null;
    try { const b = await Project.pdf.bbl(); if (b && b.length) bbl = new TextDecoder().decode(b); } catch (_) {}
    const last = window.lastCompileResult;
    const log = last && last.log && (!last.mainFile || last.mainFile === main) ? last.log : null;
    return { files, main, bbl, log };
  }

  // ------------------------------------------------------------ the ZIP

  // the text of a file; the one that is open is read from the editor (it may not be saved yet)
  async function readLive(path) {
    return typeof currentFileId !== 'undefined' && path === currentFileId && typeof editor !== 'undefined' && editor ? editor.getValue() : BrowserGit.readFile(path);
  }

  /** options: { paths: [path], comments: bool (take them out of the .tex files), bbl: { path, text } | null }. Returns { blob, count, bytes }. */
  async function buildZip(options) {
    const enc = new TextEncoder();
    const out = [];
    const taken = new Set();
    if (options.bbl && options.bbl.text) { out.push({ name: options.bbl.path, bytes: enc.encode(options.bbl.text) }); taken.add(options.bbl.path); }
    for (const p of options.paths) {
      if (taken.has(p)) continue;
      taken.add(p);
      if (options.comments && ['tex', 'ltx'].includes(ext(p))) out.push({ name: p, bytes: enc.encode(stripComments(await readLive(p))) });
      else if (TEXT.includes(ext(p))) out.push({ name: p, bytes: enc.encode(await readLive(p)) });
      else out.push({ name: p, bytes: await BrowserGit.readFile(p, 'uint8array') });
    }
    if (!out.length) throw new Error('Nothing to put in the ZIP');
    const bytes = Zip.write(out);
    return { blob: new Blob([bytes], { type: 'application/zip' }), count: out.length, bytes: bytes.length };
  }

  // ------------------------------------------------------------ the window

  const MESSAGES = {
    'main-missing': a => T('The main file {0} is not in the project.', a[0]),
    'file-missing': a => T('File "{0}" is not in the project.', a[0]),
    'case-mismatch': a => T('"{0}" matches "{1}" only when capital letters are ignored: it fails where file names are case sensitive.', a[0], a[1]),
    'absolute-path': a => T('"{0}" points outside the project.', a[0]),
    'ref-undefined': a => T('Reference "{0}" has no \\label.', a[0]),
    'cite-undefined': a => T('Citation "{0}" is not in the bibliography.', a[0]),
    'cite-no-bibliography': () => T('The document cites references but has no bibliography (.bib or \\bibitem).'),
    'label-duplicate': a => T('Label "{0}" is defined twice (also at {1}).', a[0], a[1]),
    'bibkey-duplicate': a => T('Bibliography key "{0}" appears twice.', a[0]),
    'bbl-missing': () => T('The bibliography comes from BibTeX or biber but there is no .bbl: compile the project once, so that the ZIP can include it.'),
    'package-problem': a => T('Package {0} {1}: most submission systems cannot build it.', a[0], a[1]),
    'draft-package': a => T('Package {0} is for drafts: its marks may appear in the final PDF.', a[0]),
    'todo': a => T('\\{0} notes are still in the document.', a[0]),
    'includeonly': () => T('\\includeonly leaves parts of the document out of the build.'),
    'style-unknown': a => T('Bibliography style "{0}" is not in the project and is not a usual one.', a[0]),
    'file-name': a => T('The file name "{0}" has characters that some systems reject (use letters, digits, dots, dashes and underscores).', a[0]),
    'file-large': a => T('The file is {0} MB: very large files are often refused.', a[0]),
    'total-large': a => T('The files add up to {0} MB: some systems accept less.', a[0]),
    'name-clash': a => T('"{0}" and "{1}" differ only in capital letters.', a[0], a[1]),
    'pdf-failed': () => T('The last compilation failed.'),
    'pdf-refs': a => T('The PDF has unresolved references (??): {0}.', a[0]),
    'pdf-cites': a => T('The PDF has unresolved citations: {0}.', a[0]),
    'pdf-rerun': () => T('LaTeX asked for another run: references may be out of date in the PDF.'),
    'pdf-glyphs': a => T('Characters missing in the fonts of the PDF: {0}.', a[0]),
    'pdf-overfull': a => T('{0} lines stick out of the margin by 10 pt or more.', a[0]),
    'pdf-not-checked': () => T('The PDF was not checked: compile the project first, so that what the log says is included.')
  };
  const describe = p => (MESSAGES[p.code] ? MESSAGES[p.code](p.args) : p.code);

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }
  const fmtSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  function goTo(path, line) {
    try {
      if (typeof switchFile === 'function') switchFile(path, path);
      if (line && typeof editor !== 'undefined' && editor) setTimeout(() => { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); editor.focus(); }, 300);
    } catch (_) {}
  }

  async function open() {
    const old = document.getElementById('sub-modal');
    if (old) old.remove();
    const cfg = (typeof projectConfig !== 'undefined' && projectConfig) || {};
    if (/\.typ$/i.test(cfg.mainFile || '')) { alert(T('Preparing for submission works with LaTeX projects.')); return; }
    if (typeof updateStatus === 'function') updateStatus('saving', T('Checking the project...'));
    let input, result;
    try {
      input = await gather();
      result = analyze(input);
    } catch (e) {
      if (typeof updateStatus === 'function') updateStatus('error', T('Could not check the project: {0}', e.message));
      return;
    }
    if (typeof updateStatus === 'function') updateStatus('saved', T('Ready'));
    const sizes = new Map(input.files.map(f => [f.path, f.size]));
    const bblText = input.bbl;
    const checks = new Map();   // path -> checkbox
    const usedList = [...result.used].sort();
    const errors = result.problems.filter(p => p.level === 'error').length;
    const warnings = result.problems.filter(p => p.level === 'warning').length;

    const summary = el('div', { class: 'sub-summary' + (errors ? ' sub-bad' : warnings ? ' sub-warn' : ' sub-ok') },
      errors || warnings ? [errors ? T('{0} errors', errors) : '', warnings ? T('{0} warnings', warnings) : ''].filter(Boolean).join(' · ') : T('No problems found.'));
    const list = el('div', { class: 'sub-problems' });
    const mark = { error: '✖', warning: '▲', info: 'ℹ' };
    for (const p of result.problems) {
      const where = p.file ? el('a', { href: '#', class: 'sub-where', onclick: ev => { ev.preventDefault(); modal.remove(); goTo(p.file, p.line); } }, p.file + (p.line ? ':' + p.line : '')) : null;
      list.append(el('div', { class: 'sub-row sub-' + p.level }, el('span', { class: 'sub-mark' }, mark[p.level]), el('span', { class: 'sub-msg' }, describe(p), where ? ' ' : null, where)));
    }

    const count = el('span', { class: 'sub-count' });
    const refresh = () => {
      let n = 0, size = 0;
      for (const [p, cb] of checks) if (cb.checked) { n++; size += sizes.get(p) || 0; }
      if (bblBox && bblBox.checked) { n++; size += (bblText || '').length; }
      count.textContent = T('{0} files · {1}', n, fmtSize(size));
      download.disabled = n === 0;
    };
    const row = (p, on) => {
      const cb = el('input', { type: 'checkbox', 'data-path': p });
      cb.checked = on;
      cb.addEventListener('change', refresh);
      checks.set(p, cb);
      return el('label', { class: 'sub-file' }, cb, el('span', {}, p), el('span', { class: 'sub-size' }, fmtSize(sizes.get(p) || 0)));
    };
    const fileBox = el('div', { class: 'sub-files' });
    let bblBox = null;
    const bblInProject = result.bblPath && sizes.has(result.bblPath);
    if (bblText && result.usesBibliography) {
      bblBox = el('input', { type: 'checkbox', id: 'sub-bbl' });
      bblBox.checked = true;
      bblBox.addEventListener('change', refresh);
      fileBox.append(el('label', { class: 'sub-file' }, bblBox, el('span', {}, T('{0} (from the last compilation)', result.bblPath)), el('span', { class: 'sub-size' }, fmtSize(bblText.length))));
    }
    for (const p of usedList) if (!(bblBox && p === result.bblPath && bblInProject)) fileBox.append(row(p, true));
    const unusedBox = el('div', { class: 'sub-files' });
    for (const p of result.unused) unusedBox.append(row(p, false));

    const comments = el('input', { type: 'checkbox', id: 'sub-comments' });
    comments.checked = true;
    const download = el('button', { class: 'btn btn-primary', type: 'button', id: 'sub-download', onclick: async () => {
      download.disabled = true;
      try {
        const paths = [...checks].filter(([, cb]) => cb.checked).map(([p]) => p);
        const bbl = bblBox && bblBox.checked ? { path: result.bblPath, text: bblText } : null;
        const zip = await buildZip({ paths, comments: comments.checked, bbl });
        const name = (((typeof projectId !== 'undefined' && projectId) ? projectId.split('__').slice(1).join('__') : 'project').replace(/[^A-Za-z0-9_-]/g, '_') || 'project') + '-submission.zip';
        const url = URL.createObjectURL(zip.blob);
        const a = el('a', { href: url, download: name });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        if (typeof updateStatus === 'function') updateStatus('saved', T('ZIP ready: {0} files · {1}', zip.count, fmtSize(zip.bytes)));
      } catch (e) {
        if (typeof updateStatus === 'function') updateStatus('error', T('Could not build the ZIP: {0}', e.message));
      } finally { refresh(); }
    } }, T('Download ZIP'));

    const modal = el('div', { class: 'modal-backdrop', id: 'sub-modal', style: 'display:flex;' },
      el('div', { class: 'modal-box sub-box' },
        el('h3', { class: 'sub-title' }, T('Prepare for submission')),
        summary,
        errors ? el('p', { class: 'modal-hint' }, T('The errors below are likely to make the submission fail.')) : null,
        list,
        el('h4', { class: 'sub-h' }, T('Files in the ZIP')),
        fileBox,
        result.unused.length ? el('h4', { class: 'sub-h' }, T('Not used by the document (left out)')) : null,
        result.unused.length ? unusedBox : null,
        el('label', { class: 'sub-opt' }, comments, el('span', {}, T('Remove the comments from the .tex files'))),
        el('div', { class: 'sub-foot' }, count, el('span', { style: 'flex:1' }),
          el('button', { class: 'btn', type: 'button', onclick: () => modal.remove() }, T('Close')), download)));
    modal.addEventListener('mousedown', e => { if (e.target === modal) modal.remove(); });
    document.body.append(modal);
    refresh();
  }

  window.Submission = { analyze, stripComments, mask, ext, join, gather, buildZip, open, describe };
})();
