//! Compilation pipeline: runs latexmk/tectonic/ConTeXt, installs missing packages and builds the response.

use crate::config::{cache_dir, home};
use crate::engines::{EngineInfo, context_env, detect_engines, find_binary, search_dirs};
use crate::http::{COMPILING, State, json_response};
use crate::packages::{package_for, preinstall_declared};
use crate::project::{
    FileRef, blob_path, safe_rel_path, sync_workspace, valid_project_id, work_dir,
};
use crate::texlog::{bibtex_errors, missing_files};
use crate::{fonts, tlmgr};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tiny_http::Response;

const COMPILE_TIMEOUT: Duration = Duration::from_secs(300);

/// kpathsea search path: `.`, the extra folder and (through the trailing `:`) the default paths.
fn search_path(extra: &Path, existing: Option<&str>) -> String {
    search_path_with(extra, existing, if cfg!(windows) { ';' } else { ':' })
}

fn search_path_with(extra: &Path, existing: Option<&str>, sep: char) -> String {
    let dot = format!(".{sep}");
    format!(
        ".{sep}{}{sep}{}",
        extra.display(),
        existing
            .map(|e| e.trim_start_matches(dot.as_str()))
            .unwrap_or("")
    )
}

/// Fontconfig configuration with this machine's TeX font folders (TEXMFDIST, TEXMFLOCAL and TEXMFHOME).
fn tex_fontconfig(path_var: &std::ffi::OsStr) -> Option<PathBuf> {
    let kpse = find_binary("kpsewhich")?;
    let var = |name: &str| -> Option<PathBuf> {
        let out = Command::new(&kpse)
            .arg(format!("-var-value={name}"))
            .env("PATH", path_var)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!s.is_empty() && !s.contains(['{', ':'])).then(|| PathBuf::from(s))
    };
    let mut trees: Vec<PathBuf> = ["TEXMFDIST", "TEXMFLOCAL", "TEXMFHOME"]
        .iter()
        .filter_map(|n| var(n))
        .collect();
    trees.push(home().join("texmf"));
    fonts::write_conf(&trees, &cache_dir().join("fonts.conf"))
}

/// Builds the engine's command line (the context's old PDF is removed here, before the run).
fn engine_command(
    engine: &EngineInfo,
    main: &str,
    dir: &Path,
    out_dir: &Path,
    force: bool,
) -> Command {
    let mut cmd;
    match engine.id {
        "agent-tectonic" => {
            cmd = Command::new(find_binary("tectonic").unwrap());
            cmd.args(["-X", "compile", "--synctex", "--keep-logs", "--outdir"])
                .arg(out_dir)
                .arg(main);
        }
        "agent-context" => {
            // ConTeXt runs as many passes as needed and writes the PDF and the log in the folder where it runs (it ignores --result for
            // subfolders): after the run, the PDF and the log are copied to _out, where the rest of the agent looks for them
            let ctx_bin = find_binary("context").unwrap();
            cmd = Command::new(&ctx_bin);
            cmd.envs(context_env(&ctx_bin));
            cmd.arg("--nonstopmode");
            if let Some(parent) = Path::new(main)
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
            {
                cmd.arg(format!("--path={}", parent.display()));
            }
            cmd.arg(main);
            let stem = Path::new(main)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("main");
            let _ = fs::remove_file(dir.join(format!("{stem}.pdf")));
            let _ = fs::remove_file(out_dir.join(format!("{stem}.pdf")));
        }
        id => {
            let (flag, tex) = match id {
                "agent-xelatex" => ("-xelatex", "xelatex"),
                "agent-lualatex" => ("-lualatex", "lualatex"),
                _ => ("-pdf", "pdflatex"),
            };
            cmd = Command::new(find_binary("latexmk").unwrap());
            // a repository can carry a latexmkrc, which is Perl run by latexmk: never read any rc file (project, user or system)
            cmd.arg("-norc");
            cmd.env(
                "LATEXMKRCSYS",
                if cfg!(windows) { "NUL" } else { "/dev/null" },
            );
            if force {
                cmd.arg("-g"); // without this latexmk says "nothing to do" when the previous failure was for a package that was just installed
            }
            cmd.args([
                flag,
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-synctex=1",
                "-file-line-error",
            ])
            .arg(format!("-{tex}={tex} -no-shell-escape %O %S"))
            .arg(format!("-outdir={}", out_dir.display()))
            .arg(main);
        }
    }
    cmd
}

/// Output kept from the compiler (the rest is read and dropped, so a runaway log cannot fill the memory).
const MAX_OUTPUT: u64 = 8 * 1024 * 1024;

fn read_capped(mut r: impl Read) -> Vec<u8> {
    let mut b = Vec::new();
    let _ = (&mut r).take(MAX_OUTPUT).read_to_end(&mut b);
    let _ = std::io::copy(&mut r, &mut std::io::sink());
    b
}

