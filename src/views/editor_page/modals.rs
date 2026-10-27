/// Name dialog (new file, new folder, rename).
pub(super) fn name_modal() -> &'static str {
    r##"    <!-- Name dialog (new file, new folder, rename) -->
    <div id="name-modal" class="modal-backdrop">
        <div class="modal-box" style="width: 400px;">
            <h3 id="name-title" style="color: var(--text-bright); margin-bottom: 14px;"></h3>
            <form onsubmit="FT.nameSubmit(event)">
                <div id="name-type-row" style="display:none; margin-bottom: 10px;">
                    <label for="name-type" class="modal-hint" style="display:block; margin-bottom: 4px;">File type</label>
                    <select id="name-type" class="form-control"></select>
                </div>
                <input type="text" id="name-input" class="form-control" maxlength="120" autocomplete="off" required>
                <div id="name-error" class="modal-error" style="display:none; margin-top: 10px;"></div>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;">
                    <button type="button" class="btn" onclick="FT.nameCancel()">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="name-ok">OK</button>
                </div>
            </form>
        </div>
    </div>

"##
}

/// Move file or folder dialog.
pub(super) fn move_modal() -> &'static str {
    r##"    <!-- Move file or folder dialog -->
    <div id="move-modal" class="modal-backdrop" style="display:none;" onclick="if (event.target === this) FT.moveCancel()">
        <div class="modal-box" style="width: 420px;">
            <h3 id="move-title" style="color: var(--text-bright); margin-bottom: 14px;">Move</h3>
            <form onsubmit="FT.moveSubmit(event)">
                <div style="font-size: 13px; color: var(--muted); margin-bottom: 8px;">Destination folder:</div>
                <select id="move-select" class="form-control" style="width: 100%; margin-bottom: 12px;"></select>
                <div id="move-error" class="modal-error" style="display:none; margin-top: 10px;"></div>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;">
                    <button type="button" class="btn" onclick="FT.moveCancel()">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="move-ok">Move</button>
                </div>
            </form>
        </div>
    </div>

"##
}

/// Image and PDF preview modal.
pub(super) fn preview_modal() -> &'static str {
    r##"    <!-- Image and PDF preview -->
    <div id="preview-modal" class="modal-backdrop" onclick="if (event.target === this) FT.closePreview()">
        <div class="modal-box modal-xl" style="height: 86vh;">
            <div class="modal-head">
                <h3 id="preview-title"></h3>
                <button type="button" class="btn" onclick="FT.closePreview()">✕</button>
            </div>
            <div id="preview-body" style="flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: auto;"></div>
        </div>
    </div>

"##
}

/// Repository collaborators modal.
pub(super) fn share_modal() -> &'static str {
    r##"    <!-- Share modal -->
    <div id="share-modal" class="modal-backdrop">
        <div class="modal-box modal-wide">
            <div class="modal-head">
                <h3>Repository Collaborators</h3>
                <button type="button" class="btn" onclick="closeShare()">✕</button>
            </div>
            <form id="share-form" class="share-form" onsubmit="submitShare(event)">
                <input type="text" id="share-email" class="form-control" placeholder="GitHub user or e-mail" required autofocus>
                <select id="share-role" class="form-control" style="width: 140px;">
                    <option value="writer">Editor (Push)</option>
                    <option value="reader">Reader (Pull)</option>
                    <option value="admin">Administrator</option>
                </select>
                <button type="submit" class="btn btn-primary" id="share-submit">Invite</button>
            </form>
            <p class="modal-hint">The person will receive an invitation on GitHub to collaborate on the repository. Once accepted, the project will appear in their NeoLeaf with the [neoleaf] tag.</p>
            <div id="share-error" class="modal-error" style="display:none;"></div>
            <div class="modal-subtitle">Who has access</div>
            <div id="share-list" class="perm-list">Loading...</div>
        </div>
    </div>

"##
}

/// Project modal: header and tab buttons.
pub(super) fn project_modal_head() -> &'static str {
    r##"    <!-- Project modal (.neoleaf) -->
    <div id="project-modal" class="modal-backdrop">
        <div class="modal-box modal-xl">
            <div class="modal-head">
                <h3>Project <span style="color:var(--muted);font-weight:400;font-size:13px;">· .neoleaf folder</span></h3>
                <button type="button" class="btn" onclick="closeProject()">✕</button>
            </div>
            <div class="ptabs">
                <button class="ptab active" data-tab="settings" onclick="switchPTab('settings')">Settings</button>
                <button class="ptab" data-tab="packages" onclick="switchPTab('packages')">Packages</button>
                <button class="ptab" data-tab="milestones" onclick="switchPTab('milestones')">Version milestones</button>
                <button class="ptab" data-tab="authorship" onclick="switchPTab('authorship')">Authorship</button>
            </div>
            <div id="pmsg" class="modal-error" style="display:none;"></div>

