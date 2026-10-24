//! Project template catalog, managed only by the administrator.
//!
//! The catalog keeps **only metadata and the source link** (a GitHub repository, preferably pinned to a tag or
//! commit). Template files are never kept here: when creating a project, the browser downloads the source through a stateless
//! proxy and writes it to the local clone. It lives in `templates.json` (mode 0600) and survives restarts. It holds no user data.

use std::{path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};

const MAX_MODELS: usize = 200;
/// ids that already exist as built-in templates
const RESERVED: [&str; 3] = ["article", "report", "beamer"];
const CATEGORIES: [&str; 6] = ["article", "thesis", "slides", "report", "poster", "other"];
const ENGINES: [&str; 5] = [
    "",
    "wasm-texlive",
    "wasm-xelatex",
    "wasm-lualatex",
    "wasm-typst",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub institution: String,
    pub language: String,
    pub license: String,
    /// `owner/repository` on GitHub
    pub source: String,
    /// tag, branch or commit; empty = default branch
    pub git_ref: String,
    /// folder inside the repository; empty = root
    pub subdir: String,
    /// main file (relative to the folder); empty = the browser detects it
    pub main_file: String,
    /// recommended engine; empty = NeoLeaf's default
    pub engine: String,
    /// preview image: `https://...` or `/static/...`; empty = no preview
    pub preview_url: String,
    pub enabled: bool,
    pub order: i32,
    pub updated_at: u64,
    pub updated_by: String,
}

/// What the administration form sends.
#[derive(Clone, Debug, Deserialize)]
pub struct ModelInput {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub institution: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub license: String,
    pub source: String,
    #[serde(default)]
    pub git_ref: String,
    #[serde(default)]
    pub subdir: String,
    #[serde(default)]
    pub main_file: String,
    #[serde(default)]
    pub engine: String,
    #[serde(default)]
    pub preview_url: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub order: i32,
}

fn yes() -> bool {
    true
}

/// What the public page sees (without who changed it or when).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicModel {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub institution: String,
    pub language: String,
    pub license: String,
    pub source_url: String,
    pub git_ref: String,
    pub subdir: String,
    pub main_file: String,
    pub engine: String,
    pub preview_url: String,
}

impl Model {
    pub fn public(&self) -> PublicModel {
        PublicModel {
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            category: self.category.clone(),
            institution: self.institution.clone(),
            language: self.language.clone(),
            license: self.license.clone(),
            source_url: format!("https://github.com/{}", self.source),
            git_ref: self.git_ref.clone(),
            subdir: self.subdir.clone(),
            main_file: self.main_file.clone(),
            engine: self.engine.clone(),
            preview_url: self.preview_url.clone(),
        }
    }
}

static LIST: Mutex<Vec<Model>> = Mutex::new(Vec::new());

fn file_path() -> PathBuf {
    PathBuf::from(std::env::var("TEMPLATES_FILE").unwrap_or_else(|_| "templates.json".to_string()))
}

/// Loads the catalog from disk (call once at startup).
pub fn load() {
    let Ok(text) = std::fs::read_to_string(file_path()) else {
        return;
    };
    match serde_json::from_str::<Vec<Model>>(&text) {
        Ok(list) => {
            let n = list.len();
            *LIST.lock().unwrap_or_else(|e| e.into_inner()) = list;
            if n > 0 {
                println!("📚 {n} template(s) in the catalog");
            }
        }
        Err(_) => eprintln!("Warning: could not read {}", file_path().display()),
    }
}

fn persist(list: &[Model]) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let path = file_path();
    let tmp = path.with_extension("tmp");
    let json = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    (|| -> std::io::Result<()> {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(&json)?;
        f.sync_all()?;
        std::fs::rename(&tmp, &path)
    })()
    .map_err(|_| "Could not write the catalog to disk".to_string())
}

