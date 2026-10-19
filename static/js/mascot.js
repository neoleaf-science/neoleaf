// NeoLeaf mascot: an optional animated helper in the editor. Off by default; nothing is downloaded while it is off.
// The preference lives only in this browser (localStorage `ld-mascot` = '1'), switched in the user modal.
// It is silent (no sound, no speech) and reacts to the compilation: it thinks while compiling, celebrates a success
// and points to the Logs tab on an error. Drag him anywhere; double-click for a trick.
// The animation library is vendored (MIT, see LICENSES.md) and loaded on demand with a dynamic import.
(function () {
  const KEY = 'ld-mascot';
  const POS_KEY = 'ld-mascot-pos';
  const HELLO_KEY = 'ld-mascot-hello';   // sessionStorage: greet once per browser session
  const SIZE = 96;                        // size on the screen, in CSS pixels
  const FRAME = 128;                      // size of one frame in the sprite sheet
  const MAP = [768, 640];                 // size of the sprite sheet
  const SCALE = SIZE / FRAME;
  const Z_INDEX = '900';                  // above the panels, below the modals

  let agent = null;
  let loading = null;
  const lastTalk = {};                    // kind -> time, so he never chatters

  const enabled = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };
  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** Says something, at most once per `minMs` for each kind of message. */
  function say(kind, text, minMs) {
    const now = Date.now();
    if (now - (lastTalk[kind] || 0) < minMs) return;
    lastTalk[kind] = now;
    agent.speak(T(text));
  }

  function savePosition() {
    try {
      const r = agent._el.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left / window.innerWidth, y: r.top / window.innerHeight }));
    } catch (_) {}
  }

  /** Sets his position directly (clamped to the window), without the library's queue or animations. */
  function placeAt(p) {
    const x = Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - SIZE));
    const y = Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - SIZE));
    agent._el.style.left = x + 'px';
    agent._el.style.top = y + 'px';
  }

  function startPosition() {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) return { x: p.x * window.innerWidth, y: p.y * window.innerHeight };
    } catch (_) {}
    return { x: window.innerWidth - SIZE - 16, y: window.innerHeight - SIZE - 16 };
  }

  /** The character data describes 128 px frames; this copy describes frames of SIZE px (every frame position is scaled). */
  function scaledData(data) {
    const d = JSON.parse(JSON.stringify(data));
    d.framesize = [SIZE, SIZE];
    for (const anim of Object.values(d.animations)) {
      for (const frame of anim.frames || []) {
        if (frame.images) frame.images = frame.images.map(([x, y]) => [x * SCALE, y * SCALE]);
      }
    }
    return d;
  }

  async function create() {
    const lib = await import('/static/vendor/neoleaf-mascot.mjs');
    agent = await lib.initAgent({
      agent: async () => ({ default: scaledData((await import('/static/vendor/neoleaf-mascot-agent.mjs')).default) }),
      map: () => ({ default: '/static/img/neoleaf-mascot.png' }),
      sound: () => ({ default: {} }),        // silent
    });
    agent._el.id = 'ld-mascot';
    // the sprite sheet is drawn smaller as well (the browser scales it, so it stays sharp on high-density screens)
    try { for (const o of agent._animator._overlays) o.style.backgroundSize = (MAP[0] * SCALE) + 'px ' + (MAP[1] * SCALE) + 'px'; } catch (_) {}
    agent._el.style.zIndex = Z_INDEX;
    try { agent._balloon._balloon.style.zIndex = Z_INDEX; } catch (_) {}
    agent._el.setAttribute('aria-hidden', 'true');   // decoration: the information is also in the status bar and the log
    window.addEventListener('mouseup', () => { if (agent && agent._el.style.display !== 'none') savePosition(); });
    document.addEventListener('visibilitychange', () => { if (!agent) return; if (document.hidden) agent.pause(); else if (!reducedMotion()) agent.resume(); });
  }

  async function turnOn() {
    if (!loading) loading = create().catch(() => { loading = null; });
    await loading;
    if (!agent || !enabled()) return;
    // Put him in his place BEFORE showing him: with no position the library shows him at the top centre of the screen and
    // only then moves him, which looked like a jump
    placeAt(startPosition());
    if (reducedMotion()) {
      agent.show(true);
      agent.pause();                          // a still picture, no idle animations
      return;
    }
    agent.show();
    let first = false;
    try { first = !sessionStorage.getItem(HELLO_KEY); sessionStorage.setItem(HELLO_KEY, '1'); } catch (_) {}
    if (first) {
      agent.play('Greeting');
      agent.speak(T("Hi! I'm NeoLeaf. Drag me anywhere, double-click me for a trick, and switch me off in your profile."));
    }
  }

  function turnOff() { if (agent) { agent.stop(); agent.hide(true); } }

  // reactions to the compilation (the events come from pdf-panel.js)
  window.addEventListener('ld-compile', ev => {
    if (!agent || !enabled() || reducedMotion()) return;
    const d = ev.detail || {};
    if (d.phase === 'start') agent.play('Thinking');
    else if (d.success) { agent.play('Congratulate'); say('ok', 'Compiled! Your PDF is ready.', 60000); }
    else { agent.play('Alert'); say('error', 'Something went wrong. Open the Logs tab to see the details.', 30000); }
  });

  // the user modal switches him on and off without reloading the page
  window.addEventListener('ld-mascot-change', () => { if (enabled()) turnOn(); else turnOff(); });

  if (enabled()) turnOn();
})();
