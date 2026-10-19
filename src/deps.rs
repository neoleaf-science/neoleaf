//! Files the browser compiler already ships in the base bundle (`/api/ctan/resolve` uses this to avoid downloading them again).

use std::collections::HashSet;

use tokio::sync::OnceCell;

const DEFAULT_BUNDLE: &str = "static/texlive/texmf-core-pdflatex.tar.gz";

/// File names the browser compiler already ships (read from the base bundle served by the app).
pub async fn bundle_files() -> Option<&'static HashSet<String>> {
    static SET: OnceCell<Option<HashSet<String>>> = OnceCell::const_new();
    SET.get_or_init(|| async {
        let path = std::env::var("TEXLIVE_BUNDLE").unwrap_or_else(|_| DEFAULT_BUNDLE.to_string());
        tokio::task::spawn_blocking(move || {
            let file = std::fs::File::open(&path).ok()?;
            let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
            let mut names = HashSet::new();
            for entry in archive.entries().ok()? {
                let Ok(entry) = entry else { continue };
                if let Ok(p) = entry.path()
                    && let Some(base) = p.file_name().and_then(|n| n.to_str())
                    && [
                        "sty", "cls", "clo", "def", "ldf", "fd", "cfg", "bbx", "cbx", "lbx", "bst",
                    ]
                    .iter()
                    .any(|e| base.ends_with(&format!(".{e}")))
                {
                    names.insert(base.to_string());
                }
            }
            (!names.is_empty()).then_some(names)
        })
        .await
        .ok()
        .flatten()
    })
    .await
    .as_ref()
}
