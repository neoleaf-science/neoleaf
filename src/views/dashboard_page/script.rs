// Inline scripts of the projects page.

/// Script of the projects list: tag colors, filter, sort, search and tag bar.
pub(super) fn list_script() -> &'static str {
    r##"    <script>
        const TAG_PALETTE = [
            '#388bfd', '#2ea043', '#a371f7', '#d29922',
            '#f778ba', '#39c5cf', '#f85149', '#56d364',
            '#bc8cff', '#58a6ff', '#f0883e', '#238636',
            '#ec4899', '#06b6d4', '#8b5cf6', '#eab308'
        ];
        function tagColor(tag) {
            const lower = String(tag || '').toLowerCase();
            const bytes = new TextEncoder().encode(lower);
            let h = 0;
            for (let i = 0; i < bytes.length; i++) {
                h = ((h * 31) + bytes[i]) >>> 0;
            }
            return TAG_PALETTE[h % TAG_PALETTE.length];
        }
        window.tagColor = tagColor;

        (function () {
            const body = document.getElementById('pl-body');
            if (!body) return;
            const rows = [...body.querySelectorAll('.pl-row')];
            let filter = 'all', sortKey = 'time', sortDir = -1;
            function ago(iso) {
                const t = Date.parse(iso);
                if (!t) return '-';
                const s = Math.max(0, (Date.now() - t) / 1000);
                const f = (n, u) => n === 1 ? '1 ' + u + ' ago' : n + ' ' + u + 's ago';
                if (s < 60) return 'just now';
                if (s < 3600) return f(Math.floor(s / 60), 'minute');
                if (s < 86400) return f(Math.floor(s / 3600), 'hour');
                if (s < 86400 * 30) return f(Math.floor(s / 86400), 'day');
                if (s < 86400 * 365) return f(Math.floor(s / 86400 / 30), 'month');
                return f(Math.floor(s / 86400 / 365), 'year');
            }
            rows.forEach(r => {
                const c = r.querySelector('.pl-mod');
                const trashed = r.dataset.deleted === 'true';
                c.textContent = (trashed ? '🗑️ ' : '') + ago(c.dataset.iso);
                const when = c.dataset.iso ? new Date(c.dataset.iso).toLocaleString(LDI18n.locale()) : '';
                c.title = trashed && when ? 'Deleted on ' + when : when;
                if (trashed) return; // a project in the trash does not open: restore it first
                r.addEventListener('click', () => { location.href = r.dataset.href; });
                r.addEventListener('keydown', e => { if (e.key === 'Enter') location.href = r.dataset.href; });
            });
            // display title: saved in the repository description as "NeoLeaf: <title>" (the owner only; the server asks for admin access)
            function showTitle(row, title) {
                row.dataset.title = title || '';
                const link = row.querySelector('.pl-title-link');
                const sub = row.querySelector('.pl-subname');
                if (link) link.textContent = title || row.dataset.repo;
                if (sub) { sub.textContent = title ? row.dataset.repo : ''; sub.hidden = !title; }
                row.dataset.name = (title || row.dataset.repo).toLowerCase();
                row.dataset.search = ((title || '') + ' ' + row.dataset.repo).trim().toLowerCase();
            }
            window.editProjectTitle = async function(id) {
                const row = document.getElementById('proj-row-' + id);
                if (!row) return;
                const typed = prompt('Project title, shown only in NeoLeaf lists (saved in the repository description as "NeoLeaf: title"). Leave it empty to remove it.', row.dataset.title || '');
                if (typed === null) return;
                const send = async overwrite => (await fetch('/api/project/' + encodeURIComponent(id) + '/title', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: typed, overwrite })
                })).json();
                try {
                    let r = await send(false);
                    if (r.needs_overwrite) {
                        if (!confirm('The repository already has a description that is not a NeoLeaf title. Replace it with this title?')) return;
                        r = await send(true);
                    }
                    if (r.error) { alert(T('Could not change the title: {0}', T(r.error))); return; }
                    showTitle(row, r.title || '');
                    apply();
                    if (typeof neoToast === 'function') neoToast(r.title ? T('Title saved.') : T('Title removed.'));
                } catch (e) {
                    alert(T('Could not change the title: {0}', (e && e.message) || e));
                }
            };
            window.filterByTopic = function(topic) {
                const s = document.getElementById('pl-search');
                if (!s) return;
                const current = s.value.trim().toLowerCase();
                const target = topic ? ('#' + topic.toLowerCase()) : '';
                if (!topic || current === target) {
                    s.value = '';
                } else {
                    s.value = target;
                }
                apply();
                s.focus();
            };

            function updateTagBar() {
                const bar = document.getElementById('pl-tag-bar');
                if (!bar) return;
                const rawQ = document.getElementById('pl-search').value.trim().toLowerCase();
                const activeTag = rawQ.startsWith('#') ? rawQ.slice(1).trim() : '';

                const allTags = new Set();
                rows.forEach(r => {
                    // only the tags of the projects in the current view (#deleted does not pollute the normal list)
                    if ((filter === 'trash') !== (r.dataset.deleted === 'true')) return;
                    try {
                        const list = JSON.parse(r.dataset.topicsJson || '[]');
                        list.forEach(t => {
                            if (t && t !== 'neoleaf') allTags.add(t.toLowerCase());
                        });
                    } catch (_) {}
                });

                if (allTags.size === 0) {
                    bar.style.display = 'none';
                    return;
                }
                bar.style.display = 'flex';

                let html = '<span class="pl-tag-bar-label">🏷️ Tags:</span>';
                html += `<span class="pl-filter-chip ${!activeTag ? 'active' : ''}" onclick="filterByTopic('')">All</span>`;

                Array.from(allTags).sort().forEach(tag => {
                    const isActive = activeTag === tag;
                    const tagEsc = tag.replace(/'/g, "\\'");
                    const c = tagColor(tag);
                    html += `<span class="pl-filter-chip ${isActive ? 'active' : ''}" style="--chip-color:${c};" onclick="filterByTopic('${tagEsc}')">#${tag}</span>`;
                });

                if (activeTag) {
                    html += `<span class="pl-filter-chip clear" onclick="filterByTopic('')" title="Clear tag filter">✕ Clear</span>`;
                }

                bar.innerHTML = html;
            }

            function apply() {
                const rawQ = document.getElementById('pl-search').value.trim().toLowerCase();
                const isTagSearch = rawQ.startsWith('#');
                const q = isTagSearch ? rawQ.slice(1).trim() : rawQ;

                rows.sort((a, b) => {
                    const x = sortKey === 'name' ? a.dataset.name : a.dataset.time;
                    const y = sortKey === 'name' ? b.dataset.name : b.dataset.time;
                    return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
                });

                let shown = 0;
                rows.forEach(r => {
                    const nameMatch = (r.dataset.search || r.dataset.name) && (r.dataset.search || r.dataset.name).includes(q);
                    const topicMatch = r.dataset.topics && r.dataset.topics.includes(q);
                    const match = !q || (isTagSearch ? topicMatch : (nameMatch || topicMatch));

                    const trashed = r.dataset.deleted === 'true';
                    const ok = match && (filter === 'trash' ? trashed : !trashed && (
                        filter === 'all'
                        || (filter === 'mine' && r.dataset.shared === 'false')
                        || (filter === 'shared' && r.dataset.collab === 'true')
                    ));
                    r.style.display = ok ? '' : 'none';
                    if (ok) shown++;
                    body.append(r);
                });
                const noneText = document.getElementById('pl-none-text');
                if (noneText) noneText.textContent = (!q && filter === 'trash') ? 'The trash is empty.' : (!q && rows.every(r => r.dataset.deleted === 'true') && filter !== 'trash') ? 'No active projects. Deleted projects are in the Trash.' : 'No project matches the search.';
                document.getElementById('pl-none').style.display = shown ? 'none' : 'block';
                document.querySelectorAll('.pl-th.sortable').forEach(th => {
                    th.querySelector('.arrow').textContent = th.dataset.sort === sortKey ? (sortDir < 0 ? '↓' : '↑') : '';
                });
                const titles = { all: 'All projects', mine: 'Your projects', shared: 'Shared with you', trash: 'Trash' };
                document.querySelector('.pl-main h1').textContent = titles[filter];
                updateTagBar();
            }
            document.getElementById('pl-search').addEventListener('input', apply);
            document.querySelectorAll('.pl-th.sortable').forEach(th => th.addEventListener('click', () => {
                if (sortKey === th.dataset.sort) sortDir = -sortDir; else { sortKey = th.dataset.sort; sortDir = sortKey === 'time' ? -1 : 1; }
                apply();
            }));
            document.querySelectorAll('.pl-nav a').forEach(a => a.addEventListener('click', e => {
                e.preventDefault();
                filter = a.dataset.filter;
                document.querySelectorAll('.pl-nav a').forEach(x => x.classList.toggle('active', x === a));
                apply();
            }));
            window.applyProjectFilter = apply;
            window.updateTagBar = updateTagBar;
            apply();
        })();
    </script>"##
}

