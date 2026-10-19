// Git blame in the editor gutter (toggle on and off).
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// -------------------------------------------------------------
// Git Blame in the editor (side gutter with on/off toggle)
// -------------------------------------------------------------
let isBlameActive = false;
let currentBlameData = null;
let blameScrollDisposable = null;

function formatBlameRelativeTime(timestampSec) {
  if (!timestampSec) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestampSec;
  if (diff < 60) return 'just now';
  if (diff < 3600) return T('{0}m ago', Math.floor(diff / 60));
  if (diff < 86400) return T('{0}h ago', Math.floor(diff / 3600));
  if (diff < 2592000) {
    const days = Math.floor(diff / 86400);
    return days === 1 ? T('yesterday') : T('{0}d ago', days);
  }
  if (diff < 31536000) {
    const m = Math.floor(diff / 2592000);
    return m === 1 ? T('1mo ago') : T('{0}mo ago', m);
  }
  const y = Math.floor(diff / 31536000);
  return y === 1 ? T('1y ago') : T('{0}y ago', y);
}

function getCommitHue(commit) {
  let h = 0;
  for (let i = 0; i < (commit || '').length; i++) {
    h = (h << 5) - h + commit.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % 360;
}

async function loadGitBlame(fileId) {
  const gutter = document.getElementById('blame-gutter');
  if (!gutter) return;

  const targetFile = fileId || currentFileId;
  if (!targetFile) {
    gutter.innerHTML = '<div style="padding:10px; color:var(--muted); font-size:11px;">' + T('No active file') + '</div>';
    return;
  }

  gutter.innerHTML = '<div style="padding:10px; color:var(--muted); font-size:11px;">' + T('Loading authorship...') + '</div>';

  try {
    currentBlameData = await BrowserGit.blame(targetFile);
    renderGitBlame(currentBlameData);
  } catch (err) {
    gutter.innerHTML = '<div style="padding:10px; color:var(--muted); font-size:11px;">' + T('No commit history for this file') + '</div>';
  }
}

function renderGitBlame(blameList) {
  const gutter = document.getElementById('blame-gutter');
  if (!gutter || !editor) return;

  gutter.innerHTML = '';
  if (!blameList || blameList.length === 0) {
    gutter.innerHTML = '<div style="padding:10px; color:var(--muted); font-size:11px;">' + T('No commit history') + '</div>';
    return;
  }

  const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight) || 19;
  const topPadding = (editor.getOption(monaco.editor.EditorOption.padding) || {}).top || 0;

  const inner = document.createElement('div');
  inner.style.position = 'relative';
  inner.style.paddingTop = topPadding + 'px';

  let prevCommit = '';

  blameList.forEach(item => {
    const row = document.createElement('div');
    row.className = 'blame-line';
    row.style.height = `${lineHeight}px`;
    row.style.lineHeight = `${lineHeight}px`;

    const hue = getCommitHue(item.commit);
    row.style.borderLeftColor = `hsl(${hue}, 65%, 55%)`;

    const isSame = (item.commit === prevCommit);
    if (isSame) {
      row.classList.add('same-commit');
    }

    const dateStr = item.timestamp ? new Date(item.timestamp * 1000).toLocaleString() : '';
    const relTime = formatBlameRelativeTime(item.timestamp);

    row.title = `${T('Commit')}: ${item.commit}\n${T('Author')}: ${item.author} <${item.email}>\n${T('Date')}: ${dateStr}\n\n${item.summary || T('(No message)')}`;

    const hashSpan = document.createElement('span');
    hashSpan.className = 'blame-hash';
    hashSpan.textContent = isSame ? '··' : (item.commit ? item.commit.substring(0, 7) : '');

    const authorSpan = document.createElement('span');
    authorSpan.className = 'blame-author';
    authorSpan.textContent = isSame ? '' : (item.author || T('Unknown'));

    const timeSpan = document.createElement('span');
    timeSpan.className = 'blame-time';
    timeSpan.textContent = isSame ? '' : relTime;

    row.appendChild(hashSpan);
    row.appendChild(authorSpan);
    row.appendChild(timeSpan);

    inner.appendChild(row);
    prevCommit = item.commit;
  });

  gutter.appendChild(inner);
  gutter.scrollTop = editor.getScrollTop();
}

function toggleGitBlame() {
  const gutter = document.getElementById('blame-gutter');
  const btn = document.getElementById('blame-toggle-btn');
  if (!gutter) return;

  isBlameActive = !isBlameActive;
  window.isBlameActive = isBlameActive;

  if (isBlameActive) {
    gutter.style.display = 'block';
    if (btn) btn.classList.add('active');
    if (editor) {
      editor.layout();
      if (!blameScrollDisposable) {
        blameScrollDisposable = editor.onDidScrollChange(e => {
          if (gutter) gutter.scrollTop = e.scrollTop;
        });
      }
    }
    loadGitBlame(currentFileId);
  } else {
    gutter.style.display = 'none';
    if (btn) btn.classList.remove('active');
    if (editor) {
      editor.layout();
    }
  }
}
window.toggleGitBlame = toggleGitBlame;
window.loadGitBlame = loadGitBlame;
window.renderGitBlame = renderGitBlame;
