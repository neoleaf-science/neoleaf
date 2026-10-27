//! Static files embedded in the binary (`include_bytes!`), served by `GET /static/{js,css,vendor,img,licenses}/{file}`.
//!
//! Adding a file to the editor means adding one line to `FILES`; the URL is the file path under `static/`.
//! Nothing here is user data. Anything bigger or generated at deploy time (WASM engines, TeX Live bundles, the agent
//! binaries, Pyodide) is read from disk by the dedicated routes in `main.rs`.

/// `(path under static/, bytes)`. The path doubles as the URL: `static/js/zip.js` is served at `/static/js/zip.js`.
pub static FILES: &[(&str, &[u8])] = &[
    ("css/editor.css", include_bytes!("../static/css/editor.css")),
    (
        "img/editor_preview.webp",
        include_bytes!("../static/img/editor_preview.webp"),
    ),
    (
        "img/editor_preview_2.webp",
        include_bytes!("../static/img/editor_preview_2.webp"),
    ),
    (
        "img/editor_preview_claro.webp",
        include_bytes!("../static/img/editor_preview_claro.webp"),
    ),
    (
        "img/editor_preview_claro_2.webp",
        include_bytes!("../static/img/editor_preview_claro_2.webp"),
    ),
    (
        "img/favicon.png",
        include_bytes!("../static/img/favicon.png"),
    ),
    (
        "img/neoleaf-mascot.png",
        include_bytes!("../static/img/neoleaf-mascot.png"),
    ),
    (
        "licenses/rust-agent.txt",
        include_bytes!("../static/licenses/rust-agent.txt"),
    ),
    (
        "licenses/rust-server.txt",
        include_bytes!("../static/licenses/rust-server.txt"),
    ),
    ("img/logo.png", include_bytes!("../static/img/logo.png")),
    ("js/agent.js", include_bytes!("../static/js/agent.js")),
    (
        "js/autocomplete.js",
        include_bytes!("../static/js/autocomplete.js"),
    ),
    (
        "js/browser-git.js",
        include_bytes!("../static/js/browser-git.js"),
    ),
    (
        "js/browser-git-sync.js",
        include_bytes!("../static/js/browser-git-sync.js"),
    ),
    (
        "js/browser-git-compare.js",
        include_bytes!("../static/js/browser-git-compare.js"),
    ),
    ("js/collab.js", include_bytes!("../static/js/collab.js")),
    ("js/comments.js", include_bytes!("../static/js/comments.js")),
    ("js/badness.js", include_bytes!("../static/js/badness.js")),
    (
        "js/badness-worker.js",
        include_bytes!("../static/js/badness-worker.js"),
    ),
    (
        "js/compile-typst.js",
        include_bytes!("../static/js/compile-typst.js"),
    ),
    (
        "js/context-index.js",
        include_bytes!("../static/js/context-index.js"),
    ),
    (
        "js/context-language.js",
        include_bytes!("../static/js/context-language.js"),
    ),
    (
        "js/csv-preview.js",
        include_bytes!("../static/js/csv-preview.js"),
    ),
    (
        "js/editor-toolbar.js",
        include_bytes!("../static/js/editor-toolbar.js"),
    ),
    ("js/mascot.js", include_bytes!("../static/js/mascot.js")),
    (
        "js/export-menu.js",
        include_bytes!("../static/js/export-menu.js"),
    ),
    (
        "js/file-tree.js",
        include_bytes!("../static/js/file-tree.js"),
    ),
    (
        "js/file-tree-dnd.js",
        include_bytes!("../static/js/file-tree-dnd.js"),
    ),
    (
        "js/file-tree-menu.js",
        include_bytes!("../static/js/file-tree-menu.js"),
    ),
    (
        "js/file-tree-ops.js",
        include_bytes!("../static/js/file-tree-ops.js"),
    ),
    (
        "js/git-review.js",
        include_bytes!("../static/js/git-review.js"),
    ),
    (
        "js/git-review-modals.js",
        include_bytes!("../static/js/git-review-modals.js"),
    ),
    (
        "js/git-review-open.js",
        include_bytes!("../static/js/git-review-open.js"),
    ),
    ("js/i18n-cs.js", include_bytes!("../static/js/i18n-cs.js")),
    ("js/i18n-da.js", include_bytes!("../static/js/i18n-da.js")),
    ("js/i18n-de.js", include_bytes!("../static/js/i18n-de.js")),
    ("js/i18n-es.js", include_bytes!("../static/js/i18n-es.js")),
    ("js/i18n-fr.js", include_bytes!("../static/js/i18n-fr.js")),
    ("js/i18n-it.js", include_bytes!("../static/js/i18n-it.js")),
    ("js/i18n-ja.js", include_bytes!("../static/js/i18n-ja.js")),
    ("js/i18n-ko.js", include_bytes!("../static/js/i18n-ko.js")),
    ("js/i18n-nb.js", include_bytes!("../static/js/i18n-nb.js")),
    ("js/i18n-pt.js", include_bytes!("../static/js/i18n-pt.js")),
    ("js/i18n-ru.js", include_bytes!("../static/js/i18n-ru.js")),
    ("js/i18n-sv.js", include_bytes!("../static/js/i18n-sv.js")),
    ("js/i18n-tr.js", include_bytes!("../static/js/i18n-tr.js")),
    ("js/i18n-zh.js", include_bytes!("../static/js/i18n-zh.js")),
    ("js/i18n.js", include_bytes!("../static/js/i18n.js")),
    (
        "js/latex-language.js",
        include_bytes!("../static/js/latex-language.js"),
    ),
    (
        "js/md-preview.js",
        include_bytes!("../static/js/md-preview.js"),
    ),
    (
        "js/mermaid-preview.js",
        include_bytes!("../static/js/mermaid-preview.js"),
    ),
    ("js/mindmap.js", include_bytes!("../static/js/mindmap.js")),
    (
        "js/completions-data.js",
        include_bytes!("../static/js/completions-data.js"),
    ),
    (
        "js/editor-core.js",
        include_bytes!("../static/js/editor-core.js"),
    ),
    (
        "js/git-status.js",
        include_bytes!("../static/js/git-status.js"),
    ),
    (
        "js/git-conflicts.js",
        include_bytes!("../static/js/git-conflicts.js"),
    ),
    ("js/git-sync.js", include_bytes!("../static/js/git-sync.js")),
    (
        "js/git-blame.js",
        include_bytes!("../static/js/git-blame.js"),
    ),
    (
        "js/font-packs.js",
        include_bytes!("../static/js/font-packs.js"),
    ),
    (
        "js/project-build.js",
        include_bytes!("../static/js/project-build.js"),
    ),
    (
        "js/bibliography.js",
        include_bytes!("../static/js/bibliography.js"),
    ),
    (
        "js/compile-pdflatex.js",
        include_bytes!("../static/js/compile-pdflatex.js"),
    ),
    (
        "js/package-install.js",
        include_bytes!("../static/js/package-install.js"),
    ),
    (
        "js/compile-xelatex.js",
        include_bytes!("../static/js/compile-xelatex.js"),
    ),
    (
        "js/compile-lualatex.js",
        include_bytes!("../static/js/compile-lualatex.js"),
    ),
    (
        "js/pdf-panel.js",
        include_bytes!("../static/js/pdf-panel.js"),
    ),
    (
        "js/editor-ui.js",
        include_bytes!("../static/js/editor-ui.js"),
    ),
    ("js/share.js", include_bytes!("../static/js/share.js")),
    ("js/history.js", include_bytes!("../static/js/history.js")),
    (
        "js/notebook-frame.js",
        include_bytes!("../static/js/notebook-frame.js"),
    ),
    ("js/notebook.js", include_bytes!("../static/js/notebook.js")),
    ("js/outline.js", include_bytes!("../static/js/outline.js")),
    ("js/pdf-view.js", include_bytes!("../static/js/pdf-view.js")),
    (
        "js/project-handoff.js",
        include_bytes!("../static/js/project-handoff.js"),
    ),
    (
        "js/project-import.js",
        include_bytes!("../static/js/project-import.js"),
    ),
    (
        "js/project-store.js",
        include_bytes!("../static/js/project-store.js"),
    ),
    (
        "js/project-store-texmf.js",
        include_bytes!("../static/js/project-store-texmf.js"),
    ),
    (
        "js/project-store-build.js",
        include_bytes!("../static/js/project-store-build.js"),
    ),
    (
        "js/project-tools.js",
        include_bytes!("../static/js/project-tools.js"),
    ),
    (
        "js/py-runner.js",
        include_bytes!("../static/js/py-runner.js"),
    ),
    ("js/py-ui.js", include_bytes!("../static/js/py-ui.js")),
    (
        "js/ref-sources.js",
        include_bytes!("../static/js/ref-sources.js"),
    ),
    (
        "js/references.js",
        include_bytes!("../static/js/references.js"),
    ),
    ("js/search.js", include_bytes!("../static/js/search.js")),
    (
        "js/session-guard.js",
        include_bytes!("../static/js/session-guard.js"),
    ),
    (
        "js/spellcheck-dicts.js",
        include_bytes!("../static/js/spellcheck-dicts.js"),
    ),
    (
        "js/spellcheck.js",
        include_bytes!("../static/js/spellcheck.js"),
    ),
    (
        "js/spellcheck-worker.js",
        include_bytes!("../static/js/spellcheck-worker.js"),
    ),
    (
        "js/splitters.js",
        include_bytes!("../static/js/splitters.js"),
    ),
    (
        "js/storage-manager.js",
        include_bytes!("../static/js/storage-manager.js"),
    ),
    ("js/synctex.js", include_bytes!("../static/js/synctex.js")),
    ("js/tabs.js", include_bytes!("../static/js/tabs.js")),
    ("js/theme.js", include_bytes!("../static/js/theme.js")),
    (
        "js/typst-language.js",
        include_bytes!("../static/js/typst-language.js"),
    ),
    (
        "js/typst-worker.js",
        include_bytes!("../static/js/typst-worker.js"),
    ),
    ("js/zip.js", include_bytes!("../static/js/zip.js")),
    (
        "vendor/hunspell-asm.min.js",
        include_bytes!("../static/vendor/hunspell-asm.min.js"),
    ),
    (
        "vendor/isomorphic-git-http.js",
        include_bytes!("../static/vendor/isomorphic-git-http.js"),
    ),
    (
        "vendor/isomorphic-git.min.js",
        include_bytes!("../static/vendor/isomorphic-git.min.js"),
    ),
    (
        "vendor/lightning-fs.min.js",
        include_bytes!("../static/vendor/lightning-fs.min.js"),
    ),
    (
        "vendor/marked.umd.js",
        include_bytes!("../static/vendor/marked.umd.js"),
    ),
    (
        "vendor/mermaid.min.js",
        include_bytes!("../static/vendor/mermaid.min.js"),
    ),
    (
        "vendor/papaparse.min.js",
        include_bytes!("../static/vendor/papaparse.min.js"),
    ),
    (
        "vendor/purify.min.js",
        include_bytes!("../static/vendor/purify.min.js"),
    ),
    (
        "vendor/neoleaf-mascot.mjs",
        include_bytes!("../static/vendor/neoleaf-mascot.mjs"),
    ),
    (
        "vendor/neoleaf-mascot-agent.mjs",
        include_bytes!("../static/vendor/neoleaf-mascot-agent.mjs"),
    ),
    (
        "vendor/badness-engine.js",
        include_bytes!("../static/vendor/badness-engine.js"),
    ),
    (
        "vendor/badness-engine_bg.wasm",
        include_bytes!("../static/vendor/badness-engine_bg.wasm"),
    ),
    (
        "vendor/typst-engine.min.js",
        include_bytes!("../static/vendor/typst-engine.min.js"),
    ),
    ("vendor/yjs.mjs", include_bytes!("../static/vendor/yjs.mjs")),
];

