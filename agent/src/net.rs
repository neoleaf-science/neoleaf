//! Network, hash and terminal-prompt utilities shared by the TinyTeX installer and `update`.

use std::fs;
use std::io::{BufRead, IsTerminal, Write};
use std::path::Path;
use std::process::Command;

use sha2::{Digest, Sha256};

/// File names a program may have (on Windows: `.exe` and `.bat`, like tlmgr).
pub fn exe_names(name: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![
            format!("{name}.exe"),
            format!("{name}.bat"),
            name.to_string(),
        ]
    } else {
        vec![name.to_string()]
    }
}

pub fn which(name: &str) -> bool {
    let names = exe_names(name);
    let has = |d: &Path| names.iter().any(|n| d.join(n).is_file());
    std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| has(&d)))
        || ["/usr/bin", "/bin", "/usr/local/bin"]
            .iter()
            .any(|d| has(Path::new(d)))
}

pub fn fetch_text(url: &str) -> Result<String, String> {
    let out = if which("curl") {
        Command::new("curl")
            .args([
                "-fsSL",
                "--max-time",
                "30",
                "-H",
                "Accept: application/vnd.github+json",
                "-H",
                "User-Agent: neoleaf-agent",
                url,
            ])
            .output()
    } else {
        Command::new("wget")
            .args([
                "-qO-",
                "--timeout=30",
                "--header=Accept: application/vnd.github+json",
                "--user-agent=neoleaf-agent",
                url,
            ])
            .output()
    }
    .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("could not query {url} (no internet?)"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn download(url: &str, out: &Path) -> Result<(), String> {
    let status = if which("curl") {
        Command::new("curl")
            .args(["-fL", "--retry", "5", "--retry-delay", "3", "-C", "-", "-o"])
            .arg(out)
            .arg(url)
            .status()
    } else {
        Command::new("wget")
            .args(["-c", "--tries=6", "--waitretry=3", "-O"])
            .arg(out)
            .arg(url)
            .status()
    }
    .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("the download failed".into())
    }
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    std::io::copy(&mut f, &mut h).map_err(|e| e.to_string())?;
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

pub fn confirm(question: &str, yes: bool) -> Result<bool, String> {
    if yes {
        return Ok(true);
    }
    if !std::io::stdin().is_terminal() {
        return Err("no terminal to ask on: run it in a terminal or use --yes".into());
    }
    print!("{question} [y/N] ");
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    Ok(matches!(line.trim().to_lowercase().as_str(), "y" | "yes"))
}