/// Script of the page actions: trash, import, new project, invitations and tag editing.
pub(super) fn actions_script() -> &'static str {
    r##"    <script>
        // ---- trash
        let deletingId = null;
        function openDeleteModal(id, name) {
            deletingId = id;
            document.getElementById('delete-modal-name').textContent = name;
            const err = document.getElementById('delete-modal-error');
            err.style.display = 'none';
            err.textContent = '';
            document.getElementById('delete-modal').style.display = 'flex';
            document.getElementById('delete-cancel').focus();
        }
        function closeDeleteModal() {
            document.getElementById('delete-modal').style.display = 'none';
            deletingId = null;
        }
        async function trashRequest(id, action) {
            const res = await fetch('/api/project/' + encodeURIComponent(id) + '/' + action, { method: 'POST' });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Unknown error');
            return data;
        }
        async function confirmDeleteProject() {
            if (!deletingId) return;
            const btn = document.getElementById('delete-confirm');
            const cancel = document.getElementById('delete-cancel');
            const err = document.getElementById('delete-modal-error');
            btn.disabled = true; cancel.disabled = true;
            btn.textContent = 'Moving...';
            try {
                await trashRequest(deletingId, 'delete');
                sessionStorage.setItem('pl-after-reload', 'trash');
                location.reload();
            } catch (e) {
                err.textContent = e.message;
                err.style.display = 'block';
                btn.disabled = false; cancel.disabled = false;
                btn.textContent = 'Move to trash';
            }
        }
        async function restoreProject(id, name) {
            if (!confirm('Restore "' + name + '"? The repository goes back to its original name and loses the deleted tag.')) return;
            try {
                await trashRequest(id, 'restore');
                sessionStorage.setItem('pl-after-reload', 'all');
                location.reload();
            } catch (e) {
                alert('Could not restore: ' + e.message);
            }
        }
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDeleteModal(); });
        // after deleting/restoring, the page reloads already in the view where the person will see the result
        (function () {
            const want = sessionStorage.getItem('pl-after-reload');
            if (!want) return;
            sessionStorage.removeItem('pl-after-reload');
            const link = document.querySelector('.pl-nav a[data-filter="' + want + '"]');
            if (link) link.click();
        })();

        function openImportModal() {
            document.getElementById('import-modal').style.display = 'flex';
        }
        function closeImportModal() {
            document.getElementById('import-modal').style.display = 'none';
        }
        function showImportError(msg) {
            const box = document.getElementById('import-error');
            box.textContent = msg || '';
            box.style.display = msg ? 'block' : 'none';
        }
        document.getElementById('imp-file').addEventListener('change', function () {
            const f = this.files[0];
            showImportError('');
            if (!f) return;
            if (f.size > 200 * 1024 * 1024) {
                showImportError('The ZIP is ' + (f.size / 1024 / 1024).toFixed(1) + ' MB; the maximum is 200 MB.');
                this.value = '';
                return;
            }
            const nameInput = document.getElementById('imp-name');
            if (!nameInput.value) nameInput.value = f.name.replace(/\.zip$/i, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '_').slice(0, 100);
            nameInput.focus();
            nameInput.select();
        });
        async function handleImport(e) {
            e.preventDefault();
            const file = document.getElementById('imp-file').files[0];
            const name = document.getElementById('imp-name').value.trim();
            if (!file || !name) return;
            const btn = document.getElementById('imp-submit');
            const cancel = document.getElementById('imp-cancel');
            btn.disabled = true;
            cancel.disabled = true;
            showImportError('');
            btn.innerText = 'Reading the ZIP and creating the repository...';
            try {
                // the ZIP is read here in the browser; the server only creates the empty repository on GitHub
                const id = await ProjectImport.start(file, name);
                window.location.href = '/project/' + id;
            } catch (err) {
                showImportError(err.message);
                btn.disabled = false;
                cancel.disabled = false;
                btn.innerText = 'Import';
            }
        }
        function openNewProjectModal() {
            document.getElementById('new-project-modal').style.display = 'flex';
            document.getElementById('proj-name').focus();
            loadTemplateGallery();
        }
        // template gallery: the built-in ones and those registered by the administrator (metadata only; the files come from GitHub)
        const TPL_CATEGORIES = { article: 'Article', thesis: 'Thesis / Dissertation', slides: 'Slides', report: 'Report', poster: 'Poster', other: 'Other' };
        const tr = t => (window.T ? window.T(t) : t);
        function pickTemplate(value) {
            document.getElementById('proj-template').value = value;
            document.querySelectorAll('#tpl-gallery .tpl-card').forEach(c => c.classList.toggle('sel', c.dataset.value === value));
        }
        function tplCard(value, title, meta, desc, preview, url) {
            const c = document.createElement('div');
            c.className = 'tpl-card';
            c.dataset.value = value;
            c.tabIndex = 0;
            c.setAttribute('role', 'radio');
            if (preview) { const i = document.createElement('img'); i.src = preview; i.alt = ''; i.loading = 'lazy'; i.className = 'tpl-prev'; c.appendChild(i); }
            const b = document.createElement('div');
            b.className = 'tpl-body';
            const h = document.createElement('strong'); h.textContent = title; b.appendChild(h);
            if (meta) { const m = document.createElement('span'); m.className = 'tpl-meta'; m.textContent = meta; b.appendChild(m); }
            if (desc) { const d = document.createElement('p'); d.textContent = desc; b.appendChild(d); }
            if (url) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = tr('View source'); a.className = 'tpl-src'; a.onclick = e => e.stopPropagation(); b.appendChild(a); }
            c.appendChild(b);
            c.onclick = () => pickTemplate(value);
            c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickTemplate(value); } };
            return c;
        }
        let galleryLoaded = false;
        async function loadTemplateGallery() {
            const box = document.getElementById('tpl-gallery');
            if (!box || galleryLoaded) return;
            box.innerHTML = '';
            [['article', 'Scientific Article (Default)'], ['report', 'Technical Report'], ['beamer', 'Slide Presentation (Beamer)']].forEach(([k, n]) => box.appendChild(tplCard(k, tr(n), '', '', '', '')));
            pickTemplate(document.getElementById('proj-template').value || 'article');
            // catalog templates come from GitHub repositories: with a Codeberg session they are not offered
            if ((document.getElementById('new-project-modal').dataset.provider || '') === 'codeberg') {
                const note = document.createElement('p');
                note.className = 'tpl-meta';
                note.style.gridColumn = '1 / -1';
                note.textContent = tr('Templates are available only when you sign in with GitHub.');
                box.appendChild(note);
                galleryLoaded = true;
                return;
            }
            try {
                const res = await fetch('/api/templates');
                const data = await res.json();
                window.__models = data.templates || [];
                window.__models.forEach(m => {
                    const meta = [tr(TPL_CATEGORIES[m.category] || 'Other'), m.institution, m.language].filter(Boolean).join(' · ');
                    box.appendChild(tplCard('model:' + m.id, m.name, meta, m.description, /^https:\/\//.test(m.previewUrl) || m.previewUrl.startsWith('/static/') ? m.previewUrl : '', m.sourceUrl));
                });
                galleryLoaded = true;
                pickTemplate(document.getElementById('proj-template').value);
            } catch (_) { /* without the catalog only the built-in ones remain */ }
        }
        function closeNewProjectModal() {
            document.getElementById('new-project-modal').style.display = 'none';
        }
        async function handleCreateProject(e) {
            e.preventDefault();
            const btn = document.getElementById('btn-create-submit');
            btn.disabled = true;
            btn.innerText = 'Creating repository on GitHub...';

            const name = document.getElementById('proj-name').value;
            const template = document.getElementById('proj-template').value;

            try {
                // the server only creates the empty repository; the template files are written and pushed by the browser
                const model = template.startsWith('model:') ? (window.__models || []).find(m => m.id === template.slice(6)) : null;
                const id = model ? await ProjectImport.startFromModel(model, name) : await ProjectImport.startNew(name, template);
                window.location.href = '/project/' + id;
            } catch (err) {
                alert('Error creating project: ' + err.message);
                btn.disabled = false;
                btn.innerText = 'Create on GitHub';
            }
        }

        async function acceptInvitation(event, id) {
            const btn = event.target;
            btn.disabled = true;
            btn.textContent = 'Accepting...';
            try {
                const res = await fetch(`/api/invitations/${id}/accept`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    window.location.reload();
                } else {
                    alert('Error accepting invitation: ' + (data.error || 'Unknown error'));
                    btn.disabled = false;
                    btn.textContent = '✔ Accept on NeoLeaf';
                }
            } catch (e) {
                alert('Connection error: ' + e.message);
                btn.disabled = false;
                btn.textContent = '✔ Accept on NeoLeaf';
            }
        }

        async function declineInvitation(id) {
            if (!confirm('Do you really want to decline this invitation?')) return;
            const card = document.getElementById(`inv-card-${id}`);
            try {
                const res = await fetch(`/api/invitations/${id}/decline`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    if (card) card.remove();
                } else {
                    alert('Error declining invitation: ' + (data.error || 'Unknown error'));
                }
            } catch (e) {
                alert('Connection error: ' + e.message);
            }
        }

        let currentEditingProjId = null;
        let currentEditingProjName = '';
        let currentEditingTags = [];

        function escapeHtml(str) {
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function sanitizeTopic(str) {
            return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .toLowerCase().trim()
                .replace(/[^a-z0-9-_]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-+|-+$/g, '');
        }

        function openEditTopicsModal(id, name) {
            currentEditingProjId = id;
            currentEditingProjName = name;
            document.getElementById('modal-topics-proj-name').textContent = name;
            const errBox = document.getElementById('modal-topics-error');
            errBox.style.display = 'none';
            errBox.textContent = '';

            const row = document.getElementById('proj-row-' + id);
            try {
                currentEditingTags = JSON.parse(row ? row.dataset.topicsJson : '[]') || [];
            } catch (e) {
                currentEditingTags = [];
            }
            if (!currentEditingTags.includes('neoleaf')) {
                currentEditingTags.unshift('neoleaf');
            }

            renderModalChips();
            document.getElementById('edit-topics-modal').style.display = 'flex';
            setTimeout(() => {
                const inp = document.getElementById('new-tag-input');
                if (inp) inp.focus();
            }, 50);
        }

        function closeEditTopicsModal() {
            document.getElementById('edit-topics-modal').style.display = 'none';
            currentEditingProjId = null;
        }

        function renderModalChips() {
            const list = document.getElementById('modal-tags-list');
            if (!list) return;
            const visible = currentEditingTags.filter(t => t.toLowerCase() !== 'neoleaf');
            if (visible.length === 0) {
                list.innerHTML = '<span style="font-size:12px; color:var(--muted);">No additional tags. Type a tag below to add one.</span>';
                return;
            }
            list.innerHTML = visible.map(t => {
                const c = tagColor(t);
                return `<span class="modal-tag-chip" style="--chip-color:${c};">#${escapeHtml(t)}<button type="button" onclick="removeTag('${escapeHtml(t)}')" title="Remove tag">×</button></span>`;
            }).join('');
        }

        function handleAddTag(e) {
            e.preventDefault();
            const input = document.getElementById('new-tag-input');
            const raw = input.value.trim();
            if (!raw) return;

            const parts = raw.split(/[,\s]+/);
            for (const part of parts) {
                const clean = sanitizeTopic(part);
                if (clean && clean.toLowerCase() !== 'neoleaf' && clean.length <= 35 && !currentEditingTags.includes(clean)) {
                    if (currentEditingTags.length < 20) {
                        currentEditingTags.push(clean);
                    }
                }
            }
            input.value = '';
            renderModalChips();
        }

        function removeTag(tag) {
            if (tag.toLowerCase() === 'neoleaf') return;
            currentEditingTags = currentEditingTags.filter(t => t.toLowerCase() !== tag.toLowerCase());
            renderModalChips();
        }

        async function saveTopics() {
            if (!currentEditingProjId) return;
            const btnSave = document.getElementById('btn-save-topics');
            const btnCancel = document.getElementById('btn-cancel-topics');
            const errBox = document.getElementById('modal-topics-error');
            errBox.style.display = 'none';
            errBox.textContent = '';

            btnSave.disabled = true;
            btnCancel.disabled = true;
            btnSave.textContent = 'Saving to GitHub...';

            try {
                const res = await fetch(`/api/project/${encodeURIComponent(currentEditingProjId)}/topics`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topics: currentEditingTags })
                });
                const data = await res.json();
                if (data.success && data.topics) {
                    const row = document.getElementById('proj-row-' + currentEditingProjId);
                    if (row) {
                        row.dataset.topicsJson = JSON.stringify(data.topics);
                        row.dataset.topics = data.topics.filter(t => t.toLowerCase() !== 'neoleaf').join(' ').toLowerCase();
                    }
                    renderProjectTagsInRow(currentEditingProjId, data.topics);
                    if (window.applyProjectFilter) window.applyProjectFilter();
                    closeEditTopicsModal();
                } else {
                    errBox.textContent = data.error || 'Error updating topics on GitHub.';
                    errBox.style.display = 'block';
                }
            } catch (err) {
                errBox.textContent = 'Connection error: ' + err.message;
                errBox.style.display = 'block';
            } finally {
                btnSave.disabled = false;
                btnCancel.disabled = false;
                btnSave.textContent = 'Save to GitHub';
            }
        }

        function renderProjectTagsInRow(id, topics) {
            const container = document.getElementById('tags-' + id);
            if (!container) return;
            const pills = topics
                .filter(t => t.toLowerCase() !== 'neoleaf')
                .map(t => {
                    const c = tagColor(t);
                    return `<span class="pl-tag" style="--tag-color:${c};" onclick="event.stopPropagation(); filterByTopic('${escapeHtml(t)}')" title="Filter by ${escapeHtml(t)}">#${escapeHtml(t)}</span>`;
                }).join('');
            const addBtn = `<button type="button" class="pl-tag-add" onclick="event.stopPropagation(); openEditTopicsModal('${escapeHtml(id)}', '${escapeHtml(currentEditingProjName.replace(/'/g, "\\'"))}')" title="Manage tags">+ tag</button>`;
            container.innerHTML = pills + addBtn;
        }
    </script>"##
}
