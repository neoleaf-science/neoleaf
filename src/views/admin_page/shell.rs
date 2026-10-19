// Static HTML blocks of the admin page (placeholders are filled by `render`).

/// Document head up to the stylesheet link.
pub(super) fn head() -> &'static str {
    r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Panel - NeoLeaf</title>
    <link rel="icon" type="image/png" href="/static/img/favicon.png">
    <script src="/static/js/theme.js"></script>
    <script src="/static/js/i18n.js"></script>
    <link rel="stylesheet" href="/static/css/editor.css">"##
}

/// Opening of the body and the top bar with the back link and the user button.
pub(super) fn body_and_top_bar() -> &'static str {
    r##"<body class="dashboard-body">
    <header class="top-bar">
        <div class="top-bar-left">
            <span class="brand-title"><img src="/static/img/logo.png" alt="" class="brand-logo"> <span class="brand-gradient">NeoLeaf</span></span>
            <span style="margin-left: 10px; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; background: color-mix(in srgb, var(--green) 15%, var(--bg-primary)); color: var(--green); border: 1px solid color-mix(in srgb, var(--green) 30%, transparent);">
                🛡️ ADMIN
            </span>
        </div>
        <div class="top-bar-right">
            <a href="/" class="btn" style="text-decoration: none; padding: 5px 12px; font-size: 12px;">
                ← Back to Projects
            </a>
            {{USER_BUTTON}}
        </div>
    </header>"##
}

/// Title with the version badge, service status pill and refresh button.
pub(super) fn page_header() -> &'static str {
    r##"        <div class="admin-header">
            <div class="admin-title-area">
                <h1>Server Admin Panel <span class="version-badge" title="NeoLeaf version running">v{{APP_VERSION}}</span></h1>
                <p style="font-size: 13px; color: var(--muted); margin: 0;">
                    Real-time monitoring of the VPS, hardware usage and registered users.
                </p>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
                <div class="status-pill">
                    <span class="pulse-dot"></span>
                    <span>Service Active</span>
                </div>
                <button type="button" class="btn" onclick="fetchLiveStats()" id="btn-refresh" style="font-size: 12px; padding: 6px 12px;">
                    🔄 Refresh Data
                </button>
            </div>
        </div>"##
}

/// Tab buttons (overview, users, templates).
pub(super) fn tabs_nav() -> &'static str {
    r##"        <div class="admin-tabs" role="tablist">
            <button type="button" class="admin-tab active" id="tabbtn-overview" onclick="showAdminTab('overview')">📊 Overview</button>
            <button type="button" class="admin-tab" id="tabbtn-users" onclick="showAdminTab('users')">👥 Users</button>
            <button type="button" class="admin-tab" id="tabbtn-models" onclick="showAdminTab('models')">📚 Templates</button>
        </div>"##
}

/// Overview: CPU, RAM, disk and uptime/process cards.
pub(super) fn metric_cards() -> &'static str {
    r##"        <!-- Main metric cards -->
        <div class="grid-cards">
            <!-- CPU -->
            <div class="admin-card">
                <div class="card-top">
                    <span class="card-title">⚡ Processing (CPU)</span>
                    <span style="font-size: 12px; color: var(--muted);" id="cpu-cores">{{CPU_CORES}} cores</span>
                </div>
                <div class="card-big" id="cpu-val">{{CPU_LOAD_1M}}</div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" id="cpu-bar" style="width: {{CPU_PERCENT}}%;"></div>
                </div>
                <div class="card-sub" id="cpu-sub">
                    Load Avg: <strong>{{CPU_LOAD_1M}}</strong> (1m) · <strong>{{CPU_LOAD_5M}}</strong> (5m) · <strong>{{CPU_LOAD_15M}}</strong> (15m)
                </div>
            </div>

            <!-- RAM -->
            <div class="admin-card">
                <div class="card-top">
                    <span class="card-title">💾 RAM</span>
                    <span style="font-size: 12px; font-weight: 700; color: var(--green);" id="mem-pct-badge">{{MEM_PERCENT}}%</span>
                </div>
                <div class="card-big" id="mem-val">{{MEM_USED_MB}} MB</div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" id="mem-bar" style="width: {{MEM_PERCENT}}%;"></div>
                </div>
                <div class="card-sub" id="mem-sub">
                    Out of a total of <strong>{{MEM_TOTAL_MB}} MB</strong> (Free: <strong>{{MEM_FREE_MB}} MB</strong>)
                </div>
            </div>

            <!-- Disk storage -->
            <div class="admin-card">
                <div class="card-top">
                    <span class="card-title">💽 Disk Storage</span>
                    <span style="font-size: 12px; font-weight: 700; color: var(--green);" id="disk-pct-badge">{{DISK_PERCENT}}%</span>
                </div>
                <div class="card-big" id="disk-val">{{DISK_USED_GB}} GB</div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" id="disk-bar" style="width: {{DISK_PERCENT}}%;"></div>
                </div>
                <div class="card-sub" id="disk-sub">
                    Of <strong>{{DISK_TOTAL_GB}} GB</strong> mounted at <code>{{DISK_MOUNT}}</code> (Free: <strong>{{DISK_FREE_GB}} GB</strong>)
                </div>
            </div>

            <!-- Uptime and process -->
            <div class="admin-card">
                <div class="card-top">
                    <span class="card-title">⏱️ Uptime & Process</span>
                    <span style="font-size: 12px; color: var(--muted);" id="proc-pid">PID {{PROC_PID}}</span>
                </div>
                <div class="card-big" style="font-size: 24px;" id="sys-uptime-val">{{SYS_UPTIME}}</div>
                <div style="margin: 8px 0 6px; font-size: 12px; color: var(--text-bright);">
                    NeoLeaf RSS: <strong id="proc-rss">{{PROC_RSS}} MB</strong> in RAM
                </div>
                <div class="card-sub" id="proc-uptime">
                    Process running for <strong>{{PROC_UPTIME}}</strong>
                </div>
            </div>
        </div>"##
}

