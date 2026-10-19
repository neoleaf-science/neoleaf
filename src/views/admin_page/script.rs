// Inline script of the admin page, split by topic.

/// Live stats refresh (fetch every 5 seconds and update the cards).
pub(super) fn live_stats_js() -> &'static str {
    r##"        async function fetchLiveStats() {
            const btn = document.getElementById('btn-refresh');
            if (btn) btn.innerText = '⏳ Refreshing...';
            try {
                const res = await fetch('/api/admin/stats');
                if (!res.ok) throw new Error('Failed to get metrics (' + res.status + ')');
                const s = await res.json();
                updateUI(s);
            } catch (err) {
                console.error('Refresh error:', err);
            } finally {
                if (btn) btn.innerText = '🔄 Refresh Data';
            }
        }

        function updateUI(s) {
            // CPU
            document.getElementById('cpu-val').innerText = s.cpu.load_1m.toFixed(2);
            document.getElementById('cpu-bar').style.width = Math.min(100, s.cpu.percent_estimate) + '%';
            document.getElementById('cpu-sub').innerHTML = `Load Avg: <strong>${s.cpu.load_1m.toFixed(2)}</strong> (1m) · <strong>${s.cpu.load_5m.toFixed(2)}</strong> (5m) · <strong>${s.cpu.load_15m.toFixed(2)}</strong> (15m)`;

            // Memory
            document.getElementById('mem-val').innerText = s.memory.used_mb + ' MB';
            document.getElementById('mem-bar').style.width = s.memory.percent_used.toFixed(1) + '%';
            document.getElementById('mem-pct-badge').innerText = s.memory.percent_used.toFixed(1) + '%';
            document.getElementById('mem-sub').innerHTML = `Out of a total of <strong>${s.memory.total_mb} MB</strong> (Free: <strong>${s.memory.free_mb} MB</strong>)`;

            // Disk
            document.getElementById('disk-val').innerText = s.disk.used_gb.toFixed(1) + ' GB';
            document.getElementById('disk-bar').style.width = s.disk.percent_used.toFixed(1) + '%';
            document.getElementById('disk-pct-badge').innerText = s.disk.percent_used.toFixed(1) + '%';
            document.getElementById('disk-sub').innerHTML = `Of <strong>${s.disk.total_gb.toFixed(1)} GB</strong> mounted at <code>${s.disk.mount_point}</code> (Free: <strong>${s.disk.free_gb.toFixed(1)} GB</strong>)`;

            // Process and uptime
            document.getElementById('sys-uptime-val').innerText = s.system_uptime_formatted;
            document.getElementById('proc-rss').innerText = s.process.rss_mb.toFixed(1);
            document.getElementById('proc-uptime').innerHTML = `Process running for <strong>${s.process.uptime_formatted}</strong>`;

            // Counters
            document.getElementById('count-users').innerText = s.unique_users_count;
            document.getElementById('count-sessions').innerText = s.total_sessions;
            document.getElementById('count-rooms').innerText = s.collab_rooms;
            document.getElementById('count-peers').innerText = s.collab_peers;
            document.getElementById('user-count-badge').innerHTML = `Total: <strong>${s.unique_users_count}</strong> user(s)`;
        }

        // Gentle auto-refresh every 5 seconds
        setInterval(fetchLiveStats, 5000);"##
}

