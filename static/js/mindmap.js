// Project map (experiment): the document in the center, sections and subsections as branches, images as leaves.
// Uses the same structure reader as the panel (LDOutline), so it follows \input/\include from the main file.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const IMG_EXT = ['', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.PNG', '.JPG', '.JPEG'];
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };
  const GAP_X = 46, ROW = 28, IMG_W = 84, IMG_H = 60;
  const st = { order: (() => { try { return localStorage.getItem('ld-map-order') || 'cw'; } catch (_) { return 'cw'; } })(), showImages: true, showOrphans: (() => { try { return localStorage.getItem('ld-map-orphans') === '1'; } catch (_) { return false; } })(), collapsed: new Set(), seen: false, tx: 0, ty: 0, k: 1, files: null, thumbs: new Map(), listing: null, root: null };

  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const tr = t => (typeof T === 'function' ? T(t) : t);
  const textW = t => Math.min(240, 18 + t.length * 6.6);
  const clip = (t, n = 34) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

  // ------------------------------------------------------------ data
  async function load() {
    const [texts, cfg] = await Promise.all([Project.texts(), Project.loadConfig().catch(() => null)]);
    const files = {};
    for (const f of texts.files) files[f.path] = f.text;
    const main = LDOutline.pickMain(files, cfg && cfg.mainFile);
    const { items, orphans } = LDOutline.parse(files, main, true, true);
    const rootTitle = (() => {
      const m = main && /\\title\s*(?=[\[{])/.exec(LDOutline.stripComments(files[main] || ''));
      if (m) {
        const src = LDOutline.stripComments(files[main]);
        const a = LDOutline.arg(src, m.index + m[0].length);
        const t = a && LDOutline.cleanTitle(a.text);
        if (t) return t;
      }
      return (typeof projectId !== 'undefined' ? projectId.split('__').slice(1).join('__') : '') || tr('Project');
    })();
    const root = { label: rootTitle, kind: 'root', level: -1, children: [], path: main, line: 1 };
    const build = (list, parent) => {
      const stack = [parent];
      for (const it of list) {
        const node = { label: it.title, kind: it.kind || 'section', level: it.level, path: it.path, line: it.line, children: [] };
        if (it.kind === 'image') { stack[stack.length - 1].children.push(node); continue; }
        while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      }
    };
    build(items, root);
    if (orphans.length) {
      const g = { label: tr('Not included'), kind: 'group', level: -1, children: [] };
      for (const o of orphans) build(o.items, g);
      root.children.push(g);
    }
    let n = 0;
    (function id(node, d) { node.id = 'n' + n++; node.depth = d; node.children.forEach(c => id(c, d + 1)); })(root, 0);
    st.files = files;
    st.root = root;
    return root;
  }

  // ------------------------------------------------------------ images
  async function listing() {
    if (!st.listing) st.listing = (await BrowserGit.listFiles()).filter(f => !f.is_folder).map(f => f.path);
    return st.listing;
  }
  async function thumb(name) {
    if (st.thumbs.has(name)) return st.thumbs.get(name);
    const paths = await listing();
    const clean = name.replace(/^\.\//, '');
    let found = null;
    for (const e of IMG_EXT) if (paths.includes(clean + e)) { found = clean + e; break; }
    if (!found) {
      const base = clean.split('/').pop().toLowerCase();
      found = paths.find(p => IMG_EXT.some(e => p.split('/').pop().toLowerCase() === base + e.toLowerCase()));
    }
    let res = { url: null, ext: found ? found.split('.').pop().toLowerCase() : null, found: !!found };
    if (found && MIME[res.ext]) {
      try { res.url = URL.createObjectURL(new Blob([await BrowserGit.readFile(found, 'uint8array')], { type: MIME[res.ext] })); } catch (_) {}
    }
    st.thumbs.set(name, res);
    return res;
  }

  // ------------------------------------------------------------ layout
  const shown = c => (st.showImages || c.kind !== 'image') && (st.showOrphans || c.kind !== 'group');
  const visibleKids = n => (st.collapsed.has(n.id) ? [] : n.children.filter(shown));
  const ownH = n => (n.kind === 'image' ? IMG_H + 8 : ROW);

  function span(n) {
    const kids = visibleKids(n);
    n.h = Math.max(ownH(n), kids.reduce((s, c) => s + span(c), 0));
    return n.h;
  }
  // x grows sideways (dir = 1 or -1); y is the center of the span reserved for the node
  function place(n, dir, x, top, colX) {
    const kids = visibleKids(n);
    n.w = n.kind === 'image' ? IMG_W : textW(clip(n.label));
    n.x = x; n.y = top + n.h / 2; n.dir = dir;
    let y = top;
    for (const c of kids) {
      const cx = x + dir * (n.w + GAP_X);
      place(c, dir, cx, y, colX);
      y += c.h;
    }
  }

  function layout(root) {
    const kids = visibleKids(root);
    root.w = Math.min(280, textW(clip(root.label, 40)) + 20);
    // main branches in document order, contiguous: clockwise (starts at the top right, goes down the right and up the left),
    // counterclockwise (mirrored) or all on the right
    kids.forEach(span);
    const total = kids.reduce((s, c) => s + c.h, 0);
    let k = kids.length;
    if (st.order !== 'right') {
      let acc = 0, best = Infinity;
      for (let i = 0; i <= kids.length; i++) {
        const d = Math.abs(acc - (total - acc));
        if (d < best) { best = d; k = i; }
        if (i < kids.length) acc += kids[i].h;
      }
    }
    const first = kids.slice(0, k), rest = kids.slice(k);
    let right, left;
    if (st.order === 'ccw') { left = first; right = rest.slice().reverse(); }
    else { right = first; left = rest.slice().reverse(); }
    const sum = l => l.reduce((s, c) => s + c.h, 0);
    const hl = sum(left), hr = sum(right);
    const H = Math.max(hl, hr, ROW);
    const side = (list, dir, tot) => {
      let y = (H - tot) / 2;
      for (const c of list) {
        place(c, dir, dir * (root.w / 2 + GAP_X), y, 0);
        y += c.h;
      }
    };
    side(right, 1, hr);
    side(left, -1, hl);
    root.x = 0; root.y = H / 2; root.dir = 0;
    return { H };
  }

  // ------------------------------------------------------------ drawing
  function draw() {
    const svg = document.getElementById('mm-svg');
    if (!svg || !st.root) return;
    svg.querySelector('#mm-world')?.remove();
    const world = el('g', { id: 'mm-world' }, svg);
    const links = el('g', {}, world), nodes = el('g', {}, world);
    layout(st.root);

    const edgeX = (n, side) => (n.dir >= 0 ? (side === 'out' ? n.x + n.w : n.x) : (side === 'out' ? n.x - n.w : n.x));

    function link(p, c) {
      let x1, x2;
      if (p.dir === 0) { x1 = c.dir * p.w / 2; x2 = edgeX(c, 'in'); }
      else { x1 = edgeX(p, 'out'); x2 = edgeX(c, 'in'); }
      const mx = (x1 + x2) / 2;
      el('path', { d: `M${x1},${p.y} C${mx},${p.y} ${mx},${c.y} ${x2},${c.y}`, class: 'mm-link d' + Math.min(c.depth, 4) }, links);
    }

    function node(n) {
      const g = el('g', { class: 'mm-node ' + n.kind + ' d' + Math.min(n.depth, 4), 'data-id': n.id }, nodes);
      const left = n.dir === -1;
      const x0 = n.dir === 0 ? -n.w / 2 : (left ? n.x - n.w : n.x);
      if (n.kind === 'image') {
        const h = IMG_H;
        el('rect', { x: x0, y: n.y - h / 2, width: n.w, height: h, rx: 4, class: 'mm-img-box' }, g);
        const lab = el('text', { x: x0 + n.w / 2, y: n.y + h / 2 + 11, 'text-anchor': 'middle', class: 'mm-img-label' }, g);
        lab.textContent = clip(n.label.split('/').pop(), 16);
        thumb(n.label).then(t => {
          if (t.url) el('image', { href: t.url, x: x0 + 2, y: n.y - h / 2 + 2, width: n.w - 4, height: h - 4, preserveAspectRatio: 'xMidYMid meet' }, g);
          else { const q = el('text', { x: x0 + n.w / 2, y: n.y + 4, 'text-anchor': 'middle', class: 'mm-img-ph' }, g); q.textContent = t.found ? (t.ext || '').toUpperCase() : '?'; }
        });
      } else {
        el('rect', { x: x0, y: n.y - 11, width: n.w, height: 22, rx: n.kind === 'root' ? 11 : 6, class: 'mm-box' }, g);
        const t = el('text', { x: x0 + n.w / 2, y: n.y + 4, 'text-anchor': 'middle', class: 'mm-text' }, g);
        t.textContent = clip(n.label, n.kind === 'root' ? 40 : 34);
      }
      const tip = el('title', {}, g);
      tip.textContent = n.path ? `${n.label}\n${n.path}:${n.line}` : n.label;
      g.addEventListener('click', ev => { ev.stopPropagation(); if (st.moved) return; if (n.path && n.kind !== 'group') LDOutline.goto({ path: n.path, line: n.line }); });
      g.addEventListener('dblclick', ev => { ev.stopPropagation(); if (n.children.length) toggle(n); });
      const all = n.children.filter(shown);
      if (all.length) {
        const dir = n.dir === 0 ? 1 : n.dir;
        const bx = n.dir === 0 ? n.w / 2 : (dir === 1 ? n.x + n.w : n.x - n.w);
        const b = el('g', { class: 'mm-toggle', transform: `translate(${bx + dir * 9},${n.y})` }, g);
        el('circle', { r: 7 }, b);
        const s = el('text', { 'text-anchor': 'middle', y: 3.5 }, b);
        s.textContent = st.collapsed.has(n.id) ? String(all.length) : '−';
        b.addEventListener('click', ev => { ev.stopPropagation(); if (!st.moved) toggle(n); });
        b.addEventListener('dblclick', ev => ev.stopPropagation());
      }
    }

    (function walk(n) {
      for (const c of visibleKids(n)) { link(n, c); walk(c); }
      node(n);
    })(st.root);
    apply();
  }

  function toggle(n) {
    st.collapsed.has(n.id) ? st.collapsed.delete(n.id) : st.collapsed.add(n.id);
    draw();
  }

  function apply() {
    const w = document.getElementById('mm-world');
    if (w) w.setAttribute('transform', `translate(${st.tx},${st.ty}) scale(${st.k})`);
  }

  function fit() {
    const svg = document.getElementById('mm-svg'), w = document.getElementById('mm-world');
    if (!svg || !w) return;
    const b = w.getBBox(), r = svg.getBoundingClientRect();
    if (!b.width || !r.width) return;
    st.k = Math.min(1.3, Math.max(0.15, Math.min((r.width - 40) / b.width, (r.height - 40) / b.height)));
    st.tx = r.width / 2 - (b.x + b.width / 2) * st.k;
    st.ty = r.height / 2 - (b.y + b.height / 2) * st.k;
    apply();
  }

  function setAll(collapse) {
    st.collapsed.clear();
    if (collapse) (function w(n) { n.children.forEach(c => { if (c.children.length) st.collapsed.add(c.id); w(c); }); })(st.root);
    draw(); fit();
  }

  // ------------------------------------------------------------ panel
  function ensureUi() {
    const box = document.getElementById('map-container');
    if (!box || box.dataset.ready) return box;
    box.dataset.ready = '1';
    box.innerHTML = `<div class="mm-bar">
      <button class="btn" id="mm-fit" title="Fit the map to the screen">Fit</button>
      <button class="btn" id="mm-expand">Expand all</button>
      <button class="btn" id="mm-collapse">Collapse</button>
      <label class="mm-chk"><input type="checkbox" id="mm-img" checked> Images</label>
      <label class="mm-chk" title=".tex files that no other file includes"><input type="checkbox" id="mm-orph"> Not included</label>
      <select id="mm-order" class="theme-select" title="Order of the main branches"><option value="cw">Clockwise</option><option value="ccw">Counterclockwise</option><option value="right">All on the right</option></select>
      <button class="btn" id="mm-refresh" title="Reload the project">↻</button>
      <button class="btn" id="mm-full" title="Full screen (Esc exits)">⛶</button>
      <span class="mm-hint">Click a node to open the file; drag to move; scroll to zoom.</span>
    </div><svg id="mm-svg" xmlns="${NS}"></svg>`;
    const svg = box.querySelector('#mm-svg');
    box.querySelector('#mm-fit').onclick = fit;
    box.querySelector('#mm-expand').onclick = () => setAll(false);
    box.querySelector('#mm-collapse').onclick = () => { setAll(true); st.collapsed.delete(st.root.id); draw(); fit(); };
    box.querySelector('#mm-img').onchange = e => { st.showImages = e.target.checked; draw(); fit(); };
    const orph = box.querySelector('#mm-orph');
    orph.checked = st.showOrphans;
    orph.onchange = () => { st.showOrphans = orph.checked; try { localStorage.setItem('ld-map-orphans', st.showOrphans ? '1' : '0'); } catch (_) {} draw(); fit(); };
    const ord = box.querySelector('#mm-order');
    ord.value = st.order;
    ord.onchange = () => { st.order = ord.value; try { localStorage.setItem('ld-map-order', st.order); } catch (_) {} draw(); fit(); };
    box.querySelector('#mm-refresh').onclick = () => render(true);
    box.querySelector('#mm-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen?.().catch(() => {}); };
    document.addEventListener('fullscreenchange', () => setTimeout(fit, 150));
    // dragging only starts after moving a few pixels: capturing the pointer on click would send the click to the SVG and not to the node
    let drag = null;
    svg.addEventListener('pointerdown', e => { drag = { x: e.clientX - st.tx, y: e.clientY - st.ty, sx: e.clientX, sy: e.clientY, on: false, id: e.pointerId }; st.moved = false; });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.on) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
        drag.on = true; st.moved = true;
        try { svg.setPointerCapture(drag.id); } catch (_) {}
        svg.classList.add('drag');
      }
      st.tx = e.clientX - drag.x; st.ty = e.clientY - drag.y; apply();
    });
    const end = () => { drag = null; svg.classList.remove('drag'); setTimeout(() => { st.moved = false; }, 0); };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const k = Math.min(3, Math.max(0.1, st.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      st.tx = px - (px - st.tx) * (k / st.k); st.ty = py - (py - st.ty) * (k / st.k); st.k = k; apply();
    }, { passive: false });
    return box;
  }

  async function render(reload) {
    const box = ensureUi();
    if (!box || !window.Project) return;
    if (reload) { st.listing = null; st.thumbs.clear(); }
    try { await load(); } catch (e) { box.querySelector('#mm-svg').innerHTML = ''; return; }
    if (!st.seen || reload) {
      // opens only the first levels; what is below stays collapsed (click the node's circle to open)
      st.collapsed.clear();
      (function w(n) { n.children.forEach(c => { if (c.depth >= 2 && c.children.length) st.collapsed.add(c.id); w(c); }); })(st.root);
    }
    draw();
    if (!st.seen || reload) { st.seen = true; requestAnimationFrame(fit); }
  }

  // the language changed with the map open: redo the map's own labels
  window.addEventListener('ld-lang-change', () => { const b = document.getElementById('map-container'); if (b && b.dataset.ready && b.offsetParent) render(); });

  window.Mindmap = { render, fit };
})();
