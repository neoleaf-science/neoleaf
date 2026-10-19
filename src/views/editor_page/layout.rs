/// Opens the body and renders the top bar (engine, compile, git buttons, user menu).
pub(super) fn top_bar() -> &'static str {
    r##"<body>
    <!-- Top Navigation Bar -->
    <header class="top-bar">
        <div class="top-bar-left">
            <a href="/" class="btn home-logo-btn" title="Back to Projects" aria-label="Back to Projects">
                <img src="/static/img/logo.png" alt="" class="home-logo">
                <svg class="home-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>
            </a>
            <span class="project-title" title="{{PROJECT_TOOLTIP}}">{{PROJECT_TITLE}}</span>
            <div class="save-status">
                <span id="status-dot" class="status-dot"></span>
                <span id="status-text">Synced</span>
            </div>
            <div id="collab-users" class="collab-users"></div>
        </div>

        <div class="top-bar-right">
            <!-- Compilation engine & Compile -->
            <select id="engine-select" class="btn" style="padding: 5px 8px; font-size: 12px; background: var(--bg-tertiary); border-color: var(--border-strong); cursor: pointer;" title="Choose the compilation engine">
                <option value="wasm-texlive" selected>⚡ Browser (pdfLaTeX)</option>
                <option value="wasm-xelatex">⚡ Browser (XeLaTeX / WebAssembly)</option>
                <option value="wasm-lualatex">⚡ Browser (LuaLaTeX / WebAssembly)</option>
            </select>
            <button id="fast-btn" class="btn compile-icon" style="display:none" onclick="toggleFastMode()" title="Fast mode" aria-label="Fast mode"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg></button>
            <button id="compile-btn" class="btn btn-primary compile-icon" onclick="recompileLatex(event)" title="Recompile document (Ctrl + Enter). Shift+click: clean build" aria-label="Recompile document (Ctrl + Enter)"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg></button>

            <!-- Pull button (visible when the remote has new commits) -->
            <button id="git-pull-btn" class="btn" style="display:none; padding: 5px 10px; font-size: 12px; font-weight: 600; background: var(--warn); color: #000; border: none; align-items: center; gap: 6px; cursor: pointer;" onclick="openGitPullModal()" title="There are changes in the remote repository. Click to see what is coming and do a Pull.">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13 5h-2V1.5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0-.5.5V5H3a.5.5 0 0 0-.35.85l5 5a.5.5 0 0 0 .7 0l5-5A.5.5 0 0 0 13 5zM8 10.29 4.71 7h2.29V2h2v5h2.29L8 10.29zM1 14h14v1.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V14z"/></svg>
                <span id="git-pull-label">⬇ Pull</span>
            </button>

            <!-- Reset button: discards what is local and brings what is on GitHub -->
            <button id="git-reset-btn" class="btn" style="padding: 5px 8px; font-size: 12px; display: inline-flex; align-items: center;" onclick="openGitResetModal()" title="Reset: discards what is local and brings what is on GitHub" aria-label="Reset: discards what is local and brings what is on GitHub">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
            </button>

            <!-- Push button -->
            <button id="git-push-btn" class="btn" style="padding: 5px 10px; font-size: 12px; font-weight: 500; background: #238636; color: #ffffff; border: none; display: inline-flex; align-items: center; gap: 6px;" onclick="openGitPushModal()" title="Commit and send changes to GitHub (Push)">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12V2.5l3.24 3.24a.75.75 0 1 0 1.06-1.06l-4.5-4.5a.75.75 0 0 0-1.06 0l-4.5 4.5a.75.75 0 0 0 1.06 1.06L7.5 2.5V12a.75.75 0 0 0 1.5 0zM1 14.25c0-.41.34-.75.75-.75h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1-.75-.75z"/></svg>
                <span>Push</span>
                <span id="git-push-badge" style="display:none; background: rgba(255,255,255,0.25); border-radius: 10px; padding: 1px 6px; font-size: 10px;"></span>
            </button>

            <button class="btn" style="padding: 5px 8px;" onclick="openProject()" title="Settings, extra packages, version milestones and authorship (.neoleaf folder)" aria-label="Settings, extra packages, version milestones and authorship (.neoleaf folder)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
            <button class="btn" style="padding: 5px 8px;" onclick="openHistory()" title="View commits and changes in the file" aria-label="View history"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg></button>
            <button class="btn btn-primary" style="padding: 5px 8px;" onclick="openShare()" title="Repository collaborators" aria-label="Repository collaborators"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg></button>
            <button class="btn" style="padding: 5px 8px;" onclick="ExportMenu.toggle(event)" title="Download the project (source code ZIP) or the .bbl" aria-label="Download the project (source code ZIP) or the .bbl"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg></button>
            <button class="btn" style="padding: 5px 8px;" onclick="openShortcutsModal()" title="Keyboard shortcuts" aria-label="Keyboard shortcuts"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="12" x="2" y="6" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M10 14h4"/></svg></button>
            <a href="{{DRIVE_FOLDER_URL}}" id="repo-link" data-provider="{{PROVIDER_ID}}" target="_blank" rel="noopener" class="btn" style="padding: 5px 8px;" title="{{PROVIDER_OPEN_TITLE}}" aria-label="{{PROVIDER_OPEN_TITLE}}">{{PROVIDER_ICON}}</a>
            {{USER_BUTTON}}
        </div>
    </header>

