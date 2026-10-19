//! TinyTeX installer (`neoleaf-agent install-tinytex`).
//!
//! TinyTeX is a lean TeX Live that lives in `~/.TinyTeX`: it needs neither root nor a package manager, and its
//! `tlmgr` belongs to the user, which lets the agent's automatic package installation work. The package comes from the
//! official releases (github.com/rstudio/tinytex-releases) and is checked against the SHA-256 that GitHub publishes.
//! Nothing is executed straight from the internet: a `.tar.xz` is downloaded, its hash is checked and it is extracted.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::net::{confirm, download, fetch_text, sha256_file, which};
use serde_json::Value;

const API: &str = "https://api.github.com/repos/rstudio/tinytex-releases/releases/latest";

/// "TinyTeX-1" package: ~55 MB, has the essentials; the agent installs whatever is missing with `tlmgr`.
const VARIANT: &str = "TinyTeX-1";

#[derive(Debug)]
pub struct Plan {
    pub tag: String,
    pub asset: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

// ------------------------------------------------------------------ system

/// Name of the part of the file name for this machine (`linux-x86_64`, `linux-arm64`, `linuxmusl-x86_64`).
pub fn platform_tag(arch: &str, musl: bool) -> Option<&'static str> {
    if cfg!(target_os = "macos") {
        return Some("darwin"); // single package (universal: Intel and Apple Silicon)
    }
    if cfg!(windows) {
        return Some("windows");
    }
    match (arch, musl) {
        ("x86_64", false) => Some("linux-x86_64"),
        ("x86_64", true) => Some("linuxmusl-x86_64"),
        ("aarch64", false) => Some("linux-arm64"),
        _ => None,
    }
}

fn is_musl() -> bool {
    if fs::read_dir("/lib").ok().is_some_and(|rd| {
        rd.flatten()
            .any(|e| e.file_name().to_string_lossy().starts_with("ld-musl-"))
    }) {
        return true;
    }
    Command::new("ldd")
        .arg("--version")
        .output()
        .ok()
        .is_some_and(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains("musl")
                || String::from_utf8_lossy(&o.stderr)
                    .to_lowercase()
                    .contains("musl")
        })
}

#[derive(Debug, PartialEq)]
pub struct OsInfo {
    pub pretty: String,
    /// `ID` and those from `ID_LIKE`, lowercase
    pub ids: Vec<String>,
}

pub fn parse_os_release(text: &str) -> OsInfo {
    let get = |key: &str| {
        text.lines().find_map(|l| {
            l.strip_prefix(&format!("{key}="))
                .map(|v| v.trim().trim_matches('"').to_string())
        })
    };
    let mut ids: Vec<String> = Vec::new();
    if let Some(id) = get("ID") {
        ids.push(id.to_lowercase());
    }
    if let Some(like) = get("ID_LIKE") {
        ids.extend(like.split_whitespace().map(|s| s.to_lowercase()));
    }
    OsInfo {
        pretty: get("PRETTY_NAME").unwrap_or_else(|| "Linux".to_string()),
        ids,
    }
}

fn os_info() -> OsInfo {
    if cfg!(target_os = "macos") {
        return OsInfo {
            pretty: "macOS".into(),
            ids: vec!["macos".into()],
        };
    }
    if cfg!(windows) {
        return OsInfo {
            pretty: "Windows".into(),
            ids: vec!["windows".into()],
        };
    }
    parse_os_release(
        &fs::read_to_string("/etc/os-release")
            .or_else(|_| fs::read_to_string("/usr/lib/os-release"))
            .unwrap_or_default(),
    )
}

/// Command to install packages on this distribution family (None if not recognized).
pub fn install_command(ids: &[String], tools: &[&str]) -> Option<String> {
    let has = |names: &[&str]| ids.iter().any(|i| names.contains(&i.as_str()));
    // each tool's package name differs between families
    let pkg = |tool: &str, xz_name: &'static str| -> String {
        if tool == "xz" {
            xz_name.to_string()
        } else {
            tool.to_string()
        }
    };
    let list = |xz_name: &'static str| {
        tools
            .iter()
            .map(|t| pkg(t, xz_name))
            .collect::<Vec<_>>()
            .join(" ")
    };
    if has(&["macos"]) {
        Some(format!("brew install {}", tools.join(" ")))
    } else if has(&["debian", "ubuntu"]) {
        Some(format!("sudo apt install {}", list("xz-utils")))
    } else if has(&["fedora", "rhel", "centos", "rocky", "almalinux"]) {
        Some(format!("sudo dnf install {}", list("xz")))
    } else if has(&["arch", "manjaro", "endeavouros"]) {
        Some(format!("sudo pacman -S {}", list("xz")))
    } else if has(&["opensuse", "suse", "sles"]) {
        Some(format!("sudo zypper install {}", list("xz")))
    } else if has(&["alpine"]) {
        Some(format!("sudo apk add {}", list("xz")))
    } else if has(&["void"]) {
        Some(format!("sudo xbps-install {}", list("xz")))
    } else {
        None
    }
}