"##
}

/// Project modal: settings tab.
pub(super) fn project_tab_settings() -> &'static str {
    r##"            <div id="ptab-settings" class="ppane">
                <div class="form-group">
                    <label for="cfg-main">Main file (the one that is compiled)</label>
                    <select id="cfg-main" class="form-control"></select>
                </div>
                <div class="form-group">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <label for="cfg-engine" style="margin-bottom: 0;">Compilation engine</label>
                        <a href="/agent" target="_blank" style="font-size: 11px; color: var(--link); text-decoration: none;">ℹ️ About WebAssembly & the Local Agent</a>
                    </div>
                    <select id="cfg-engine" class="form-control">
                        <option value="wasm-texlive">⚡ Browser (pdfLaTeX)</option>
                        <option value="wasm-xelatex">⚡ Browser (XeLaTeX / WebAssembly)</option>
                        <option value="wasm-lualatex">⚡ Browser (LuaLaTeX / WebAssembly)</option>
                        <option value="wasm-typst">⚡ Browser (Typst / WebAssembly)</option>
                    </select>
                    <div id="agent-hint" class="modal-hint"></div>
                </div>
                <label class="check"><input type="checkbox" id="cfg-auto"> Automatically install missing packages (downloaded from TeX Live for this project)</label>
                <label class="check"><input type="checkbox" id="cfg-global"> Use this engine as the default for all my projects</label>
                <div class="form-group" style="margin-top: 12px; margin-bottom: 12px; padding: 12px; background: var(--bg-secondary); border-radius: 6px; border: 1px solid var(--border-color);">
                    <label class="check" style="font-weight: 500; margin-bottom: 6px;">
                        <input type="checkbox" id="cfg-auto-sync" onchange="toggleAutoSyncIntervalVisibility()">
                        Periodic Git sync (automatic Pull and Push)
                    </label>
                    <div id="cfg-auto-sync-interval-group" style="margin-left: 24px; display: flex; align-items: center; gap: 8px; font-size: 13px;">
                        <span>Check interval:</span>
                        <select id="cfg-auto-sync-interval" class="form-control" style="width: auto; padding: 2px 8px; font-size: 13px;">
                            <option value="1">1 minute</option>
                            <option value="2">2 minutes</option>
                            <option value="5" selected>5 minutes</option>
                            <option value="10">10 minutes</option>
                            <option value="15">15 minutes</option>
                            <option value="30">30 minutes</option>
                        </select>
                    </div>
                    <div class="modal-hint" style="margin-left: 24px; margin-top: 4px; font-size: 11px;">
                        First checks whether the remote repository has changes (pull), and if there are local changes in the browser, pushes them with date and time.
                    </div>
                </div>
                <div class="form-group" style="margin-top: 12px; margin-bottom: 12px; padding: 12px; background: var(--bg-secondary); border-radius: 6px; border: 1px solid var(--border-color);">
                    <label class="check" style="font-weight: 500; margin-bottom: 6px;">
                        <input type="checkbox" id="cfg-spell-check" checked>
                        Spell check
                    </label>
                    <div style="margin-left: 24px; display: flex; align-items: center; gap: 8px; font-size: 13px; margin-top: 6px;">
                        <span>Language:</span>
                        <select id="cfg-spell-lang" class="form-control" style="width: auto; padding: 2px 8px; font-size: 13px;">
                            <option value="auto" selected>Automatic (from document)</option>
                            <option value="pt-BR">Português (Brasil)</option>
                            <option value="pt-PT">Português (Portugal)</option>
                            <option value="en-US">English (US)</option>
                            <option value="en-GB">English (UK)</option>
                            <option value="es-ES">Español</option>
                            <option value="fr-FR">Français</option>
                            <option value="it-IT">Italiano</option>
                            <option value="de-DE">Deutsch</option>
                        </select>
                    </div>
                    <div class="modal-hint" style="margin-left: 24px; margin-top: 6px; font-size: 11px;" data-i18n-html>
                        Underlines misspelled words in the editor. Ignores LaTeX commands, math and references. Project vocabulary is kept in <code>.neoleaf/dictionary.txt</code>. Your browser downloads each dictionary when it is needed, from the LibreOffice dictionaries on GitHub, and keeps it on this device: Portuguese (Brazil and Portugal), English (US and UK), Spanish, French, Italian and German. Documents in other languages are not checked.
                    </div>
                </div>
                <div class="form-group" style="margin-top: 12px; margin-bottom: 12px; padding: 12px; background: var(--bg-secondary); border-radius: 6px; border: 1px solid var(--border-color);">
                    <label class="check" style="font-weight: 500; margin-bottom: 6px;">
                        <input type="checkbox" id="cfg-style-check" checked>
                        Style checks and syntax errors
                    </label>
                    <div style="margin-left: 24px; display: flex; align-items: center; gap: 8px; font-size: 13px; margin-top: 6px; flex-wrap: wrap;">
                        <span>Format Document:</span>
                        <select id="cfg-format-wrap" class="form-control" style="width: auto; padding: 2px 8px; font-size: 13px;">
                            <option value="reflow" selected>Reflow paragraphs</option>
                            <option value="sentence">One sentence per line</option>
                            <option value="semantic">Break at clauses</option>
                            <option value="preserve">Keep my line breaks</option>
                        </select>
                        <span>Line width (characters):</span>
                        <input type="number" id="cfg-format-width" class="form-control" min="40" max="200" value="80" title="Default 80. Format Document and the editor wrap lines at this width." style="width: 76px; padding: 2px 8px; font-size: 13px;">
                    </div>
                    <div class="modal-hint" style="margin-left: 24px; margin-top: 6px; font-size: 11px;" data-i18n-html>
                        Underlines unclosed environments and braces and style slips (straight quotes, <code>$$</code>, <code>...</code>, a missing non-breaking space), with a quick fix. Format Document (Shift+Alt+F) and Fix all style issues are in the editor menu. Runs in your browser with Badness.
                    </div>
                </div>
                <div id="cfg-ci" class="form-group" style="margin-top: 12px; margin-bottom: 12px; padding: 12px; background: var(--bg-secondary); border-radius: 6px; border: 1px solid var(--border-color);">
                    <div style="font-weight: 500; margin-bottom: 6px;">Build the PDF on GitHub</div>
                    <div class="modal-hint" style="margin-top: 0; font-size: 11px;">
                        Adds a GitHub Actions workflow that compiles the project on every push and keeps the PDF with the run. The file is created on GitHub, where you commit it; then Pull here.
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;">
                        <button type="button" class="btn" id="cfg-ci-open" onclick="openCiWorkflow()">Add the workflow on GitHub</button>
                        <button type="button" class="btn" id="cfg-ci-copy" onclick="copyCiWorkflow()">Copy the file</button>
                    </div>
                    <div id="cfg-ci-msg" class="modal-hint" style="margin-top: 6px; font-size: 11px;"></div>
                </div>
                <p class="modal-hint" data-i18n-html>The settings are stored in the project's <code>.neoleaf/config.json</code> file (and in <code>NeoLeaf/.neoleaf</code> for the global default). Anyone who edits the project can change them.</p>
                <button class="btn btn-primary" onclick="saveSettings()">Save settings</button>
            </div>

