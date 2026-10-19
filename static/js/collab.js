// Real-time collaborative editing: Yjs (CRDT) bound to Monaco over WebSocket.
// Depends on: window.Y (static/vendor/yjs.mjs), and the global `editor` and `monaco` (editor-core.js).
(function () {
  const PALETTE = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#be5046'];
  const MAX_FAILS_BEFORE_FALLBACK = 3;

  let ws = null;
  let ydoc = null;
  let ytext = null;
  let room = null;
  let stopped = true;
  let synced = false;
  let everSynced = false;
  let failures = 0;
  let retryTimer = null;
  let awTimer = null;
  let myId = null;
  let canEdit = true;
  let lock = null;         // { by, name }: file locked by someone (whoever locked it is the only one who edits)
  let role = 'join';       // seed (seeds the initial text), wait (waits for the seeding) or join (receives the state)
  let waitTimer = null;
  let saveTimer = null;
  let applyingRemote = false;
  let disposables = [];
  let decorations = [];
  const peers = new Map(); // id -> { id, name, picture, anchor, head }

  window.collabActive = false;

  const colorOf = id => PALETTE[Number(id) % PALETTE.length];

  function status(state, text) {
    if (typeof updateStatus === 'function') updateStatus(state, text);
  }

  function waitForYjs() {
    return new Promise(resolve => {
      if (window.Y) return resolve(true);
      const done = () => resolve(!!window.Y);
      window.addEventListener('yjs-ready', done, { once: true });
      setTimeout(done, 5000);
    });
  }

  // ---------------------------------------------------------------- lifecycle

  window.collabStart = async function (fileId) {
    window.collabStop();
    if (typeof saveTimeout !== 'undefined' && saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    if (!(await waitForYjs()) || typeof editor === 'undefined' || !editor) return;
    stopped = false;
    room = fileId;
    failures = 0;
    everSynced = false;
    editor.updateOptions({ readOnly: true }); // until synced, so nobody types over outdated text
    status('saving', 'Connecting to real-time editing...');
    connect();
  };

  window.collabStop = function (skipFlush) {
    if (!skipFlush && window.BrowserGit && room && typeof editor !== 'undefined' && editor) {
      try {
        const val = editor.getValue();
        if (val) BrowserGit.writeFile(room, val).catch(() => {});
      } catch (_) {}
    }
    room = null; // prevents a second call from writing the new file's text over the old one
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(awTimer);
    clearTimeout(waitTimer);
    clearTimeout(saveTimer);
    teardown();
    if (ws) { const s = ws; ws = null; try { s.close(); } catch (_) {} }
    peers.clear();
    lock = null;
    renderPeers();
    renderLock();
    window.collabActive = false;
    if (typeof editor !== 'undefined' && editor) editor.updateOptions({ readOnly: false });
  };

  function teardown() {
    synced = false;
    disposables.forEach(d => { try { d.dispose(); } catch (_) {} });
    disposables = [];
    if (ydoc) { try { ydoc.destroy(); } catch (_) {} }
    ydoc = null;
    ytext = null;
    if (typeof editor !== 'undefined' && editor) decorations = editor.deltaDecorations(decorations, []);
    window.collabActive = false;
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws/file/${encodeURIComponent(room)}?project=${encodeURIComponent(typeof projectId !== 'undefined' ? projectId : '')}`);
    sock.binaryType = 'arraybuffer';
    ws = sock;
    sock.onmessage = ev => { if (sock === ws) onMessage(ev); };
    sock.onclose = () => { if (sock === ws && !stopped) onDisconnected(); };
  }

  function onDisconnected() {
    teardown();
    ws = null;
    if (!everSynced) {
      failures += 1;
      if (failures >= MAX_FAILS_BEFORE_FALLBACK) {
        // No WebSocket/no access: go back to the previous individual saving.
        stopped = true;
        editor.updateOptions({ readOnly: false });
        status('error', 'Real-time editing unavailable: saving individually');
        return;
      }
    }
    editor.updateOptions({ readOnly: true });
    status('error', 'Reconnecting...');
    const delay = Math.min(15000, 1000 * Math.pow(2, Math.min(failures, 4)));
    retryTimer = setTimeout(() => { if (!stopped) connect(); }, delay);
  }

  // ---------------------------------------------------------------- messages

  function onMessage(ev) {
    if (typeof ev.data !== 'string') {
      const arr = new Uint8Array(ev.data);
      if (arr[0] !== 1) return;
      const update = arr.subarray(1);
      if (!synced) {
        ydoc = new Y.Doc();
        ytext = ydoc.getText('content');
        Y.applyUpdate(ydoc, update, 'init');
        clearTimeout(waitTimer);
        bind('join');
      } else {
        Y.applyUpdate(ydoc, update, 'remote');
      }
      return;
    }

    let m;
    try { m = JSON.parse(ev.data); } catch (_) { return; }
    switch (m.t) {
      case 'hello':
        myId = m.id;
        canEdit = !!m.canEdit;
        lock = m.lock && m.lock.by ? { by: m.lock.by, name: m.lock.name } : null;
        role = m.role || 'join';
        peers.clear();
        (m.peers || []).forEach(p => peers.set(p.id, p));
        renderPeers();
        if (role === 'seed') {
          // the room is empty: this browser's text (BrowserGit) is what opens it for the others
          ydoc = new Y.Doc();
          ytext = ydoc.getText('content');
          bind('seed');
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'seeded' }));
        } else if (role === 'wait') {
          status('saving', canEdit ? 'Waiting for the room to open...' : 'Read only');
          if (!canEdit) editor.updateOptions({ readOnly: true });
          // if the seeding does not arrive, reconnect (the first to reconnect becomes the seeder)
          waitTimer = setTimeout(() => { if (!synced && ws) { try { ws.close(); } catch (_) {} } }, 10000);
        }
        break;
      case 'lock':
        lock = m.by ? { by: m.by, name: m.name } : null;
        if (synced) { applyEditable(); status('saved', editableNow() ? 'Real-time editing active' : 'Read only'); }
        renderLock();
        break;
      case 'rejected':
        // edited at the moment someone else locked: discard the local copy; the room's text comes right after
        if (synced) teardown();
        break;
      case 'reseed':
        if (!synced && ws) { try { ws.close(); } catch (_) {} }
        break;
      case 'join':
        peers.set(m.id, { id: m.id, name: m.name, picture: m.picture });
        renderPeers();
        renderLock();
        break;
      case 'leave':
        peers.delete(m.id);
        renderPeers();
        renderLock();
        renderCursors();
        break;
      case 'aw': {
        const p = peers.get(m.id) || { id: m.id, name: m.name, picture: m.picture };
        p.anchor = m.anchor;
        p.head = m.head;
        peers.set(m.id, p);
        renderCursors();
        break;
      }
      case 'error':
        status('error', m.error || 'Error saving');
        break;
      case 'reset':
        // the project was reset to what is on GitHub: reload to open the new text
        // (whoever requested the reset reloads on their own, after also resetting the browser clone)
        if (window.__resetting) break;
        stopped = true;
        if (typeof isDirty !== 'undefined') isDirty = false;
        location.reload();
        break;
    }
  }

  function sendUpdate(update) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const b = new Uint8Array(update.length + 1);
    b[0] = 1;
    b.set(update, 1);
    ws.send(b);
  }

  // ---------------------------------------------------------------- Yjs <-> Monaco binding

  // authorship: what THIS person typed since the last save (each browser records its own part in .neoleaf/history/)
  let authorStat = { added: 0, removed: 0, preview: '', since: '' };
  function countLocalChange(e) {
    for (const c of e.changes) {
      authorStat.added += c.text.length;
      authorStat.removed += c.rangeLength;
      if (!authorStat.preview && c.text.trim()) authorStat.preview = c.text.trim().slice(0, 120);
    }
    if (!authorStat.since) authorStat.since = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  }

  /** Writes the editor text to the local clone (BrowserGit): the only place where the project is saved. */
  function saveLocalNow() {
    clearTimeout(saveTimer);
    if (!window.BrowserGit || !room || typeof editor === 'undefined' || !editor) return;
    const val = editor.getValue();
    const stat = authorStat;
    authorStat = { added: 0, removed: 0, preview: '', since: '' };
    const file = room;
    BrowserGit.writeFile(file, val).then(async () => {
      if ((stat.added || stat.removed) && window.Project) await Project.recordAuthorship({ fileId: file, file: file.split('/').pop(), ...stat });
      status('saved', 'Saved in browser');
      if (typeof checkGitStatus === 'function') checkGitStatus();
    }).catch(() => {});
  }
  function scheduleLocalSave() {
    clearTimeout(saveTimer);
    status('saving', 'Saving...');
    saveTimer = setTimeout(saveLocalNow, 1500);
  }
  window.addEventListener('pagehide', () => { if (synced) saveLocalNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && synced) saveLocalNow(); });

  function bind(mode) {
    const model = editor.getModel();
    model.setEOL(monaco.editor.EndOfLineSequence.LF);

    window.collabActive = true;
    if (typeof saveTimeout !== 'undefined' && saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }

    const serverText = ytext.toString();
    const localText = model.getValue();

    // The room is born empty on the relay: whoever opens it (mode "seed") delivers the text from their browser; the others receive the state.
    if (mode === 'seed') {
      if (localText) {
        ydoc.transact(() => {
          ytext.insert(0, localText);
        }, 'local');
        sendUpdate(Y.encodeStateAsUpdate(ydoc));
      }
    } else {
      applyingRemote = true;
      model.setValue(serverText);
      applyingRemote = false;
    }

    synced = true;
    everSynced = true;
    failures = 0;
    applyEditable();
    if (typeof isDirty !== 'undefined') isDirty = false;
    status('saved', editableNow() ? 'Real-time editing active' : 'Read only');
    renderLock();
    window.dispatchEvent(new CustomEvent('collab-synced'));

    // save to the local clone after each change, coming from here or from the others
    disposables.push(model.onDidChangeContent(() => scheduleLocalSave()));

    // Editor -> Yjs
    disposables.push(model.onDidChangeContent(e => {
      if (applyingRemote || !ydoc) return;
      countLocalChange(e);
      ydoc.transact(() => {
        const changes = [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
        for (const c of changes) {
          if (c.rangeLength > 0) ytext.delete(c.rangeOffset, c.rangeLength);
          if (c.text) ytext.insert(c.rangeOffset, c.text);
        }
      }, 'local');
    }));

    // Yjs -> server (local edits only)
    const onUpdate = (update, origin) => { if (origin === 'local') sendUpdate(update); };
    ydoc.on('update', onUpdate);
    disposables.push({ dispose: () => ydoc && ydoc.off('update', onUpdate) });

    // Yjs -> Editor (edits from others)
    const observer = (event, txn) => {
      if (txn.origin === 'local' || txn.origin === 'init') return;
      applyRemoteDelta(model, event.delta);
      renderCursors();
    };
    ytext.observe(observer);
    disposables.push({ dispose: () => ytext && ytext.unobserve(observer) });

    // Cursor/selection
    disposables.push(editor.onDidChangeCursorSelection(() => scheduleAwareness()));
    sendAwareness();
  }

  function applyRemoteDelta(model, delta) {
    applyingRemote = true;
    try {
      let pos = 0;
      const rangeAt = (from, to) => {
        const a = model.getPositionAt(from);
        const b = model.getPositionAt(to);
        return new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column);
      };
      for (const op of delta) {
        if (op.retain) {
          pos += op.retain;
        } else if (op.insert) {
          const text = typeof op.insert === 'string' ? op.insert : '';
          model.applyEdits([{ range: rangeAt(pos, pos), text, forceMoveMarkers: true }]);
          pos += text.length;
        } else if (op.delete) {
          model.applyEdits([{ range: rangeAt(pos, pos + op.delete), text: '' }]);
        }
      }
    } finally {
      applyingRemote = false;
    }
  }

  // ---------------------------------------------------------------- remote cursors

  function scheduleAwareness() {
    if (awTimer) return;
    awTimer = setTimeout(() => { awTimer = null; sendAwareness(); }, 80);
  }

  function sendAwareness() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !ydoc || !synced) return;
    const sel = editor.getSelection();
    const model = editor.getModel();
    if (!sel) return;
    const anchorIdx = model.getOffsetAt({ lineNumber: sel.selectionStartLineNumber, column: sel.selectionStartColumn });
    const headIdx = model.getOffsetAt(sel.getPosition());
    const rel = idx => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, idx));
    ws.send(JSON.stringify({ t: 'aw', anchor: rel(anchorIdx), head: rel(headIdx) }));
  }

  function cssSafe(s) {
    return String(s || '').replace(/["\\\n\r<>{}]/g, '').slice(0, 30);
  }

  function ensureStyle(p) {
    const id = 'rc-style-' + p.id;
    const color = colorOf(p.id);
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent =
      `.rc-sel-${p.id}{background:${color}40;}` +
      `.rc-caret-${p.id}{border-left:2px solid ${color};margin-left:-1px;position:relative;}` +
      `.rc-caret-${p.id}::after{content:"${cssSafe(p.name || "?")}";position:absolute;top:-1.4em;left:-2px;` +
      `background:${color};color:#fff;font-size:10px;line-height:1.4;padding:0 4px;border-radius:3px 3px 3px 0;` +
      `white-space:nowrap;z-index:50;pointer-events:none;}`;
  }

  function absIndex(relJson) {
    try {
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(relJson), ydoc);
      return abs ? abs.index : null;
    } catch (_) {
      return null;
    }
  }

  function renderCursors() {
    if (!ydoc || !synced) return;
    const model = editor.getModel();
    const next = [];
    peers.forEach(p => {
      if (!p.anchor || !p.head) return;
      const a = absIndex(p.anchor);
      const h = absIndex(p.head);
      if (a === null || h === null) return;
      ensureStyle(p);
      const pa = model.getPositionAt(a);
      const ph = model.getPositionAt(h);
      if (a !== h) {
        const start = a < h ? pa : ph;
        const end = a < h ? ph : pa;
        next.push({
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: { className: 'rc-sel-' + p.id }
        });
      }
      next.push({
        range: new monaco.Range(ph.lineNumber, ph.column, ph.lineNumber, ph.column),
        options: { afterContentClassName: 'rc-caret-' + p.id, stickiness: 1 }
      });
    });
    decorations = editor.deltaDecorations(decorations, next);
  }

  // ---------------------------------------------------------------- file lock

  const editableNow = () => canEdit && !(lock && lock.by !== myId);
  function applyEditable() { if (typeof editor !== 'undefined' && editor) editor.updateOptions({ readOnly: !editableNow() }); }

  const LOCK_SVG = (open) => '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="' + (open ? 'M8 11V7a4 4 0 0 1 7.5-2' : 'M8 11V7a4 4 0 0 1 8 0v4') + '"/></svg>';

  /** Padlock on the open file's tab: only shown with more than one person in the file (or while it is locked). */
  function renderLock() {
    const bar = document.getElementById('tab-bar');
    if (!bar) return;
    bar.querySelectorAll('.tab-lock').forEach(b => b.remove());
    const tab = bar.querySelector('.tab.active');
    if (!tab || !ws || !synced || !canEdit || (peers.size < 1 && !lock)) return;
    const mine = lock && lock.by === myId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab-lock' + (lock ? ' locked' : '') + (lock && !mine ? ' by-other' : '');
    btn.innerHTML = LOCK_SVG(!lock);
    const who = lock && !mine ? (lock.name || '?') : '';
    btn.title = !lock ? T('Lock this file: only you can edit')
      : mine ? T('Locked by you. Click to unlock')
      : T('Locked by {0}. Click to unlock').replace('{0}', who);
    btn.setAttribute('aria-pressed', lock ? 'true' : 'false');
    btn.onclick = ev => {
      ev.stopPropagation();
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: lock ? 'unlock' : 'lock' }));
    };
    tab.insertBefore(btn, tab.querySelector('.tab-name'));
  }
  window.collabLockRefresh = renderLock;

  // ---------------------------------------------------------------- connected people

  function renderPeers() {
    const box = document.getElementById('collab-users');
    if (!box) return;
    box.textContent = '';
    peers.forEach(p => {
      const color = colorOf(p.id);
      const label = `${p.name || '?'}: editing this file`;
      let node;
      if (p.picture && String(p.picture).startsWith('https://')) {
        node = document.createElement('img');
        node.src = p.picture;
        node.referrerPolicy = 'no-referrer';
        node.alt = '';
      } else {
        node = document.createElement('div');
        node.textContent = ((p.name || '?').trim()[0] || '?').toUpperCase();
      }
      node.className = 'collab-avatar';
      node.style.borderColor = color;
      if (node.tagName === 'DIV') node.style.background = color;
      node.title = label;
      box.appendChild(node);
    });
    if (peers.size > 0) {
      const t = document.createElement('span');
      t.className = 'collab-count';
      t.textContent = peers.size === 1 ? '1 person in this file' : `${peers.size} people in this file`;
      box.appendChild(t);
    }
  }
})();