/// Blocking and unblocking users (modal and requests).
pub(super) fn block_users_js() -> &'static str {
    r##"        // ---- blocking users
        document.querySelectorAll('.blk-when').forEach(el => { el.textContent = new Date(Number(el.dataset.ts) * 1000).toLocaleString(); });
        let blockTarget = null;
        function openBlockModal(btn) {
            blockTarget = { login: btn.dataset.login, provider: btn.dataset.provider || 'github', id: Number(btn.dataset.id) || 0 };
            document.getElementById('block-modal-name').textContent = btn.dataset.name;
            document.getElementById('block-modal-login').textContent = '(@' + btn.dataset.login + ')';
            document.getElementById('block-modal-reason').value = '';
            const err = document.getElementById('block-modal-error');
            err.style.display = 'none';
            document.getElementById('block-modal').style.display = 'flex';
            document.getElementById('block-modal-reason').focus();
        }
        function closeBlockModal() {
            document.getElementById('block-modal').style.display = 'none';
            blockTarget = null;
        }
        async function postAdmin(path, body) {
            const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Unknown error');
            return data;
        }
        async function confirmBlock() {
            if (!blockTarget) return;
            const btn = document.getElementById('block-confirm');
            const err = document.getElementById('block-modal-error');
            btn.disabled = true;
            try {
                await postAdmin('/api/admin/users/block', { login: blockTarget.login, provider: blockTarget.provider, id: blockTarget.id, reason: document.getElementById('block-modal-reason').value });
                location.reload();
            } catch (e) {
                err.textContent = e.message;
                err.style.display = 'block';
                btn.disabled = false;
            }
        }
        async function blockByLogin(e) {
            e.preventDefault();
            try {
                await postAdmin('/api/admin/users/block', { login: document.getElementById('block-login-input').value, reason: document.getElementById('block-login-reason').value });
                location.reload();
            } catch (err) { alert('Could not block: ' + err.message); }
        }
        async function unblockUser(btn) {
            if (!confirm('Unblock @' + btn.dataset.login + '?')) return;
            try {
                await postAdmin('/api/admin/users/unblock', { login: btn.dataset.login, provider: btn.dataset.provider || 'github' });
                location.reload();
            } catch (err) { alert('Could not unblock: ' + err.message); }
        }
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBlockModal(); });"##
}