"##
}

/// Project modal: extra packages tab.
pub(super) fn project_tab_packages() -> &'static str {
    r##"            <div id="ptab-packages" class="ppane" style="display:none;">
                <p class="modal-hint" style="margin-top:0;" data-i18n-html>Add classes, packages and fonts (.otf, .ttf) that the browser compiler does not include (for example <code>abntex2</code>, OpenType fonts or languages). They are used in the next compilation.</p>
                <div class="pk-add">
                    <input type="text" id="pk-name" class="form-control" placeholder="package name (e.g. abntex2, babel-portuges)">
                    <select id="pk-scope" class="form-control" style="width:190px;">
                        <option value="project">This project only</option>
                        <option value="global">All my projects</option>
                    </select>
                    <button class="btn btn-primary" id="pk-import" onclick="importPackage()">Import</button>
                </div>
                <div class="pk-add">
                    <input type="file" id="pk-file" class="form-control" multiple accept=".sty,.cls,.clo,.ldf,.def,.fd,.cfg,.dfu,.bbx,.cbx,.lbx,.tex,.zip,.otf,.ttf,.ttc,.pfb,.pfa,.afm,.tfm,.vf,.map,.enc,.woff,.woff2">
                    <button class="btn" onclick="uploadPackages()">Upload file(s)</button>
                </div>
                <div class="modal-subtitle">This project's</div>
                <div id="pk-list-project" class="perm-list">Loading...</div>
                <div class="modal-subtitle">Global (all my projects)</div>
                <div id="pk-list-global" class="perm-list"></div>
            </div>