/// Overview: users, sessions, rooms and WebSocket counters.
pub(super) fn counter_cards() -> &'static str {
    r##"        <!-- Sessions and collaboration -->
        <div class="grid-cards" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
            <div class="admin-card">
                <div class="card-top"><span class="card-title">👥 Registered Users</span></div>
                <div class="card-big" id="count-users">{{UNIQUE_USERS}}</div>
                <div class="card-sub">Unique users with a recorded session</div>
            </div>
            <div class="admin-card">
                <div class="card-top"><span class="card-title">🔑 Active Sessions</span></div>
                <div class="card-big" id="count-sessions">{{TOTAL_SESSIONS}}</div>
                <div class="card-sub">Tokens saved in <code>sessions.json</code></div>
            </div>
            <div class="admin-card">
                <div class="card-top"><span class="card-title">📝 Collaborative Rooms</span></div>
                <div class="card-big" id="count-rooms">{{COLLAB_ROOMS}}</div>
                <div class="card-sub">Documents open in real time</div>
            </div>
            <div class="admin-card">
                <div class="card-top"><span class="card-title">🌐 WebSocket Connections</span></div>
                <div class="card-big" id="count-peers">{{COLLAB_PEERS}}</div>
                <div class="card-sub">Collaborators syncing at the same time</div>
            </div>
        </div>"##
}

/// Overview: server environment and infrastructure details.
pub(super) fn vps_box() -> &'static str {
    r##"        <!-- VPS environment details -->
        <div class="admin-table-box">
            <div class="table-header-bar">
                <h2>🖥️ VPS Environment & Infrastructure</h2>
            </div>
            <div class="server-meta-grid">
                <div class="meta-item">
                    <span class="meta-label">Instance Hostname</span>
                    <span class="meta-val">{{SERVER_HOSTNAME}}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Operating System</span>
                    <span class="meta-val">{{SERVER_OS}}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Linux Kernel Version</span>
                    <span class="meta-val">{{SERVER_KERNEL}}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Production Domain</span>
                    <span class="meta-val"><a href="https://neoleaf.science" target="_blank" style="color:var(--green); text-decoration:none;">https://neoleaf.science ↗</a></span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Swap</span>
                    <span class="meta-val">{{SWAP_USED_MB}} MB of {{SWAP_TOTAL_MB}} MB ({{SWAP_PERCENT}}%)</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">TeX Live package cache</span>
                    <span class="meta-val">{{TL_CACHE}}</span>
                </div>
            </div>
        </div>"##
}

/// Comment and opening tag of the users tab.
pub(super) fn users_tab_open() -> &'static str {
    r##"        <!-- Users tab: system users and blocked users -->
        <div id="tab-users" style="display:none;">"##
}

/// Users tab: table of registered users (rows are placeholders).
pub(super) fn users_table() -> &'static str {
    r##"        <!-- Table of registered users -->
        <div class="admin-table-box">
            <div class="table-header-bar">
                <h2>👥 System Users</h2>
                <span style="font-size: 12px; color: var(--muted);" id="user-count-badge">
                    Total: <strong>{{UNIQUE_USERS}}</strong> user(s)
                </span>
            </div>
            <div style="overflow-x: auto;">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>User / Provider</th>
                            <th>Name</th>
                            <th>E-mail</th>
                            <th>Access Type</th>
                            <th style="text-align: center;">Sessions</th>
                            <th>Last Activity</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="users-tbody">
                        {{USERS_ROWS}}
                    </tbody>
                </table>
            </div>
        </div>"##
}