/// An embedded file ready to be sent.
pub struct Asset {
    pub body: &'static [u8],
    pub content_type: &'static str,
    pub cache_control: &'static str,
}

/// Looks up `static/<dir>/<name>`. `dir` and `name` come from the URL, so only an exact match in `FILES` is accepted.
pub fn find(dir: &str, name: &str) -> Option<Asset> {
    let key = format!("{dir}/{name}");
    let (_, body) = FILES.iter().find(|(path, _)| *path == key)?;
    let (content_type, cache_control) = match name.rsplit('.').next().unwrap_or("") {
        "js" | "mjs" => ("application/javascript; charset=utf-8", "no-cache"),
        "css" => ("text/css; charset=utf-8", "no-cache"),
        "png" => ("image/png", "public, max-age=86400"),
        "webp" => ("image/webp", "public, max-age=86400"),
        "txt" => ("text/plain; charset=utf-8", "no-cache"),
        // requested with the build version (?v=), so a new build is a new address
        "wasm" => ("application/wasm", "public, max-age=31536000, immutable"),
        _ => ("application/octet-stream", "no-cache"),
    };
    Some(Asset {
        body,
        content_type,
        cache_control,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_known_files_with_the_right_type() {
        let js = find("js", "zip.js").expect("zip.js is embedded");
        assert_eq!(js.content_type, "application/javascript; charset=utf-8");
        assert!(!js.body.is_empty());
        assert_eq!(
            find("css", "editor.css").unwrap().content_type,
            "text/css; charset=utf-8"
        );
        assert_eq!(find("img", "logo.png").unwrap().content_type, "image/png");
        assert_eq!(
            find("vendor", "badness-engine_bg.wasm")
                .unwrap()
                .content_type,
            "application/wasm"
        );
        assert_eq!(
            find("vendor", "yjs.mjs").unwrap().content_type,
            "application/javascript; charset=utf-8"
        );
    }

    #[test]
    fn rejects_unknown_names_and_path_tricks() {
        assert!(find("js", "nope.js").is_none());
        assert!(find("js", "../Cargo.toml").is_none());
        assert!(find("js", "..%2FCargo.toml").is_none());
        assert!(find("agent", "version.json").is_none());
    }

    #[test]
    fn every_listed_path_is_unique() {
        let mut seen = std::collections::HashSet::new();
        assert!(FILES.iter().all(|(p, _)| seen.insert(*p)));
    }
}