/// Template catalog: tabs, list, form, check and enable/disable.
pub(super) fn template_catalog_js() -> &'static str {
    r##"        // ---- template catalog
        function showAdminTab(name) {
            ['overview', 'users', 'models'].forEach(n => {
                document.getElementById('tab-' + n).style.display = n === name ? '' : 'none';
                document.getElementById('tabbtn-' + n).classList.toggle('active', n === name);
            });
            if (name === 'models') loadModels();
            try { sessionStorage.setItem('admin-tab', name); } catch (_) { /* no storage */ }
        }
        // after blocking or unblocking the page reloads: go back to the tab the person was on
        try { const t = sessionStorage.getItem('admin-tab'); if (['users', 'models'].includes(t)) showAdminTab(t); } catch (_) { /* no storage */ }
        let modelsCache = [];
        async function loadModels() {
            const body = document.getElementById('models-tbody');
            try {
                const res = await fetch('/api/admin/templates');
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Error');
                modelsCache = data.templates;
            } catch (e) { body.innerHTML = ''; const r = body.insertRow(); const c = r.insertCell(); c.colSpan = 6; c.textContent = 'Could not load: ' + e.message; return; }
            renderSuggested();
            body.innerHTML = '';
            if (!modelsCache.length) { const r = body.insertRow(); const c = r.insertCell(); c.colSpan = 6; c.style.color = 'var(--muted)'; c.textContent = 'No template registered. The three built-in templates (article, report and Beamer) always exist.'; return; }
            for (const m of modelsCache) {
                const r = body.insertRow();
                r.insertCell().textContent = m.order;
                const n = r.insertCell(); n.innerHTML = '<strong></strong><br><span style="color:var(--muted);font-size:12px;"></span>';
                n.querySelector('strong').textContent = m.name; n.querySelector('span').textContent = m.id + (m.institution ? ' · ' + m.institution : '');
                r.insertCell().textContent = ({ article: 'Article', thesis: 'Thesis / Dissertation', slides: 'Slides', report: 'Report', poster: 'Poster', other: 'Other' })[m.category] || m.category;
                const o = r.insertCell(); const a = document.createElement('a');
                a.href = 'https://github.com/' + m.source; a.target = '_blank'; a.rel = 'noopener'; a.textContent = m.source + (m.git_ref ? ' @ ' + m.git_ref : '');
                o.appendChild(a);
                const en = r.insertCell(); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = m.enabled; cb.title = 'Enable or disable';
                cb.onchange = () => toggleModel(m, cb);
                en.appendChild(cb);
                const act = r.insertCell();
                const ed = document.createElement('button'); ed.className = 'btn'; ed.style.cssText = 'font-size:12px;padding:3px 9px;margin-right:6px;'; ed.textContent = 'Edit'; ed.onclick = () => editModel(m.id);
                const rm = document.createElement('button'); rm.className = 'btn'; rm.style.cssText = 'font-size:12px;padding:3px 9px;color:var(--danger-color);'; rm.textContent = 'Remove'; rm.onclick = () => removeModel(m);
                act.append(ed, rm);
            }
        }
        const MF = ['id', 'name', 'category', 'institution', 'language', 'license', 'description', 'source', 'ref', 'subdir', 'main', 'engine', 'preview', 'order'];
        function mfSet(m) {
            const v = { id: m.id, name: m.name, category: m.category, institution: m.institution, language: m.language, license: m.license, description: m.description, source: m.source, ref: m.git_ref, subdir: m.subdir, main: m.main_file, engine: m.engine, preview: m.preview_url, order: m.order };
            MF.forEach(k => { document.getElementById('mf-' + k).value = v[k] ?? ''; });
            document.getElementById('mf-enabled').checked = m.enabled !== false;
        }
        function mfGet() {
            const g = k => document.getElementById('mf-' + k).value;
            return { id: g('id').trim(), name: g('name'), category: g('category'), institution: g('institution'), language: g('language'), license: g('license'), description: g('description'), source: g('source'), git_ref: g('ref'), subdir: g('subdir'), main_file: g('main'), engine: g('engine'), preview_url: g('preview'), order: Number(g('order')) || 0, enabled: document.getElementById('mf-enabled').checked };
        }
        function mfMsg(text, ok) { const el = document.getElementById('mf-msg'); el.style.display = text ? 'block' : 'none'; el.textContent = text || ''; el.style.color = ok ? 'var(--success)' : 'var(--danger-color)'; }
        function openModelForm(title, idLocked) {
            document.getElementById('model-form-title').textContent = title;
            document.getElementById('mf-id').readOnly = !!idLocked;
            mfMsg('');
            const box = document.getElementById('model-form-box'); box.style.display = '';
            box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        function newModel() { mfSet({ id: '', name: '', category: 'article', institution: '', language: 'pt', license: '', description: '', source: '', git_ref: '', subdir: '', main_file: '', engine: '', preview_url: '', order: (modelsCache.length ? Math.max(...modelsCache.map(m => m.order)) + 1 : 1), enabled: true }); openModelForm('New template', false); }
        function editModel(id) { const m = modelsCache.find(x => x.id === id); if (!m) return; mfSet(m); openModelForm('Edit template', true); }
        function closeModelForm() { document.getElementById('model-form-box').style.display = 'none'; }
        async function saveModel(e) {
            e.preventDefault();
            const btn = document.getElementById('mf-save'); btn.disabled = true;
            try { await postAdmin('/api/admin/templates/save', mfGet()); closeModelForm(); await loadModels(); }
            catch (err) { mfMsg(err.message, false); }
            btn.disabled = false;
        }
        async function checkModel() {
            const btn = document.getElementById('mf-check'); btn.disabled = true; mfMsg('Querying GitHub...', true);
            try { const d = await postAdmin('/api/admin/templates/check', mfGet()); mfMsg('✔ ' + d.message, true); }
            catch (err) { mfMsg('✖ ' + err.message, false); }
            btn.disabled = false;
        }
        async function toggleModel(m, cb) {
            try { await postAdmin('/api/admin/templates/save', { ...m, enabled: cb.checked }); m.enabled = cb.checked; }
            catch (err) { cb.checked = !cb.checked; alert('Could not change: ' + err.message); }
        }"##
}

