// Project sharing dialog (collaborators and roles).
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// =====================================================================
// Share project (repository collaborator permissions)
// =====================================================================

const ROLE_LABELS = {
  owner: 'Owner',
  admin: T('Administrator'),
  writer: T('Editor (Push)'),
  push: T('Editor (Push)'),
  reader: T('Reader (Pull)'),
  pull: T('Reader (Pull)')
};

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === false || v === null || v === undefined) { /* attribute turned off (e.g. disabled: false) */ }
    else node.setAttribute(k, v === true ? '' : v);
  });
  children.forEach(c => node.append(c));
  return node;
}

function avatarFor(photo, name, email) {
  if (photo && photo.startsWith('https://')) {
    return h('img', { class: 'perm-avatar', src: photo, referrerpolicy: 'no-referrer', alt: '' });
  }
  const letter = ((name || email || '?').trim()[0] || '?').toUpperCase();
  return h('div', { class: 'perm-avatar' }, letter);
}

function showShareError(msg) {
  const box = document.getElementById('share-error');
  box.textContent = msg || '';
  box.style.display = msg ? 'block' : 'none';
}

function openShare() {
  document.getElementById('share-modal').style.display = 'flex';
  showShareError('');
  loadPermissions();
}

function closeShare() {
  document.getElementById('share-modal').style.display = 'none';
}

async function loadPermissions() {
  const list = document.getElementById('share-list');
  list.textContent = 'Loading...';
  try {
    const res = await fetch(`/api/project/${projectId}/permissions`);
    const data = await res.json();
    if (data.error) { list.textContent = ''; showShareError(data.error); return; }
    renderPermissions(data.permissions || [], (data.me || '').toLowerCase());
  } catch (err) {
    list.textContent = '';
    showShareError(T('Connection failure: {0}', err.message));
  }
}

function renderPermissions(perms, me) {
  const list = document.getElementById('share-list');
  list.textContent = '';
  const iAmOwner = perms.some(p => (p.role === 'owner' || p.role === 'admin') && (p.id || '').toLowerCase() === me);
  if (perms.length === 0) list.textContent = 'No other collaborators.';
  perms.forEach(p => {
    const isOwner = p.role === 'owner' || p.role === 'admin';
    const isMe = (p.id || '').toLowerCase() === me;
    const name = p.name || p.displayName || p.id;
    const info = h('div', { class: 'perm-info' },
      h('div', { class: 'perm-name' }, name + (isMe ? ' (you)' : '')),
      h('div', { class: 'perm-email' }, p.email || `@${p.id}`));
    const row = h('div', { class: 'perm-item' }, avatarFor(p.photo || p.photoLink, name, p.id), info);

    if (isOwner || !iAmOwner) {
      row.append(h('div', { class: 'perm-role' }, ROLE_LABELS[p.role] || p.role));
    } else {
      const sel = h('select', { class: 'form-control', style: 'max-width: 130px;' });
      [['writer', T('Editor (Push)')], ['reader', T('Reader (Pull)')], ['admin', T('Administrator')]].forEach(([v, l]) => {
        const o = h('option', { value: v }, l);
        if (v === p.role) o.selected = true;
        sel.append(o);
      });
      sel.addEventListener('change', () => changeRole(p.id, sel.value));
      row.append(sel, h('button', { class: 'btn', title: T('Remove access'), onclick: () => removePermission(p.id, name) }, '✕'));
    }
    list.append(row);
  });
}

async function submitShare(e) {
  e.preventDefault();
  const email = document.getElementById('share-email').value.trim();
  const role = document.getElementById('share-role').value;
  const btn = document.getElementById('share-submit');
  btn.disabled = true;
  showShareError('');
  try {
    const res = await fetch(`/api/project/${projectId}/permissions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role })
    });
    const data = await res.json();
    if (data.error) showShareError(data.error);
    else { document.getElementById('share-email').value = ''; await loadPermissions(); }
  } catch (err) {
    showShareError(T('Connection failure: {0}', err.message));
  } finally {
    btn.disabled = false;
  }
}

async function changeRole(permId, role) {
  showShareError('');
  const res = await fetch(`/api/project/${projectId}/permissions/${encodeURIComponent(permId)}/role`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role })
  });
  const data = await res.json();
  if (data.error) showShareError(data.error);
  await loadPermissions();
}

async function removePermission(permId, name) {
  if (!confirm(T('Remove access for {0}?', name))) return;
  showShareError('');
  const res = await fetch(`/api/project/${projectId}/permissions/${encodeURIComponent(permId)}/remove`, { method: 'POST' });
  const data = await res.json();
  if (data.error) showShareError(data.error);
  await loadPermissions();
}