/// Required tools that are not installed (perl for tlmgr; tar and xz to extract; curl or wget to download).
fn missing_tools() -> Vec<&'static str> {
    let mut out = Vec::new();
    // macOS tar (bsdtar) already extracts .xz; Linux needs xz
    for &t in if cfg!(windows) {
        &[][..]
    } else if cfg!(target_os = "macos") {
        &["perl", "tar"][..]
    } else {
        &["perl", "tar", "xz"][..]
    } {
        if !which(t) {
            out.push(t);
        }
    }
    if !which("curl") && !which("wget") {
        out.push("curl");
    }
    out
}

// ------------------------------------------------------------------ release and download

/// Picks the right package from the releases API response (with the SHA-256 that GitHub publishes).
pub fn pick_asset(release: &Value, platform: &str) -> Result<Plan, String> {
    let tag = release["tag_name"]
        .as_str()
        .ok_or("API response without tag_name")?
        .to_string();
    let wanted = format!("{VARIANT}-{platform}-{tag}{}", asset_ext(platform));
    let asset = release["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["name"].as_str() == Some(&wanted)))
        .ok_or_else(|| format!("release {tag} does not have the package {wanted}"))?;
    let digest = asset["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).ok_or("the release does not publish the package's SHA-256: I will not install without being able to verify")?;
    if digest.len() != 64 || !digest.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("published SHA-256 has an unexpected format".into());
    }
    let url = asset["browser_download_url"]
        .as_str()
        .ok_or("package without a download URL")?;
    if !url.starts_with("https://github.com/rstudio/tinytex-releases/") {
        return Err(format!("unexpected download URL: {url}"));
    }
    Ok(Plan {
        tag,
        asset: wanted,
        url: url.to_string(),
        sha256: digest.to_lowercase(),
        size: asset["size"].as_u64().unwrap_or(0),
    })
}

// ------------------------------------------------------------------ installation

pub fn dest(home: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library/TinyTeX")
    } else if cfg!(windows) {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Roaming"))
            .join("TinyTeX")
    } else {
        home.join(".TinyTeX")
    }
}

/// Package extension: on Windows it is a self-extracting archive (`.exe`); elsewhere, `.tar.xz`.
pub fn asset_ext(platform: &str) -> &'static str {
    if platform == "windows" {
        ".exe"
    } else {
        ".tar.xz"
    }
}

/// Name of the top folder inside the package (`.TinyTeX` on Linux, `TinyTeX` on macOS).
fn top_dir() -> &'static str {
    if cfg!(target_os = "macos") || cfg!(windows) {
        "TinyTeX"
    } else {
        ".TinyTeX"
    }
}

fn tlmgr_in(dest: &Path) -> Option<PathBuf> {
    let names = crate::net::exe_names("tlmgr");
    fs::read_dir(dest.join("bin"))
        .ok()?
        .flatten()
        .flat_map(|e| {
            names
                .iter()
                .map(move |n| e.path().join(n))
                .collect::<Vec<_>>()
        })
        .find(|p| p.is_file())
}

fn human(bytes: u64) -> String {
    format!("{:.0} MB", bytes as f64 / 1_000_000.0)
}

/// Completes a TinyTeX that did not ship latexmk (the agent uses latexmk to compile).
fn ensure_latexmk(tlmgr: &Path) {
    println!("Installing latexmk with tlmgr...");
    if let Err(e) = crate::tlmgr::install(tlmgr, "latexmk", None) {
        eprintln!("Could not install latexmk: {e}");
    }
}

