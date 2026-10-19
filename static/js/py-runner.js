// Runs Python (Pyodide, in WebAssembly) in the browser, with nothing to install. PROTOTYPE of the "Run" feature.
//
// Security (the script may come from collaborators): Pyodide runs in a Worker INSIDE a sandboxed iframe (isolated origin, no
// access to the page or the session cookie), with a content security policy (CSP) that only allows downloading from /static/pyodide/ (no external
// network, nothing from the NeoLeaf API). The project files go into a virtual Python folder and only what the script generates comes back.
// Everything is downloaded on demand: the engine (~6 MB) on the first run and each package (numpy, pandas...) only when the code imports it.
//
// Usage: PyRunner.run(code, { files: { 'data.csv': 'a,b\n1,2' }, onStatus, onStdout, onStderr, timeoutMs })
//      -> { ok, error, stdout, stderr, files: { 'figure.png': Uint8Array }, ms, initMs }      PyRunner.stop() ends everything.
(function () {
  'use strict';

  const BASE = location.origin + '/static/pyodide/';
  const MAX_OUT_FILES = 50, MAX_OUT_BYTES = 30 * 1024 * 1024, MAX_IN_BYTES = 30 * 1024 * 1024;

  let frame = null, ready = false, readyAt = 0, startedAt = 0, current = null, initWaiters = [], resetWaiters = [], epoch = 0;

  // ---- notebook kernel (Python that runs in the Worker): cell-by-cell execution with state, in the nbformat output format
  const KERNEL_PY = `
import ast, sys, io, json, base64, traceback, linecache, warnings, re
warnings.filterwarnings('ignore', message='FigureCanvasAgg is non-interactive')
_NB = {'g': None, 'outs': None}

def _nb_display(*objs):
    for o in objs:
        _NB['outs'].append({'output_type': 'display_data', 'data': _nb_mime(o), 'metadata': {}})

def _nb_reset():
    _NB['g'] = {'__name__': '__main__', 'display': _nb_display}

def _nb_mime(obj):
    data = {}
    for attr, mime in (('_repr_html_', 'text/html'), ('_repr_markdown_', 'text/markdown'), ('_repr_svg_', 'image/svg+xml'), ('_repr_latex_', 'text/latex')):
        f = getattr(obj, attr, None)
        if callable(f):
            try:
                v = f()
            except Exception:
                v = None
            if isinstance(v, str) and v:
                data[mime] = v
    for attr, mime in (('_repr_png_', 'image/png'), ('_repr_jpeg_', 'image/jpeg')):
        f = getattr(obj, attr, None)
        if callable(f):
            try:
                v = f()
            except Exception:
                v = None
            if isinstance(v, (bytes, bytearray)) and v:
                data[mime] = base64.b64encode(bytes(v)).decode()
    data['text/plain'] = repr(obj)
    return data

def _nb_figures(outs):
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is None:
        return
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=100)
        w, h = fig.get_size_inches()
        outs.append({'output_type': 'display_data', 'metadata': {}, 'data': {
            'image/png': base64.b64encode(buf.getvalue()).decode(),
            'text/plain': '<Figure size %dx%d with %d Axes>' % (w * fig.dpi, h * fig.dpi, len(fig.axes))}})
    plt.close('all')

_MAGIC = re.compile(r'^[ \\t]*%(matplotlib|config|load_ext|reload_ext|autoreload|pylab|precision)\\b.*$', re.M)

def _nb_tb(e):
    tb = e.__traceback__
    while tb is not None and tb.tb_frame.f_code.co_filename != '<cell>':
        tb = tb.tb_next
    if tb is None:
        text = ''.join(traceback.format_exception_only(type(e), e))
    else:
        text = ''.join(traceback.format_exception(type(e), e, tb))
    return text.rstrip('\\n').split('\\n')

def _nb_run(code):
    g = _NB['g']
    outs = []
    _NB['outs'] = outs
    src = _MAGIC.sub('', code)
    suppress = src.rstrip().endswith(';')
    linecache.cache['<cell>'] = (len(src), None, src.splitlines(True), '<cell>')
    error = None
    try:
        tree = ast.parse(src, '<cell>', 'exec')
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        exec(compile(tree, '<cell>', 'exec'), g)
        if last is not None:
            val = eval(compile(last, '<cell>', 'eval'), g)
            if val is not None and not suppress:
                outs.append({'output_type': 'execute_result', 'data': _nb_mime(val), 'metadata': {}, 'execution_count': None})
    except BaseException as e:
        error = {'ename': type(e).__name__, 'evalue': str(e), 'traceback': _nb_tb(e)}
    try:
        _nb_figures(outs)
    except Exception:
        pass
    return json.dumps({'outputs': outs, 'error': error})

_nb_reset()
`;

  // ---- code that runs in the (classic) Worker: it is sent as text
  function workerMain() {
    let py = null;
    const send = (m, t) => postMessage(m, t || []);
    const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

    async function init(base) {
      send({ status: 'Loading Python...' });
      importScripts(base + 'pyodide.js');   // Classic Worker: a module Worker does not load from a blob in an isolated origin
      py = await loadPyodide({ indexURL: base, stdout: s => send({ stdout: s }), stderr: s => send({ stderr: s }) });
      py.runPython("import os\nos.environ['MPLBACKEND'] = 'Agg'");
      py.runPython(KERNEL);
      send({ ready: true });
    }

    function walk(dir, out) {
      for (const name of py.FS.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        const full = dir + '/' + name, st = py.FS.stat(full);
        if (py.FS.isDir(st.mode)) walk(full, out); else out.push([full, st.size, st.mtime.getTime ? st.mtime.getTime() : +st.mtime]);
      }
      return out;
    }
    function rmtree(dir) {
      for (const name of py.FS.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        const full = dir + '/' + name;
        if (py.FS.isDir(py.FS.stat(full).mode)) { rmtree(full); py.FS.rmdir(full); } else py.FS.unlink(full);
      }
    }

    async function run(m) {
      const root = '/work';
      try {
        try { py.FS.mkdir(root); } catch (_) { /* already exists */ }
        rmtree(root);
        for (const d of m.dirs || []) {   // the project folders exist, even if empty (the script may write to them)
          let acc = root;
          for (const part of d.split('/').filter(Boolean)) { acc += '/' + part; try { py.FS.mkdir(acc); } catch (_) { /* already exists */ } }
        }
        for (const [path, data] of Object.entries(m.files || {})) {
          const full = root + '/' + path;
          let acc = root;
          for (const part of dirOf(path).split('/').filter(Boolean)) { acc += '/' + part; try { py.FS.mkdir(acc); } catch (_) { /* already exists */ } }
          py.FS.writeFile(full, data);
        }
        const before = new Map(walk(root, []).map(([p, size, t]) => [p, size + ':' + t]));
        py.FS.chdir(root);
        await py.loadPackagesFromImports(m.code, { messageCallback: s => send({ status: s }), errorCallback: s => send({ stderr: s }) });
        send({ status: 'Running...' });
        const globals = py.globals.get('dict')();
        globals.set('__name__', '__main__');
        if (m.scriptPath) {
          globals.set('__file__', root + '/' + m.scriptPath);
          const dir = root + (dirOf(m.scriptPath) ? '/' + dirOf(m.scriptPath) : '');
          py.runPython('import sys\nfor p in (' + JSON.stringify(dir) + ', ' + JSON.stringify(root) + '):\n    if p not in sys.path:\n        sys.path.insert(0, p)');
        }
        let result;
        try { result = await py.runPythonAsync(m.code, { globals }); } finally { globals.destroy(); }
        const outs = [], buffers = [];
        let total = 0;
        for (const [p, size, t] of walk(root, [])) {
          if (before.get(p) === size + ':' + t) continue;
          if (outs.length >= m.maxFiles || total + size > m.maxBytes) { send({ stderr: 'Generated file ignored (size limit): ' + p.slice(root.length + 1) }); continue; }
          const bytes = py.FS.readFile(p);
          total += size;
          outs.push([p.slice(root.length + 1), bytes]);
          buffers.push(bytes.buffer);
        }
        rmtree(root);
        send({ done: true, id: m.id, ok: true, result: result === undefined || result === null ? '' : String(result), files: outs }, buffers);
      } catch (e) {
        try { rmtree(root); } catch (_) { /* clean what can be cleaned */ }
        send({ done: true, id: m.id, ok: false, error: String((e && e.message) || e) });
      }
    }

    // Notebook cell: the same kernel (variables) is used across cells; returns the outputs in the nbformat format
    function mkdirp(base, rel) {
      let acc = base;
      for (const part of String(rel || '').split('/').filter(Boolean)) { acc += '/' + part; try { py.FS.mkdir(acc); } catch (_) { /* already exists */ } }
      return acc;
    }
    async function cell(m) {
      try {
        // the project in the Python file system (sent only when it changes); the working directory is the notebook's folder, as in Jupyter
        const root = '/work';
        try { py.FS.mkdir(root); } catch (_) { /* already exists */ }
        for (const d of m.dirs || []) mkdirp(root, d);
        for (const [rel, data] of Object.entries(m.files || {})) { mkdirp(root, rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''); py.FS.writeFile(root + '/' + rel, data); }
        const cwd = mkdirp(root, m.cwd);
        py.FS.chdir(cwd);
        py.runPython('import sys\nfor p in (' + JSON.stringify(cwd) + ', ' + JSON.stringify(root) + '):\n    if p not in sys.path:\n        sys.path.insert(0, p)');
        // magic lines (%matplotlib inline) and shell lines (!pip) are not Python: removed only to find the imports (otherwise the analyzer gives up and nothing is downloaded)
        const forImports = m.code.replace(/^[ \t]*[%!].*$/gm, '');
        try { await py.loadPackagesFromImports(forImports, { messageCallback: s => send({ status: s }), errorCallback: s => send({ stderr: s }) }); }
        catch (e) { throw new Error('Could not download a Python package: ' + ((e && e.message) || e)); }
        send({ status: 'Running...' });
        const out = JSON.parse(py.globals.get('_nb_run')(m.code));
        py.runPython('import sys\nsys.stdout.flush()\nsys.stderr.flush()');
        send({ done: true, id: m.id, ok: true, cell: out });
      } catch (e) {
        send({ done: true, id: m.id, ok: true, cell: { outputs: [], error: { ename: 'Error', evalue: String((e && e.message) || e), traceback: [String((e && e.message) || e)] } } });
      }
    }

    onmessage = e => {
      const m = e.data || {};
      if (m.init) init(m.base).catch(err => send({ initError: String((err && err.message) || err) }));
      else if (m.run) run(m.run);
      else if (m.cell) cell(m.cell);
      else if (m.reset) { py.globals.get('_nb_reset')(); send({ resetDone: true }); }
    };
  }

  // ---- code that runs in the isolated iframe: creates the Worker and relays the messages
  function frameMain(cfg) {
    const post = m => parent.postMessage(Object.assign({ neoleafPy: true }, m), '*');
    let worker = null;
    function start() {
      if (worker) return;
      const url = URL.createObjectURL(new Blob([cfg.workerSrc], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = e => post(e.data);
      worker.onerror = e => post({ initError: 'Worker failure: ' + (e.message || 'unknown error') });
      worker.postMessage({ init: true, base: cfg.base });
    }
    addEventListener('message', e => {
      if (e.source !== parent) return;
      const d = e.data || {};
      if (d.start) start();
      else if (d.run && worker) worker.postMessage({ run: d.run });
      else if (d.cell && worker) worker.postMessage({ cell: d.cell });
      else if (d.reset && worker) worker.postMessage({ reset: true });
    });
    post({ frameReady: true });
  }

  function shell() {
    const nonce = btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(18))));
    const workerSrc = 'const KERNEL = ' + JSON.stringify(KERNEL_PY) + ';\n(' + workerMain.toString() + ')();';
    // 'wasm-unsafe-eval': Python's WebAssembly; the network is limited to what NeoLeaf serves at /static/pyodide/
    const csp = `default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${BASE} blob:; worker-src blob:; connect-src ${BASE}`;
    const script = '(' + frameMain.toString() + ')(' + JSON.stringify({ base: BASE, workerSrc }).replace(/</g, '\\u003c') + ');';
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><script nonce="${nonce}">${script}<\/script></body></html>`;
  }

  function ensureFrame() {
    if (frame) return;
    ready = false;
    epoch++;   // a new engine: the Python file system starts empty again
    frame = document.createElement('iframe');
    frame.id = 'py-runner-frame';
    frame.title = 'Python';
    frame.style.display = 'none';
    // no allow-same-origin: Python runs in an isolated origin, with no access to the page or the session cookie
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = shell();
    document.body.appendChild(frame);
  }

  function post(msg) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*');
  }

  function whenReady() {
    ensureFrame();
    if (ready) return Promise.resolve();
    return new Promise((resolve, reject) => initWaiters.push({ resolve, reject }));
  }

  function stop(reason) {
    if (frame) frame.remove();
    frame = null; ready = false;
    const waiters = initWaiters; initWaiters = [];
    waiters.forEach(w => w.reject(new Error(reason || 'Interrupted')));
    if (current && current.kind === 'cell') { const c = current; current = null; clearTimeout(c.timer); resetWaiters.forEach(x => x()); resetWaiters = []; c.resolve({ ok: false, interrupted: true, error: { ename: 'KeyboardInterrupt', evalue: reason || 'Interrupted', traceback: [reason || 'Interrupted'] }, outputs: [], ms: Date.now() - c.t0 }); return; }
    if (current) { const c = current; current = null; clearTimeout(c.timer); c.resolve({ ok: false, error: reason || 'Interrupted', stdout: c.stdout.join('\n'), stderr: c.stderr.join('\n'), files: {}, ms: Date.now() - c.t0, initMs: 0 }); }
  }

  window.addEventListener('message', e => {
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.neoleafPy !== true) return;
    if (d.frameReady) { startedAt = Date.now(); post({ start: true }); return; }
    if (d.ready) { ready = true; readyAt = Date.now() - startedAt; const w = initWaiters; initWaiters = []; w.forEach(x => x.resolve()); return; }
    if (d.initError) { const msg = String(d.initError).slice(0, 500); stop(msg); return; }
    if (d.resetDone) { const w = resetWaiters; resetWaiters = []; w.forEach(x => x()); return; }
    if (!current) return;
    if (typeof d.status === 'string') current.onStatus(d.status.slice(0, 300));
    if (typeof d.stdout === 'string') { current.stdout.push(d.stdout); current.onStdout(d.stdout); }
    if (typeof d.stderr === 'string') { current.stderr.push(d.stderr); current.onStderr(d.stderr); }
    if (d.done && d.id === current.id && current.kind === 'cell') {
      const c = current; current = null; clearTimeout(c.timer);
      const cell = d.cell || {};
      c.resolve({ ok: true, outputs: Array.isArray(cell.outputs) ? cell.outputs : [], error: cell.error || null, ms: Date.now() - c.t0 });
      return;
    }
    if (d.done && d.id === current.id) {
      const c = current; current = null; clearTimeout(c.timer);
      const files = {};
      for (const [name, bytes] of (d.ok && Array.isArray(d.files) ? d.files : [])) if (typeof name === 'string' && bytes instanceof Uint8Array) files[name] = bytes;
      c.resolve({ ok: !!d.ok, error: d.ok ? '' : String(d.error || ''), result: d.result || '', stdout: c.stdout.join('\n'), stderr: c.stderr.join('\n'), files, ms: Date.now() - c.t0, initMs: c.initMs });
    }
  });

  let nextId = 0;
  async function run(code, opts) {
    opts = opts || {};
    if (current) throw new Error('A script is already running.');
    const files = {};
    let total = 0;
    for (const [name, v] of Object.entries(opts.files || {})) {
      const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : v;
      total += bytes.length;
      if (total > MAX_IN_BYTES) throw new Error('Too many files for Python (limit of 30 MB).');
      if (!/^[^\0]+$/.test(name) || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Invalid file name: ' + name);
      files[name] = bytes;
    }
    const t0 = Date.now();
    const c = { id: ++nextId, t0, initMs: 0, stdout: [], stderr: [], onStatus: opts.onStatus || (() => {}), onStdout: opts.onStdout || (() => {}), onStderr: opts.onStderr || (() => {}), resolve: null, timer: null };
    current = c;
    const done = new Promise(resolve => { c.resolve = resolve; });
    c.timer = setTimeout(() => stop('Timed out (' + Math.round((opts.timeoutMs || 120000) / 1000) + ' s): the script was interrupted.'), opts.timeoutMs || 120000);
    try {
      if (!ready) c.onStatus('Loading Python...');
      await whenReady();
      c.initMs = readyAt;
    } catch (err) {
      if (current === c) { current = null; clearTimeout(c.timer); }
      return { ok: false, error: String(err.message || err), result: '', stdout: '', stderr: '', files: {}, ms: Date.now() - t0, initMs: 0 };
    }
    if (current !== c) return done;
    frame.contentWindow.postMessage({ run: { id: c.id, code: String(code), scriptPath: typeof opts.scriptPath === 'string' ? opts.scriptPath : '', dirs: Array.isArray(opts.dirs) ? opts.dirs.filter(d => typeof d === 'string' && d.length < 300 && !d.startsWith('/') && !d.split('/').includes('..')) : [], files, maxFiles: MAX_OUT_FILES, maxBytes: MAX_OUT_BYTES } }, '*');
    return done;
  }

  // ---- notebook kernel: variables persist across cells until restart or stop (stopping kills the Worker, so the kernel starts over)
  async function cell(code, opts) {
    opts = opts || {};
    if (current) throw new Error('A run is already in progress.');
    const t0 = Date.now();
    const c = { id: ++nextId, kind: 'cell', t0, initMs: 0, stdout: [], stderr: [], onStatus: opts.onStatus || (() => {}), onStdout: opts.onStdout || (() => {}), onStderr: opts.onStderr || (() => {}), resolve: null, timer: null };
    current = c;
    const done = new Promise(resolve => { c.resolve = resolve; });
    if (opts.timeoutMs) c.timer = setTimeout(() => stop('Timed out (' + Math.round(opts.timeoutMs / 1000) + ' s): the kernel was restarted.'), opts.timeoutMs);
    try {
      if (!ready) c.onStatus('Loading Python...');
      await whenReady();
    } catch (err) {
      if (current === c) { current = null; clearTimeout(c.timer); }
      return { ok: false, interrupted: true, error: { ename: 'Interrupted', evalue: String(err.message || err), traceback: [String(err.message || err)] }, outputs: [], ms: Date.now() - t0 };
    }
    if (current !== c) return done;
    frame.contentWindow.postMessage({ cell: { id: c.id, code: String(code), cwd: typeof opts.cwd === 'string' ? opts.cwd : '', files: opts.files || null, dirs: Array.isArray(opts.dirs) ? opts.dirs : null } }, '*');
    const r = await done;
    if (r.ok === false) return r;
    return r;
  }

  function resetKernel() {
    if (!frame || !ready) return Promise.resolve();
    return new Promise(resolve => { resetWaiters.push(resolve); post({ reset: true }); });
  }

  async function available() {
    try { return (await fetch(BASE + 'pyodide-lock.json', { method: 'HEAD' })).ok; } catch (_) { return false; }
  }

  window.PyRunner = { run, cell, resetKernel, epoch: () => epoch, stop: () => stop('Interrupted'), available, preload: () => whenReady().catch(() => {}), isReady: () => ready };
})();
