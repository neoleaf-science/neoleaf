// Editor toolbar (LaTeX and Markdown): undo and redo, text style, bold and italic, math,
// symbols, link, comment, label and reference, citation, image, table and list. Every change goes through the editor itself (executeEdits and
// Monaco snippets), so undo (Ctrl+Z) and live editing keep working. Only shown for LaTeX and Markdown files.
(function () {
  'use strict';

  const tr = t => (window.T ? window.T(t) : t);
  const HIDE_KEY = 'ld-toolbar-hidden';
  const IMG_RE = /\.(png|jpe?g|gif|svg|webp|pdf)$/i;
  const IMG_DIRS = ['images', 'imagens', 'img', 'figures', 'figuras', 'fig'];
  const BLOCKED = /^\.(git|neoleaf)(\/|$)/;

  let bar = null, groupsBox = null, moreBtn = null, morePop = null, pop = null, groups = [], toggleBtn = null;

  const lang = () => (typeof editor !== 'undefined' && editor && editor.getModel() ? editor.getModel().getLanguageId() : '');
  const isTex = () => lang() === 'latex';
  const isMd = () => lang() === 'markdown';
  const supported = () => isTex() || isMd();
  const hidden = () => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch (_) { return false; } };

  // ------------------------------------------------------------ editing through the editor
  // Writes the text as a Monaco snippet: `‹1:default›` and `‹1›` are the cursor stops; the rest is literal (backslash, $ and } escaped).
  const SNIP = src => src.replace(/[\\$}]/g, m => '\\' + m).replace(/‹(\d+)(?::([^›]*))?›/g, (m, n, d) => (d !== undefined ? '${' + n + ':' + d + '}' : '${' + n + '}')).replace(/‹0›/g, '$0');

  function snippet(src) {
    editor.focus();
    const c = editor.getContribution && editor.getContribution('snippetController2');
    const text = SNIP(src);
    if (c && c.insert) c.insert(text);
    else editor.executeEdits('toolbar', [{ range: editor.getSelection(), text: src.replace(/‹\d+(?::([^›]*))?›/g, (m, d) => d || ''), forceMoveMarkers: true }]);
  }
  const selected = () => { const s = editor.getSelection(); return s && !s.isEmpty() ? editor.getModel().getValueInRange(s) : ''; };

  // wraps the selection (or a sample passage); if already wrapped, unwraps
  function wrap(before, after, ph) {
    editor.focus();
    const sel = editor.getSelection(), model = editor.getModel(), text = selected();
    if (text && text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
      editor.executeEdits('toolbar', [{ range: sel, text: text.slice(before.length, text.length - after.length), forceMoveMarkers: true }]);
      return;
    }
    // the selection is between the markers (as it is left after applying): removes the markers
    const a = sel.getStartPosition(), b = sel.getEndPosition();
    if (a.column - before.length >= 1 && !before.includes('\n') && !after.includes('\n')) {
      const bR = new monaco.Range(a.lineNumber, a.column - before.length, a.lineNumber, a.column), aR = new monaco.Range(b.lineNumber, b.column, b.lineNumber, b.column + after.length);
      if (model.getValueInRange(bR) === before && model.getValueInRange(aR) === after) { editor.executeEdits('toolbar', [{ range: aR, text: '' }, { range: bR, text: '' }]); return; }
    }
    snippet(before + '‹1:' + (text || ph || '') + '›' + after);
  }

  const lineRange = n => { const m = editor.getModel(); return new monaco.Range(n, 1, n, m.getLineMaxColumn(n)); };
  function selectedLines() {
    const s = editor.getSelection();
    return { from: s.startLineNumber, to: s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber };
  }

  // ------------------------------------------------------------ floating menus
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function openPop(anchor, build, cls) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'ed-pop ' + (cls || '');
    build(pop);
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, vw = window.innerWidth;
    pop.style.left = Math.max(6, Math.min(r.left, vw - w - 6)) + 'px';
    pop.style.top = (r.bottom + 4) + 'px';
    return pop;
  }
  document.addEventListener('mousedown', e => { if (pop && !e.target.closest('.ed-pop') && !e.target.closest('.ed-btn')) closePop(); if (morePop && !e.target.closest('.ed-pop') && !e.target.closest('#ed-more')) closeMore(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); closeMore(); } });
  window.addEventListener('resize', () => { closePop(); fit(); });

  const item = (label, fn, hint) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ed-item';
    const l = document.createElement('span'); l.textContent = label; b.append(l);
    if (hint) { const h = document.createElement('code'); h.textContent = hint; b.append(h); }
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => { closePop(); closeMore(); fn(); });
    return b;
  };
  const menu = (anchor, items) => openPop(anchor, p => items.forEach(it => { if (it === '-') { const s = document.createElement('div'); s.className = 'ed-sep'; p.append(s); } else p.append(item(...it)); }), 'ed-menu');

  // ------------------------------------------------------------ project: labels, keys and images
  async function projectTexts() { try { return (await Project.texts()).files || []; } catch (_) { return []; } }

  async function labelsOfProject() {
    const out = [], seen = new Set();
    const cur = (typeof currentFileId === 'string' ? currentFileId : '');
    for (const f of await projectTexts()) {
      if (!/\.(tex|ltx)$/i.test(f.path)) continue;
      const text = f.path === cur ? editor.getValue() : f.text;
      for (const m of String(text || '').matchAll(/\\label\{([^}\n]+)\}/g)) if (!seen.has(m[1])) { seen.add(m[1]); out.push({ key: m[1], hint: f.path }); }
    }
    return out.slice(0, 600);
  }
  async function citeKeysOfProject() {
    const out = [], seen = new Set();
    for (const f of await projectTexts()) {
      if (!/\.bib$/i.test(f.path)) continue;
      const text = String(f.text || '');
      const re = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
      const marks = [];
      let m;
      while ((m = re.exec(text))) if (!['comment', 'string', 'preamble'].includes(m[1].toLowerCase())) marks.push({ key: m[2], at: m.index });
      marks.forEach((mk, i) => {
        if (seen.has(mk.key)) return;
        seen.add(mk.key);
        const body = text.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : text.length);
        const t = /\btitle\s*=\s*[{"]+\s*([^}"\n]*)/i.exec(body), y = /\byear\s*=\s*[{"]?\s*(\d{4})/i.exec(body);
        out.push({ key: mk.key, hint: ((t ? t[1].trim() : '') + (y ? ' (' + y[1] + ')' : '')).slice(0, 90) });
      });
    }
    return out.slice(0, 800);
  }

  // filterable list to pick a label or a key
  function picker(anchor, title, loader, onPick, emptyMsg) {
    openPop(anchor, p => {
      const head = document.createElement('div'); head.className = 'ed-pop-title'; head.textContent = title;
      const filter = document.createElement('input'); filter.type = 'search'; filter.className = 'form-control ed-filter'; filter.placeholder = tr('Filter...');
      const list = document.createElement('div'); list.className = 'ed-list'; list.textContent = tr('Loading...');
      p.append(head, filter, list);
      let all = [];
      const draw = () => {
        const q = filter.value.trim().toLowerCase();
        list.textContent = '';
        const rows = all.filter(x => !q || x.key.toLowerCase().includes(q) || (x.hint || '').toLowerCase().includes(q)).slice(0, 80);
        if (!rows.length) { const e = document.createElement('div'); e.className = 'ed-empty'; e.textContent = all.length ? tr('Nothing found.') : emptyMsg; list.append(e); return; }
        rows.forEach(r => { const b = item(r.key, () => onPick(r.key), r.hint); b.classList.add('ed-row'); list.append(b); });
      };
      filter.addEventListener('input', draw);
      loader().then(r => { all = r; draw(); }).catch(() => { list.textContent = emptyMsg; });
      setTimeout(() => filter.focus(), 0);
    }, 'ed-picker');
  }

  // ------------------------------------------------------------ actions
  const HEADINGS = [['chapter', 'Chapter'], ['section', 'Section'], ['subsection', 'Subsection'], ['subsubsection', 'Subsubsection'], ['paragraph', 'Paragraph']];
  const HEAD_RE = /^(\s*)\\(chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\{(.*)\}\s*$/;

  function setHeading(cmd) {
    editor.focus();
    const model = editor.getModel(), { from, to } = selectedLines();
    if (isMd()) {
      const level = { chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, normal: 0 }[cmd];
      const edits = [];
      for (let n = from; n <= to; n++) {
        const line = model.getLineContent(n), m = /^(\s*)#{1,6}\s*(.*)$/.exec(line), body = m ? m[2] : line.trimStart(), ind = m ? m[1] : (/^\s*/.exec(line) || [''])[0];
        edits.push({ range: lineRange(n), text: level ? ind + '#'.repeat(level) + ' ' + body : ind + body });
      }
      editor.executeEdits('toolbar', edits);
      return;
    }
    const text = selected();
    if (cmd !== 'normal' && text && from === to) { snippet('\\' + cmd + '{‹1:' + text + '›}'); return; }
    const edits = [];
    for (let n = from; n <= to; n++) {
      const line = model.getLineContent(n), m = HEAD_RE.exec(line);
      if (cmd === 'normal') { if (m) edits.push({ range: lineRange(n), text: m[1] + m[3] }); continue; }
      if (!line.trim()) { snippet('\\' + cmd + '{‹1:Title›}'); return; }
      const inner = m ? m[3] : line.trim(), ind = m ? m[1] : (/^\s*/.exec(line) || [''])[0];
      edits.push({ range: lineRange(n), text: ind + '\\' + cmd + '{' + inner + '}' });
    }
    if (edits.length) editor.executeEdits('toolbar', edits);
  }

  const styleMenu = a => menu(a, [
    [tr('Normal text'), () => setHeading('normal')], '-',
    ...HEADINGS.map(([c, n]) => [tr(n), () => setHeading(c), isMd() ? '' : '\\' + c]), '-',
    ...(isTex() ? [
      [tr('Underline'), () => wrap('\\underline{', '}', 'text'), '\\underline'], [tr('Emphasized'), () => wrap('\\emph{', '}', 'text'), '\\emph'],
      [tr('Monospace'), () => wrap('\\texttt{', '}', 'text'), '\\texttt'], [tr('Small caps'), () => wrap('\\textsc{', '}', 'text'), '\\textsc'],
      [tr('Footnote'), () => wrap('\\footnote{', '}', 'nota'), '\\footnote'], '-',
      [tr('Small text'), () => wrap('{\\small ', '}', 'text'), '\\small'], [tr('Large text'), () => wrap('{\\large ', '}', 'text'), '\\large'], [tr('Very large text'), () => wrap('{\\Large ', '}', 'text'), '\\Large'],
    ] : [
      [tr('Code'), () => wrap('`', '`', 'code'), '`'], [tr('Strikethrough'), () => wrap('~~', '~~', 'text'), '~~'], [tr('Citation'), () => setQuote()],
    ]),
  ]);
  function setQuote() { editor.focus(); const m = editor.getModel(), { from, to } = selectedLines(); const e = []; for (let n = from; n <= to; n++) e.push({ range: lineRange(n), text: '> ' + m.getLineContent(n).replace(/^>\s?/, '') }); editor.executeEdits('toolbar', e); }

  const bold = () => (isMd() ? wrap('**', '**', 'text') : wrap('\\textbf{', '}', 'text'));
  const italic = () => (isMd() ? wrap('*', '*', 'text') : wrap('\\textit{', '}', 'text'));

  const mathMenu = a => menu(a, isMd() ? [
    [tr('Inline formula'), () => wrap('$', '$', 'x^2'), '$ $'], [tr('Display formula'), () => wrap('$$\n', '\n$$', 'x^2'), '$$ $$'],
  ] : [
    [tr('Inline formula'), () => wrap('$', '$', 'x^2'), '$ $'], [tr('Display formula'), () => wrap('\\[ ', ' \\]', 'x^2'), '\\[ \\]'], '-',
    [tr('Numbered equation'), () => snippet('\\begin{equation}\n\t‹1:' + (selected() || 'E = mc^2') + '›\n\t\\label{eq:‹2:label›}\n\\end{equation}'), 'equation'],
    [tr('Aligned equations'), () => snippet('\\begin{align}\n\t‹1:a› &= ‹2:b› \\\\\n\t‹3:c› &= ‹4:d›\n\\end{align}'), 'align'],
    [tr('Fraction'), () => snippet('\\frac{‹1:a›}{‹2:b›}'), '\\frac'], [tr('Square root'), () => snippet('\\sqrt{‹1:x›}'), '\\sqrt'],
  ]);

  // symbols: each carries the LaTeX command and the character (in Markdown the character is inserted)
  const SYMS = {
    'Greek': [['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['δ', '\\delta'], ['ε', '\\epsilon'], ['ζ', '\\zeta'], ['η', '\\eta'], ['θ', '\\theta'], ['ι', '\\iota'], ['κ', '\\kappa'], ['λ', '\\lambda'], ['μ', '\\mu'],
      ['ν', '\\nu'], ['ξ', '\\xi'], ['π', '\\pi'], ['ρ', '\\rho'], ['σ', '\\sigma'], ['τ', '\\tau'], ['φ', '\\phi'], ['χ', '\\chi'], ['ψ', '\\psi'], ['ω', '\\omega'],
      ['Γ', '\\Gamma'], ['Δ', '\\Delta'], ['Θ', '\\Theta'], ['Λ', '\\Lambda'], ['Ξ', '\\Xi'], ['Π', '\\Pi'], ['Σ', '\\Sigma'], ['Φ', '\\Phi'], ['Ψ', '\\Psi'], ['Ω', '\\Omega']],
    'Operators': [['±', '\\pm'], ['∓', '\\mp'], ['×', '\\times'], ['÷', '\\div'], ['·', '\\cdot'], ['∗', '\\ast'], ['∑', '\\sum'], ['∏', '\\prod'], ['∫', '\\int'], ['∮', '\\oint'], ['∂', '\\partial'], ['∇', '\\nabla'],
      ['√', '\\sqrt{}'], ['∞', '\\infty'], ['∪', '\\cup'], ['∩', '\\cap'], ['∘', '\\circ'], ['⊕', '\\oplus'], ['⊗', '\\otimes'], ['…', '\\ldots']],
    'Relations': [['≤', '\\leq'], ['≥', '\\geq'], ['≠', '\\neq'], ['≈', '\\approx'], ['≡', '\\equiv'], ['∼', '\\sim'], ['≃', '\\simeq'], ['≪', '\\ll'], ['≫', '\\gg'], ['∈', '\\in'], ['∉', '\\notin'],
      ['⊂', '\\subset'], ['⊆', '\\subseteq'], ['⊃', '\\supset'], ['⊇', '\\supseteq'], ['∝', '\\propto'], ['∥', '\\parallel'], ['⊥', '\\perp']],
    'Arrows': [['→', '\\to'], ['←', '\\leftarrow'], ['↔', '\\leftrightarrow'], ['⇒', '\\Rightarrow'], ['⇐', '\\Leftarrow'], ['⇔', '\\Leftrightarrow'], ['↦', '\\mapsto'], ['↑', '\\uparrow'], ['↓', '\\downarrow'], ['⟶', '\\longrightarrow']],
    'Other symbols': [['∀', '\\forall'], ['∃', '\\exists'], ['¬', '\\neg'], ['∧', '\\wedge'], ['∨', '\\vee'], ['∅', '\\emptyset'], ['ℝ', '\\mathbb{R}'], ['ℕ', '\\mathbb{N}'], ['ℤ', '\\mathbb{Z}'], ['ℚ', '\\mathbb{Q}'],
      ['ℂ', '\\mathbb{C}'], ['°', '^\\circ'], ['′', "'"], ['ℓ', '\\ell'], ['ℏ', '\\hbar'], ['†', '\\dagger'], ['§', '\\S'], ['¶', '\\P'], ['©', '\\copyright'], ['€', '\\euro']],
  };
  function insertSymbol(ch, tex) {
    editor.focus();
    if (isMd()) { editor.executeEdits('toolbar', [{ range: editor.getSelection(), text: ch, forceMoveMarkers: true }]); return; }
    if (tex.endsWith('{}')) { snippet(tex.slice(0, -1) + '‹1›}'); return; }
    editor.executeEdits('toolbar', [{ range: editor.getSelection(), text: tex, forceMoveMarkers: true }]);
  }
  function symbolsPop(anchor) {
    openPop(anchor, p => {
      const tabs = document.createElement('div'); tabs.className = 'ed-tabs';
      const grid = document.createElement('div'); grid.className = 'ed-grid';
      const show = name => {
        [...tabs.children].forEach(t => t.classList.toggle('on', t.dataset.n === name));
        grid.textContent = '';
        SYMS[name].forEach(([ch, tex]) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'ed-sym'; b.textContent = ch; b.title = isMd() ? ch : tex;
          b.addEventListener('mousedown', e => e.preventDefault());
          b.addEventListener('click', () => { insertSymbol(ch, tex); });
          grid.append(b);
        });
      };
      Object.keys(SYMS).forEach(n => { const t = document.createElement('button'); t.type = 'button'; t.className = 'ed-tab'; t.dataset.n = n; t.textContent = tr(n); t.addEventListener('mousedown', e => e.preventDefault()); t.addEventListener('click', () => show(n)); tabs.append(t); });
      p.append(tabs, grid);
      show('Greek');
    }, 'ed-symbols');
  }

  const linkMenu = a => menu(a, isMd()
    ? [[tr('Link'), () => snippet('[‹1:' + (selected() || 'text') + '›](‹2:https://›)'), '[text](url)']]
    : [[tr('Link with text'), () => snippet('\\href{‹1:https://›}{‹2:' + (selected() || 'text') + '›}'), '\\href'], [tr('Address as text'), () => snippet('\\url{‹1:' + (selected() || 'https://') + '›}'), '\\url']]);

  const commentBtn = () => { if (window.Comments && Comments.startComment) Comments.startComment('comment'); };

  const refMenu = a => menu(a, [
    [tr('Define a label'), () => snippet('\\label{‹1:label›}'), '\\label'], '-',
    [tr('Reference a label...'), () => picker(a, tr('Project labels'), labelsOfProject, k => snippet('\\ref{' + k + '}‹0›'), tr('No \\label found in the project.')), '\\ref'],
    [tr('Reference an equation...'), () => picker(a, tr('Project labels'), labelsOfProject, k => snippet('\\eqref{' + k + '}‹0›'), tr('No \\label found in the project.')), '\\eqref'],
    [tr('Reference the page...'), () => picker(a, tr('Project labels'), labelsOfProject, k => snippet('\\pageref{' + k + '}‹0›'), tr('No \\label found in the project.')), '\\pageref'],
  ]);

  const citeMenu = a => menu(a, [
    [tr('Cite a reference from the .bib...'), () => picker(a, tr('Project references'), citeKeysOfProject, k => snippet('\\cite{' + k + '}‹0›'), tr('No .bib entry found in the project.')), '\\cite'],
    [tr('Cite in the text (author, year)...'), () => picker(a, tr('Project references'), citeKeysOfProject, k => snippet('\\citet{' + k + '}‹0›'), tr('No .bib entry found in the project.')), '\\citet'],
    [tr('Cite in parentheses...'), () => picker(a, tr('Project references'), citeKeysOfProject, k => snippet('\\citep{' + k + '}‹0›'), tr('No .bib entry found in the project.')), '\\citep'], '-',
    [tr('Search papers to cite...'), () => { if (window.References) References.open(); }],
  ]);

  // ---- image
  async function listProject() { try { return await BrowserGit.listFiles(); } catch (_) { return []; } }
  async function imageDir() {
    const all = await listProject();
    const dirs = all.filter(f => f.is_folder).map(f => f.path);
    for (const d of IMG_DIRS) { const hit = dirs.find(x => x.toLowerCase() === d); if (hit) return hit; }
    const withImgs = all.find(f => !f.is_folder && /\.(png|jpe?g|gif|svg|webp)$/i.test(f.name) && f.path.includes('/'));
    return withImgs ? withImgs.path.slice(0, withImgs.path.lastIndexOf('/')) : 'images';
  }
  async function ensureGraphicx() {
    const files = await projectTexts();
    if (files.some(f => /\\usepackage(\[[^\]]*\])?\{[^}]*graphicx/.test(String(f.text || '')))) return;
    const model = editor.getModel();
    const hit = model.findMatches('\\\\documentclass', false, true, false, null, false)[0];
    if (hit) {
      const n = hit.range.startLineNumber;
      editor.executeEdits('toolbar', [{ range: new monaco.Range(n + 1, 1, n + 1, 1), text: '\\usepackage{graphicx}\n' }]);
      flash(tr('I added \\usepackage{graphicx} to the preamble.'));
    } else flash(tr('Remember to include \\usepackage{graphicx} in the document preamble.'));
  }
  async function insertImage(path) {
    editor.focus();
    if (isMd()) { snippet('![‹1:description›](' + path + ')'); return; }
    await ensureGraphicx();
    const base = path.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    snippet('\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{' + path + '}\n\t\\caption{‹1:Caption›}\n\t\\label{fig:‹2:' + base + '›}\n\\end{figure}');
  }
  async function uploadImage(file) {
    if (!file) return;
    const dir = await imageDir();
    const clean = file.name.replace(/[^A-Za-z0-9._-]+/g, '_');
    const all = await listProject();
    const taken = new Set(all.map(f => f.path));
    let name = clean, i = 1;
    while (taken.has(dir + '/' + name)) { const dot = clean.lastIndexOf('.'); name = (dot > 0 ? clean.slice(0, dot) : clean) + '-' + (++i) + (dot > 0 ? clean.slice(dot) : ''); }
    await BrowserGit.writeFile(dir + '/' + name, new Uint8Array(await file.arrayBuffer()));
    if (window.FT && FT.refresh) await FT.refresh();
    flash(tr('Image saved to {0}.').replace('{0}', dir + '/' + name));
    await insertImage(dir + '/' + name);
  }
  function imagePop(anchor) {
    openPop(anchor, p => {
      const head = document.createElement('div'); head.className = 'ed-pop-title'; head.textContent = tr('Project images');
      const up = document.createElement('button'); up.type = 'button'; up.className = 'btn ed-upload'; up.textContent = '⬆ ' + tr('Upload image...');
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*,.pdf'; input.style.display = 'none'; input.id = 'ed-image-file';
      up.addEventListener('mousedown', e => e.preventDefault());
      up.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => { const f = input.files && input.files[0]; closePop(); try { await uploadImage(f); } catch (e) { flash(tr('Could not upload the image: {0}').replace('{0}', e.message || String(e))); } });
      const filter = document.createElement('input'); filter.type = 'search'; filter.className = 'form-control ed-filter'; filter.placeholder = tr('Filter...');
      const list = document.createElement('div'); list.className = 'ed-list'; list.textContent = tr('Loading...');
      p.append(head, up, input, filter, list);
      let all = [];
      const draw = () => {
        const q = filter.value.trim().toLowerCase();
        list.textContent = '';
        const rows = all.filter(f => !q || f.path.toLowerCase().includes(q)).slice(0, 60);
        if (!rows.length) { const e = document.createElement('div'); e.className = 'ed-empty'; e.textContent = all.length ? tr('Nothing found.') : tr('No image in the project yet: upload one.'); list.append(e); return; }
        rows.forEach(f => { const b = item(f.path, () => insertImage(f.path), ''); b.classList.add('ed-row'); b.dataset.path = f.path; list.append(b); });
      };
      filter.addEventListener('input', draw);
      listProject().then(r => { all = r.filter(f => !f.is_folder && IMG_RE.test(f.name) && !BLOCKED.test(f.path)); draw(); });
    }, 'ed-picker');
  }

  // ---- table
  function tableInsert(rows, cols) {
    editor.focus();
    if (isMd()) {
      const head = '| ' + Array.from({ length: cols }, (_, i) => (i ? 'Column ' + (i + 1) : '‹1:Column 1›')).join(' | ') + ' |';
      const sep = '|' + ' --- |'.repeat(cols);
      const body = Array.from({ length: rows - 1 }, () => '| ' + Array(cols).fill('').join(' | ') + ' |');
      snippet([head, sep, ...body].join('\n') + '\n');
      return;
    }
    const spec = 'c'.repeat(cols);
    const row = (first, stop) => '\t\t' + Array.from({ length: cols }, (_, i) => (i === 0 ? first : '')).join(' & ') + ' \\\\';
    const head = '\t\t' + Array.from({ length: cols }, (_, i) => (i === 0 ? '‹3:Column 1›' : 'Column ' + (i + 1))).join(' & ') + ' \\\\';
    const body = Array.from({ length: Math.max(rows - 1, 0) }, (_, r) => '\t\t' + Array.from({ length: cols }, (_, i) => (i === 0 ? '‹' + (r + 4) + '›' : '')).join(' & ') + ' \\\\');
    snippet(['\\begin{table}[htbp]', '\t\\centering', '\t\\caption{‹1:Caption›}', '\t\\label{tab:‹2:label›}', '\t\\begin{tabular}{' + spec + '}', '\t\t\\hline', head, '\t\t\\hline', ...body, '\t\t\\hline', '\t\\end{tabular}', '\\end{table}'].join('\n'));
  }
  function tablePop(anchor) {
    openPop(anchor, p => {
      const MAX = 8;
      const label = document.createElement('div'); label.className = 'ed-pop-title'; label.textContent = tr('Choose the table size');
      const grid = document.createElement('div'); grid.className = 'ed-tgrid'; grid.style.gridTemplateColumns = 'repeat(' + MAX + ', 22px)';
      const cells = [];
      const mark = (r, c) => { cells.forEach(x => x.el.classList.toggle('on', x.r <= r && x.c <= c)); label.textContent = r + ' × ' + c + ' ' + tr('(rows × columns)'); };
      for (let r = 1; r <= MAX; r++) for (let c = 1; c <= MAX; c++) {
        const el = document.createElement('button'); el.type = 'button'; el.className = 'ed-tcell'; el.dataset.r = r; el.dataset.c = c;
        el.addEventListener('mousedown', e => e.preventDefault());
        el.addEventListener('mouseenter', () => mark(r, c));
        el.addEventListener('click', () => { closePop(); tableInsert(r, c); });
        cells.push({ el, r, c }); grid.append(el);
      }
      p.append(label, grid);
    }, 'ed-table');
  }

  // ---- list
  function listInsert(kind) {
    editor.focus();
    const model = editor.getModel(), { from, to } = selectedLines();
    const multi = !editor.getSelection().isEmpty() && model.getValueInRange(editor.getSelection()).trim().length > 0;
    if (isMd()) {
      if (!multi) { snippet(kind === 'enumerate' ? '1. ‹1:item›\n2. \n3. ' : '- ‹1:item›\n- \n- '); return; }
      const e = []; let k = 1;
      for (let n = from; n <= to; n++) { const t = model.getLineContent(n); if (t.trim()) e.push({ range: lineRange(n), text: (kind === 'enumerate' ? (k++) + '. ' : '- ') + t.replace(/^\s*(?:[-*]|\d+\.)\s+/, '') }); }
      editor.executeEdits('toolbar', e);
      return;
    }
    const env = kind;
    if (!multi) { snippet('\\begin{' + env + '}\n\t' + (env === 'description' ? '\\item[‹1:term›] ‹2:description›\n\t\\item[] \n\t\\item[] ' : '\\item ‹1:item›\n\t\\item \n\t\\item ') + '\n\\end{' + env + '}'); return; }
    const items = [];
    for (let n = from; n <= to; n++) { const t = model.getLineContent(n).trim(); if (t) items.push('\t\\item ' + t); }
    editor.executeEdits('toolbar', [{ range: new monaco.Range(from, 1, to, model.getLineMaxColumn(to)), text: '\\begin{' + env + '}\n' + items.join('\n') + '\n\\end{' + env + '}' }]);
  }
  const listMenu = a => menu(a, [[tr('Bulleted list'), () => listInsert('itemize'), isMd() ? '- item' : 'itemize'], [tr('Numbered list'), () => listInsert('enumerate'), isMd() ? '1. item' : 'enumerate'],
    ...(isMd() ? [] : [[tr('Description list'), () => listInsert('description'), 'description']])]);

  // ------------------------------------------------------------ quick notice
  function flash(msg) {
    const d = document.createElement('div');
    d.className = 'refs-toast'; d.textContent = msg;
    document.body.append(d);
    setTimeout(() => d.remove(), 3500);
  }

  // ------------------------------------------------------------ the bar
  const ICON = {
    undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
    redo: 'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z',
    style: 'M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z',
    link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
    comment: 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-3 9h-4v4h-2v-4H7V9h4V5h2v4h4v2z',
    ref: 'M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z',
    cite: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
    image: 'M19 7v2.99s-1.99.01-2 0V7h-3s.01-1.99 0-2h3V2h2v3h3v2h-3zm-3 4V8h-3V5H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8h-3zM5 19l3-4 2 3 3-4 4 5H5z',
    table: 'M3 3v18h18V3H3zm8 16H5v-6h6v6zm0-8H5V5h6v6zm8 8h-6v-6h6v6zm0-8h-6V5h6v6z',
    list: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
    more: 'M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  };
  const svg = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('fill', 'currentColor'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };

  // `def`: [id, icon (SVG path) or text, hint, action (button), menu?, available?]
  const DEFS = () => [
    [['undo', ICON.undo, tr('Undo (Ctrl+Z)'), () => { editor.focus(); editor.trigger('toolbar', 'undo', null); }], ['redo', ICON.redo, tr('Redo (Ctrl+Y)'), () => { editor.focus(); editor.trigger('toolbar', 'redo', null); }]],
    [['style', ICON.style, tr('Text style'), styleMenu, true]],
    [['bold', 'B', tr('Bold (Ctrl+B)'), bold], ['italic', 'I', tr('Italic (Ctrl+I)'), italic]],
    [['math', '∑', tr('Math'), mathMenu, true], ['symbols', 'Ω', tr('Symbols'), symbolsPop, true]],
    [['link', ICON.link, tr('Link'), linkMenu, true], ['comment', ICON.comment, tr('Comment on the selected passage'), commentBtn], ['ref', ICON.ref, tr('Label and reference'), refMenu, true, 'tex'], ['cite', ICON.cite, tr('Citation'), citeMenu, true, 'tex']],
    [['image', ICON.image, tr('Insert image'), imagePop, true], ['table', ICON.table, tr('Insert table'), tablePop, true], ['list', ICON.list, tr('List'), listMenu, true]],
  ];

  function build() {
    bar = document.getElementById('editor-toolbar');
    if (!bar) return false;
    bar.textContent = '';
    groups = [];
    groupsBox = document.createElement('div'); groupsBox.className = 'ed-groups';
    DEFS().forEach(g => {
      const box = document.createElement('div'); box.className = 'ed-group';
      g.forEach(([id, icon, tip, fn, dropdown, only]) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ed-btn'; b.id = 'ed-' + id; b.title = tip; b.setAttribute('aria-label', tip);
        if (icon.length <= 2) { const t = document.createElement('span'); t.className = 'ed-glyph ' + (id === 'italic' ? 'it' : ''); t.textContent = icon; b.append(t); } else b.append(svg(icon));
        if (dropdown) { const c = document.createElement('span'); c.className = 'ed-caret'; c.textContent = '▾'; b.append(c); }
        if (only) b.dataset.only = only;
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', () => { if (b.disabled) return; if (dropdown) { if (pop && pop.dataset.owner === id) { closePop(); return; } fn(b); if (pop) pop.dataset.owner = id; } else { closePop(); fn(); } });
        box.append(b);
      });
      groupsBox.append(box);
      groups.push(box);
    });
    moreBtn = document.createElement('button'); moreBtn.type = 'button'; moreBtn.className = 'ed-btn'; moreBtn.id = 'ed-more'; moreBtn.title = tr('More tools'); moreBtn.style.display = 'none'; moreBtn.append(svg(ICON.more));
    moreBtn.addEventListener('mousedown', e => e.preventDefault());
    moreBtn.addEventListener('click', () => { if (morePop) closeMore(); else openMore(); });
    bar.append(groupsBox, moreBtn);
    return true;
  }

  // whatever does not fit the width goes to the "⋯" menu (the removed groups are kept in `holder` until the menu opens)
  const holder = document.createElement('div');
  function openMore() {
    closePop(); closeMore();
    morePop = document.createElement('div'); morePop.className = 'ed-pop ed-more-pop';
    document.body.appendChild(morePop);
    [...holder.children].forEach(g => morePop.append(g));
    const r = moreBtn.getBoundingClientRect();
    morePop.style.top = (r.bottom + 4) + 'px';
    morePop.style.left = Math.max(6, Math.min(r.right - morePop.offsetWidth, window.innerWidth - morePop.offsetWidth - 6)) + 'px';
  }
  function closeMore() {
    if (!morePop) return;
    [...morePop.children].forEach(g => holder.append(g));
    morePop.remove(); morePop = null;
  }
  function fit() {
    if (!bar || !groupsBox) return;
    closeMore();
    [...holder.children].forEach(g => groupsBox.append(g));
    moreBtn.style.display = 'none';
    if (bar.style.display === 'none') return;
    const over = () => groupsBox.scrollWidth > groupsBox.clientWidth + 1;
    if (over()) {
      moreBtn.style.display = '';
      let guard = groups.length;
      while (over() && guard-- > 0 && groupsBox.lastElementChild) holder.prepend(groupsBox.lastElementChild);
    }
  }

  function refresh() {
    if (!bar) return;
    const on = supported() && !hidden();
    bar.style.display = on ? '' : 'none';
    if (toggleBtn) { toggleBtn.style.display = supported() ? '' : 'none'; toggleBtn.classList.toggle('on', !hidden()); }
    if (!on) { closePop(); closeMore(); return; }
    bar.querySelectorAll('[data-only="tex"]').forEach(b => { b.disabled = !isTex(); b.style.opacity = isTex() ? '' : '.35'; });
    fit();
  }

  function init() {
    if (!build()) return;
    toggleBtn = document.getElementById('toolbar-toggle-btn');
    if (toggleBtn) toggleBtn.addEventListener('click', () => { try { localStorage.setItem(HIDE_KEY, hidden() ? '0' : '1'); } catch (_) { /* no storage */ } refresh(); });
    editor.onDidChangeModelLanguage(refresh);
    refresh();
    window.addEventListener('ld-lang-change', () => { build(); refresh(); });
    if (window.ResizeObserver) new ResizeObserver(() => fit()).observe(bar);
  }
  if (typeof editor !== 'undefined' && editor) init(); else window.addEventListener('editor-ready', init, { once: true });

  window.EditorToolbar = { refresh, isVisible: () => !!bar && bar.style.display !== 'none' };
})();
