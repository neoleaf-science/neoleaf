// "Project" window (.neoleaf folder): settings, extra packages, version milestones and authorship.
// Depends on globals from the editor scripts: h(), editor, monaco, projectId, currentFileId, switchFile().

(function () {
  const $ = id => document.getElementById(id);

  function showMsg(text, ok) {
    const box = $('pmsg');
    box.textContent = text || '';
    box.style.display = text ? 'block' : 'none';
    box.style.background = ok ? 'color-mix(in srgb, var(--success) 14%, var(--bg-primary))' : '';
    box.style.borderColor = ok ? 'color-mix(in srgb, var(--success) 50%, var(--bg-primary))' : '';
    box.style.color = ok ? 'var(--success)' : '';
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleString(LDI18n.locale()) : '';
  }

  // ------------------------------------------------------------ opening / tabs

  window.openProject = function () {
    $('project-modal').style.display = 'flex';
    showMsg('');
    window.switchPTab('settings');
  };

  window.closeProject = function () {
    $('project-modal').style.display = 'none';
  };

  window.switchPTab = function (tab) {
    document.querySelectorAll('.ptab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    ['settings', 'packages', 'milestones', 'authorship'].forEach(t => { $('ptab-' + t).style.display = t === tab ? 'block' : 'none'; });
    showMsg('');
    if (tab === 'settings') loadSettings();
    if (tab === 'packages') loadPackages();
    if (tab === 'milestones') loadMilestones();
    if (tab === 'authorship') window.loadAuthorship();
  };

  // ------------------------------------------------------------ settings

  window.toggleAutoSyncIntervalVisibility = function () {
    const chk = $('cfg-auto-sync');
    const grp = $('cfg-auto-sync-interval-group');
    if (grp) grp.style.display = (chk && chk.checked) ? 'flex' : 'none';
  };

  async function loadSettings() {
    try {
      const d = await Project.config.get();
      const sel = $('cfg-main');
      sel.textContent = '';
      const files = d.texFiles && d.texFiles.length ? d.texFiles : [d.config.mainFile];
      if (!files.includes(d.config.mainFile)) files.unshift(d.config.mainFile);
      files.forEach(f => {
        const o = h('option', { value: f }, f);
        if (f === d.config.mainFile) o.selected = true;
        sel.append(o);
      });
      $('cfg-engine').value = d.config.engine;
      $('cfg-auto').checked = d.config.autoInstall !== false;
      $('cfg-global').checked = false;
      if ($('cfg-spell-check')) $('cfg-spell-check').checked = d.config.spellCheck !== false;
      if ($('cfg-spell-lang')) $('cfg-spell-lang').value = d.config.spellLanguage || 'auto';
      if ($('cfg-style-check')) $('cfg-style-check').checked = d.config.styleCheck !== false;
      if ($('cfg-format-wrap')) $('cfg-format-wrap').value = d.config.formatWrap || 'reflow';
      if ($('cfg-format-width')) $('cfg-format-width').value = d.config.formatLineWidth || 80;
      if ($('cfg-auto-sync')) $('cfg-auto-sync').checked = !!d.config.autoSync;
      if ($('cfg-auto-sync-interval')) $('cfg-auto-sync-interval').value = d.config.autoSyncInterval || 5;
      window.toggleAutoSyncIntervalVisibility();
    } catch (e) {
      showMsg(e.message);
    }
  }

  window.saveSettings = async function () {
    showMsg('');
    const mainFile = $('cfg-main').value;
    const engine = $('cfg-engine').value;
    const autoInstall = $('cfg-auto').checked;
    const spellCheck = $('cfg-spell-check') ? $('cfg-spell-check').checked : true;
    const spellLanguage = $('cfg-spell-lang') ? $('cfg-spell-lang').value : 'auto';
    const styleCheck = $('cfg-style-check') ? $('cfg-style-check').checked : true;
    const formatWrap = $('cfg-format-wrap') ? $('cfg-format-wrap').value : 'reflow';
    const formatLineWidth = $('cfg-format-width') ? parseInt($('cfg-format-width').value, 10) || 80 : 80;
    const autoSync = $('cfg-auto-sync') ? $('cfg-auto-sync').checked : false;
    const autoSyncInterval = $('cfg-auto-sync-interval') ? parseInt($('cfg-auto-sync-interval').value, 10) || 5 : 5;
    try {
      await Project.config.save({ mainFile, engine, autoInstall, autoSync, autoSyncInterval, spellCheck, spellLanguage, styleCheck, formatWrap, formatLineWidth, scope: 'project' });
      if ($('cfg-global').checked) {
        await Project.config.save({ mainFile: 'main.tex', engine, autoInstall, autoSync, autoSyncInterval, spellCheck, spellLanguage, styleCheck, formatWrap, formatLineWidth, scope: 'global' });
      }
      projectConfig = { mainFile, engine, autoInstall, autoSync, autoSyncInterval, spellCheck, spellLanguage, styleCheck, formatWrap, formatLineWidth };
      if (window.BrowserGit && await BrowserGit.isCloned()) {
        try {
          await BrowserGit.writeFile('.neoleaf/config.json', JSON.stringify(projectConfig, null, 2));
          if (typeof checkGitStatus === 'function') checkGitStatus();
        } catch (_) {}
      }
      if (window.SpellCheck && SpellCheck.applyConfig) SpellCheck.applyConfig(projectConfig);
      if (window.LDBadness) LDBadness.applyConfig(projectConfig);
      if (window.initAutoSync) window.initAutoSync();
      const sel = $('engine-select');
      if (sel) sel.value = engine;
      showMsg('Settings saved to .neoleaf/config.json', true);
    } catch (e) {
      showMsg(e.message);
    }
  };

  // ------------------------------------------------------------ packages

  function renderPackages(box, items, scope) {
    box.textContent = '';
    if (!items.length) { box.append(h('div', { class: 'pk-empty' }, 'None.')); return; }
    items.forEach(it => {
      box.append(h('div', { class: 'pk-item' },
        h('span', {}, it.kind === 'package' ? '📦' : '📄'),
        h('span', { class: 'pk-name' }, it.name.replace(/\.zip$/i, '')),
        h('span', { class: 'pk-meta' }, (it.kind === 'package' ? T('package') + ' · ' : T('file') + ' · ') + fmtSize(it.size)),
        h('button', { class: 'btn', title: T('Remove'), onclick: () => removePackage(it, scope) }, '✕')));
    });
  }

  async function loadPackages() {
    try {
      const d = await Project.texmf.list();
      renderPackages($('pk-list-project'), d.project || [], 'project');
      renderPackages($('pk-list-global'), d.global || [], 'global');
    } catch (e) {
      showMsg(e.message);
    }
  }

  window.importPackage = async function () {
    const name = $('pk-name').value.trim();
    if (!name) { showMsg('Enter the package name.'); return; }
    const btn = $('pk-import');
    btn.disabled = true;
    btn.textContent = T('Downloading...');
    showMsg('');
    try {
      const d = await Project.texmf.import({ scope: $('pk-scope').value, package: name });
      $('pk-name').value = '';
      showMsg(T('Package "{0}" imported ({1}). Recompile to use it.', d.item.name.replace(/\.zip$/i, ''), fmtSize(d.item.size)), true);
      await loadPackages();
    } catch (e) {
      showMsg(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Import';
    }
  };

  function fileToB64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('Could not read the file'));
      r.readAsDataURL(file);
    });
  }

  window.uploadPackages = async function () {
    const input = $('pk-file');
    const files = [...input.files];
    if (!files.length) { showMsg(T('Choose one or more files.')); return; }
    showMsg('');
    let ok = 0;
    for (const f of files) {
      try {
        await Project.texmf.upload({ scope: $('pk-scope').value, name: f.name, content: await fileToB64(f) });
        ok++;
      } catch (e) {
        showMsg(`${f.name}: ${e.message}`);
      }
    }
    input.value = '';
    if (ok) showMsg(T('{0} file(s) uploaded. Recompile to use them.', ok), true);
    await loadPackages();
  };

  async function removePackage(item, scope) {
    if (!confirm(T('Remove "{0}"?', item.name))) return;
    try {
      await Project.texmf.remove(encodeURIComponent(item.id));
      await loadPackages();
    } catch (e) {
      showMsg(e.message);
    }
  }

  // ------------------------------------------------------------ version milestones

  let msDiff = null;
  let msCurrent = null; // { milestone, files: [{name, id, content}], now: Map(name -> text) }

  async function loadMilestones() {
    const list = $('ms-list');
    list.textContent = 'Loading...';
    try {
      const d = { milestones: await Project.milestones.list() };
      list.textContent = '';
      if (!d.milestones.length) list.textContent = 'No milestones yet.';
      d.milestones.forEach(m => {
        const author = (m.author && (m.author.name || m.author.email)) || '';
        list.append(h('div', { class: 'hist-item', onclick: () => openMilestone(m.id) },
          h('div', { class: 'hist-user' }, m.name),
          h('div', { class: 'hist-date' }, `${author} · ${fmtDate(m.createdAt)}`),
          m.note ? h('div', { class: 'hist-count', style: 'color:var(--muted);' }, m.note) : '',
          h('div', { style: 'margin-top:6px;' }, h('button', { class: 'btn', style: 'padding:2px 8px;font-size:11px;', onclick: ev => { ev.stopPropagation(); deleteMilestone(m); } }, 'Delete'))));
      });
    } catch (e) {
      list.textContent = '';
      showMsg(e.message);
    }
  }

  window.createMilestone = async function () {
    const name = $('ms-name').value.trim();
    if (!name) { showMsg('Give the milestone a name.'); return; }
    const btn = $('ms-create');
    btn.disabled = true;
    showMsg('');
    try {
      await Project.milestones.create({ name, note: $('ms-note').value.trim() });
      $('ms-name').value = '';
      $('ms-note').value = '';
      showMsg(T('Milestone created.'), true);
      await loadMilestones();
    } catch (e) {
      showMsg(e.message);
    } finally {
      btn.disabled = false;
    }
  };

  async function deleteMilestone(m) {
    if (!confirm(T('Delete the milestone "{0}"?', m.name))) return;
    try {
      await Project.milestones.remove(m.id);
      $('ms-files').textContent = '';
      $('ms-toolbar').textContent = '';
      await loadMilestones();
    } catch (e) {
      showMsg(e.message);
    }
  }

  async function openMilestone(id) {
    showMsg('');
    $('ms-toolbar').textContent = 'Loading...';
    try {
      const [m, build] = await Promise.all([
        Project.milestones.get(id),
        Project.build()
      ]);
      const now = new Map((build.files || []).map(f => [f.path, { text: f.text, id: f.id }]));
      // the file open in the editor takes precedence over the stored copy
      msCurrent = { milestone: m, now };
      renderMilestoneFiles();
      $('ms-toolbar').textContent = T('Milestone "{0}": choose a file to see the differences from the current state.', m.name);
    } catch (e) {
      $('ms-toolbar').textContent = '';
      showMsg(e.message);
    }
  }

  function renderMilestoneFiles() {
    const box = $('ms-files');
    box.textContent = '';
    const { milestone, now } = msCurrent;
    const names = new Set([...milestone.files.map(f => f.name), ...now.keys()]);
    [...names].sort().forEach(name => {
      const was = milestone.files.find(f => f.name === name);
      const cur = now.get(name);
      let state = 'same';
      if (!was) state = 'new'; else if (!cur) state = 'removed'; else if (was.content !== cur.text) state = 'changed';
      const label = { same: T('same'), new: T('new'), removed: T('removed'), changed: T('changed') }[state];
      box.append(h('span', { class: `ms-file ${state}`, onclick: ev => showMilestoneDiff(name, ev.currentTarget) }, `${name} · ${label}`));
    });
  }

  function showMilestoneDiff(name, chip) {
    document.querySelectorAll('.ms-file').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const { milestone, now } = msCurrent;
    const was = milestone.files.find(f => f.name === name);
    const cur = now.get(name);
    const before = was ? was.content : '';
    const after = cur ? cur.text : '';

    const container = $('ms-diff');
    if (!msDiff) {
      msDiff = monaco.editor.createDiffEditor(container, { readOnly: true, renderSideBySide: true, automaticLayout: true, theme: LD.THEME, fontSize: 13 });
    }
    const old = msDiff.getModel();
    const msLang = LD.languageFor(name);
    msDiff.setModel({ original: monaco.editor.createModel(before, msLang), modified: monaco.editor.createModel(after, msLang) });
    if (old) { old.original.dispose(); old.modified.dispose(); }

    const tb = $('ms-toolbar');
    tb.textContent = '';
    tb.append(h('span', {}, T('{0}: milestone (left) × current (right)', name)));
    if (was && cur) {
      tb.append(h('button', { class: 'btn btn-primary', style: 'padding:4px 10px;font-size:12px;', onclick: () => restoreFromMilestone(name, was.content, cur.id) }, '↩ Restore this file'));
    }
  }

  async function restoreFromMilestone(name, text, fileId) {
    if (!confirm(T('Replace the current content of "{0}" with this milestone\'s version? (the current version stays in the history)', name))) return;
    closeProject();
    if (fileId !== currentFileId) {
      const li = [...document.querySelectorAll('#file-tree li')].find(el => el.dataset.name === name);
      if (li) {
        li.click();
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    if (typeof currentFileId !== 'undefined' && currentFileId === fileId) {
      editor.setValue(text);
    } else {
      alert(T('Open the file "{0}" in the editor and try again.', name));
    }
  }

  // ------------------------------------------------------------ authorship

  window.loadAuthorship = async function () {
    const box = $('au-list');
    box.textContent = 'Loading...';
    const all = $('au-all').checked;
    try {
      const d = { entries: await Project.history.list(all ? null : currentFileId) };
      box.textContent = '';
      if (!d.entries.length) { box.textContent = 'No records yet. They appear when more than one person (or you) edits in real-time editing.'; return; }
      d.entries.forEach(e => {
        const who = (e.user && (e.user.name || e.user.email)) || T('Unknown');
        const head = h('div', { class: 'au-head' },
          h('div', { class: 'perm-avatar', style: 'width:24px;height:24px;font-size:11px;' }, (who.trim()[0] || '?').toUpperCase()),
          h('span', {}, who),
          h('span', { class: 'au-add' }, `+${e.added || 0}`),
          h('span', { class: 'au-rem' }, `−${e.removed || 0}`),
          all && e.file ? h('span', { class: 'pk-meta' }, e.file) : '',
          h('span', { class: 'au-when' }, fmtDate(e.time)));
        const item = h('div', { class: 'au-item' }, head);
        if (e.preview) item.append(h('div', { class: 'au-prev' }, '“' + e.preview + '”'));
        box.append(item);
      });
    } catch (err) {
      box.textContent = '';
      showMsg(err.message);
    }
  };
})();