"##
}

/// Project modal: version milestones tab.
pub(super) fn project_tab_milestones() -> &'static str {
    r##"            <div id="ptab-milestones" class="ppane" style="display:none;">
                <div class="pk-add">
                    <input type="text" id="ms-name" class="form-control" placeholder="milestone name (e.g. Submission to advisor)" maxlength="100">
                    <input type="text" id="ms-note" class="form-control" placeholder="note (optional)" maxlength="500">
                    <button class="btn btn-primary" id="ms-create" onclick="createMilestone()">Create milestone</button>
                </div>
                <p class="modal-hint">A milestone keeps a copy of all the project's text files, with no expiry.</p>
                <div class="history-layout" style="min-height:340px;">
                    <div id="ms-list" class="hist-list">Loading...</div>
                    <div class="history-diff">
                        <div id="ms-files" class="ms-files"></div>
                        <div id="ms-toolbar" class="history-toolbar"></div>
                        <div id="ms-diff" class="history-diff-container"></div>
                    </div>
                </div>
            </div>

"##
}

/// Project modal: authorship tab; closes the project modal.
pub(super) fn project_tab_authorship() -> &'static str {
    r##"            <div id="ptab-authorship" class="ppane" style="display:none;">
                <label class="check"><input type="checkbox" id="au-all" onchange="loadAuthorship()"> Show all project files</label>
                <p class="modal-hint">Records who typed what during real-time editing: characters inserted and removed, and an excerpt of what was written.</p>
                <div id="au-list" class="au-list">Loading...</div>
            </div>
        </div>
    </div>

"##
}

/// Change history modal.
pub(super) fn history_modal() -> &'static str {
    r##"    <!-- History modal -->
    <div id="history-modal" class="modal-backdrop">
        <div class="modal-box modal-xl">
            <div class="modal-head">
                <h3>Change history: <span id="history-file" style="color:var(--green);"></span></h3>
                <button type="button" class="btn" onclick="closeHistory()">✕</button>
            </div>
            <div class="history-layout">
                <div class="hist-files-col">
                    <input type="text" id="history-filter" class="form-control" placeholder="Filter files..." oninput="renderHistoryFiles()" autocomplete="off">
                    <div id="history-files" class="hist-list hist-files">Loading...</div>
                </div>
                <div id="history-list" class="hist-list">Loading...</div>
                <div class="history-diff">
                    <div id="history-toolbar" class="history-toolbar">Select a change to see what changed.</div>
                    <div id="history-diff-container" class="history-diff-container"></div>
                </div>
            </div>
        </div>
    </div>

"##
}

/// Git push modal.
pub(super) fn git_push_modal() -> &'static str {
    r##"    <!-- Modal Git Push -->
    <div id="git-push-modal" class="modal-backdrop" style="display:none;">
        <div class="modal-box" style="max-width: 760px; width: 94vw;">
            <div class="modal-head">
                <h3 style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12V2.5l3.24 3.24a.75.75 0 1 0 1.06-1.06l-4.5-4.5a.75.75 0 0 0-1.06 0l-4.5 4.5a.75.75 0 0 0 1.06 1.06L7.5 2.5V12a.75.75 0 0 0 1.5 0zM1 14.25c0-.41.34-.75.75-.75h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1-.75-.75z"/></svg>
                    Git Push
                </h3>
                <button type="button" class="btn" onclick="closeGitPushModal()">✕</button>
            </div>
            <div id="git-push-info" style="font-size: 13px; color: var(--muted); margin-bottom: 12px; line-height: 1.5;"></div>
            <div id="git-push-behind" class="gr-warn" style="display:none;"></div>
            <div id="git-push-changes" class="gr-box"></div>
            <form id="git-push-form" onsubmit="handleGitPushSubmit(event)">
                <div class="form-group">
                    <label for="git-commit-msg">Commit Message <span style="font-weight: normal; color: var(--muted); font-size: 11px;">(optional, pre-filled with date and time)</span></label>
                    <input type="text" id="git-commit-msg" class="form-control" placeholder="Update: DD/MM/YYYY HH:mm" autofocus>
                </div>
                <div id="git-push-error" class="modal-error" style="display:none; margin-bottom: 12px;"></div>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                    <button type="button" class="btn" onclick="closeGitPushModal()" id="btn-push-cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="btn-push-submit" style="background: #238636; border-color: #2ea043;">Confirm and Send (Push)</button>
                </div>
            </form>
        </div>
    </div>

