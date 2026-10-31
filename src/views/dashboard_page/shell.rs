// Static HTML blocks of the projects page (no placeholders except the ones filled by `render`).

/// Document head: meta tags, icon, scripts and stylesheet.
pub(super) fn head() -> &'static str {
    r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Projects - NeoLeaf</title>
    <link rel="icon" type="image/svg+xml" sizes="any" href="/static/img/favicon.svg">
    <link rel="icon" type="image/png" sizes="64x64" href="/static/img/favicon.png">
    <script src="/static/js/session-guard.js"></script>
    <script src="/static/js/zip.js"></script>
    <script src="/static/js/project-handoff.js"></script>
    <script src="/static/js/project-import.js"></script>
    <script src="/static/js/theme.js"></script>
    <script src="/static/js/i18n.js"></script>
    <link rel="stylesheet" href="/static/css/editor.css">
</head>"##
}

/// Opening of the body and the top bar with the user button and sign-out link.
pub(super) fn body_and_top_bar() -> &'static str {
    r##"<body class="dashboard-body">
    <header class="top-bar">
        <div class="top-bar-left">
            <span class="brand-title"><img src="/static/img/neoleaf_logo_vet.svg" alt="" class="brand-logo"> <span class="brand-gradient">NeoLeaf</span></span>
        </div>
        <div class="top-bar-right">
            {{USER_BUTTON}}
        </div>
    </header>"##
}

/// Left sidebar: new project, import, filters, hint and footer links.
pub(super) fn sidebar() -> &'static str {
    r##"        <aside class="pl-side">
            <button class="pl-new" onclick="openNewProjectModal()">+ New project</button>
            <button class="pl-import" onclick="openImportModal()" title="Create a repository from a zip">⬆ Import ZIP</button>
            <nav class="pl-nav">
                <a href="#" class="active" data-filter="all">All projects</a>
                <a href="#" data-filter="mine">Your projects</a>
                <a href="#" data-filter="shared">Shared with you</a>
                <a href="#" data-filter="trash" id="pl-nav-trash">🗑️ Trash <span class="pl-count" id="pl-trash-count">{{TRASH_COUNT}}</span></a>
            </nav>
            <p class="pl-hint" data-i18n-html>Repositories on <strong>GitHub</strong> with the tag <code>neoleaf</code></p>
            <div style="margin-top: auto; padding-top: 24px; font-size: 11px; color: var(--muted); display: flex; flex-direction: column; gap: 6px;">
                {{ADMIN_SIDEBAR_LINK}}
                <a href="/agent" style="color: var(--muted); text-decoration: none;">💻 Local Agent & Compilation</a>
                <a href="/privacy" style="color: var(--muted); text-decoration: none;">🔒 Privacy (LGPD)</a>
                <a href="/terms" style="color: var(--muted); text-decoration: none;">📄 Terms of Use</a>
                <a href="/licenses" style="color: var(--muted); text-decoration: none;">📜 Licenses</a>
                <span style="font-size: 10px; margin-top: 4px;">Contact: <a href="mailto:contact@neoleaf.science" style="color: var(--muted); text-decoration: underline;">contact@neoleaf.science</a></span>
                <span id="pl-version" style="font-size: 10px; opacity: 0.8;">NeoLeaf v{{APP_VERSION}}</span>
            </div>
        </aside>"##
}

/// Main column: title, error, invitations, search box, tag bar and the projects card.
pub(super) fn main_column() -> &'static str {
    r##"        <main class="pl-main">
            <h1>All projects</h1>
            {{ERROR}}
            {{INVITATIONS}}
            <input type="search" id="pl-search" class="pl-search" placeholder="Search all projects (or #tag)..." autocomplete="off">
            <div id="pl-tag-bar" class="pl-tag-bar" style="display:none;"></div>
            <div class="pl-card">
                {{PROJECTS}}
            </div>
        </main>"##
}

/// Modal to create a new article (name and template gallery).
pub(super) fn new_project_modal() -> &'static str {
    r##"    <!-- New project modal -->
    <div id="new-project-modal" class="modal-backdrop" data-provider="{{PROVIDER}}">
        <div class="modal-box">
            <h3 style="color: var(--text-bright); margin-bottom: 16px;">Create New Article on GitHub</h3>
            <form id="new-project-form" onsubmit="handleCreateProject(event)">
                <div class="form-group">
                    <label for="proj-name">Repository Name</label>
                    <input type="text" id="proj-name" class="form-control" placeholder="e.g. paper-sbes-2026" maxlength="100" pattern="[A-Za-z0-9._\- ]+" title="Up to 100 characters: unaccented letters, numbers, - _ . (space becomes -)" required autofocus>
                </div>
                <div class="form-group">
                    <label>Starting Template</label>
                    <input type="hidden" id="proj-template" value="article">
                    <div id="tpl-gallery" class="tpl-gallery" data-no-i18n></div>
                </div>
                <p style="font-size: 12px; color: var(--muted); margin-top: 8px;" data-i18n-html>The repository will be created on GitHub with the topic <code>neoleaf</code> and synchronized automatically.</p>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px;">
                    <button type="button" class="btn" onclick="closeNewProjectModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="btn-create-submit">Create on GitHub</button>
                </div>
            </form>
        </div>
    </div>"##
}