/// Kills the compiler and everything it started (a shell-escape-less TeX can still run bibtex, makeindex, a viewer...).
fn kill_tree(child: &mut std::process::Child) {
    let pid = child.id().to_string();
    if cfg!(windows) {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    } else {
        // the child leads its own process group (see run_with_timeout)
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

/// Spawns the command, reads its output in threads and waits with a time limit. Returns (finished well, timed out, stdout, stderr).
fn run_with_timeout(mut cmd: Command) -> Result<(bool, bool, String, String), String> {
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Err(format!("could not start the compiler: {e}")),
    };
    // reads the output in threads (otherwise the pipe fills up and the compiler hangs) and waits with a time limit
    let mut so = child.stdout.take().unwrap();
    let mut se = child.stderr.take().unwrap();
    let t1 = std::thread::spawn(move || read_capped(&mut so));
    let t2 = std::thread::spawn(move || read_capped(&mut se));
    let deadline = Instant::now() + COMPILE_TIMEOUT;
    let (ok, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(status)) => break (status.success(), false),
            Ok(None) if Instant::now() > deadline => {
                kill_tree(&mut child);
                let _ = child.wait();
                break (false, true);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(80)),
            Err(_) => break (false, false),
        }
    };
    let stdout = String::from_utf8_lossy(&t1.join().unwrap_or_default()).to_string();
    let stderr = String::from_utf8_lossy(&t2.join().unwrap_or_default()).to_string();
    Ok((ok, timed_out, stdout, stderr))
}

/// Copies ConTeXt's PDF and log from the project folder to the output folder.
fn copy_context_outputs(main: &str, dir: &Path, out_dir: &Path) {
    let stem = Path::new(main)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("main");
    for ext in ["pdf", "log"] {
        let src = dir.join(format!("{stem}.{ext}"));
        if src.is_file() {
            let _ = fs::copy(&src, out_dir.join(format!("{stem}.{ext}")));
        }
    }
}

/// Runs the compiler once. Returns (finished well, timed out, stdout, stderr) or the error on start.
fn run_once(
    engine: &EngineInfo,
    main: &str,
    dir: &Path,
    out_dir: &Path,
    path_var: &std::ffi::OsStr,
    force: bool,
) -> Result<(bool, bool, String, String), String> {
    let mut cmd = engine_command(engine, main, dir, out_dir, force);
    // main file in a subfolder (e.g. samples/x.tex with \bibliography{refs} and samples/refs.bib): TeX, BibTeX and
    // latexmk run at the project root, so the main file's folder goes into the search paths
    if let Some(parent) = Path::new(main)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        let abs = dir.join(parent);
        for var in ["TEXINPUTS", "BIBINPUTS", "BSTINPUTS"] {
            cmd.env(var, search_path(&abs, std::env::var(var).ok().as_deref()));
        }
    }
    // XeLaTeX finds fonts by name through fontconfig: give it the installed TeX's fonts (e.g. TinyTeX's FontAwesome.otf)
    if cfg!(target_os = "linux")
        && engine.id == "agent-xelatex"
        && std::env::var_os("FONTCONFIG_FILE").is_none()
        && let Some(conf) = tex_fontconfig(path_var)
    {
        cmd.env("FONTCONFIG_FILE", conf);
    }
    cmd.current_dir(dir)
        .env("PATH", path_var)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let result = run_with_timeout(cmd)?;
    if engine.id == "agent-context" {
        copy_context_outputs(main, dir, out_dir);
    }
    Ok(result)
}

/// A validated compile request.
struct Job<'a> {
    project: &'a str,
    main: &'a str,
    files: Vec<FileRef>,
}

/// Validates the request body; the error is the message of the 400 response.
fn parse_job<'a>(v: &'a serde_json::Value, engine_id: &str) -> Result<Job<'a>, String> {
    let project = v["project"].as_str().unwrap_or("");
    let main = v["mainFile"].as_str().unwrap_or("");
    if !valid_project_id(project) {
        return Err("invalid project".to_string());
    }
    // ConTeXt also uses .mkiv and .mkxl as the main file
    let main_lc = main.to_ascii_lowercase();
    let ext_ok = main_lc.ends_with(".tex")
        || (engine_id == "agent-context"
            && (main_lc.ends_with(".mkiv") || main_lc.ends_with(".mkxl")));
    if !ext_ok || !safe_rel_path(main) {
        return Err("invalid main file".to_string());
    }
    let files: Vec<FileRef> = match serde_json::from_value(v["files"].clone()) {
        Ok(f) => f,
        Err(e) => return Err(format!("invalid list: {e}")),
    };
    if files
        .iter()
        .any(|f| !safe_rel_path(&f.path) || blob_path(&f.sha256).is_none())
        || !files.iter().any(|f| f.path == main)
    {
        return Err("invalid file list or missing the main file".to_string());
    }
    Ok(Job {
        project,
        main,
        files,
    })
}

