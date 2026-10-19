//! Finding and installing the TeX Live packages a project needs (through tlmgr).

use crate::engines::find_binary;
use crate::project::FileRef;
use crate::tlmgr;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

/// TeX Live package that contains the file (tlmgr search), if tlmgr exists
pub(crate) fn package_for(tlmgr: &Path, file: &str, path_var: &std::ffi::OsStr) -> Option<String> {
    let out = Command::new(tlmgr)
        .args(["search", "--global", "--file", &format!("/{file}")])
        .env("PATH", path_var)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let mut pkg: Option<&str> = None;
    for line in text.lines() {
        if !line.starts_with(char::is_whitespace) && line.ends_with(':') {
            pkg = Some(line.trim_end_matches(':'));
        } else if line.trim().ends_with(&format!("/{file}"))
            && let Some(p) = pkg
        {
            return Some(p.to_string());
        }
    }
    None
}

/// Reads what the project asks for (\usepackage, \RequirePackage, \documentclass), sees what TeX cannot find and installs everything at once
/// (avoids one compilation round per package when the class belongs to the project, like acmart).
pub(crate) fn preinstall_declared(
    tlmgr: &Path,
    dir: &Path,
    files: &[FileRef],
    path_var: &std::ffi::OsStr,
    installed: &mut Vec<String>,
    failed: &mut Vec<String>,
) {
    let local: Vec<String> = files
        .iter()
        .filter_map(|f| {
            Path::new(&f.path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
        })
        .collect();
    let kpsewhich = find_binary("kpsewhich");
    let mut wanted: Vec<String> = Vec::new();
    for f in files.iter().filter(|f| {
        matches!(
            Path::new(&f.path).extension().and_then(|e| e.to_str()),
            Some("tex" | "cls" | "sty")
        )
    }) {
        let Ok(text) = fs::read_to_string(dir.join(&f.path)) else {
            continue;
        };
        for (name, is_class) in tlmgr::declared_packages(&text) {
            let file = if name.contains('.') {
                name.clone()
            } else {
                format!("{name}.{}", if is_class { "cls" } else { "sty" })
            };
            if local.contains(&file) || wanted.contains(&file) {
                continue;
            }
            let found = kpsewhich.as_ref().is_some_and(|k| {
                Command::new(k)
                    .arg(&file)
                    .current_dir(dir)
                    .env("PATH", path_var)
                    .stdin(Stdio::null())
                    .stderr(Stdio::null())
                    .output()
                    .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
                    .unwrap_or(true)
            });
            if !found {
                wanted.push(file);
            }
        }
    }
    for pkg in tlmgr::packages_for_files(tlmgr, &wanted, Some(path_var)) {
        match tlmgr::install(tlmgr, &pkg, Some(path_var)) {
            Ok(()) => installed.push(pkg),
            Err(e) => failed.push(format!("{pkg}: {e}")),
        }
    }
}