/// Users tab: blocked users with the block-by-login form.
pub(super) fn blocked_box() -> &'static str {
    r##"        <!-- Blocked users -->
        <div class="admin-table-box" id="blocked-box">
            <div class="table-header-bar">
                <h2>🚫 Blocked Users</h2>
                <span style="font-size: 12px; color: var(--muted);">Total: <strong id="blocked-count">{{BLOCKED_COUNT}}</strong></span>
            </div>
            <form id="block-by-login-form" onsubmit="blockByLogin(event)" style="display:flex; gap:8px; flex-wrap:wrap; padding:14px; border-bottom:1px solid var(--border-color);">
                <input type="text" id="block-login-input" class="form-control" placeholder="Block by provider login (e.g. someone)" maxlength="39" required autocomplete="off" style="flex:1; min-width:220px;">
                <input type="text" id="block-login-reason" class="form-control" placeholder="Reason (optional)" maxlength="200" autocomplete="off" style="flex:2; min-width:220px;">
                <button type="submit" class="btn-block" style="padding:8px 14px;">🚫 Block</button>
            </form>
            <div style="overflow-x: auto;">
                <table class="admin-table">
                    <thead><tr><th>User</th><th>Reason</th><th>When</th><th></th></tr></thead>
                    <tbody id="blocked-tbody">{{BLOCKED_ROWS}}</tbody>
                </table>
            </div>
            <p style="font-size:12px; color:var(--muted); padding:0 14px 14px;">A blocked person loses their sessions, cannot sign in again and is disconnected from real-time editing. The block applies to the provider account id, even if the person changes their login.</p>
        </div>"##
}

/// Modal to block a user with an optional reason.
pub(super) fn block_modal() -> &'static str {
    r##"        <!-- Block modal -->
        <div id="block-modal" class="modal-backdrop" style="display:none;" onclick="if(event.target===this)closeBlockModal()">
            <div class="modal-box" style="max-width: 460px;">
                <h3 style="color: var(--text-bright); margin-bottom: 12px;">Block user</h3>
                <p style="font-size: 14px; margin-bottom: 10px;">User: <strong id="block-modal-name" style="color:var(--text-bright);"></strong> <span id="block-modal-login" style="color:var(--muted);"></span></p>
                <label for="block-modal-reason" style="font-size:12px; color:var(--muted);">Reason (optional, only the administrator sees it)</label>
                <textarea id="block-modal-reason" class="form-control" rows="3" maxlength="200" placeholder="e.g. tried to access other people's projects"></textarea>
                <p style="font-size: 12px; color: var(--muted); margin-top: 10px;">The sessions will end now and the person will not be able to sign in again until unblocked.</p>
                <div id="block-modal-error" style="display:none; color:var(--danger-color); font-size:13px; margin-top:10px;"></div>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;">
                    <button type="button" class="btn" onclick="closeBlockModal()" id="block-cancel">Cancel</button>
                    <button type="button" class="btn btn-primary" onclick="confirmBlock()" id="block-confirm" style="background:var(--danger-color); border-color:var(--danger-color);">Block</button>
                </div>
            </div>
        </div>"##
}

/// Comment and opening tag of the templates tab.
pub(super) fn models_tab_open() -> &'static str {
    r##"        <!-- Templates tab: catalog of project templates (metadata and the GitHub source link only) -->
        <div id="tab-models" style="display:none;">"##
}

/// Templates tab: table of the registered templates.
pub(super) fn models_table() -> &'static str {
    r##"            <div class="admin-table-box">
                <div class="table-header-bar">
                    <h2>📚 Project Templates</h2>
                    <button type="button" class="btn btn-primary" onclick="newModel()" style="font-size:12px; padding:6px 12px;">+ New template</button>
                </div>
                <div style="overflow-x:auto;">
                    <table class="admin-table">
                        <thead><tr><th>Order</th><th>Template</th><th>Category</th><th>Source (GitHub)</th><th>Active</th><th></th></tr></thead>
                        <tbody id="models-tbody"><tr><td colspan="6" style="color:var(--muted);">Loading...</td></tr></tbody>
                    </table>
                </div>
                <p style="font-size:12px; color:var(--muted); padding:0 14px 14px;">The catalog keeps only the name, description and source link. The template files never stay on this server: when creating a project, the browser downloads the source from GitHub and writes it to the person's repository. Pin a tag or commit so the template does not change without you knowing. Check each template's license before registering it.</p>
            </div>"##
}

