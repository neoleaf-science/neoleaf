// Web Worker for Badness (formatter, syntax errors and style findings for LaTeX and BibTeX), compiled to WebAssembly (static/vendor/badness-engine*,
// built by scripts/build_badness_vendor.sh). Everything runs in the browser on the text it is given; nothing is sent anywhere.
// Messages are handled one at a time, in order.
/* global importScripts, wasm_bindgen */
importScripts('/static/vendor/badness-engine.js' + self.location.search); // same ?v= as the page, see badness.js

const query = self.location.search;
let ready = null;

function load() {
  if (!ready) {
    ready = wasm_bindgen({ module_or_path: '/static/vendor/badness-engine_bg.wasm' + query }).catch(err => { ready = null; throw err; });
  }
  return ready;
}

async function handle(msg) {
  await load();
  if (msg.type === 'check') {
    const findings = JSON.parse(wasm_bindgen.check(msg.text, msg.kind));
    self.postMessage({ type: 'checked', id: msg.id, findings: findings });
  } else if (msg.type === 'format') {
    const o = msg.options || {};
    const text = wasm_bindgen.format(msg.text, msg.kind, o.lineWidth, o.indentWidth, o.wrap, o.mathWrap);
    self.postMessage({ type: 'formatted', id: msg.id, text: text });
  } else if (msg.type === 'fix') {
    const text = wasm_bindgen.fix(msg.text, msg.kind, msg.includeUnsafe === true);
    self.postMessage({ type: 'fixed', id: msg.id, text: text });
  }
}

let queue = Promise.resolve();
self.onmessage = function (e) {
  const msg = e.data || {};
  queue = queue.then(() => handle(msg)).catch(err => {
    self.postMessage({ type: 'error', id: msg.id, message: (err && err.message) || String(err) });
  });
};