"##
}

/// Opens the main workspace and renders the sidebar (file tree and outline).
pub(super) fn sidebar() -> &'static str {
    r##"    <!-- Main Workspace (3 Panes) -->
    <main class="main-container">
        <!-- Sidebar: Files & Outline -->
        <aside class="sidebar">
            <div class="sidebar-section-title">
                <span>Files</span>
                <span class="tree-tools">
                    <button class="tree-tool" onclick="FT.newFile()" title="New file"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/></svg></button>
                    <button class="tree-tool" onclick="FT.newFolder()" title="New folder"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/></svg></button>
                    <button class="tree-tool" onclick="document.getElementById('tree-upload').click()" title="Upload files"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg></button>
                    <input type="file" id="tree-upload" multiple style="display:none" onchange="FT.upload(this.files); this.value=''">
                </span>
            </div>
            <ul id="file-tree" class="file-tree"></ul>

            <div class="splitter-h" id="split-outline" role="separator" aria-orientation="horizontal" tabindex="0" title="Drag to adjust the height (double-click restores)"></div>
            <div class="sidebar-section-title" id="outline-title">
                <span>Outline (Sections)</span>
            </div>
            <div id="outline-list" class="outline-container"></div>
        </aside>

        <div class="splitter" id="split-sidebar" role="separator" aria-orientation="vertical" tabindex="0" title="Drag to adjust the width (double-click to reset)"></div>

"##
}

/// Center pane: tab bar, text toolbar and the Monaco container.
pub(super) fn editor_pane() -> &'static str {
    r##"        <!-- Center: Monaco Editor -->
        <section class="editor-pane">
            <div class="editor-tab-wrapper" style="display: flex; align-items: center; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color);">
                <div id="tab-bar" class="tab-bar" style="flex: 1; border-bottom: none; min-width: 0;"></div>
                <div style="display: flex; align-items: center; padding: 0 8px; flex-shrink: 0; gap: 6px;">
                    <button id="toolbar-toggle-btn" class="btn" style="display:none" title="Show or hide the toolbar" aria-label="Show or hide the toolbar">Aa</button>
                    <button id="blame-toggle-btn" class="btn btn-blame" onclick="toggleGitBlame()" title="Show or hide Git Blame history per line">
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M10.561 8.073a6.005 6.005 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6.004 6.004 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/></svg>
                        <span>Blame</span>
                    </button>
                </div>
            </div>
            <!-- Text toolbar (LaTeX and Markdown), see editor-toolbar.js -->
            <div id="editor-toolbar" class="ed-toolbar" style="display:none"></div>
            <div class="editor-workspace" style="display: flex; flex: 1; min-height: 0; position: relative; overflow: hidden;">
                <div id="blame-gutter" class="blame-gutter" style="display: none;"></div>
                <div id="monaco-container" style="flex: 1; min-width: 0; height: 100%;"></div>
            </div>
        </section>