fn sorted(mut list: Vec<Model>) -> Vec<Model> {
    list.sort_by(|a, b| {
        a.order
            .cmp(&b.order)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    list
}

/// All of them (for administration), in display order.
pub fn all() -> Vec<Model> {
    sorted(LIST.lock().unwrap_or_else(|e| e.into_inner()).clone())
}

/// Only the enabled ones (for the public gallery), in display order.
pub fn enabled() -> Vec<Model> {
    all().into_iter().filter(|m| m.enabled).collect()
}

pub fn get(id: &str) -> Option<Model> {
    LIST.lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|m| m.id == id)
        .cloned()
}

/// Creates or updates (by id) and writes to disk.
pub fn upsert(model: Model) -> Result<(), String> {
    let mut list = LIST.lock().unwrap_or_else(|e| e.into_inner());
    let pos = list.iter().position(|m| m.id == model.id);
    if pos.is_none() && list.len() >= MAX_MODELS {
        return Err(format!(
            "The catalog already has the maximum of {MAX_MODELS} templates"
        ));
    }
    let mut next = list.clone();
    match pos {
        Some(i) => next[i] = model,
        None => next.push(model),
    }
    persist(&next)?;
    *list = next;
    Ok(())
}

/// Removes by id; returns false if it did not exist.
pub fn remove(id: &str) -> Result<bool, String> {
    let mut list = LIST.lock().unwrap_or_else(|e| e.into_inner());
    if !list.iter().any(|m| m.id == id) {
        return Ok(false);
    }
    let next: Vec<Model> = list.iter().filter(|m| m.id != id).cloned().collect();
    persist(&next)?;
    *list = next;
    Ok(true)
}

// ------------------------------------------------------------------ validation

fn clean_text(s: &str, max: usize) -> String {
    s.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .collect::<String>()
        .trim()
        .chars()
        .take(max)
        .collect()
}

fn one_line(s: &str, max: usize) -> String {
    clean_text(s, max).replace('\n', " ")
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 60
        && !id.starts_with('-')
        && !id.ends_with('-')
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

/// `https://github.com/owner/repo`, `github.com/owner/repo(.git)` or `owner/repo` -> `owner/repo`
pub fn parse_source(s: &str) -> Result<String, String> {
    let t = s.trim().trim_end_matches('/');
    let t = t
        .strip_prefix("https://")
        .or_else(|| t.strip_prefix("http://"))
        .unwrap_or(t);
    let t = t.strip_prefix("www.").unwrap_or(t);
    let t = t.strip_prefix("github.com/").unwrap_or(t);
    let t = t.strip_suffix(".git").unwrap_or(t);
    let mut it = t.split('/');
    let (Some(owner), Some(repo), None) = (it.next(), it.next(), it.next()) else {
        return Err(
            "The source must be a GitHub repository (e.g. https://github.com/owner/repository)"
                .to_string(),
        );
    };
    let owner_ok = !owner.is_empty()
        && owner.len() <= 39
        && owner
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-');
    let repo_ok = !repo.is_empty()
        && repo.len() <= 100
        && repo != "."
        && repo != ".."
        && repo
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'));
    if !owner_ok || !repo_ok {
        return Err("Invalid repository owner or name".to_string());
    }
    Ok(format!("{owner}/{repo}"))
}

fn valid_ref(r: &str) -> bool {
    r.len() <= 100
        && !r.starts_with('-')
        && !r.starts_with('/')
        && !r.contains("..")
        && r.bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'/' | b'-'))
}

fn valid_rel(p: &str) -> bool {
    p.len() <= 200
        && !p.starts_with('/')
        && p.split('/').all(|s| {
            !s.is_empty()
                && s != "."
                && s != ".."
                && !s
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '\\' | '?' | '#' | '%'))
        })
}

fn valid_preview(u: &str) -> bool {
    u.len() <= 300
        && !u.chars().any(|c| c.is_whitespace() || c.is_control())
        && (u.starts_with("https://") || u.starts_with("/static/"))
}