/// `engines_found` tells whether the agent already sees a compiler (in that case it just uses it).
pub fn install(
    home: &Path,
    yes: bool,
    engines_found: &dyn Fn() -> Vec<String>,
) -> Result<(), String> {
    let dest = dest(home);

    let found = engines_found();
    if !found.is_empty() {
        println!(
            "A LaTeX compiler is already available on this machine ({}). Nothing to install: the agent will use it.",
            found.join(", ")
        );
        return Ok(());
    }
    if let Some(tlmgr) = tlmgr_in(&dest) {
        println!(
            "TinyTeX is already at {}, but latexmk is missing.",
            dest.display()
        );
        if confirm("Install latexmk now (tlmgr install latexmk)?", yes)? {
            ensure_latexmk(&tlmgr);
            return if engines_found().is_empty() {
                Err("still cannot find latexmk and pdflatex; check TinyTeX in ~/.TinyTeX".into())
            } else {
                println!("Done.");
                Ok(())
            };
        }
        return Ok(());
    }
    if dest.exists() {
        return Err(format!(
            "{} already exists but does not look like a TinyTeX; remove or rename the folder and try again",
            dest.display()
        ));
    }

    let os = os_info();
    let arch = std::env::consts::ARCH;
    let platform = platform_tag(arch, is_musl())
        .ok_or_else(|| format!("there is no prebuilt TinyTeX for the {arch} architecture"))?;
    let missing = missing_tools();
    if !missing.is_empty() {
        let hint = install_command(&os.ids, &missing)
            .map(|c| format!("\nInstall with: {c}"))
            .unwrap_or_default();
        return Err(format!(
            "required tools are missing: {}.{hint}",
            missing.join(", ")
        ));
    }

    println!("System: {} ({arch})", os.pretty);
    println!("Checking the latest TinyTeX version...");
    let release: Value = serde_json::from_str(&fetch_text(API)?)
        .map_err(|e| format!("invalid response from GitHub: {e}"))?;
    let plan = pick_asset(&release, platform)?;
    println!("\nTinyTeX is a lean LaTeX, installed only for your user (no root):");
    println!("  version  {}", plan.tag);
    println!("  download {} ({})", plan.asset, human(plan.size));
    println!("  target   {}", dest.display());
    println!("  source   github.com/rstudio/tinytex-releases (SHA-256 verified)\n");
    if !confirm("Install TinyTeX?", yes)? {
        println!("Cancelled.");
        return Ok(());
    }

    let cache = crate::config::cache_dir().join("downloads");
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let file = cache.join(&plan.asset);
    let verified = |f: &Path| sha256_file(f).is_ok_and(|h| h == plan.sha256);
    if !(file.exists() && verified(&file)) {
        println!("Downloading...");
        download(&plan.url, &file)?;
        if !verified(&file) {
            let _ = fs::remove_file(&file);
            return Err(
                "the downloaded file's SHA-256 does not match the release's: nothing was installed"
                    .into(),
            );
        }
    }
    println!("SHA-256 verified. Extracting...");

    let tmp = home.join(".neoleaf-tinytex-tmp");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let ok = if cfg!(windows) {
        // 7-Zip self-extractor: -y answers "yes" and -o<folder> picks where to extract
        Command::new(&file)
            .arg("-y")
            .arg(format!("-o{}", tmp.display()))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        Command::new("tar")
            .arg("-xJf")
            .arg(&file)
            .arg("-C")
            .arg(&tmp)
            .stdin(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    };
    if !ok || !tmp.join(top_dir()).is_dir() {
        let _ = fs::remove_dir_all(&tmp);
        return Err("could not extract the package (did the file come as expected?)".into());
    }
    fs::rename(tmp.join(top_dir()), &dest)
        .map_err(|e| format!("could not move to {}: {e}", dest.display()))?;
    let _ = fs::remove_dir_all(&tmp);
    let _ = fs::remove_file(&file);

    let tlmgr = tlmgr_in(&dest).ok_or("installed, but could not find tlmgr in ~/.TinyTeX/bin")?;
    if engines_found().is_empty() {
        ensure_latexmk(&tlmgr);
    }
    if engines_found().is_empty() {
        return Err("TinyTeX was installed, but the agent still cannot see latexmk and pdflatex (try: ~/.TinyTeX/bin/*/tlmgr install latexmk)".into());
    }
    println!("\nTinyTeX installed. In NeoLeaf, choose the \"💻 Local\" engine.");
    Ok(())
}

pub fn uninstall(home: &Path, yes: bool) -> Result<(), String> {
    let dest = dest(home);
    if !dest.is_dir() {
        println!("There is no TinyTeX at {}.", dest.display());
        return Ok(());
    }
    if tlmgr_in(&dest).is_none() {
        return Err(format!(
            "{} does not look like a TinyTeX; I will not delete it",
            dest.display()
        ));
    }
    if !confirm(
        &format!("Remove {} and everything in it?", dest.display()),
        yes,
    )? {
        println!("Cancelled.");
        return Ok(());
    }
    fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    println!("TinyTeX removed.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn platform_names() {
        assert_eq!(asset_ext("windows"), ".exe");
        assert_eq!(asset_ext("linux-x86_64"), ".tar.xz");
        assert_eq!(platform_tag("x86_64", false), Some("linux-x86_64"));
        assert_eq!(platform_tag("x86_64", true), Some("linuxmusl-x86_64"));
        assert_eq!(platform_tag("aarch64", false), Some("linux-arm64"));
        assert_eq!(platform_tag("aarch64", true), None);
        assert_eq!(platform_tag("riscv64", false), None);
    }

    #[test]
    fn os_release_parsing() {
        let os = parse_os_release(
            "NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 24.04 LTS\"\nID=ubuntu\nID_LIKE=debian\n",
        );
        assert_eq!(os.pretty, "Ubuntu 24.04 LTS");
        assert_eq!(os.ids, vec!["ubuntu", "debian"]);
        assert_eq!(parse_os_release("").pretty, "Linux");
    }

    #[test]
    fn install_hint_per_family() {
        let ids = |s: &str| s.split(' ').map(String::from).collect::<Vec<_>>();
        assert_eq!(
            install_command(&ids("ubuntu debian"), &["perl", "xz"]).unwrap(),
            "sudo apt install perl xz-utils"
        );
        assert_eq!(
            install_command(&ids("fedora"), &["perl", "xz"]).unwrap(),
            "sudo dnf install perl xz"
        );
        assert_eq!(
            install_command(&ids("rocky rhel fedora"), &["tar"]).unwrap(),
            "sudo dnf install tar"
        );
        assert_eq!(
            install_command(&ids("arch"), &["curl"]).unwrap(),
            "sudo pacman -S curl"
        );
        assert_eq!(
            install_command(&ids("opensuse-tumbleweed suse"), &["perl"]).unwrap(),
            "sudo zypper install perl"
        );
        assert_eq!(
            install_command(&ids("macos"), &["perl"]).unwrap(),
            "brew install perl"
        );
        assert_eq!(
            install_command(&ids("alpine"), &["xz"]).unwrap(),
            "sudo apk add xz"
        );
        assert!(install_command(&ids("nixos"), &["perl"]).is_none());
    }

    fn release() -> Value {
        let digest = format!("sha256:{}", "ab".repeat(32));
        json!({ "tag_name": "v2026.10", "assets": [
            { "name": "TinyTeX-1-linux-x86_64-v2026.10.tar.xz", "size": 53_000_000, "digest": digest, "browser_download_url": "https://github.com/rstudio/tinytex-releases/releases/download/v2026.10/TinyTeX-1-linux-x86_64-v2026.10.tar.xz" },
            { "name": "TinyTeX-linux-x86_64-v2026.10.tar.xz", "size": 151_000_000, "digest": digest, "browser_download_url": "https://github.com/rstudio/tinytex-releases/releases/download/v2026.10/x" },
        ]})
    }

    #[test]
    fn picks_the_small_variant_with_digest() {
        let p = pick_asset(&release(), "linux-x86_64").unwrap();
        assert_eq!(p.asset, "TinyTeX-1-linux-x86_64-v2026.10.tar.xz");
        assert_eq!(p.sha256, "ab".repeat(32));
        assert_eq!(p.size, 53_000_000);
        assert!(pick_asset(&release(), "linux-arm64").is_err());
    }

    #[test]
    fn refuses_without_digest_or_with_foreign_url() {
        let mut r = release();
        r["assets"][0]["digest"] = Value::Null;
        assert!(
            pick_asset(&r, "linux-x86_64")
                .unwrap_err()
                .contains("SHA-256")
        );
        let mut r = release();
        r["assets"][0]["browser_download_url"] = json!("https://evil.example/TinyTeX.tar.xz");
        assert!(pick_asset(&r, "linux-x86_64").unwrap_err().contains("URL"));
        let mut r = release();
        r["assets"][0]["digest"] = json!("sha256:zz");
        assert!(pick_asset(&r, "linux-x86_64").is_err());
    }

    #[test]
    fn sha256_of_file() {
        let p = std::env::temp_dir().join(format!("nl-sha-{}", std::process::id()));
        fs::write(&p, b"abc").unwrap();
        assert_eq!(
            sha256_file(&p).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn reuses_existing_compiler_without_touching_the_disk() {
        let home = std::env::temp_dir().join(format!("nl-home-{}", std::process::id()));
        fs::create_dir_all(&home).unwrap();
        install(&home, true, &|| vec!["pdfLaTeX".to_string()]).unwrap();
        assert!(!dest(&home).exists());
        let _ = fs::remove_dir_all(&home);
    }
}
