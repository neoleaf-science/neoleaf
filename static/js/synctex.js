// SyncTeX format reader (.synctex): links PDF positions to code lines and vice versa.
// Coordinates returned in "bp" (1/72 in), from the top left corner of the page, as PDF.js uses.
(function () {
  const LEAF = new Set(['k', 'g', '$', 'x', 'h', 'v']);

  function parse(text) {
    const m = { inputs: new Map(), sheets: [], scale: 1 };
    let unit = 1, mag = 1000, xo = 0, yo = 0;
    let sheet = null;
    const stack = [];
    let inContent = false;
    const rec = /^([\[\(hvkg$x])(\d+),(\d+)(?:,\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/;
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!inContent) {
        let k;
        if ((k = /^Input:(\d+):(.*)$/.exec(line))) m.inputs.set(+k[1], k[2]);
        else if ((k = /^Unit:(-?\d+)/.exec(line))) unit = +k[1];
        else if ((k = /^Magnification:(-?\d+)/.exec(line))) mag = +k[1];
        else if ((k = /^X Offset:(-?\d+)/.exec(line))) xo = +k[1];
        else if ((k = /^Y Offset:(-?\d+)/.exec(line))) yo = +k[1];
        else if (line.startsWith('Content:')) { inContent = true; m.scale = (unit * (mag / 1000) / 65536) * (72 / 72.27); }
        continue;
      }
      const c = line[0];
      if (c === 'I' && line.startsWith('Input:')) {          // new files are also declared in the middle of the content
        const k = /^Input:(\d+):(.*)$/.exec(line);
        if (k) m.inputs.set(+k[1], k[2]);
        continue;
      }
      if (c === '{') { sheet = { page: parseInt(line.slice(1), 10), recs: [] }; m.sheets.push(sheet); stack.length = 0; continue; }
      if (c === '}') { sheet = null; stack.length = 0; continue; }
      if (c === 'P') break;                          // "Postamble:"
      if (!sheet) continue;
      if (c === ']' || c === ')') { stack.pop(); continue; }
      const k = rec.exec(line);
      if (!k) continue;
      const s = m.scale;
      const r = { t: k[1], tag: +k[2], line: +k[3], x: (+k[4] + xo) * s, y: (+k[5] + yo) * s, w: k[6] !== undefined ? +k[6] * s : 0, h: k[7] !== undefined ? +k[7] * s : 0, d: k[8] !== undefined ? +k[8] * s : 0, parent: stack.length ? stack[stack.length - 1] : -1 };
      const idx = sheet.recs.push(r) - 1;
      if (c === '[' || c === '(') stack.push(idx);
    }
    return m;
  }

  const area = r => Math.max(1, r.w) * Math.max(1, r.h + r.d);

  // (page, x, y) in bp -> most likely { tag, line }
  function pdfToSource(m, page, x, y) {
    const sheet = m.sheets.find(s => s.page === page);
    if (!sheet) return null;
    const recs = sheet.recs;
    let best = -1, bestArea = Infinity;
    recs.forEach((r, i) => {
      if (r.t !== '(' || r.line <= 0) return;
      if (x >= r.x - 1 && x <= r.x + r.w + 1 && y >= r.y - r.h - 1 && y <= r.y + r.d + 1) {
        const a = area(r);
        if (a < bestArea) { best = i; bestArea = a; }
      }
    });
    if (best < 0) {            // click outside any line: the text line closest vertically
      let dist = Infinity;
      recs.forEach((r, i) => {
        if (r.t !== '(' || r.line <= 0) return;
        const d = Math.min(Math.abs(y - (r.y - r.h)), Math.abs(y - (r.y + r.d)));
        if (d < dist) { dist = d; best = i; }
      });
      if (best < 0) return null;
    }
    // within the line, the item (space, kern, formula, box) closest horizontally
    let leaf = null, ld = Infinity;
    recs.forEach(r => {
      if (r.parent !== best || !LEAF.has(r.t) || r.line <= 0) return;
      const d = x < r.x ? r.x - x : (x > r.x + r.w ? x - (r.x + r.w) : 0);
      if (d < ld) { ld = d; leaf = r; }
    });
    const pick = leaf || recs[best];
    return { tag: pick.tag, line: pick.line };
  }

  // (file tag, line) -> { page, x, y, w, h } (rectangle of the text line) or null
  function sourceToPdf(m, tag, line) {
    let found = null, diff = Infinity;
    for (const sheet of m.sheets) {
      for (const r of sheet.recs) {
        if (r.tag !== tag || r.line <= 0) continue;
        const d = Math.abs(r.line - line) + (r.line < line ? 0.5 : 0);
        if (d < diff) { diff = d; found = { sheet, r }; }
        if (d === 0) break;
      }
      if (diff === 0) break;
    }
    if (!found) return null;
    const { sheet, r } = found;
    let box = r;
    if (r.t !== '(' && r.t !== '[') {
      let p = r.parent;
      while (p >= 0 && sheet.recs[p].t !== '(') p = sheet.recs[p].parent;
      if (p >= 0) box = sheet.recs[p];
    }
    if (box.t === '(' || box.t === '[') return { page: sheet.page, x: box.x, y: box.y - box.h, w: box.w, h: box.h + box.d, exact: diff === 0 };
    return { page: sheet.page, x: r.x, y: r.y - 10, w: Math.max(r.w, 40), h: 12, exact: diff === 0 };
  }

  const norm = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

  // project path (e.g. "chapters/intro.tex") to the SyncTeX tag, comparing the ends of the paths
  function tagForPath(m, path) {
    const want = norm(path);
    let best = null, bestLen = -1;
    for (const [tag, p] of m.inputs) {
      const n = norm(p);
      if (n === want || n.endsWith('/' + want)) { if (n.length > bestLen) { best = tag; bestLen = n.length; } }
    }
    return best;
  }

  function pathForTag(m, tag, projectPaths) {
    const n = norm(m.inputs.get(tag) || '');
    if (!n) return null;
    let best = null;
    for (const p of projectPaths) {
      const q = norm(p);
      if ((n === q || n.endsWith('/' + q)) && (!best || q.length > best.length)) best = p;
    }
    return best;
  }

  // ------------------------------------------------------------ checking a result against the text that was clicked
  // SyncTeX says where TeX was reading when it made a box. For text that a class or a package prints (a title, the authors, a heading) that is the macro that
  // prints it (\maketitle, or a line inside the .cls), not the place where the person wrote the words. So the words under the click are looked for in the
  // project's .tex files, and the SyncTeX line is only kept when it really contains them.

  // a word the way it is compared: no ligatures or accents, lower case
  const plainWord = w => String(w).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // the words of a piece of text, in order (what the PDF shows: letters and digits)
  function wordsOf(text) {
    return (String(text).match(/[\p{L}\p{N}]+/gu) || []).map(plainWord);
  }

  // the words of LaTeX source with their line: comments and command names are left out, the text in their arguments stays
  function tokenize(text) {
    const out = [];
    const lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      for (let k = 0; k < line.length; k++) {
        if (line[k] === '\\') { k++; continue; }
        if (line[k] === '%') { line = line.slice(0, k); break; }
      }
      line = line.replace(/\\[A-Za-z@]+\*?/g, ' ').replace(/\\./g, ' ');
      for (const w of wordsOf(line)) out.push({ w: w, line: i + 1 });
    }
    return out;
  }

  // does the text around `line` (the line and `radius` lines on each side) contain the word? One line is the slack SyncTeX needs (a space or a kern belongs to the line
  // where it was made); more would accept a \maketitle two lines below a \title as the place of the title
  function lineHasWord(text, line, word, radius) {
    return nearestLineWithWord(text, line, word, radius) !== null;
  }

  // the line, within `radius` of `line`, where the word is written, the nearest to `line` (the earlier one on a tie); null when it is not written there.
  // For a paragraph SyncTeX often gives the blank line that ended it, or the \end{document} after it: the word itself is on the line above.
  function nearestLineWithWord(text, line, word, radius) {
    const want = plainWord(word);
    const r = radius === undefined ? 1 : radius;
    let best = null;
    for (const t of tokenize(text)) {
      if (t.w !== want || Math.abs(t.line - line) > r) continue;
      if (best === null || Math.abs(t.line - line) < Math.abs(best - line) || (Math.abs(t.line - line) === Math.abs(best - line) && t.line < best)) best = t.line;
    }
    return best;
  }

  // every place where the words of `want` follow each other in `toks`: { start, end, at } with the line of the first word, of the last, and of the word `focus`
  function phraseMatches(toks, want, focus) {
    const out = [];
    const f = Math.min(Math.max(0, focus || 0), want.length - 1);
    for (let i = 0; i + want.length <= toks.length; i++) {
      let ok = true;
      for (let j = 0; j < want.length; j++) if (toks[i + j].w !== want[j]) { ok = false; break; }
      if (ok) out.push({ start: toks[i].line, end: toks[i + want.length - 1].line, at: toks[i + f].line });
    }
    return out;
  }

  /** The line where the clicked word is written, given the SyncTeX line: `needle` is the phrase around the word, `focus` the index of the word in it. Only a match that
   *  touches the lines within `radius` of `line` counts, and the nearest wins (the earlier one on a tie). A phrase tells places apart where a word like "the" cannot.
   *  Returns the line, or null. */
  function nearestLineWithPhrase(text, line, needle, focus, radius) {
    const want = needle.map(plainWord).filter(Boolean);
    if (!want.length) return null;
    const r = radius === undefined ? 1 : radius;
    let best = null;
    for (const m of phraseMatches(tokenize(text), want, focus)) {
      const d = line >= m.start && line <= m.end ? 0 : Math.min(Math.abs(m.start - line), Math.abs(m.end - line));
      if (d > r) continue;
      if (best === null || Math.abs(m.at - line) < Math.abs(best - line) || (Math.abs(m.at - line) === Math.abs(best - line) && m.at < best)) best = m.at;
    }
    return best;
  }

  /** Where the words of `needle` (an array, in order) are written: files = [{ path, text }]. `focus` is the index of the clicked word in it (the answer is its line).
   *  `prefer` ({ path, line }) is the SyncTeX answer: the nearest match to it wins, then a match in `mainPath`. A single short word is not enough to tell places apart,
   *  so it must be 4 letters or more and appear only once. Returns { path, line } or null. */
  function findPhrase(files, needle, prefer, mainPath, focus) {
    const want = needle.map(plainWord).filter(Boolean);
    if (!want.length) return null;
    const found = [];
    for (const f of files) for (const m of phraseMatches(tokenize(f.text), want, focus)) found.push({ path: f.path, line: m.at });
    if (!found.length) return null;
    if (want.length === 1 && (want[0].length < 4 || found.length > 1)) return null;
    const score = m => (prefer && m.path === prefer.path ? Math.abs(m.line - prefer.line) : 100000) + (m.path === mainPath ? 0 : 0.5);
    found.sort((a, b) => score(a) - score(b));
    return found[0];
  }

  const api = { parse, pdfToSource, sourceToPdf, tagForPath, pathForTag, wordsOf, tokenize, lineHasWord, nearestLineWithWord, nearestLineWithPhrase, findPhrase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.SyncTeX = api;
})();
