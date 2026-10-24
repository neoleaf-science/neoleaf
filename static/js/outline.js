// Document structure ("Outline" panel): starts from the main file and follows \input, \include and \subfile,
// so it shows the sections of the whole project, in order, even when spread across several files.
(function () {
  const LEVELS = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4 };
  const CMD = /\\(part|chapter|section|subsection|subsubsection|input|include|subfile|includegraphics)(\*?)(?![A-Za-z])/g;

  // ---- ConTeXt (.mkiv, .mkxl, .mkvi, or text with \starttext, \startcomponent...)
  const LEVELS_CTX = { part: 0, chapter: 1, title: 1, section: 2, subject: 2, subsection: 3, subsubject: 3, subsubsection: 4, subsubsubsection: 4, subsubsubject: 4 };
  const CMD_CTX = /\\(startpart|startchapter|starttitle|startsection|startsubject|startsubsection|startsubsubject|startsubsubsection|startsubsubsubsection|startsubsubsubject|part|chapter|title|section|subject|subsection|subsubject|subsubsection|subsubsubsection|subsubsubject|component|product|project|environment|input|externalfigure)(?![A-Za-z@!?])/g;
  const isContextFile = (path, text) => /\.(mkiv|mkxl|mkvi)$/i.test(path) || /\\(?:starttext|startcomponent|startproduct|startproject|startenvironment)(?![A-Za-z])/.test(text || '');

  // ---- Typst (.typ)
  const isTypstPath = path => /\.typ$/i.test(String(path || ''));
  // a path written in a Typst file: relative to that file, or to the project root when it starts with "/"
  function resolveTypst(name, fromPath, files) {
    const parts = name.startsWith('/') ? [] : fromPath.split('/').slice(0, -1);
    for (const seg of name.replace(/^\/+/, '').split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    const p = parts.join('/');
    return Object.prototype.hasOwnProperty.call(files, p) ? p : null;
  }

  // value of a key inside [key=value, ...]: title={Text, with comma} or title=Text
  function optValue(opts, key) {
    const m = new RegExp('(?:^|,)\\s*' + key + '\\s*=\\s*').exec(opts);
    if (!m) return null;
    const rest = opts.slice(m.index + m[0].length);
    if (rest[0] === '{') { const a = arg(rest, 0); return a ? a.text : null; }
    return rest.split(',')[0].trim();
  }

  // argument of \input, \component...: {name}, [name] or just the word
  function wordArg(src, i) {
    while (i < src.length && /[ \t]/.test(src[i])) i++;
    if (src[i] === '{') return arg(src, i);
    if (src[i] === '[') return arg(src, i, '[', ']');
    const m = /^[^\s\\{}\[\]%]+/.exec(src.slice(i));
    return m ? { text: m[0], end: i + m[0].length } : null;
  }

  function resolveCtx(name, files) {
    const p = name.trim().replace(/^\.\//, '');
    return [p, p + '.tex', p + '.mkiv', p + '.mkxl'].find(c => Object.prototype.hasOwnProperty.call(files, c)) || null;
  }

  // replaces what follows % with spaces (keeps positions and lines); \% is not a comment
  function stripComments(text) {
    return text.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g, (m, a, b) => a + b + ' '.repeat(m.length - a.length - b.length));
  }

  // reads an argument between braces (or brackets) from i, with nested braces; returns { text, end } or null
  function arg(src, i, open = '{', close = '}') {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== open) return null;
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) return { text: src.slice(i + 1, j), end: j + 1 };
    }
    return null;
  }

  function cleanTitle(t) {
    let s = t.replace(/\\label\s*\{[^}]*\}/g, '').replace(/\\texorpdfstring\s*\{([^{}]*)\}\s*\{[^{}]*\}/g, '$1');
    for (let k = 0; k < 4; k++) s = s.replace(/\\[A-Za-z]+\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, '$1');
    return s.replace(/\\\\/g, ' ').replace(/\\[A-Za-z]+\*?/g, '').replace(/[{}~]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function resolvePath(name, files) {
    const p = name.trim().replace(/^\.\//, '');
    return [p, p + '.tex'].find(c => Object.prototype.hasOwnProperty.call(files, c)) || null;
  }

  /** files: { path: text }; returns { items: [{ level, title, path, line }], orphans: [{ path, items }] } */
  function parse(files, mainPath, withOrphans = true, withImages = false) {
    const cache = {};
    const visited = new Set();
    const items = [];
    const sections = path => {
      if (!cache[path]) cache[path] = stripComments(files[path] || '');
      return cache[path];
    };
    function walk(path, stack, inheritCtx) {
      if (stack.includes(path)) return; // file that includes itself
      visited.add(path);
      const src = sections(path);
      const out = [];
      const lineAt = idx => { let n = 1; for (let k = src.indexOf('\n'); k !== -1 && k < idx; k = src.indexOf('\n', k + 1)) n++; return n; };
      if (isTypstPath(path)) {
        // Typst: headings are "= Title", "== Subtitle"...; #include "file.typ" brings in another file; #image("file") is an image
        const lines = String(files[path] || '').split('\n');
        let raw = false;
        let block = 0;
        for (let i = 0; i < lines.length; i++) {
          let l = lines[i];
          if (/^\s*`{3,}/.test(l)) { raw = !raw; continue; }
          if (raw) continue;
          // block comments /* ... */ (may nest) and // comments
          let kept = '';
          for (let k = 0; k < l.length; k++) {
            if (l.startsWith('/*', k)) { block++; k++; continue; }
            if (block && l.startsWith('*/', k)) { block--; k++; continue; }
            if (block) continue;
            if (l.startsWith('//', k) && l[k - 1] !== ':') break;
            kept += l[k];
          }
          l = kept;
          const h = /^\s*(=+)\s+(.*?)\s*$/.exec(l);
          if (h) {
            const title = h[2].replace(/\s*<[^>]+>\s*$/, '').replace(/[*_`]/g, '').trim();
            if (title) out.push({ level: h[1].length, title, path, line: i + 1 });
          }
          const inc = /#include\s*\(?\s*"([^"]+)"/.exec(l);
          if (inc) {
            const target = resolveTypst(inc[1], path, files);
            if (target && target !== path) out.push({ include: target, at: i });
          }
          const img = withImages && /#image\s*\(\s*"([^"]+)"/.exec(l);
          if (img) out.push({ kind: 'image', level: 99, title: img[1], path, line: i + 1 });
        }
        for (const it of out) {
          if (it.include) walk(it.include, [...stack, path]);
          else items.push(it);
        }
        return;
      }
      const ctxFile = inheritCtx || isContextFile(path, src);   // what a ConTeXt file includes is also ConTeXt
      if (ctxFile) {
        CMD_CTX.lastIndex = 0;
        let c;
        while ((c = CMD_CTX.exec(src))) {
          const cmd = c[1];
          const pos = c.index + c[0].length;
          const base = cmd.replace(/^start/, '');
          if (cmd.startsWith('start') || base in LEVELS_CTX) {
            const isStart = cmd.startsWith('start');
            let title = null, end = pos;
            if (isStart) {
              const o = arg(src, pos, '[', ']');
              if (o) { title = optValue(o.text, 'title'); end = o.end; }
            } else {
              let p2 = pos;
              const short = arg(src, p2, '[', ']');
              if (short) p2 = short.end;
              const a = arg(src, p2);
              if (a) { title = a.text; end = a.end; }
            }
            title = title && cleanTitle(title);
            if (title && base in LEVELS_CTX) out.push({ level: LEVELS_CTX[base], title, path, line: lineAt(c.index) });
            CMD_CTX.lastIndex = Math.max(end, pos);
          } else if (cmd === 'externalfigure') {
            const a = arg(src, pos, '[', ']');
            const name = a && a.text.trim();
            if (withImages && name) out.push({ kind: 'image', level: 99, title: name, path, line: lineAt(c.index) });
            if (a) CMD_CTX.lastIndex = a.end;
          } else {
            const a = wordArg(src, pos);
            if (!a) continue;
            const target = resolveCtx(a.text, files);
            if (target && target !== path) out.push({ include: target, at: c.index });
            CMD_CTX.lastIndex = a.end;
          }
        }
        for (const it of out) {
          if (it.include) walk(it.include, [...stack, path], true);
          else items.push(it);
        }
        return;
      }
      CMD.lastIndex = 0;
      let m;
      while ((m = CMD.exec(src))) {
        const cmd = m[1];
        let pos = m.index + m[0].length;
        if (cmd in LEVELS) {
          const short = arg(src, pos, '[', ']');
          if (short) pos = short.end;
          const a = arg(src, pos);
          if (!a) continue;
          const title = cleanTitle(a.text);
          if (title) out.push({ level: LEVELS[cmd], title, path, line: lineAt(m.index) });
          CMD.lastIndex = a.end;
        } else if (cmd === 'includegraphics') {
          const o = arg(src, pos, '[', ']');
          if (o) pos = o.end;
          const a = arg(src, pos);
          if (!a) continue;
          const name = a.text.trim();
          if (withImages && name) out.push({ kind: 'image', level: 99, title: name, path, line: lineAt(m.index) });
          CMD.lastIndex = a.end;
        } else {
          if (cmd === 'subfile') { const o = arg(src, pos, '[', ']'); if (o) pos = o.end; }
          const a = arg(src, pos);
          if (!a) continue;
          const target = resolvePath(a.text, files);
          const idx = m.index;
          if (target) out.push({ include: target, at: idx });
          CMD.lastIndex = a.end;
        }
      }
      for (const it of out) {
        if (it.include) walk(it.include, [...stack, path]);
        else items.push(it);
      }
    }
    if (mainPath && files[mainPath] !== undefined) walk(mainPath, []);
    const orphans = [];
    for (const path of Object.keys(files).sort()) {
      if (!withOrphans || visited.has(path) || !/\.(tex|mkiv|mkxl|mkvi|typ)$/i.test(path) || path.startsWith('.neoleaf/')) continue;
      const sub = parse(files, path, false, withImages).items.filter(i => i.path === path);
      if (sub.length) orphans.push({ path, items: sub });
    }
    return { items, orphans };
  }

  function pickMain(files, configured) {
    if (configured && files[configured] !== undefined) return configured;
    return Object.keys(files).find(p => /\.(tex|mkiv|mkxl|mkvi)$/i.test(p) && /\\(?:documentclass|starttext|startproduct|startproject)(?![A-Za-z])/.test(files[p])) || (typeof currentFileId !== 'undefined' ? currentFileId : null);
  }

  // ------------------------------------------------------------ panel
  let timer = null, seq = 0;

  function goto(item) {
    const reveal = () => { editor.revealLineInCenter(item.line); editor.setPosition({ lineNumber: item.line, column: 1 }); editor.focus(); };
    if (item.path === currentFileId) { reveal(); return; }
    if (window.FT && FT.openPath) FT.openPath(item.path);
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (currentFileId === item.path && (window.collabActive || Date.now() - t0 > 400)) { clearInterval(iv); setTimeout(reveal, 150); }
      else if (Date.now() - t0 > 6000) clearInterval(iv);
    }, 100);
  }

  function row(item, min, mainPath) {
    const div = document.createElement('div');
    div.className = 'outline-item lv' + Math.min(4, Math.max(0, item.level - min)) + (item.path === currentFileId ? ' cur' : '');
    const title = document.createElement('span');
    title.className = 'ol-title';
    title.textContent = item.title;
    div.appendChild(title);
    if (item.path !== mainPath) {
      const f = document.createElement('span');
      f.className = 'ol-file';
      f.textContent = item.path.split('/').pop();
      div.appendChild(f);
    }
    div.title = `${item.path}:${item.line}`;
    div.onclick = () => goto(item);
    return div;
  }

  async function render() {
    const el = document.getElementById('outline-list');
    if (!el || !window.Project) return;
    const my = ++seq;
    let texts, cfg;
    try { [texts, cfg] = await Promise.all([Project.texts(), Project.loadConfig().catch(() => null)]); } catch (_) { return; }
    if (my !== seq) return;
    const files = {};
    for (const f of texts.files) files[f.path] = f.text;
    const main = pickMain(files, cfg && cfg.mainFile);
    const { items, orphans } = parse(files, main);
    const min = items.length ? Math.min(...items.map(i => i.level)) : 0;
    el.innerHTML = '';
    items.forEach(i => el.appendChild(row(i, min, main)));
    if (orphans.length) {
      const h = document.createElement('div');
      h.className = 'outline-group';
      h.textContent = typeof T === 'function' ? T('Not included') : 'Not included';
      el.appendChild(h);
      for (const o of orphans) {
        const omin = Math.min(...o.items.map(i => i.level));
        o.items.forEach(i => { const r = row(i, omin, null); r.classList.add('orphan'); el.appendChild(r); });
      }
    }
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(render, 600); }

  // redo when the open file changes (highlight) and when the tree is reloaded (pull, reset, clone)
  window.addEventListener('load', () => {
    let last = null;
    setInterval(() => { if (typeof currentFileId !== 'undefined' && currentFileId !== last) { last = currentFileId; schedule(); } }, 500);
    if (window.FT && FT.refreshFromBrowserGit) {
      const orig = FT.refreshFromBrowserGit;
      FT.refreshFromBrowserGit = async function () { const r = await orig.apply(this, arguments); schedule(); return r; };
    }
    setTimeout(render, 1500);
  });

  window.LDOutline = { parse, pickMain, arg, cleanTitle, goto, stripComments, render, schedule };
})();
