//! Calls to `tlmgr` (the user's TinyTeX / TeX Live) to install missing packages.
//!
//! A TinyTeX older than the repository refuses any installation until it updates itself
//! ("tlmgr itself needs to be updated"): in that case we run `tlmgr update --self` and try again.

use std::ffi::OsStr;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

pub fn needs_self_update(out: &str) -> bool {
    out.contains("tlmgr itself needs to be updated") || out.contains("tlmgr update --self")
}

/// Last useful line of an output (to show the reason for a failure).
pub fn reason(out: &str) -> String {
    out.lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with("===="))
        .unwrap_or("no details")
        .chars()
        .take(200)
        .collect()
}

/// Runs tlmgr and returns (success, stdout+stderr). Kills the process if it exceeds the deadline.
pub fn run(
    tlmgr: &Path,
    args: &[&str],
    path_var: Option<&OsStr>,
    timeout: Duration,
) -> (bool, String) {
    let mut cmd = Command::new(tlmgr);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(p) = path_var {
        cmd.env("PATH", p);
    }
    let Ok(child) = cmd.spawn() else {
        return (false, "could not run tlmgr".into());
    };
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(o)) => (
            o.status.success(),
            format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            ),
        ),
        Ok(Err(e)) => (false, e.to_string()),
        Err(_) => {
            if cfg!(windows) {
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .status();
            } else {
                let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
            }
            (false, "timed out".into())
        }
    }
}

/// Installs `pkg`; if tlmgr asks to update itself, updates and retries once.
pub fn install_with(run: &dyn Fn(&[&str]) -> (bool, String), pkg: &str) -> Result<(), String> {
    let (ok, out) = run(&["install", pkg]);
    if ok {
        return Ok(());
    }
    if !needs_self_update(&out) {
        return Err(reason(&out));
    }
    let (ok, out) = run(&["update", "--self"]);
    if !ok {
        return Err(format!(
            "tlmgr is out of date and I could not update it: {}",
            reason(&out)
        ));
    }
    let (ok, out) = run(&["install", pkg]);
    if ok { Ok(()) } else { Err(reason(&out)) }
}