/// Modal to move a project to the trash.
pub(super) fn delete_modal() -> &'static str {
    r##"    <!-- Move to trash modal -->
    <div id="delete-modal" class="modal-backdrop" style="display:none;" onclick="if(event.target===this)closeDeleteModal()">
        <div class="modal-box" style="max-width: 460px;">
            <h3 style="color: var(--text-bright); margin-bottom: 12px;">Move to trash</h3>
            <p style="font-size: 14px; line-height: 1.5; margin-bottom: 8px;">Project: <strong id="delete-modal-name" style="color:var(--text-bright);"></strong></p>
            <p style="font-size: 12px; color: var(--muted); line-height: 1.6;" data-i18n-html>The GitHub repository will be renamed, with the deletion date and time at the end of the name, and will get the <code>deleted</code> tag. Nothing is erased: you can restore it from the <strong>Trash</strong>.</p>
            <div id="delete-modal-error" style="display:none; background:color-mix(in srgb, var(--danger-color) 14%, var(--bg-primary)); border:1px solid color-mix(in srgb, var(--danger-color) 50%, var(--bg-primary)); color:var(--danger-color); padding:8px 12px; border-radius:6px; font-size:13px; margin-top:12px;"></div>
            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                <button type="button" class="btn" onclick="closeDeleteModal()" id="delete-cancel">Cancel</button>
                <button type="button" class="btn btn-primary" onclick="confirmDeleteProject()" id="delete-confirm" style="background:var(--danger-color); border-color:var(--danger-color);">Move to trash</button>
            </div>
        </div>
    </div>"##
}

/// Modal to import a project from a ZIP.
pub(super) fn import_modal() -> &'static str {
    r##"    <!-- Import ZIP modal -->
    <div id="import-modal" class="modal-backdrop">
        <div class="modal-box">
            <h3 style="color: var(--text-bright); margin-bottom: 16px;">Import a project from a ZIP</h3>
            <form id="import-form" onsubmit="handleImport(event)">
                <div class="form-group">
                    <label for="imp-file">ZIP file (up to 200 MB)</label>
                    <input type="file" id="imp-file" class="form-control" accept=".zip,application/zip" required>
                </div>
                <div class="form-group">
                    <label for="imp-name">Repository name</label>
                    <input type="text" id="imp-name" class="form-control" placeholder="e.g. my-latex-paper" maxlength="100" pattern="[A-Za-z0-9._\- ]+" title="Up to 100 characters: unaccented letters, numbers, - _ . (space becomes -)" required>
                </div>
                <p style="font-size: 12px; color: var(--muted); line-height: 1.5;">Use the ZIP with the source files of the project (the .tex files, figures and .bib), not the PDF. The main file and the compiler are detected from the files.</p>
                <p style="font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 8px;">The repository will be created on your GitHub and the extracted files committed locally.</p>
                <div id="import-error" style="display:none; background:color-mix(in srgb, var(--danger-color) 14%, var(--bg-primary)); border:1px solid color-mix(in srgb, var(--danger-color) 50%, var(--bg-primary)); color:var(--danger-color); padding:8px 12px; border-radius:6px; font-size:13px; margin-top:10px;"></div>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                    <button type="button" class="btn" onclick="closeImportModal()" id="imp-cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="imp-submit">Import</button>
                </div>
            </form>
        </div>
    </div>"##
}

/// Modal to manage the tags (topics) of a project.
pub(super) fn edit_topics_modal() -> &'static str {
    r##"    <!-- Manage tags modal -->
    <div id="edit-topics-modal" class="modal-backdrop" style="display:none;" onclick="if(event.target===this)closeEditTopicsModal()">
        <div class="modal-box" style="max-width: 480px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <h3 style="color:var(--text-bright); margin:0; font-size:16px;">🏷️ Manage Tags</h3>
                <button type="button" class="btn" onclick="closeEditTopicsModal()" style="padding:2px 8px; font-size:16px; border:none; background:transparent; color:var(--muted); cursor:pointer;">✕</button>
            </div>
            <p style="font-size:13px; color:var(--muted); margin-bottom:14px;">
                Project: <strong id="modal-topics-proj-name" style="color:var(--text-bright);"></strong>
            </p>

            <div style="margin-bottom:14px;">
                <label style="font-size:12px; font-weight:600; color:var(--muted); display:block; margin-bottom:6px;">Tags associadas (GitHub Topics)</label>
                <div id="modal-tags-list" style="display:flex; flex-wrap:wrap; gap:6px; min-height:36px; padding:8px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:6px; align-items:center;">
                </div>
                <div style="font-size:11px; color:var(--muted); margin-top:5px; line-height:1.4;" data-i18n-html>
                    💡 Tags are saved directly as <em>topics</em> of the repository on your GitHub. The <code>neoleaf</code> tag is kept automatically.
                </div>
            </div>

            <form id="add-tag-form" onsubmit="handleAddTag(event)" style="display:flex; gap:8px; margin-bottom:16px;">
                <input type="text" id="new-tag-input" class="form-control" placeholder="New tag (e.g. thesis, sbc, 2026)" style="flex:1;" maxlength="35" autocomplete="off">
                <button type="submit" class="btn" style="white-space:nowrap; padding:6px 12px;">+ Add</button>
            </form>

            <div id="modal-topics-error" style="display:none; background:color-mix(in srgb, var(--danger-color) 14%, var(--bg-primary)); border:1px solid color-mix(in srgb, var(--danger-color) 50%, var(--bg-primary)); color:var(--danger-color); padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:14px;"></div>

            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button type="button" class="btn" onclick="closeEditTopicsModal()" id="btn-cancel-topics">Cancel</button>
                <button type="submit" class="btn btn-primary" onclick="saveTopics()" id="btn-save-topics">Save to GitHub</button>
            </div>
        </div>
    </div>"##
}
