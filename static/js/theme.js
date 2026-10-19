// NeoLeaf themes: a single palette that feeds the interface CSS variables and the Monaco theme.
// Loaded in the <head> (before the CSS paints) to avoid flashing. Choice saved in localStorage ("system" follows the OS).
(function () {
  // bg editor/page · bg2 panels · bg3 tertiary · hover · border · text · bright · muted · accent · onAccent
  // btn (primary button) · onBtn · success · warn · danger · link · green · pdf · log · syntax: c b p t y o s l x g f
  const T = {
    neoleaf: { name: 'NeoLeaf', base: 'vs-dark', bg: '#0b1f2a', bg2: '#0f2a38', bg3: '#153646', hover: '#1d4558', border: '#1f4a5e', text: '#c9e3ea', bright: '#f0fbfc', muted: '#7fa6b3', accent: '#0b7a9c', onAccent: '#ffffff', btn: '#20b090', onBtn: '#04221f', success: '#3ccf9e', warn: '#f0c060', danger: '#f0816f', link: '#4cc9e0', green: '#2fd0a8', pdf: '#1b3a48', log: '#08181f',
      c: '5F8A94', b: '3FB0D8', p: '8FA4F0', t: '2FD0A8', y: 'E6D98A', o: 'E8A76A', s: '7FD8B0', l: '4CC9E0', x: '7FD6E8', g: 'A6E3B5', f: 'CFE6EC' },
    neoleafwhite: { name: 'NeoLeaf White', base: 'vs', bg: '#ffffff', bg2: '#f2f8fa', bg3: '#e4f0f4', hover: '#d3e6ed', border: '#c9dde5', text: '#24424f', bright: '#0a2733', muted: '#5f7f8c', accent: '#0a6f9e', onAccent: '#ffffff', btn: '#0c7f6a', onBtn: '#ffffff', success: '#12846b', warn: '#a86a00', danger: '#c24634', link: '#0a6f9e', green: '#0f8f78', pdf: '#cfe0e7', log: '#f2f8fa',
      c: '6B8F99', b: '0A6F9E', p: '5B6FD0', t: '0F8F78', y: '8A6D12', o: 'B5601E', s: '12846B', l: '0A6F9E', x: '0B7F9C', g: '2E8B57', f: '24424F' },
    dark: { name: 'Dark', base: 'vs-dark', bg: '#1e1e1e', bg2: '#252526', bg3: '#2d2d30', hover: '#38383c', border: '#3e3e42', text: '#cccccc', bright: '#ffffff', muted: '#8a8a8a', accent: '#0e639c', onAccent: '#ffffff', btn: '#2f7d2b', onBtn: '#ffffff', success: '#4caf50', warn: '#ff9800', danger: '#f48771', link: '#8ab4f8', green: '#4ec9b0', pdf: '#3a3d41', log: '#181818',
      c: '6A9955', b: '569CD6', p: 'C586C0', t: '4EC9B0', y: 'DCDCAA', o: 'D19A66', s: 'CE9178', l: '3794FF', x: '9CDCFE', g: 'B5CEA8', f: 'D4D4D4' },
    light: { name: 'Light', base: 'vs', bg: '#ffffff', bg2: '#f3f4f7', bg3: '#e8eaf0', hover: '#dfe2ea', border: '#d0d4de', text: '#2b303b', bright: '#11141a', muted: '#6b7280', accent: '#1a6fb5', onAccent: '#ffffff', btn: '#238048', onBtn: '#ffffff', success: '#2e7d32', warn: '#b26a00', danger: '#c62828', link: '#1a5fb4', green: '#00796b', pdf: '#c9ccd3', log: '#f5f5f5',
      c: '5A8A45', b: '0451A5', p: 'AF00DB', t: '267F99', y: '795E26', o: 'B5651D', s: 'A31515', l: '0066CC', x: '001080', g: '098658', f: '333333' },
    mocha: { name: 'Catppuccin Mocha', base: 'vs-dark', bg: '#1e1e2e', bg2: '#181825', bg3: '#313244', hover: '#45475a', border: '#45475a', text: '#cdd6f4', bright: '#f5f7ff', muted: '#9399b2', accent: '#89b4fa', onAccent: '#1e1e2e', btn: '#a6e3a1', onBtn: '#1e1e2e', success: '#a6e3a1', warn: '#f9e2af', danger: '#f38ba8', link: '#89b4fa', green: '#94e2d5', pdf: '#45475a', log: '#11111b',
      c: '6C7086', b: '89B4FA', p: 'CBA6F7', t: '94E2D5', y: 'F9E2AF', o: 'FAB387', s: 'A6E3A1', l: '74C7EC', x: '89DCEB', g: 'FAB387', f: 'CDD6F4' },
    latte: { name: 'Catppuccin Latte', base: 'vs', bg: '#eff1f5', bg2: '#e6e9ef', bg3: '#ccd0da', hover: '#bcc0cc', border: '#bcc0cc', text: '#4c4f69', bright: '#1e2030', muted: '#6c6f85', accent: '#1e66f5', onAccent: '#ffffff', btn: '#2c7f1c', onBtn: '#ffffff', success: '#2c7f1c', warn: '#a86500', danger: '#d20f39', link: '#1a58d6', green: '#0d7a80', pdf: '#d6d9e3', log: '#e6e9ef',
      c: '7C7F93', b: '1E66F5', p: '8839EF', t: '179299', y: 'A86500', o: 'C2410C', s: '2C7F1C', l: '0B7BA8', x: '167F92', g: 'C2410C', f: '4C4F69' },
    dracula: { name: 'Dracula', base: 'vs-dark', bg: '#282a36', bg2: '#21222c', bg3: '#343746', hover: '#44475a', border: '#44475a', text: '#f8f8f2', bright: '#ffffff', muted: '#8d95b8', accent: '#bd93f9', onAccent: '#282a36', btn: '#50fa7b', onBtn: '#282a36', success: '#50fa7b', warn: '#f1fa8c', danger: '#ff5555', link: '#8be9fd', green: '#50fa7b', pdf: '#44475a', log: '#191a21',
      c: '6272A4', b: '8BE9FD', p: 'FF79C6', t: '50FA7B', y: 'F1FA8C', o: 'FFB86C', s: 'F1FA8C', l: '8BE9FD', x: '8BE9FD', g: 'BD93F9', f: 'F8F8F2' },
    nord: { name: 'Nord', base: 'vs-dark', bg: '#2e3440', bg2: '#272c36', bg3: '#3b4252', hover: '#434c5e', border: '#434c5e', text: '#d8dee9', bright: '#eceff4', muted: '#8f9bb3', accent: '#88c0d0', onAccent: '#2e3440', btn: '#a3be8c', onBtn: '#2e3440', success: '#a3be8c', warn: '#ebcb8b', danger: '#d9737c', link: '#88c0d0', green: '#8fbcbb', pdf: '#3b4252', log: '#242933',
      c: '7B88A3', b: '81A1C1', p: 'B48EAD', t: '8FBCBB', y: 'EBCB8B', o: 'D08770', s: 'A3BE8C', l: '88C0D0', x: '88C0D0', g: 'B48EAD', f: 'D8DEE9' },
    gruvbox: { name: 'Gruvbox', base: 'vs-dark', bg: '#282828', bg2: '#1d2021', bg3: '#3c3836', hover: '#504945', border: '#504945', text: '#ebdbb2', bright: '#fbf1c7', muted: '#a89984', accent: '#83a598', onAccent: '#282828', btn: '#b8bb26', onBtn: '#282828', success: '#b8bb26', warn: '#fabd2f', danger: '#fb4934', link: '#83a598', green: '#8ec07c', pdf: '#504945', log: '#1d2021',
      c: '928374', b: '83A598', p: 'D3869B', t: '8EC07C', y: 'FABD2F', o: 'FE8019', s: 'B8BB26', l: '83A598', x: '8EC07C', g: 'D3869B', f: 'EBDBB2' },
    solarized: { name: 'Solarized Light', base: 'vs', bg: '#fdf6e3', bg2: '#eee8d5', bg3: '#e4ddc4', hover: '#d9d2b8', border: '#d3cbb0', text: '#46595f', bright: '#073642', muted: '#5e7479', accent: '#1b6fae', onAccent: '#fdf6e3', btn: '#667700', onBtn: '#fdf6e3', success: '#667700', warn: '#8f6b00', danger: '#dc322f', link: '#1b6fae', green: '#1d7f78', pdf: '#e6dfc8', log: '#eee8d5',
      c: '768587', b: '268BD2', p: '6C71C4', t: '1D857E', y: '946F00', o: 'CB4B16', s: '1D857E', l: '268BD2', x: '1D857E', g: '667900', f: '586E75' }
  };
  const KEY = 'ld-theme';
  const DEFAULT = 'neoleafwhite';   // default theme for anyone who has not chosen yet
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function cookie(name) { const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
  function pref() {
    let v = '';
    try { v = localStorage.getItem(KEY) || ''; } catch (_) {}
    v = v || cookie('ld_theme');
    return T[v] || v === 'system' ? v : DEFAULT;
  }
  function resolve(p) { return T[p] ? p : (mq && !mq.matches ? 'light' : 'dark'); }

  function css(t) {
    return ':root{color-scheme:' + (t.base === 'vs' ? 'light' : 'dark') + ';' +
      '--bg-primary:' + t.bg + ';--bg-secondary:' + t.bg2 + ';--bg-tertiary:' + t.bg3 + ';--bg-hover:' + t.hover + ';--border-color:' + t.border + ';--border-strong:' + t.hover +
      ';--text-primary:' + t.text + ';--text-bright:' + t.bright + ';--muted:' + t.muted + ';--accent-color:' + t.accent + ';--on-accent:' + t.onAccent +
      ';--green-btn:' + t.btn + ';--on-btn:' + t.onBtn + ';--success:' + t.success + ';--warn:' + t.warn + ';--danger-color:' + t.danger + ';--link:' + t.link + ';--green:' + t.green +
      ';--pdf-bg:' + t.pdf + ';--log-bg:' + t.log + ';}';
  }

  function apply() {
    const id = resolve(pref());
    const t = T[id];
    let el = document.getElementById('ld-theme-vars');
    if (!el) { el = document.createElement('style'); el.id = 'ld-theme-vars'; document.head.appendChild(el); }
    el.textContent = css(t);
    document.documentElement.dataset.theme = id;
    window.dispatchEvent(new CustomEvent('ld-theme-change', { detail: { id } }));
  }

  function set(p) {
    try { localStorage.setItem(KEY, p); } catch (_) {}
    apply();
    // the preference stays in this browser only (the server stores no person data beyond the session)
  }

  // no profile on the server: nothing to sync
  function syncFromProfile() {}

  // Monaco theme derived from the palette
  function monacoTheme(t) {
    const r = (token, fg, fontStyle) => (fontStyle ? { token, foreground: fg, fontStyle } : { token, foreground: fg });
    const rules = [
      r('comment', t.c, 'italic'), r('keyword.command', t.b), r('keyword.control', t.p, 'bold'), r('variable.environment', t.t), r('keyword.section', t.y, 'bold'),
      r('keyword.preamble', t.p), r('keyword.reference', t.o), r('string.reference', t.s), r('string.link', t.l, 'underline'), r('string.option', t.o),
      r('string.math.delimiter', t.o, 'bold'), r('string.math', t.y), r('keyword.math', t.x), r('number.math', t.g), r('operator.math', t.f), r('string.verbatim', t.s),
      r('keyword.escape', t.o), r('operator.align', t.f, 'bold'), r('variable.parameter', t.x), r('keyword.entry', t.b, 'bold'), r('type.identifier', t.t),
      r('attribute.name', t.x), r('string', t.s), r('string.escape', t.o), r('number', t.g), r('variable.name', t.y)
    ];
    return {
      base: t.base, inherit: true, rules,
      colors: {
        'editor.background': t.bg, 'editor.foreground': '#' + t.f, 'editorLineNumber.foreground': t.muted, 'editorLineNumber.activeForeground': t.text,
        'editor.lineHighlightBackground': t.bg2, 'editor.selectionBackground': t.accent + '55', 'editor.inactiveSelectionBackground': t.accent + '30',
        'editorCursor.foreground': t.accent, 'editorGutter.background': t.bg, 'editorWidget.background': t.bg2, 'editorWidget.border': t.border,
        'editorSuggestWidget.background': t.bg2, 'editorSuggestWidget.border': t.border, 'editorSuggestWidget.selectedBackground': t.accent + '55',
        'editorHoverWidget.background': t.bg2, 'editorHoverWidget.border': t.border, 'list.hoverBackground': t.hover, 'list.activeSelectionBackground': t.accent + '55',
        'input.background': t.bg3, 'input.border': t.border, 'scrollbarSlider.background': t.hover + '99', 'minimap.background': t.bg,
        'editorIndentGuide.background1': t.border, 'editorWhitespace.foreground': t.border
      }
    };
  }

  function defineMonaco(monaco) {
    Object.keys(T).forEach(id => monaco.editor.defineTheme('ld-' + id, monacoTheme(T[id])));
    monaco.editor.setTheme('ld-' + resolve(pref()));
    window.addEventListener('ld-theme-change', e => monaco.editor.setTheme('ld-' + e.detail.id));
  }

  // theme picker in the top bar (elements with id="theme-picker")
  function mount() {
    document.querySelectorAll('[data-theme-picker]').forEach(host => {
      if (host.firstChild) return;
      const sel = document.createElement('select');
      sel.className = 'theme-select theme-picker-select';
      sel.title = 'Theme';
      sel.setAttribute('aria-label', 'Theme');
      const opt = (v, n) => { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.appendChild(o); };
      opt('system', '🖥 System');
      Object.keys(T).forEach(id => opt(id, T[id].name));
      sel.value = pref();
      sel.addEventListener('change', () => set(sel.value));
      host.appendChild(sel);
    });
  }

  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (pref() === 'system') apply(); });
  window.addEventListener('storage', e => { if (e.key === KEY) apply(); });
  apply();
  document.addEventListener('DOMContentLoaded', () => { mount(); syncFromProfile(); });
  window.LDTheme = { themes: T, set, pref, resolve: () => resolve(pref()), monacoId: () => 'ld-' + resolve(pref()), defineMonaco, mount };
})();
