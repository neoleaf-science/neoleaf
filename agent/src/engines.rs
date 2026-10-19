//! Detection of the LaTeX compilers on this machine and where to look for binaries.

use crate::config::{cache_dir, home};
use crate::{net, tinytex};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Clone, Serialize)]
pub(crate) struct EngineInfo {
    pub(crate) id: &'static str,
    pub(crate) name: &'static str,
    pub(crate) version: String,
}

pub(crate) fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in ["/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(PathBuf::from(d));
    }
    dirs.push(home().join(".local/bin"));
    if cfg!(target_os = "macos") {
        // Homebrew (Apple Silicon and Intel) and MacTeX (/Library/TeX/texbin); launchd does not inherit the shell's PATH
        for d in ["/opt/homebrew/bin", "/Library/TeX/texbin"] {
            dirs.push(PathBuf::from(d));
        }
    }
    if cfg!(windows) {
        // MiKTeX and TeX Live for Windows; TinyTeX (%APPDATA%\\TinyTeX) comes in through the list below
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData/Local"));
        dirs.push(local.join("Programs/MiKTeX/miktex/bin/x64"));
        dirs.push(PathBuf::from("C:\\Program Files\\MiKTeX\\miktex\\bin\\x64"));
        if let Ok(rd) = fs::read_dir("C:\\texlive") {
            for e in rd.flatten() {
                dirs.push(e.path().join("bin/windows"));
                dirs.push(e.path().join("bin/win64"));
            }
        }
    }
    // TinyTeX: ~/.TinyTeX/bin/<architecture> (on macOS, ~/Library/TinyTeX/bin/universal-darwin); hand-installed TeX Live: /usr/local/texlive/<year>/bin/<architecture>
    for base in [
        home().join(".TinyTeX/bin"),
        home().join("Library/TinyTeX/bin"),
        tinytex::dest(&home()).join("bin"),
        PathBuf::from("/usr/local/texlive"),
    ] {
        if let Ok(rd) = fs::read_dir(&base) {
            for e in rd.flatten() {
                let p = e.path();
                dirs.push(p.clone());
                dirs.push(p.join("bin"));
                if let Ok(sub) = fs::read_dir(p.join("bin")) {
                    dirs.extend(sub.flatten().map(|s| s.path()));
                }
            }
        }
    }
    // Separately installed ConTeXt (LMTX): ~/context/tex/texmf-<platform>/bin (linux-64, osx-arm64, win64...)
    if let Ok(rd) = fs::read_dir(home().join("context/tex")) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with("texmf-") {
                dirs.push(e.path().join("bin"));
            }
        }
    }
    dirs
}

pub(crate) fn find_binary(name: &str) -> Option<PathBuf> {
    let names = net::exe_names(name);
    search_dirs()
        .into_iter()
        .flat_map(|d| names.iter().map(move |n| d.join(n)))
        .find(|p| p.is_file())
}

/// ConTeXt installed as a system package (e.g. binaries in /usr/local/bin and the tree in /usr/share/texmf-dist/texmf-context):
/// `context` looks for the tree next to the binary and does not find it, so the agent says where it is. On standalone ConTeXt
/// (tex/texmf-<platform>/bin and tex/texmf-context) this does nothing.
pub(crate) fn context_env(bin: &Path) -> Vec<(String, String)> {
    if std::env::var_os("TEXMFCNF").is_some() {
        return Vec::new();
    }
    let real = bin.canonicalize().unwrap_or_else(|_| bin.to_path_buf());
    let standalone = real
        .parent()
        .and_then(|p| p.parent())
        .map(|root| root.join("texmf-context").is_dir())
        .unwrap_or(false);
    if standalone {
        return Vec::new();
    }
    for tree in [
        "/usr/share/texmf-dist/texmf-context",
        "/usr/share/texmf-context",
        "/usr/local/share/texmf-dist/texmf-context",
        "/opt/texmf-context",
    ] {
        let tree = PathBuf::from(tree);
        if tree.join("web2c/contextcnf.lua").is_file() {
            let main = tree.parent().map(|p| p.join("texmf"));
            let texmf = match main.filter(|m| m.is_dir()) {
                Some(m) => format!("{{{},{}}}", tree.display(), m.display()),
                None => format!("{{{}}}", tree.display()),
            };
            let cache = cache_dir().join("context");
            let _ = fs::create_dir_all(&cache);
            return vec![
                ("TEXMFCNF".into(), tree.join("web2c").display().to_string()),
                ("TEXMF".into(), texmf),
                ("TEXMFCACHE".into(), cache.display().to_string()),
            ];
        }
    }
    Vec::new()
}

fn version_line(bin: &Path, arg: &str) -> String {
    Command::new(bin)
        .arg(arg)
        .stdin(Stdio::null())
        .output()
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string()
        })
        .unwrap_or_default()
}

pub(crate) fn detect_engines() -> Vec<EngineInfo> {
    let mut out = Vec::new();
    let latexmk = find_binary("latexmk");
    for (bin, id, name) in [
        ("pdflatex", "agent-pdflatex", "pdfLaTeX"),
        ("xelatex", "agent-xelatex", "XeLaTeX"),
        ("lualatex", "agent-lualatex", "LuaLaTeX"),
    ] {
        if let (Some(_), Some(b)) = (&latexmk, find_binary(bin)) {
            out.push(EngineInfo {
                id,
                name,
                version: version_line(&b, "--version"),
            });
        }
    }
    if let Some(t) = find_binary("tectonic") {
        out.push(EngineInfo {
            id: "agent-tectonic",
            name: "Tectonic",
            version: version_line(&t, "--version"),
        });
    }
    // ConTeXt does not use latexmk: `context` itself runs as many passes as needed
    if let Some(c) = find_binary("context") {
        out.push(EngineInfo {
            id: "agent-context",
            name: "ConTeXt",
            version: version_line(&c, "--version"),
        });
    }
    out
}
