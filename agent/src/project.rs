//! Project files: content-addressed blob cache, path validation and the work folder.

use crate::config::cache_dir;
use crate::http::json_response;
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tiny_http::Response;

pub(crate) fn blob_path(sha: &str) -> Option<PathBuf> {
    (sha.len() == 64 && sha.bytes().all(|c| c.is_ascii_hexdigit()))
        .then(|| cache_dir().join("blobs").join(sha.to_ascii_lowercase()))
}

pub(crate) fn safe_rel_path(p: &str) -> bool {
    // no segment starts with `-` (it could be read as an option by the compiler) or contains `:` (Windows drives and streams)
    !p.is_empty()
        && p.len() <= 400
        && !p.starts_with('/')
        && p.split('/').all(|s| {
            !s.is_empty()
                && s != "."
                && s != ".."
                && !s.starts_with('-')
                && !s.contains(['\\', ':'])
                && !s.chars().any(char::is_control)
        })
}

/// Files latexmk would execute as Perl; they are never written to the work folder.
pub(crate) fn is_rc_file(p: &str) -> bool {
    let name = p.rsplit('/').next().unwrap_or(p).to_ascii_lowercase();
    name == "latexmkrc" || name.starts_with(".latexmkrc") || name.starts_with("latexmkrc.")
}

pub(crate) fn valid_project_id(id: &str) -> bool {
    // `owner__repository` (GitHub: owner up to 39, repository up to 100, with `.`); it becomes a folder name, so it never starts with `.`
    !id.is_empty()
        && id.len() <= 200
        && !id.starts_with('.')
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

#[derive(Deserialize)]
pub(crate) struct FileRef {
    pub(crate) path: String,
    pub(crate) sha256: String,
}

/// Which contents the agent does not have yet (the browser sends only those)
pub(crate) fn prepare(
    v: &serde_json::Value,
    origin: Option<&str>,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let files: Vec<FileRef> = match serde_json::from_value(v["files"].clone()) {
        Ok(f) => f,
        Err(e) => {
            return json_response(
                400,
                origin,
                serde_json::json!({ "error": format!("invalid list: {e}") }),
            );
        }
    };
    let mut need: Vec<String> = Vec::new();
    for f in &files {
        match blob_path(&f.sha256) {
            Some(p) if p.exists() => {}
            Some(_) => {
                let s = f.sha256.to_ascii_lowercase();
                if !need.contains(&s) {
                    need.push(s);
                }
            }
            None => {
                return json_response(400, origin, serde_json::json!({ "error": "invalid hash" }));
            }
        }
    }
    json_response(200, origin, serde_json::json!({ "need": need }))
}

pub(crate) fn store_blobs(
    v: &serde_json::Value,
    origin: Option<&str>,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let Some(list) = v["blobs"].as_array() else {
        return json_response(400, origin, serde_json::json!({ "error": "no blobs" }));
    };
    let dir = cache_dir().join("blobs");
    let _ = fs::create_dir_all(&dir);
    let mut stored = 0;
    for b in list {
        let (Some(sha), Some(data)) = (b["sha256"].as_str(), b["b64"].as_str()) else {
            continue;
        };
        let Ok(bytes) = B64.decode(data) else {
            return json_response(
                400,
                origin,
                serde_json::json!({ "error": "invalid base64" }),
            );
        };
        let actual = hex(&Sha256::digest(&bytes));
        if !actual.eq_ignore_ascii_case(sha) {
            return json_response(
                400,
                origin,
                serde_json::json!({ "error": "the content does not match the hash" }),
            );
        }
        let Some(path) = blob_path(&actual) else {
            continue;
        };
        if !path.exists() && fs::write(&path, &bytes).is_ok() {
            stored += 1;
        }
    }
    json_response(200, origin, serde_json::json!({ "stored": stored }))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ------------------------------------------------------------------ compilation

pub(crate) fn work_dir(project: &str) -> PathBuf {
    cache_dir().join("work").join(project)
}

/// Copies the project files to the work folder (kept between compilations, so latexmk reuses the auxiliary files)
/// and deletes the ones that left the project. Returns what is missing from the cache.
pub(crate) fn sync_workspace(dir: &Path, files: &[FileRef]) -> Result<(), Vec<String>> {
    let manifest_path = dir.join(".neoleaf-manifest.json");
    let old: HashMap<String, String> = fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let missing: Vec<String> = files
        .iter()
        .filter_map(|f| {
            blob_path(&f.sha256)
                .filter(|p| !p.exists())
                .map(|_| f.sha256.to_ascii_lowercase())
        })
        .collect();
    if !missing.is_empty() {
        return Err(missing);
    }
    let _ = fs::create_dir_all(dir);
    let mut now: HashMap<String, String> = HashMap::new();
    for f in files.iter().filter(|f| !is_rc_file(&f.path)) {
        let sha = f.sha256.to_ascii_lowercase();
        let dest = dir.join(&f.path);
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
            // with -outdir, latexmk writes the \include .aux files in _out/<subfolder>: the subfolder must exist
            if let Ok(rel) = parent.strip_prefix(dir)
                && !rel.as_os_str().is_empty()
            {
                let _ = fs::create_dir_all(dir.join("_out").join(rel));
            }
        }
        if old.get(&f.path) != Some(&sha) || !dest.exists() {
            let _ = fs::remove_file(&dest);
            if let Some(src) = blob_path(&sha)
                && fs::hard_link(&src, &dest).is_err()
            {
                let _ = fs::copy(&src, &dest);
            }
        }
        now.insert(f.path.clone(), sha);
    }
    for gone in old.keys().filter(|p| !now.contains_key(*p)) {
        let _ = fs::remove_file(dir.join(gone));
    }
    let _ = fs::write(
        &manifest_path,
        serde_json::to_string(&now).unwrap_or_default(),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_rc_file, safe_rel_path, valid_project_id};

    #[test]
    fn rejects_option_like_and_rc_paths() {
        assert!(safe_rel_path("sections/intro.tex"));
        for bad in ["-shell-escape.tex", "a/-b.tex", "C:/x.tex", "a:b.tex"] {
            assert!(!safe_rel_path(bad), "{bad}");
        }
        for rc in ["latexmkrc", ".latexmkrc", "sub/.LatexmkRC", "latexmkrc.pl"] {
            assert!(is_rc_file(rc), "{rc}");
        }
        assert!(!is_rc_file("notes/latexmk.tex"));
    }

    #[test]
    fn accepts_long_github_names_and_dots_but_not_paths() {
        assert!(valid_project_id(
            "jane-doe__a_long_thesis_title_with_many_words___university___campus_name_and_year"
        ));
        assert!(valid_project_id("dono__meu.projeto-v1"));
        assert!(valid_project_id(&format!(
            "jane-doe__{}",
            "long_repository_name_".repeat(5)
        )));
        for bad in ["", ".", "..", ".hidden", "a/b", "a\\b", "a b", "../x"] {
            assert!(!valid_project_id(bad), "{bad}");
        }
        assert!(!valid_project_id(&"a".repeat(201)));
    }
}