pub(crate) fn compile(
    state: &State,
    v: &serde_json::Value,
    origin: Option<&str>,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let started = Instant::now();
    let engine_id = v["engine"].as_str().unwrap_or("");
    let fail = |msg: &str| json_response(400, origin, serde_json::json!({ "error": msg }));
    let job = match parse_job(v, engine_id) {
        Ok(j) => j,
        Err(msg) => return fail(&msg),
    };
    let engines = detect_engines();
    let Some(engine) = engines.iter().find(|e| e.id == engine_id) else {
        return fail("compiler not found on this machine");
    };

    {
        let mut busy = state.busy.lock().unwrap();
        if busy.contains_key(job.project) {
            return json_response(
                409,
                origin,
                serde_json::json!({ "error": "this project is already being compiled" }),
            );
        }
        busy.insert(job.project.to_string(), ());
        COMPILING.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    let install_missing = v["installMissing"].as_bool().unwrap_or(true);
    let result = run_job(engine, &job, install_missing, origin, started);
    if state.busy.lock().unwrap().remove(job.project).is_some() {
        COMPILING.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    }
    result
}

/// Syncs the work folder, compiles (installing missing packages between rounds) and builds the response.
fn run_job(
    engine: &EngineInfo,
    job: &Job,
    install_missing: bool,
    origin: Option<&str>,
    started: Instant,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let (main, files) = (job.main, &job.files);
    let dir = work_dir(job.project);
    if let Err(missing) = sync_workspace(&dir, files) {
        return json_response(
            409,
            origin,
            serde_json::json!({ "error": "missing contents", "need": missing }),
        );
    }
    let out_dir = dir.join("_out");
    let _ = fs::create_dir_all(&out_dir);
    let path_var = std::env::join_paths(search_dirs()).unwrap_or_default();
    let tlmgr = find_binary("tlmgr")
        .filter(|_| engine.id != "agent-tectonic" && engine.id != "agent-context");
    let mut installed: Vec<String> = Vec::new();
    let mut tried: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    let stem = Path::new(main)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("main")
        .to_string();
    let started_at = Instant::now();
    let mut last_log = String::new();
    // packages the project declares and TeX cannot find: install them at once before the first compilation
    if install_missing && let Some(tlmgr) = &tlmgr {
        preinstall_declared(tlmgr, &dir, files, &path_var, &mut installed, &mut failed);
    }
    // compile; if a package is missing, install it with tlmgr (the user's TinyTeX / TeX Live) and try again
    for _round in 0..40 {
        let mut force = _round > 0;
        let (ok, timed_out, stdout, stderr) = loop {
            match run_once(engine, main, &dir, &out_dir, &path_var, force) {
                // latexmk does not redo what failed before if nothing changed in the project files: force it once
                Ok(r)
                    if !force
                        && !r.0
                        && (r.2.contains("in previous invocation of latexmk")
                            || r.2.contains("Nothing to do")) =>
                {
                    force = true
                }
                Ok(r) => break r,
                Err(e) => return json_response(500, origin, serde_json::json!({ "error": e })),
            }
        };
        let mut log = combined_log(engine, &out_dir, &stem, &stdout, &stderr);
        last_log = log.clone();
        let pdf_ok = ok && out_dir.join(format!("{stem}.pdf")).exists();
        let mut progressed = false;
        if !pdf_ok
            && !timed_out
            && install_missing
            && started_at.elapsed() < Duration::from_secs(15 * 60)
            && let Some(tlmgr) = &tlmgr
        {
            progressed = install_from_log(
                tlmgr,
                &log,
                &path_var,
                &mut tried,
                &mut installed,
                &mut failed,
            );
        }
        if !progressed {
            log = annotate_log(log, &out_dir, &stem, ok, timed_out, &installed, &failed);
            return success_response(
                engine, main, &out_dir, &stem, ok, log, &installed, started, origin,
            );
        }
    }
    // could not finish installing everything: return the log instead of a bare error
    let log = format!(
        "Stopped installing packages automatically (too many rounds or timed out). Installed: {}.\n\n{last_log}",
        if installed.is_empty() {
            "none".to_string()
        } else {
            installed.join(", ")
        }
    );
    json_response(
        200,
        origin,
        serde_json::json!({ "success": false, "log": log, "installed": installed, "engine_used": format!("{} (local)", engine.name), "mainFile": main, "ms": started.elapsed().as_millis() as u64 }),
    )
}

/// The TeX log file followed by the compiler's console output (whichever exist).
fn combined_log(
    engine: &EngineInfo,
    out_dir: &Path,
    stem: &str,
    stdout: &str,
    stderr: &str,
) -> String {
    let log_file = fs::read_to_string(out_dir.join(format!("{stem}.log"))).unwrap_or_default();
    let console = format!("{stdout}{stderr}");
    if log_file.is_empty() {
        console.clone()
    } else if console.trim().is_empty() {
        log_file
    } else {
        format!(
            "{log_file}\n\n----- output of {} -----\n{console}",
            engine.name
        )
    }
}

/// Installs the TeX Live packages for the files the log could not find. Returns true if anything was (or already had been) installed.
fn install_from_log(
    tlmgr: &Path,
    log: &str,
    path_var: &std::ffi::OsStr,
    tried: &mut Vec<String>,
    installed: &mut Vec<String>,
    failed: &mut Vec<String>,
) -> bool {
    let mut progressed = false;
    let todo: Vec<String> = missing_files(log)
        .into_iter()
        .filter(|f| !tried.contains(f))
        .take(6)
        .collect();
    for file in todo {
        tried.push(file.clone());
        match package_for(tlmgr, &file, path_var) {
            Some(pkg) if installed.contains(&pkg) => progressed = true,
            Some(pkg) => match tlmgr::install(tlmgr, &pkg, Some(path_var)) {
                Ok(()) => {
                    installed.push(pkg);
                    progressed = true;
                }
                Err(e) => failed.push(format!("{pkg} ({file}): {e}")),
            },
            None => failed.push(format!("{file}: no TeX Live package contains this file")),
        }
    }
    progressed
}

/// Prepends the install notes and BibTeX errors to the log and appends the time limit notice.
fn annotate_log(
    mut log: String,
    out_dir: &Path,
    stem: &str,
    ok: bool,
    timed_out: bool,
    installed: &[String],
    failed: &[String],
) -> String {
    if !installed.is_empty() {
        log = format!(
            "Packages installed automatically (local TeX Live): {}\n\n{log}",
            installed.join(", ")
        );
    }
    if !failed.is_empty() {
        log = format!(
            "Could not install automatically (tlmgr): {}\n\n{log}",
            failed.join("; ")
        );
    }
    if !ok || !out_dir.join(format!("{stem}.pdf")).exists() {
        let bib = bibtex_errors(&log);
        if !bib.is_empty() {
            log = format!(
                "BibTeX found errors: {}. If it is a .bst style from the project, try the TeX Live version (e.g. delete the project's .bst).\n\n{log}",
                bib.join(" | ")
            );
        }
    }
    if timed_out {
        log.push_str("\n\nCompilation time limit exceeded (300 seconds).");
    }
    log
}

/// Reads the PDF, synctex and bbl from the output folder and builds the final JSON response.
#[allow(clippy::too_many_arguments)]
fn success_response(
    engine: &EngineInfo,
    main: &str,
    out_dir: &Path,
    stem: &str,
    ok: bool,
    log: String,
    installed: &[String],
    started: Instant,
    origin: Option<&str>,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let pdf = fs::read(out_dir.join(format!("{stem}.pdf")))
        .ok()
        .filter(|b| b.starts_with(b"%PDF-"));
    let sync = fs::read(out_dir.join(format!("{stem}.synctex.gz")))
        .ok()
        .filter(|b| b.starts_with(&[0x1f, 0x8b]));
    let bbl = fs::read(out_dir.join(format!("{stem}.bbl")))
        .ok()
        .filter(|b| !b.is_empty());
    let success = ok && pdf.is_some();
    json_response(
        200,
        origin,
        serde_json::json!({
            "success": success,
            "pdf_base64": pdf.filter(|_| success).map(|b| B64.encode(b)),
            "synctex_base64": sync.filter(|_| success).map(|b| B64.encode(b)),
            "bbl_base64": bbl.filter(|_| success).map(|b| B64.encode(b)),
            "log": log,
            "installed": installed,
            "engine_used": format!("{} (local)", engine.name),
            "mainFile": main,
            "ms": started.elapsed().as_millis() as u64,
        }),
    )
}
#[cfg(test)]
mod tests {
    use super::{search_path, search_path_with};
    use std::path::Path;

    #[test]
    fn search_path_separator() {
        assert_eq!(
            search_path_with(Path::new("C:\\p\\samples"), Some(".;C:\\x;"), ';'),
            ".;C:\\p\\samples;C:\\x;"
        );
        assert_eq!(search_path_with(Path::new("C:\\p"), None, ';'), ".;C:\\p;");
    }

    #[test]
    fn adds_main_dir_and_keeps_defaults() {
        assert_eq!(search_path(Path::new("/p/samples"), None), ".:/p/samples:");
        assert_eq!(
            search_path(Path::new("/p/samples"), Some(".:/x/tex:")),
            ".:/p/samples:/x/tex:"
        );
    }
}