/// Templates tab: form to create or edit a template.
pub(super) fn model_form() -> &'static str {
    r##"            <div class="admin-table-box" id="model-form-box" style="display:none;">
                <div class="table-header-bar"><h2 id="model-form-title">New template</h2></div>
                <form id="model-form" onsubmit="saveModel(event)" style="padding:14px; display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px;">
                    <label class="mf">Identifier (lowercase letters, numbers and hyphen)<input id="mf-id" class="form-control" maxlength="60" required autocomplete="off" placeholder="e.g. abntex2-tcc"></label>
                    <label class="mf">Name<input id="mf-name" class="form-control" maxlength="100" required placeholder="e.g. abnTeX2 (TCC)"></label>
                    <label class="mf">Category
                        <select id="mf-category" class="form-control">
                            <option value="article">Article</option><option value="thesis">Thesis / Dissertation</option><option value="slides">Slides</option>
                            <option value="report">Report</option><option value="poster">Poster</option><option value="other">Other</option>
                        </select>
                    </label>
                    <label class="mf">Institution or event<input id="mf-institution" class="form-control" maxlength="100" placeholder="e.g. SBC, ABNT"></label>
                    <label class="mf">Language<input id="mf-language" class="form-control" maxlength="20" placeholder="e.g. pt"></label>
                    <label class="mf">License<input id="mf-license" class="form-control" maxlength="60" placeholder="e.g. LPPL 1.3c"></label>
                    <label class="mf" style="grid-column:1/-1;">Description<textarea id="mf-description" class="form-control" rows="2" maxlength="400"></textarea></label>
                    <label class="mf" style="grid-column:1/-1;">Source (GitHub repository)<input id="mf-source" class="form-control" maxlength="200" required placeholder="https://github.com/owner/repository"></label>
                    <label class="mf">Tag, branch or commit (pinning recommended)<input id="mf-ref" class="form-control" maxlength="100" placeholder="e.g. v1.9.7"></label>
                    <label class="mf">Folder inside the repository<input id="mf-subdir" class="form-control" maxlength="200" placeholder="empty = root"></label>
                    <label class="mf">Main file<input id="mf-main" class="form-control" maxlength="200" placeholder="empty = detect"></label>
                    <label class="mf">Recommended engine
                        <select id="mf-engine" class="form-control">
                            <option value="">NeoLeaf default</option><option value="wasm-texlive">pdfLaTeX</option><option value="wasm-xelatex">XeLaTeX</option><option value="wasm-lualatex">LuaLaTeX</option>
                        </select>
                    </label>
                    <label class="mf" style="grid-column:1/-1;">Preview image (https:// or /static/...)<input id="mf-preview" class="form-control" maxlength="300" placeholder="optional"></label>
                    <label class="mf">Order in the gallery<input id="mf-order" type="number" class="form-control" value="0" min="-9999" max="9999"></label>
                    <label class="mf" style="flex-direction:row; align-items:center; gap:8px;"><input id="mf-enabled" type="checkbox" checked> Active (visible to everyone)</label>
                    <div id="mf-msg" style="grid-column:1/-1; font-size:13px; display:none;"></div>
                    <div style="grid-column:1/-1; display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
                        <button type="button" class="btn" onclick="closeModelForm()">Cancel</button>
                        <button type="button" class="btn" onclick="checkModel()" id="mf-check">Check on GitHub</button>
                        <button type="submit" class="btn btn-primary" id="mf-save">Save</button>
                    </div>
                </form>
            </div>"##
}

/// Templates tab: table of suggested public templates.
pub(super) fn suggest_box() -> &'static str {
    r##"            <div class="admin-table-box" id="suggest-box">
                <div class="table-header-bar">
                    <h2>✨ Suggested Templates</h2>
                    <button type="button" class="btn btn-primary" onclick="addSuggested(null)" id="suggest-all" style="font-size:12px; padding:6px 12px;">Add all</button>
                </div>
                <div style="overflow-x:auto;">
                    <table class="admin-table">
                        <thead><tr><th>Template</th><th>Source (GitHub, pinned version)</th><th>Declared license</th><th></th></tr></thead>
                        <tbody id="suggest-tbody"></tbody>
                    </table>
                </div>
                <p style="font-size:12px; color:var(--muted); padding:0 14px 14px;">Known public sources whose compilation was tested with TeX Live. They are added <strong>disabled</strong>: check the license and use "Check on GitHub" in Edit before activating. The license shown is the one declared by the repository; the responsibility for redistributing is yours.</p>
            </div>"##
}