"##
}

/// Right pane (PDF, search, references, comments, logs); closes the main workspace.
pub(super) fn pdf_panel() -> &'static str {
    r##"        <div class="splitter" id="split-preview" role="separator" aria-orientation="vertical" tabindex="0" title="Drag to adjust the width (double-click to reset)"></div>

        <!-- Right: PDF Viewer & Compiler Diagnostics -->
        <section class="preview-pane">
            <div class="preview-header">
                <div>
                    <button id="tab-pdf-btn" class="tab-btn active" onclick="switchTab('pdf')">📄 PDF</button>
                    <button id="tab-preview-btn" class="tab-btn" style="display:none" onclick="switchTab('preview')" title="Markdown preview">👁️ Preview</button>
                    <button id="tab-map-btn" class="tab-btn" onclick="switchTab('map')" title="Project map (experiment)">🗺️ Map</button>
                    <button id="tab-search-btn" class="tab-btn" onclick="switchTab('search')" title="Search and replace in the project (Ctrl+Shift+F)">🔍 Search</button>
                    <button id="tab-refs-btn" class="tab-btn" onclick="switchTab('refs')" title="Search papers and insert references (BibTeX)">📚 References</button>
                    <button id="tab-comments-btn" class="tab-btn" onclick="switchTab('comments')">
                        💬 Comments <span id="comments-badge" style="display: none; background: var(--accent-color); color: var(--on-accent); padding: 1px 6px; font-size: 10px; margin-left: 4px;"></span>
                    </button>
                    <button id="tab-logs-btn" class="tab-btn" onclick="switchTab('logs')">
                        📝 Logs <span id="error-badge" style="display: none; background: var(--danger-color); color: white; padding: 1px 6px; border-radius: 10px; font-size: 10px; margin-left: 4px;"></span>
                    </button>
                </div>
                <div>
                    <a id="download-pdf-btn" class="btn" style="padding: 3px 8px; font-size: 11px;" download="{{PROJECT_NAME}}.pdf" href="#" onclick="downloadCurrentPdf(event)">⬇ Download PDF</a>
                </div>
            </div>

            <div id="pdf-info" class="pdf-info-bar" style="display: none;"></div>

            <!-- PDF Embed Frame -->
            <div id="pdf-viewer" class="pdf-viewer-frame"></div>
            <div id="pdf-empty" class="pdf-empty" style="display: none;">
                <div>
                    <div style="font-size: 34px; margin-bottom: 10px;">📄</div>
                    <p>There is no compiled PDF in this project yet.</p>
                    <p style="color: var(--muted); margin-top: 6px;" data-i18n-html>Click <b>▶ Recompile</b> (or Ctrl+Enter). The result is saved in the project and opens without recompiling.</p>
                </div>
            </div>

            <!-- Markdown preview (isolated iframe, see md-preview.js) -->
            <div id="preview-container" class="preview-md-container"></div>

            <!-- Search and replace in the project -->
            <div id="search-container" class="comments-container"></div>

            <!-- References: article search and citations -->
            <div id="refs-container" class="comments-container"></div>

            <!-- Project map (experiment) -->
            <div id="map-container" class="map-container"></div>

            <!-- Comments and suggestions -->
            <div id="comments-container" class="comments-container"></div>

            <!-- Compiler Logs Drawer -->
            <div id="logs-container" class="logs-container">
                <div id="diagnostics-list" style="margin-bottom: 16px;"></div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px;">
                    <div style="font-weight: bold; color: var(--text-bright);">Raw Compiler Output:</div>
                    <button type="button" id="copy-log-btn" class="btn" style="font-size: 12px; padding: 3px 10px;" onclick="copyCompilerLog(this)" title="Copies the whole compiler output to the clipboard">Copy log</button>
                </div>
                <pre id="raw-log" style="white-space: pre-wrap;"></pre>
            </div>
        </section>
    </main>

"##
}
