// Comments and suggestions (review): select a passage and comment, or suggest a change for the person to accept or reject.
// They live in the project's .neoleaf/comments.json. Depends on globals: projectId, editor, monaco, currentFileId, h(), LD.smart.goTo, FT.
(function () {
  const $ = id => document.getElementById(id);
  const st = { doc: { rev: 0, threads: [] }, filter: 'open', ids: [], loadedRev: -1, focus: null };

  const curEntry = () => ((window.FT && FT.entries()) || []).find(e => e.id === currentFileId);
  const curPath = () => { const e = curEntry(); return e ? e.path : null; };
  const fmt = iso => { try { return new Date(iso).toLocaleString(LDI18n.locale(), { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return iso || ''; } };

  // ------------------------------------------------------------ storage
  async function load() {
    try {
      const d = await Project.comments.load();
      if (Array.isArray(d.threads) && d.rev !== st.loadedRev) { st.doc = d; st.loadedRev = d.rev; render(); decorate(); }
    } catch (_) { /* local project not available yet */ }
  }

  async function post(op) {
    try {
      const d = await Project.comments.op(op);
      st.doc = d; st.loadedRev = d.rev; render(); decorate();
      if (typeof checkGitStatus === 'function') checkGitStatus();
      return true;
    } catch (e) { alert(e.message); return false; }
  }

  // ------------------------------------------------------------ where the passage is now
  function locate(model, th) {
    const r = th.range, lc = model.getLineCount();
    if (r.el <= lc) {
      const rng = model.validateRange(new monaco.Range(r.sl, r.sc, r.el, r.ec));
      if (!th.quote || model.getValueInRange(rng) === th.quote) return rng;
    }
    if (th.quote) {
      const ms = model.findMatches(th.quote, false, false, true, null, false, 50);
      if (ms.length) {
        ms.sort((a, b) => Math.abs(a.range.startLineNumber - r.sl) - Math.abs(b.range.startLineNumber - r.sl));
        return ms[0].range;
      }
    }
    return null;
  }

  // ------------------------------------------------------------ editor marks
  function decorate() {
    if (typeof editor === 'undefined' || !editor || !editor.getModel()) return;
    const model = editor.getModel(), path = curPath();
    const items = [], list = [];
    if (path) {
      for (const th of st.doc.threads) {
        if (th.file !== path || th.resolved) continue;
        const rng = locate(model, th);
        if (!rng) continue;
        const first = th.messages[0];
        const who = first ? (first.author.name || first.author.email) : '';
        if (th.kind === 'suggestion') {
          const hover = '**' + T('Suggestion') + '**: ' + who + (first ? '\n\n' + first.text : '') + '\n\n' + T('Ctrl+click to open');
          items.push({ range: rng, options: { inlineClassName: 'ld-sug-old', hoverMessage: { value: hover }, linesDecorationsClassName: 'ld-sug-bar', after: { content: th.suggestion.replacement || '⌫', inlineClassName: 'ld-sug-new' } } });
        } else {
          const hover = '**' + who + '**: ' + (first ? first.text : '') + '\n\n' + T('Ctrl+click to open');
          items.push({ range: rng, options: { inlineClassName: 'ld-cmt', hoverMessage: { value: hover }, linesDecorationsClassName: 'ld-cmt-bar' } });
        }
        list.push(th.id);
      }
    }
    st.ids = editor.deltaDecorations(st.ids, items);
    st.map = list;
  }

  function threadAt(pos) {
    if (!st.map) return null;
    const model = editor.getModel();
    for (let i = 0; i < st.ids.length; i++) {
      const r = model.getDecorationRange(st.ids[i]);
      if (r && r.containsPosition(pos)) return st.map[i];
    }
    return null;
  }

  // ------------------------------------------------------------ panel
  function openPanel() { if (typeof switchTab === 'function') switchTab('comments'); }

  function who(a) { return (a && (a.name || a.email)) || '?'; }

  function card(th) {
    const msgs = th.messages.map(m => h('div', { class: 'cmt-msg' },
      h('div', { class: 'cmt-meta' }, h('b', { class: 'cmt-author' }, who(m.author)), ' · ', h('span', { class: 'cmt-when' }, fmt(m.at))),
      h('div', { class: 'cmt-text' }, m.text)));
    const body = [];
    const where = h('a', { class: 'cmt-where', href: '#', title: T('Go to the passage'), onclick: ev => { ev.preventDefault(); go(th); } },
      (th.kind === 'suggestion' ? '✏️ ' : '💬 ') + th.file + ':' + th.range.sl);
    body.push(h('div', { class: 'cmt-head' }, where, th.resolved ? h('span', { class: 'cmt-badge' }, th.kind === 'suggestion' && th.suggestion.status !== 'pending' ? (th.suggestion.status === 'accepted' ? T('accepted') : T('rejected')) : T('resolved')) : ''));
    if (th.kind === 'suggestion') {
      body.push(h('div', { class: 'cmt-diff' }, h('div', { class: 'cmt-del' }, '− ' + th.quote), h('div', { class: 'cmt-add' }, '+ ' + (th.suggestion.replacement || ''))));
    } else if (th.quote) {
      body.push(h('div', { class: 'cmt-quote' }, th.quote.length > 160 ? th.quote.slice(0, 160) + '…' : th.quote));
    }
    body.push(...msgs);
    const reply = h('input', { class: 'form-control cmt-reply', placeholder: T('Reply...'), onkeydown: ev => { if (ev.key === 'Enter' && reply.value.trim()) { const t = reply.value; reply.value = ''; post({ op: 'reply', thread: th.id, text: t }); } } });
    const actions = h('div', { class: 'cmt-actions' });
    if (th.kind === 'suggestion' && th.suggestion.status === 'pending') {
      actions.append(h('button', { class: 'btn btn-primary cmt-btn', onclick: () => accept(th) }, '✔ ' + T('Accept')),
        h('button', { class: 'btn cmt-btn', onclick: () => post({ op: 'decide', thread: th.id, status: 'rejected' }) }, '✖ ' + T('Reject')));
    } else {
      actions.append(h('button', { class: 'btn cmt-btn', onclick: () => post({ op: 'resolve', thread: th.id, resolved: !th.resolved }) }, th.resolved ? T('Reopen') : T('Resolve')));
    }
    actions.append(h('button', { class: 'btn cmt-btn cmt-del-btn', title: T('Delete'), onclick: () => { if (confirm(T('Delete this comment and its replies?'))) post({ op: 'delete', thread: th.id }); } }, '🗑'));
    body.push(reply, actions);
    return h('div', { class: 'cmt-card' + (th.resolved ? ' resolved' : '') + (st.focus === th.id ? ' focus' : ''), 'data-id': th.id }, ...body);
  }

  function render() {
    const box = $('comments-container');
    const open = st.doc.threads.filter(t => !t.resolved).length;
    const badge = $('comments-badge');
    if (badge) { badge.textContent = open; badge.style.display = open ? 'inline-block' : 'none'; }
    if (!box) return;
    const keep = box.scrollTop;
    box.textContent = '';
    const tab = (k, label) => h('button', { class: 'ptab' + (st.filter === k ? ' active' : ''), onclick: () => { st.filter = k; render(); } }, label);
    box.append(h('div', { class: 'cmt-bar' },
      h('div', {}, tab('open', T('Unresolved')), tab('resolved', T('Resolved')), tab('all', T('All'))),
      h('div', {}, h('button', { class: 'btn cmt-btn', title: 'Ctrl+Alt+M', onclick: () => startComment('comment') }, '💬 ' + T('Comment')),
        ' ', h('button', { class: 'btn cmt-btn', title: 'Ctrl+Alt+S', onclick: () => startComment('suggestion') }, '✏️ ' + T('Suggest')))));
    const list = st.doc.threads.filter(t => st.filter === 'all' || (st.filter === 'open') === !t.resolved).sort((a, b) => (a.file === b.file ? a.range.sl - b.range.sl : a.file < b.file ? -1 : 1));
    if (!list.length) box.append(h('div', { class: 'cmt-empty' }, st.filter === 'resolved' ? T('No resolved comments.') : T('No comments yet. Select a passage in the code and use 💬 Comment or ✏️ Suggest.')));
    list.forEach(th => box.append(card(th)));
    box.scrollTop = keep;
  }

  // ------------------------------------------------------------ go to the passage / accept
  function withFile(path, line, cb) {
    const entry = ((window.FT && FT.entries()) || []).find(e => e.path === path);
    if (!entry) { alert(T('File "{0}" not found in the project', path)); return; }
    if (entry.id === currentFileId) { cb(); return; }
    LD.smart.goTo(path, line);
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (currentFileId === entry.id && (window.collabActive || Date.now() - t0 > 2500)) { clearInterval(timer); setTimeout(cb, 150); }
      else if (Date.now() - t0 > 7000) clearInterval(timer);
    }, 150);
  }

  function go(th) {
    withFile(th.file, th.range.sl, () => {
      const rng = locate(editor.getModel(), th);
      if (rng) { editor.revealRangeInCenter(rng); editor.setSelection(rng); editor.focus(); }
      else alert(T('The commented passage was changed or deleted.'));
    });
  }

  function accept(th) {
    withFile(th.file, th.range.sl, async () => {
      const model = editor.getModel();
      const rng = locate(model, th);
      if (!rng || model.getValueInRange(rng) !== th.quote) { alert(T('The passage changed since the suggestion. Reject it or edit the text manually.')); return; }
      editor.executeEdits('ld-suggestion', [{ range: rng, text: th.suggestion.replacement || '' }]);
      await post({ op: 'decide', thread: th.id, status: 'accepted' });
    });
  }

  // ------------------------------------------------------------ create
  function selectionInfo(needText) {
    const model = editor.getModel();
    let sel = editor.getSelection();
    if (sel.isEmpty()) {
      if (needText) { toast(T('Select the passage you want to change.')); return null; }
      const w = model.getWordAtPosition(sel.getStartPosition());
      sel = w ? new monaco.Range(sel.startLineNumber, w.startColumn, sel.startLineNumber, w.endColumn)
        : new monaco.Range(sel.startLineNumber, 1, sel.startLineNumber, model.getLineMaxColumn(sel.startLineNumber));
    }
    const quote = model.getValueInRange(sel);
    if (quote.length > 2000) { toast(T('Select a shorter passage (up to 2000 characters).')); return null; }
    return { sel, quote };
  }

  const toast = msg => alert(msg);

  function startComment(kind) {
    const path = curPath();
    if (!path) return;
    const info = selectionInfo(kind === 'suggestion');
    if (!info) return;
    composer(kind, info.quote, async (text, replacement) => {
      const s = info.sel;
      const ok = await post({ op: 'add', file: path, kind, quote: info.quote, text, replacement, range: { sl: s.startLineNumber, sc: s.startColumn, el: s.endLineNumber, ec: s.endColumn } });
      if (ok) openPanel();
      return ok;
    });
  }

  function composer(kind, quote, onSubmit) {
    const back = h('div', { class: 'modal-backdrop', style: 'display:flex' });
    const close = () => back.remove();
    const ta = h('textarea', { class: 'form-control', rows: '4', placeholder: kind === 'suggestion' ? T('Comment (optional)') : T('Write the comment...') });
    const rep = kind === 'suggestion' ? h('textarea', { class: 'form-control', rows: '3' }) : null;
    if (rep) rep.value = quote;
    const send = h('button', { class: 'btn btn-primary', onclick: submit }, kind === 'suggestion' ? T('Suggest a change') : T('Comment'));
    async function submit() {
      if (kind === 'comment' && !ta.value.trim()) { ta.focus(); return; }
      send.disabled = true;
      const ok = await onSubmit(ta.value, rep ? rep.value : '');
      if (ok) close(); else send.disabled = false;
    }
    const box = h('div', { class: 'modal-box', style: 'width:520px;max-width:94vw' },
      h('h3', { style: 'color:var(--text-bright);margin-bottom:12px' }, kind === 'suggestion' ? '✏️ ' + T('Suggest a change') : '💬 ' + T('New comment')),
      h('div', { class: 'cmt-quote' }, quote.length > 300 ? quote.slice(0, 300) + '…' : quote),
      ...(rep ? [h('label', { class: 'modal-subtitle' }, T('Replace with')), rep] : []),
      h('div', { style: 'height:8px' }), ta,
      h('div', { style: 'display:flex;justify-content:flex-end;gap:10px;margin-top:14px' }, h('button', { class: 'btn', onclick: close }, T('Cancel')), send));
    back.append(box);
    back.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) submit(); });
    document.body.append(back);
    (rep || ta).focus();
  }

  // ------------------------------------------------------------ editor hookup
  function hook() {
    editor.addAction({ id: 'ld.comment', label: T('Comment on the selected passage'), contextMenuGroupId: 'navigation', contextMenuOrder: 1.6, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM], run: () => startComment('comment') });
    editor.addAction({ id: 'ld.suggest', label: T('Suggest a change to the selected passage'), contextMenuGroupId: 'navigation', contextMenuOrder: 1.7, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyS], run: () => startComment('suggestion') });
    // Ctrl+click on a marked passage opens the comment in the panel
    editor.onMouseDown(e => {
      if (!(e.event.ctrlKey || e.event.metaKey) || !e.target.position) return;
      const id = threadAt(e.target.position);
      if (!id) return;
      st.focus = id;
      if (st.doc.threads.find(t => t.id === id) && st.filter === 'resolved') st.filter = 'open';
      openPanel(); render();
      const el = document.querySelector(`.cmt-card[data-id="${id}"]`);
      if (el) el.scrollIntoView({ block: 'center' });
    });
    editor.onDidChangeModel(() => setTimeout(decorate, 50));
    window.addEventListener('collab-synced', () => setTimeout(decorate, 50));
    window.addEventListener('ld-lang-change', render);
    setInterval(() => { if (document.visibilityState === 'visible') load(); }, 20000);
    load();
  }

  window.Comments = { load, render, decorate, startComment };
  if (typeof editor !== 'undefined' && editor) hook(); else window.addEventListener('editor-ready', hook, { once: true });
})();
