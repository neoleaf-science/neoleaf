/// Editor script tags; their order is the editor JS load order.
pub(super) fn script_tags() -> &'static str {
    r##"    <!-- Frontend Script -->
    <script src="/static/js/context-language.js"></script>
    <script src="/static/js/typst-language.js"></script>
    <script src="/static/js/latex-language.js"></script>
    <script src="/static/js/autocomplete.js"></script>
    <script src="/static/js/synctex.js"></script>
    <script src="/static/js/pdf-view.js"></script>
    <script src="/static/js/comments.js"></script>
    <script src="/static/js/search.js"></script>
    <script src="/static/js/export-menu.js"></script>
    <script src="/static/js/agent.js"></script>
    <script src="/static/js/collab.js"></script>
    <script src="/static/js/completions-data.js"></script>
    <script src="/static/js/editor-core.js"></script>
    <script src="/static/js/git-status.js"></script>
    <script src="/static/js/git-conflicts.js"></script>
    <script src="/static/js/git-sync.js"></script>
    <script src="/static/js/git-blame.js"></script>
    <script src="/static/js/font-packs.js"></script>
    <script src="/static/js/project-build.js"></script>
    <script src="/static/js/bibliography.js"></script>
    <script src="/static/js/compile-pdflatex.js"></script>
    <script src="/static/js/package-install.js"></script>
    <script src="/static/js/compile-xelatex.js"></script>
    <script src="/static/js/compile-lualatex.js"></script>
    <script src="/static/js/compile-typst.js"></script>
    <script src="/static/js/pdf-panel.js"></script>
    <script src="/static/js/editor-ui.js"></script>
    <script src="/static/js/share.js"></script>
    <script src="/static/js/history.js"></script>
    <script src="/static/js/git-review.js"></script>
    <script src="/static/js/git-review-modals.js"></script>
    <script src="/static/js/git-review-open.js"></script>
    <script src="/static/js/file-tree.js"></script>
    <script src="/static/js/file-tree-dnd.js"></script>
    <script src="/static/js/file-tree-menu.js"></script>
    <script src="/static/js/file-tree-ops.js"></script>
    <script src="/static/js/tabs.js"></script>
    <script src="/static/js/splitters.js"></script>
    <script src="/static/js/outline.js"></script>
    <script src="/static/js/md-preview.js"></script>
    <script src="/static/js/mermaid-preview.js"></script>
    <script src="/static/js/csv-preview.js"></script>
    <script src="/static/js/ref-sources.js"></script>
    <script src="/static/js/references.js"></script>
    <script src="/static/js/py-runner.js"></script>
    <script src="/static/js/py-ui.js"></script>
    <script src="/static/js/notebook.js"></script>
    <script src="/static/js/editor-toolbar.js"></script>
    <script src="/static/js/mascot.js"></script>
    <script src="/static/js/mindmap.js"></script>
    <script src="/static/js/spellcheck-dicts.js"></script>
    <script src="/static/js/spellcheck.js"></script>
    <script src="/static/js/badness.js"></script>
    <script src="/static/js/project-tools.js"></script>
"##
}

/// Inline page script: project constants, file switching, PDF download, shortcuts modal.
pub(super) fn inline_script() -> &'static str {
    r##"    <script>
        const initialContent = {{INITIAL_CONTENT}};
        const activeFileId = "{{ACTIVE_FILE_ID}}";
        const projectId = "{{PROJECT_ID}}";
        window.projectId = projectId;
        const initialTree = JSON.parse({{TREE_JSON}});
        const projectParts = projectId.split('__');
        const projectOwner = projectParts[0] || '';
        const projectRepo = projectParts.slice(1).join('__') || '';
        const currentUser = JSON.parse({{CURRENT_USER_JSON}});

        window.onload = function() {
            initLatexEditor(initialContent, activeFileId);
        };

        // File switches run one at a time: two overlapping ones would bind collaboration to the wrong file.
        let switchQueue = Promise.resolve();
        function switchFile(fileId, fileName) {
            const run = switchQueue.then(() => doSwitchFile(fileId, fileName));
            switchQueue = run.catch(() => {});
            return run;
        }

        async function doSwitchFile(fileId, fileName) {
            if (!fileId) return;
            if (typeof fileId === 'string' && fileId.length > 25 && !fileId.includes('.') && !fileId.includes('/')) {
                return;
            }
            if (!fileName) fileName = fileId;
            if (fileId === currentFileId) return;
            if (window.Tabs) Tabs.saveState();          // cursor and scroll of the file being left
            if (window.collabStop) collabStop();
            if (isDirty) await saveCurrentFile();

            try {
                let content = null;
                if (window.BrowserGit && await BrowserGit.isCloned()) {
                    try {
                        content = await BrowserGit.readFile(fileId);
                    } catch (e) {
                        console.warn('BrowserGit.readFile did not find:', fileId, e);
                    }
                }
                if (content !== null) {
                    currentFileId = fileId;
                    if (window.Tabs) Tabs.expectRestore(fileId);
                    monaco.editor.setModelLanguage(editor.getModel(), LD.languageFor(fileName));
                    editor.setValue(content);
                    clearTimeout(saveTimeout);
                    isDirty = false;
                    if (window.collabStart) collabStart(fileId);
                    if (window.FT) FT.markActive(fileId);
                    if (window.updateFastButton) updateFastButton();
                    if (window.Tabs) {
                        Tabs.touch(fileId, fileName);
                        // without active collaboration, restore now; with collaboration, when it syncs
                        if (!window.collabActive) Tabs.restoreState(fileId);
                    }
                    if (window.isBlameActive && window.loadGitBlame) {
                        window.loadGitBlame(fileId);
                    }
                } else {
                    console.warn('Content not found for:', fileId);
                }
            } catch (err) {
                console.error('Error loading file:', err);
            }
        }

        function downloadCurrentPdf(e) {
            const url = window.PdfView && PdfView.blobUrl();
            if (url) {
                e.currentTarget.href = url;
            } else {
                e.preventDefault();
                alert('Compile the document before downloading the PDF.');
            }
        }

        function openShortcutsModal() {
            const m = document.getElementById('shortcuts-modal');
            if (m) m.style.display = 'flex';
        }

        function closeShortcutsModal() {
            const m = document.getElementById('shortcuts-modal');
            if (m) m.style.display = 'none';
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeShortcutsModal();
        });
    </script>
"##
}

/// User profile modal placeholder and end of the document.
pub(super) fn page_end() -> &'static str {
    r##"    {{USER_PROFILE_MODAL}}
</body>
</html>"##
}