"##
}

/// Git pull modal (what comes from the remote).
pub(super) fn git_pull_modal() -> &'static str {
    r##"    <!-- Git Pull modal: what comes from GitHub -->
    <div id="git-pull-modal" class="modal-backdrop" style="display:none;">
        <div class="modal-box" style="max-width: 760px; width: 94vw;">
            <div class="modal-head">
                <h3 style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4v9.5l3.24-3.24a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06L7.5 13.5V4a.75.75 0 0 1 1.5 0zM1 1.75c0 .41.34.75.75.75h12.5a.75.75 0 0 0 0-1.5H1.75a.75.75 0 0 0-.75.75z"/></svg>
                    Git Pull: what comes from GitHub
                </h3>
                <button type="button" class="btn" onclick="closeGitPullModal()">✕</button>
            </div>
            <div id="git-pull-warn" class="gr-warn" style="display:none;"></div>
            <div id="git-pull-changes" class="gr-box"></div>
            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px;">
                <button type="button" class="btn" onclick="closeGitPullModal()">Cancel</button>
                <button type="button" class="btn btn-primary" id="btn-pull-submit" onclick="confirmGitPull()" disabled>Pull now</button>
            </div>
        </div>
    </div>

"##
}

/// Git reset modal (overwrites local with the remote).
pub(super) fn git_reset_modal() -> &'static str {
    r##"    <!-- Git Reset modal: overwrites the local project with what is on GitHub -->
    <div id="git-reset-modal" class="modal-backdrop" style="display:none;">
        <div class="modal-box" style="max-width: 760px; width: 94vw;">
            <div class="modal-head">
                <h3 style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f85149" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
                    Reset: bring what is on GitHub
                </h3>
                <button type="button" class="btn" onclick="closeGitResetModal()">✕</button>
            </div>
            <div class="gr-warn" style="background: rgba(248,81,73,.13); color: #f85149;" data-i18n-html>
                This <strong>overwrites</strong> the local project with the version on GitHub: unsent changes, local commits and new files will be discarded in this browser. This cannot be undone.
            </div>
            <div class="gr-sec" style="padding-left:0;">What will be lost</div>
            <div id="git-reset-changes" class="gr-box"></div>
            <div id="git-reset-error" class="modal-error" style="display:none; margin-bottom: 8px;"></div>
            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px;">
                <button type="button" class="btn" onclick="closeGitResetModal()" id="btn-reset-cancel">Cancel</button>
                <button type="button" class="btn btn-primary" id="btn-reset-submit" onclick="confirmGitReset()" style="background: #da3633; border-color: #f85149;">Yes, overwrite with GitHub</button>
            </div>
        </div>
    </div>

"##
}