/// Suggested templates list and add/remove actions.
pub(super) fn suggested_templates_js() -> &'static str {
    r##"        // ---- suggested templates (public sources; they come in disabled so you can check the license)
        const SUGGESTED = [
            { id: 'abntex2-academic-work', name: 'abnTeX2: Academic work (thesis, dissertation, TCC)', category: 'thesis', institution: 'ABNT', language: 'pt', license: 'LPPL-1.3c', description: 'Canonical template for academic work under ABNT rules, with cover, title page, abstract, table of contents, chapters and references.', source: 'abntex/abntex2', git_ref: '2018-11-24-v1.9.7-ctan', subdir: 'doc/latex/abntex2/examples', main_file: 'abntex2-modelo-trabalho-academico.tex', order: 10 },
            { id: 'abntex2-research-project', name: 'abnTeX2: Research project', category: 'report', institution: 'ABNT', language: 'pt', license: 'LPPL-1.3c', description: 'Research project template under ABNT rules.', source: 'abntex/abntex2', git_ref: '2018-11-24-v1.9.7-ctan', subdir: 'doc/latex/abntex2/examples', main_file: 'abntex2-modelo-projeto-pesquisa.tex', order: 11 },
            { id: 'abntex2-technical-report', name: 'abnTeX2: Technical report', category: 'report', institution: 'ABNT', language: 'pt', license: 'LPPL-1.3c', description: 'Technical and scientific report template under ABNT rules.', source: 'abntex/abntex2', git_ref: '2018-11-24-v1.9.7-ctan', subdir: 'doc/latex/abntex2/examples', main_file: 'abntex2-modelo-relatorio-tecnico.tex', order: 12 },
            { id: 'sbc-article-classic', name: 'SBC: Article (classic template)', category: 'article', institution: 'SBC', language: 'pt', license: 'MIT (repository)', description: 'Article in the Brazilian Computer Society (SBC) format, with the sbc-template style and the sbc.bst bibliography style.', source: 'cezarlamann/sbc-latex-template', git_ref: '81934149f95be4fc04d0107ae6b57868462eebe5', subdir: 'template', main_file: 'sbc-template.tex', order: 20 },
            { id: 'sbc-article-modular', name: 'SBC: Article (sections in separate files)', category: 'article', institution: 'SBC', language: 'pt', license: 'MIT (repository)', description: 'Article in the SBC format with each section in its own file, plus table, framed table and algorithm examples.', source: 'raulivan/template-artigo-sbc', git_ref: 'fa205c49d7b11849eb12f53d6d6bf7c122110eca', subdir: '', main_file: 'main.tex', order: 21 },
            { id: 'acm-sigconf', name: 'ACM: Conference (sigconf)', category: 'article', institution: 'ACM', language: 'en', license: 'LPPL-1.3c', description: 'Conference paper in the ACM sigconf format (acmart class v2.21), with sample bibliography and figures.', source: 'neoleaf-science/neoleaf-modelos', git_ref: 'v1', subdir: 'acm-sigconf', main_file: 'sigconf.tex', order: 30 },
            { id: 'acm-sigplan', name: 'ACM: SIGPLAN Conference', category: 'article', institution: 'ACM SIGPLAN', language: 'en', license: 'LPPL-1.3c', description: 'Paper for ACM SIGPLAN conferences (acmart class v2.21).', source: 'neoleaf-science/neoleaf-modelos', git_ref: 'v1', subdir: 'acm-sigplan', main_file: 'sigplan.tex', order: 31 },
            { id: 'acm-acmsmall', name: 'ACM: Journal (acmsmall)', category: 'article', institution: 'ACM', language: 'en', license: 'LPPL-1.3c', description: 'Journal article in the ACM acmsmall format (acmart class v2.21).', source: 'neoleaf-science/neoleaf-modelos', git_ref: 'v1', subdir: 'acm-acmsmall', main_file: 'acmsmall.tex', order: 32 },
            { id: 'acm-acmtog', name: 'ACM: Transactions on Graphics', category: 'article', institution: 'ACM TOG', language: 'en', license: 'LPPL-1.3c', description: 'Paper for the ACM Transactions on Graphics journal (acmart class v2.21).', source: 'neoleaf-science/neoleaf-modelos', git_ref: 'v1', subdir: 'acm-acmtog', main_file: 'acmtog.tex', order: 33 },
            { id: 'ieee-conference', name: 'IEEE: Conference (IEEEtran)', category: 'article', institution: 'IEEE', language: 'en', license: 'LPPL-1.3', description: 'Conference paper in the IEEE format (bare_conf, IEEEtran class v1.8b).', source: 'neoleaf-science/neoleaf-modelos', git_ref: 'v2', subdir: 'ieee-conferencia', main_file: 'bare_conf.tex', order: 40 },
            { id: 'ieee-journal', name: 'IEEE: Journal (IEEEtran)', category: 'article', institution: 'IEEE', language: 'en', license: 'LPPL-1.3', description: 'Journal article in the IEEE format (bare_jrnl, IEEEtran class v1.8b).', source: 'neoleaf-science/neoleaf-modelos', git_ref: 'v2', subdir: 'ieee-periodico', main_file: 'bare_jrnl.tex', order: 41 },
            { id: 'elsevier-numeric', name: 'Elsevier: numeric citations (elsarticle)', category: 'article', institution: 'Elsevier', language: 'en', license: 'LPPL-1.3', description: 'Article for Elsevier journals with numeric citations (elsarticle class v3.5).', source: 'neoleaf-science/neoleaf-modelos', git_ref: 'v3', subdir: 'elsevier-numerico', main_file: 'elsarticle-template-num.tex', order: 50 },
            { id: 'elsevier-author-year', name: 'Elsevier: author-year citations (elsarticle)', category: 'article', institution: 'Elsevier', language: 'en', license: 'LPPL-1.3', description: 'Article for Elsevier journals with author-year citations (elsarticle class v3.5).', source: 'neoleaf-science/neoleaf-modelos', git_ref: 'v3', subdir: 'elsevier-autor-ano', main_file: 'elsarticle-template-harv.tex', order: 51 },
            { id: 'springer-lncs', name: 'Springer: LNCS (minimal template)', category: 'article', institution: 'Springer LNCS', language: 'en', license: 'CC BY 4.0 (according to CTAN)', description: 'Paper for Lecture Notes in Computer Science, with the llncs class v2.26 and a minimal example written for NeoLeaf.', source: 'neoleaf-science/neoleaf-modelos', git_ref: 'v3', subdir: 'springer-lncs', main_file: 'main.tex', order: 60 },
        ];
        function renderSuggested() {
            const body = document.getElementById('suggest-tbody');
            body.innerHTML = '';
            for (const m of SUGGESTED) {
                const have = modelsCache.some(x => x.id === m.id);
                const r = body.insertRow();
                const n = r.insertCell(); n.innerHTML = '<strong></strong><br><span style="color:var(--muted);font-size:12px;"></span>';
                n.querySelector('strong').textContent = m.name; n.querySelector('span').textContent = m.description;
                const o = r.insertCell(); const a = document.createElement('a');
                a.href = 'https://github.com/' + m.source; a.target = '_blank'; a.rel = 'noopener'; a.textContent = m.source + ' @ ' + m.git_ref.slice(0, 12);
                o.appendChild(a);
                r.insertCell().textContent = m.license;
                const act = r.insertCell(); const b = document.createElement('button');
                b.className = 'btn'; b.style.cssText = 'font-size:12px;padding:3px 9px;';
                b.textContent = have ? 'Already in the catalog' : 'Add'; b.disabled = have;
                b.onclick = () => addSuggested(m.id);
                act.appendChild(b);
            }
        }
        async function addSuggested(id) {
            const list = SUGGESTED.filter(m => (id ? m.id === id : true) && !modelsCache.some(x => x.id === m.id));
            if (!list.length) return;
            try {
                for (const m of list) await postAdmin('/api/admin/templates/save', { ...m, engine: '', preview_url: '', enabled: false });
                await loadModels();
            } catch (err) { alert('Could not add: ' + err.message); }
        }
        async function removeModel(m) {
            if (!confirm('Remove the template "' + m.name + '" from the catalog? Projects already created are not affected.')) return;
            try { await postAdmin('/api/admin/templates/delete', { id: m.id }); await loadModels(); }
            catch (err) { alert('Could not remove: ' + err.message); }
        }"##
}