/// Validates what came from the form and builds the template (who changed it and when come from outside).
pub fn normalize(i: ModelInput, by: &str, now: u64) -> Result<Model, String> {
    let id = i.id.trim().to_string();
    if !valid_id(&id) {
        return Err(
            "The identifier uses only lowercase letters, digits and hyphen (up to 60 characters)"
                .to_string(),
        );
    }
    if RESERVED.contains(&id.as_str()) {
        return Err(format!(
            "The identifier \"{id}\" belongs to a built-in NeoLeaf template"
        ));
    }
    let name = one_line(&i.name, 100);
    if name.is_empty() {
        return Err("Give the template a name".to_string());
    }
    let category = if i.category.trim().is_empty() {
        "other".to_string()
    } else {
        i.category.trim().to_string()
    };
    if !CATEGORIES.contains(&category.as_str()) {
        return Err("Invalid category".to_string());
    }
    let engine = i.engine.trim().to_string();
    if !ENGINES.contains(&engine.as_str()) {
        return Err("Invalid engine".to_string());
    }
    let source = parse_source(&i.source)?;
    let git_ref = i.git_ref.trim().to_string();
    if !valid_ref(&git_ref) {
        return Err("Invalid tag, branch or commit".to_string());
    }
    let subdir = i.subdir.trim().trim_matches('/').to_string();
    if !subdir.is_empty() && !valid_rel(&subdir) {
        return Err("Invalid folder".to_string());
    }
    let main_file = i.main_file.trim().to_string();
    if !main_file.is_empty() && !valid_rel(&main_file) {
        return Err("Invalid main file".to_string());
    }
    let preview_url = i.preview_url.trim().to_string();
    if !preview_url.is_empty() && !valid_preview(&preview_url) {
        return Err("The preview must be an https:// link or a /static/... path".to_string());
    }
    Ok(Model {
        id,
        name,
        description: clean_text(&i.description, 400),
        category,
        institution: one_line(&i.institution, 100),
        language: one_line(&i.language, 20),
        license: one_line(&i.license, 60),
        source,
        git_ref,
        subdir,
        main_file,
        engine,
        preview_url,
        enabled: i.enabled,
        order: i.order.clamp(-9999, 9999),
        updated_at: now,
        updated_by: by.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ModelInput {
        ModelInput {
            id: "abntex2".into(),
            name: "abnTeX2".into(),
            description: "ABNT template".into(),
            category: "thesis".into(),
            institution: "ABNT".into(),
            language: "pt".into(),
            license: "LPPL".into(),
            source: "https://github.com/abntex/abntex2".into(),
            git_ref: "v1.9.7".into(),
            subdir: "".into(),
            main_file: "main.tex".into(),
            engine: "wasm-texlive".into(),
            preview_url: "".into(),
            enabled: true,
            order: 1,
        }
    }

    #[test]
    fn accepts_a_valid_template_and_normalizes_the_source() {
        let m = normalize(input(), "admin", 7).unwrap();
        assert_eq!(m.source, "abntex/abntex2");
        assert_eq!(m.updated_by, "admin");
        assert_eq!(m.public().source_url, "https://github.com/abntex/abntex2");
        for s in [
            "abntex/abntex2",
            "github.com/abntex/abntex2.git",
            "http://www.github.com/abntex/abntex2/",
        ] {
            assert_eq!(parse_source(s).unwrap(), "abntex/abntex2", "{s}");
        }
    }

    #[test]
    fn rejects_sources_that_are_not_a_github_repository() {
        for s in [
            "",
            "abntex",
            "https://gitlab.com/a/b/c",
            "a/b/c",
            "https://evil.example/a/b/../c",
            "a b/c",
            "a/..",
            "-",
        ] {
            assert!(parse_source(s).is_err(), "{s}");
        }
    }

    #[test]
    fn rejects_dangerous_fields() {
        let mut i = input();
        i.id = "Abn Tex".into();
        assert!(normalize(i, "a", 0).is_err());
        let mut i = input();
        i.id = "article".into();
        assert!(normalize(i, "a", 0).is_err(), "reserved id");
        for (f, v) in [
            ("ref", "../x"),
            ("ref", "-rf"),
            ("subdir", "../x"),
            ("subdir", "a//b"),
            ("main", "/etc/passwd"),
            ("main", "a\\b"),
            ("preview", "http://x/y.png"),
            ("preview", "javascript:alert(1)"),
            ("category", "x"),
            ("engine", "agent-pdflatex"),
        ] {
            let mut i = input();
            match f {
                "ref" => i.git_ref = v.into(),
                "subdir" => i.subdir = v.into(),
                "main" => i.main_file = v.into(),
                "preview" => i.preview_url = v.into(),
                "category" => i.category = v.into(),
                _ => i.engine = v.into(),
            }
            assert!(normalize(i, "a", 0).is_err(), "{f}={v}");
        }
        let mut ok = input();
        ok.preview_url = "/static/img/x.png".into();
        ok.subdir = "templates/thesis/".into();
        assert_eq!(normalize(ok, "a", 0).unwrap().subdir, "templates/thesis");
    }

    #[test]
    fn public_view_does_not_expose_who_changed_it() {
        let json = serde_json::to_string(&normalize(input(), "admin-secret", 99).unwrap().public())
            .unwrap();
        assert!(
            !json.contains("admin-secret") && !json.contains("updated"),
            "{json}"
        );
        assert!(json.contains("sourceUrl") && json.contains("gitRef"));
    }

    #[test]
    fn sorts_by_order_then_by_name() {
        let mk = |id: &str, name: &str, order: i32| {
            let mut i = input();
            i.id = id.into();
            i.name = name.into();
            i.order = order;
            normalize(i, "a", 0).unwrap()
        };
        let s = sorted(vec![
            mk("c", "Zeta", 1),
            mk("a", "Beta", 2),
            mk("b", "alfa", 1),
        ]);
        assert_eq!(
            s.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["b", "c", "a"]
        );
    }
}