/// Git pull conflicts modal.
pub(super) fn git_conflict_modal() -> &'static str {
    r##"    <!-- Git Pull conflicts modal -->
    <div id="git-conflict-modal" class="modal-backdrop" style="display:none;">
        <div class="modal-box modal-xl" style="height: 85vh; display: flex; flex-direction: column;">
            <div class="modal-head" style="flex-shrink: 0;">
                <h3 style="display: flex; align-items: center; gap: 8px;">
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="#f85149"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H11v1.25a.75.75 0 0 1-1.28.53l-2-2a.75.75 0 0 1 0-1.06l2-2A.75.75 0 0 1 11 1.75zM5 14.25V13H2.75a.75.75 0 0 1 0-1.5H5v-1.25a.75.75 0 0 1 1.28-.53l2 2a.75.75 0 0 1 0 1.06l-2 2A.75.75 0 0 1 5 14.25z"/></svg>
                    Git Pull conflict: <span id="git-conflict-filename" style="color:var(--green); font-family:monospace;"></span>
                </h3>
                <button type="button" class="btn" onclick="abortGitConflict()">✕</button>
            </div>
            
            <div id="git-conflict-file-tabs" style="display:flex; gap: 6px; padding: 6px 0; border-bottom: 1px solid var(--border-color); margin-bottom: 8px; flex-shrink: 0; overflow-x: auto;"></div>

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: rgba(255,255,255,0.03); border-radius: 4px; font-size: 12px; margin-bottom: 8px; flex-shrink: 0;">
                <div style="display: flex; gap: 24px;">
                    <span style="color: #58a6ff; font-weight: 600;">⬅ My Local Version</span>
                    <span style="color: #3fb950; font-weight: 600;">Version Received from GitHub ➡</span>
                </div>
                <div style="color: var(--muted);">Compare the changes and choose how to resolve the conflict</div>
            </div>

            <div id="git-conflict-diff-container" style="flex: 1; min-height: 250px; border: 1px solid var(--border-color); border-radius: 4px; overflow: hidden;"></div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; flex-shrink: 0; flex-wrap: wrap; gap: 8px;">
                <button type="button" class="btn" onclick="abortGitConflict()" style="color: #f85149; border-color: rgba(248,81,73,0.4);">✕ Cancel Pull and Keep As It Was</button>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn" onclick="resolveGitConflict('manual')" title="Inserts the conflict markers in the editor so you can adjust them manually">✏️ Edit Markers in the Editor</button>
                    <button type="button" class="btn btn-primary" onclick="resolveGitConflict('local')" style="background: #1f6feb; border-color: #388bfd;">📄 Accept My Version (Local)</button>
                    <button type="button" class="btn btn-primary" onclick="resolveGitConflict('remote')" style="background: #238636; border-color: #2ea043;">🌐 Accept GitHub Version (Remote)</button>
                </div>
            </div>
        </div>
    </div>

"##
}

/// Keyboard shortcuts modal.
pub(super) fn shortcuts_modal() -> &'static str {
    r##"    <!-- Keyboard shortcuts modal -->
    <div id="shortcuts-modal" class="modal-backdrop" style="display:none;" onclick="if (event.target === this) closeShortcutsModal()">
        <div class="modal-box modal-wide" style="max-width: 640px; max-height: 85vh; overflow-y: auto;">
            <div class="modal-head">
                <h3 style="display: flex; align-items: center; gap: 8px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M10 14h4"/></svg>
                    Keyboard Shortcuts
                </h3>
                <button type="button" class="btn" onclick="closeShortcutsModal()">✕</button>
            </div>
            <div class="shortcuts-grid" style="display: flex; flex-direction: column; gap: 16px; margin-top: 12px; font-size: 13px;">
                <div>
                    <h4 style="color: var(--accent-color, #58a6ff); margin-bottom: 8px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">LaTeX Editing and Formatting</h4>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Comment / Uncomment Line</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>/</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Bold (<code>\textbf{...}</code>)</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>B</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Italic (<code>\textit{...}</code>)</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>I</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Duplicate Line or Selection</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Delete Current Line</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>K</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Indent / Outdent</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>]</kbd> / <kbd>[</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Move Line Up / Down</td><td style="text-align: right; padding: 6px 0;"><kbd>Alt</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Uppercase / Lowercase</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>U</kbd> / <kbd>L</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Format Document</td><td style="text-align: right; padding: 6px 0;"><kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Cycle Line Wrapping</td><td style="text-align: right; padding: 6px 0;"><kbd>Alt</kbd> + <kbd>Z</kbd></td></tr>
                    </table>
                </div>

                <div>
                    <h4 style="color: var(--accent-color, #58a6ff); margin-bottom: 8px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Compilation, SyncTeX and Git</h4>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Recompile Document</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>Enter</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Sync Git (Pull & Push)</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>S</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Jump from Code to PDF (SyncTeX)</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>J</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Search the Whole Project</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Comment on Passage (Review)</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>M</kbd></td></tr>
                    </table>
                </div>

                <div>
                    <h4 style="color: var(--accent-color, #58a6ff); margin-bottom: 8px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Navigation and Search</h4>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Find in Current File</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>F</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Replace in Current File</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>H</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Go to Line</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>G</kbd></td></tr>
                        <tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 6px 0;">Autocomplete / Suggestions</td><td style="text-align: right; padding: 6px 0;"><kbd>Ctrl</kbd> + <kbd>Space</kbd></td></tr>
                        <tr><td style="padding: 6px 0;">Command Palette</td><td style="text-align: right; padding: 6px 0;"><kbd>F1</kbd></td></tr>
                    </table>
                </div>
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: 18px;">
                <button type="button" class="btn btn-primary" onclick="closeShortcutsModal()">Close</button>
            </div>
        </div>
    </div>

"##
}