pub fn install(tlmgr: &Path, pkg: &str, path_var: Option<&OsStr>) -> Result<(), String> {
    install_with(&|a| run(tlmgr, a, path_var, Duration::from_secs(300)), pkg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const STALE: &str = "=====\ntlmgr itself needs to be updated.\nPlease do this via either\n  tlmgr update --self\n=====\ntlmgr: Terminating; please see warning above!\n";

    type Calls = std::rc::Rc<RefCell<Vec<String>>>;

    fn scripted(steps: Vec<(bool, &'static str)>) -> (impl Fn(&[&str]) -> (bool, String), Calls) {
        let calls = std::rc::Rc::new(RefCell::new(Vec::new()));
        let queue = RefCell::new(steps.into_iter());
        let log = calls.clone();
        (
            move |a: &[&str]| {
                log.borrow_mut().push(a.join(" "));
                let (ok, out) = queue.borrow_mut().next().expect("unexpected call");
                (ok, out.to_string())
            },
            calls,
        )
    }

    #[test]
    fn detects_the_stale_tlmgr_message() {
        assert!(needs_self_update(STALE));
        assert!(!needs_self_update(
            "tlmgr: package foo not present in repository"
        ));
    }

    #[test]
    fn installs_directly_when_all_is_fine() {
        let (run, calls) = scripted(vec![(true, "")]);
        assert!(install_with(&run, "ncctools").is_ok());
        assert_eq!(*calls.borrow(), vec!["install ncctools"]);
    }

    #[test]
    fn self_updates_and_retries_when_tlmgr_is_stale() {
        let (run, calls) = scripted(vec![(false, STALE), (true, ""), (true, "")]);
        assert!(install_with(&run, "ncctools").is_ok());
        assert_eq!(
            *calls.borrow(),
            vec!["install ncctools", "update --self", "install ncctools"]
        );
    }

    #[test]
    fn reports_why_when_self_update_fails() {
        let (run, _) = scripted(vec![
            (false, STALE),
            (false, "tlmgr: no permission to write\n"),
        ]);
        let e = install_with(&run, "ncctools").unwrap_err();
        assert!(
            e.contains("out of date") && e.contains("no permission"),
            "{e}"
        );
    }

    #[test]
    fn reports_the_reason_for_other_failures_without_self_update() {
        let (run, calls) = scripted(vec![(
            false,
            "tlmgr: package manyfoot not present in repository.\n",
        )]);
        assert!(
            install_with(&run, "manyfoot")
                .unwrap_err()
                .contains("not present")
        );
        assert_eq!(calls.borrow().len(), 1);
    }

    #[test]
    fn gives_up_if_it_still_fails_after_the_self_update() {
        let (run, calls) = scripted(vec![
            (false, STALE),
            (true, ""),
            (false, "tlmgr: disk full\n"),
        ]);
        assert!(install_with(&run, "x").unwrap_err().contains("disk full"));
        assert_eq!(calls.borrow().len(), 3);
    }
}

// ------------------------------------------------------------------ packages requested by the project

/// Packages and classes a TeX file asks for: (name, is_class). Ignores comments.
pub fn declared_packages(text: &str) -> Vec<(String, bool)> {
    let mut out: Vec<(String, bool)> = Vec::new();
    let mut clean = String::new();
    for line in text.lines() {
        let mut cut = line.len();
        let b = line.as_bytes();
        for i in 0..b.len() {
            if b[i] == b'%' && (i == 0 || b[i - 1] != b'\\') {
                cut = i;
                break;
            }
        }
        clean.push_str(&line[..cut]);
        clean.push('\n');
    }
    for (cmd, is_class) in [
        ("\\usepackage", false),
        ("\\RequirePackage", false),
        ("\\RequirePackageWithOptions", false),
        ("\\documentclass", true),
        ("\\LoadClass", true),
    ] {
        let mut rest = clean.as_str();
        while let Some(pos) = rest.find(cmd) {
            rest = &rest[pos + cmd.len()..];
            // "\usepackage" must not be a prefix of another command (e.g. \usepackagefoo)
            if rest.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
                continue;
            }
            let mut r = rest.trim_start();
            let mut options: &str = "";
            if let Some(after) = r.strip_prefix('[') {
                match after.find(']') {
                    Some(end) => {
                        options = &after[..end];
                        r = after[end + 1..].trim_start();
                    }
                    None => continue,
                }
            }
            if let Some(body) = r.strip_prefix('{')
                && let Some(end) = body.find('}')
            {
                // `\usepackage[english,brazil]{babel}`: each language is a `<language>.ldf` (the light TinyTeX does not ship all of them)
                if body[..end].split(',').any(|n| n.trim() == "babel") {
                    for lang in options.split(',').map(str::trim) {
                        let lang = lang.strip_prefix("main=").unwrap_or(lang);
                        if !lang.is_empty()
                            && !lang.contains('=')
                            && lang.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                        {
                            let f = format!("{lang}.ldf");
                            if !out.iter().any(|(n, _)| *n == f) {
                                out.push((f, false));
                            }
                        }
                    }
                }
                for name in body[..end].split(',') {
                    let name = name.trim();
                    if !name.is_empty()
                        && name.len() < 60
                        && name
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
                        && !out.iter().any(|(n, _)| n == name)
                    {
                        out.push((name.to_string(), is_class));
                    }
                }
            }
        }
    }
    out
}

/// TeX Live packages that contain the files (`name.sty` / `name.cls`), in a single tlmgr query.
pub fn packages_for_files(tlmgr: &Path, files: &[String], path_var: Option<&OsStr>) -> Vec<String> {
    if files.is_empty() {
        return Vec::new();
    }
    let alternatives = files
        .iter()
        .map(|f| f.replace('.', "\\."))
        .collect::<Vec<_>>()
        .join("|");
    let (_, out) = run(
        tlmgr,
        &[
            "search",
            "--global",
            "--file",
            &format!("/({alternatives})$"),
        ],
        path_var,
        Duration::from_secs(120),
    );
    parse_search(&out, files)
}

/// Reads the output of `tlmgr search --file` and returns the packages whose files are in `files`.
pub fn parse_search(out: &str, files: &[String]) -> Vec<String> {
    let mut pkgs: Vec<String> = Vec::new();
    let mut current: Option<&str> = None;
    for line in out.lines() {
        if !line.starts_with(char::is_whitespace) && line.ends_with(':') {
            current = Some(line.trim_end_matches(':'));
        } else if let Some(p) = current {
            let l = line.trim();
            if files.iter().any(|f| l.ends_with(&format!("/{f}"))) && !pkgs.iter().any(|x| x == p) {
                pkgs.push(p.to_string());
            }
        }
    }
    pkgs
}

#[cfg(test)]
mod declared_tests {
    use super::*;

    #[test]
    fn finds_packages_and_classes() {
        let tex = "\\documentclass[sigconf]{acmart}\n\\usepackage{booktabs,graphicx}\n\\usepackage[utf8]{inputenc} % \\usepackage{commented}\n\\RequirePackage[a=b]{xkeyval}\n\\usepackage[\n  x=1]{cleveref}\n\\usepackagefoo{no}\n\\usepackage{ foo-bar , baz_2 }\n";
        let mut got: Vec<String> = declared_packages(tex)
            .into_iter()
            .map(|(n, c)| format!("{n}{}", if c { ":cls" } else { "" }))
            .collect();
        got.sort();
        let mut want = vec![
            "booktabs",
            "graphicx",
            "inputenc",
            "xkeyval",
            "cleveref",
            "foo-bar",
            "baz_2",
            "acmart:cls",
        ];
        want.sort();
        assert_eq!(got, want);
    }

    #[test]
    fn babel_languages_become_ldf_files() {
        let got: Vec<String> = declared_packages("\\usepackage[english,main=brazil,provide=*,showlanguages]{babel}\n\\usepackage[utf8]{inputenc}").into_iter().map(|(n, _)| n).collect();
        for want in ["english.ldf", "brazil.ldf", "babel", "inputenc"] {
            assert!(got.contains(&want.to_string()), "missing {want}: {got:?}");
        }
        assert!(
            !got.iter().any(|n| n.contains("provide") || n.contains('=')),
            "{got:?}"
        );
        // without babel, other packages' options do not become languages
        assert!(
            !declared_packages("\\usepackage[english]{foo}")
                .iter()
                .any(|(n, _)| n == "english.ldf")
        );
    }

    #[test]
    fn ignores_malformed_input() {
        assert!(declared_packages("\\usepackage{").is_empty());
        assert!(declared_packages("\\usepackage[opt").is_empty());
        assert!(declared_packages("\\usepackage{a/b}").is_empty());
    }

    #[test]
    fn parses_tlmgr_search_output() {
        let out = "ncctools:\n\ttexmf-dist/tex/latex/ncctools/manyfoot.sty\n\ttexmf-dist/tex/latex/ncctools/other.sty\ncomment:\n\ttexmf-dist/tex/latex/comment/comment.sty\nnoise:\n\ttexmf-dist/doc/x/notmanyfoot.sty\n";
        assert_eq!(
            parse_search(out, &["manyfoot.sty".into(), "comment.sty".into()]),
            vec!["ncctools", "comment"]
        );
        assert!(parse_search("", &["x.sty".into()]).is_empty());
    }
}
