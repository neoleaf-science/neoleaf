//! User service (systemd --user): `install` (installs or updates), `update`, `status` and `uninstall`.
//!
//! The binary is copied to `~/.local/bin/neoleaf-agent` (a stable path, which is also on the PATH) and the service
//! points to it. Running `install` again with a newer binary updates the copy and restarts the service;
//! `update` downloads the version published on the site (checking the SHA-256) and does the same.

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde_json::Value;

use crate::net::{confirm, download, fetch_text, sha256_file};

const UNIT: &str = "neoleaf-agent.service";
/// LaunchAgent label on macOS.
const LABEL: &str = "science.neoleaf.agent";

/// Program that talks to the service manager (`NEOLEAF_SYSTEMCTL` swaps in another one, for tests).
fn systemctl() -> String {
    std::env::var("NEOLEAF_SYSTEMCTL").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "launchctl"
        } else {
            "systemctl"
        }
        .to_string()
    })
}

fn ctl(args: &[&str]) -> Result<(), String> {
    let mut cmd = Command::new(systemctl());
    if !cfg!(target_os = "macos") {
        cmd.arg("--user");
    }
    let st = cmd
        .args(args)
        .status()
        .map_err(|e| format!("{}: {e}", systemctl()))?;
    if st.success() {
        Ok(())
    } else {
        Err(format!(
            "{}{} {} failed",
            systemctl(),
            if cfg!(target_os = "macos") {
                ""
            } else {
                " --user"
            },
            args.join(" ")
        ))
    }
}

/// The user's domain in launchd (`gui/<uid>`).
fn launchd_domain() -> String {
    let uid = Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "501".into());
    format!("gui/{uid}")
}

pub fn unit_path(home: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        return home
            .join("Library/LaunchAgents")
            .join(format!("{LABEL}.plist"));
    }
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"))
        .join("systemd/user")
        .join(UNIT)
}

pub fn installed_exe(home: &Path) -> PathBuf {
    if cfg!(windows) {
        return home.join("AppData/Local/Programs/neoleaf-agent/neoleaf-agent.exe");
    }
    home.join(".local/bin/neoleaf-agent")
}

// ------------------------------------------------------------------ Windows: start with the session (the user's Run key)

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "NeoLeafAgent";

/// Run key value: `launch` starts the agent without a console window and exits.
/// The slashes are **always backslashes**: the agent path is built with `home.join("AppData/Local/...")` and ends up with mixed slashes
/// (`C:\Users\Ana\AppData/Local/...`); Explorer misreads that value (it cuts the start of the path, "AppData/Local/...exe" launch) and the
/// agent never starts at login. Tested on a real Windows 10: with mixed slashes the Shell event showed the command cut off.
pub fn run_value(exe: &Path) -> String {
    format!(
        "\"{}\" launch",
        exe.display().to_string().replace('/', "\\")
    )
}

fn reg(args: &[&str]) -> bool {
    Command::new("reg")
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Starts the agent in the background, without a window (the hidden console is inherited by latexmk and friends).
#[cfg(windows)]
pub fn spawn_background(exe: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    Command::new(exe)
        .arg("background")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not start the agent: {e}"))
}

#[cfg(not(windows))]
pub fn spawn_background(_exe: &Path) -> Result<(), String> {
    Err("the launch command only exists on Windows".into())
}

/// Stops the other copies of the agent (the installed one and the downloaded one), except this process.
fn stop_others() {
    let me = std::process::id().to_string();
    for image in ["neoleaf-agent.exe", "neoleaf-agent-windows-x86_64.exe"] {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", image, "/FI", &format!("PID ne {me}")])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    std::thread::sleep(Duration::from_millis(500));
}

pub fn unit_text(exe: &Path) -> String {
    format!(
        "[Unit]\nDescription=NeoLeaf local agent\n\n[Service]\nExecStart=\"{}\"\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n",
        exe.display()
    )
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// macOS LaunchAgent: starts at login and restarts if it crashes (but not if it exits on purpose).
pub fn plist_text(exe: &Path, log: &Path) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n  <key>Label</key>\n  <string>{LABEL}</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>{}</string>\n  </array>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>\n  <key>ProcessType</key>\n  <string>Interactive</string>\n  <key>StandardOutPath</key>\n  <string>{}</string>\n  <key>StandardErrorPath</key>\n  <string>{}</string>\n</dict>\n</plist>\n",
        xml_escape(&exe.display().to_string()),
        xml_escape(&log.display().to_string()),
        xml_escape(&log.display().to_string())
    )
}

/// Service output log on macOS.
fn mac_log(home: &Path) -> PathBuf {
    home.join("Library/Logs/neoleaf-agent.log")
}

/// macOS binaries need a signature (ad hoc is enough); Apple Silicon refuses to run without one.
fn adhoc_sign(path: &Path) {
    if cfg!(target_os = "macos") {
        let _ = Command::new("codesign")
            .args(["--force", "--sign", "-"])
            .arg(path)
            .output();
    }
}

/// Registers and (re)starts the service in the system manager.
fn start_service(home: &Path) -> Result<(), String> {
    if cfg!(windows) {
        stop_others();
        spawn_background(&installed_exe(home))
    } else if cfg!(target_os = "macos") {
        let (dom, plist) = (launchd_domain(), unit_path(home).display().to_string());
        let _ = ctl(&["bootout", &format!("{dom}/{LABEL}")]);
        ctl(&["bootstrap", &dom, &plist])?;
        ctl(&["kickstart", "-k", &format!("{dom}/{LABEL}")])
    } else {
        let _ = ctl(&["reset-failed", UNIT]); // after several failures systemd gives up (start-limit-hit) and would ignore the restart
        ctl(&["restart", UNIT])
    }
}

/// Compares `x.y.z` versions (numeric parts; missing counts as 0).
pub fn is_newer(remote: &str, local: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim()
            .trim_start_matches('v')
            .split('.')
            .map(|p| {
                p.split(['-', '+'])
                    .next()
                    .unwrap_or("")
                    .parse()
                    .unwrap_or(0)
            })
            .collect()
    };
    let (a, b) = (parse(remote), parse(local));
    (0..a.len().max(b.len()))
        .map(|i| {
            (
                a.get(i).copied().unwrap_or(0),
                b.get(i).copied().unwrap_or(0),
            )
        })
        .find(|(x, y)| x != y)
        .is_some_and(|(x, y)| x > y)
}

/// Copies the executable over the destination without interrupting whoever is using it (writes next to it and renames).
pub fn replace_binary(src: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = dest.with_extension("new");
    fs::copy(src, &tmp).map_err(|e| format!("could not copy to {}: {e}", tmp.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    adhoc_sign(&tmp);
    if cfg!(windows) && dest.exists() {
        // Windows does not let you overwrite a running .exe, but it does let you rename it
        let old = dest.with_extension("old");
        let _ = fs::remove_file(&old);
        fs::rename(dest, &old).map_err(|e| format!("could not replace {}: {e}", dest.display()))?;
    }
    fs::rename(&tmp, dest).map_err(|e| format!("could not install to {}: {e}", dest.display()))
}

fn same_file(a: &Path, b: &Path) -> bool {
    matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

/// Version of the agent currently answering on 127.0.0.1 (None if no agent is running).
pub fn running_version(port: u16) -> Option<String> {
    let addr = ("127.0.0.1", port).to_socket_addrs().ok()?.next()?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(800)).ok()?;
    s.set_read_timeout(Some(Duration::from_millis(1500))).ok()?;
    s.write_all(format!("GET /v1/status HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes())
        .ok()?;
    let mut buf = String::new();
    s.read_to_string(&mut buf).ok()?;
    let v: Value = serde_json::from_str(buf.split("\r\n\r\n").nth(1)?).ok()?;
    (v["agent"] == "neoleaf-agent").then(|| v["version"].as_str().unwrap_or("?").to_string())
}

/// What to say after restarting the service: is the expected version up? (Pure, for testing.)
pub fn verify_outcome(expected: &str, running: Option<&str>, port: u16) -> Result<(), String> {
    match running {
        Some(v) if v == expected => Ok(()),
        Some(v) => Err(format!(
            "the service was restarted, but version {v} is still answering on port {port}: another copy of the agent (for example a downloaded executable started by hand) is holding the port. Stop it (pkill -f neoleaf-agent; on Windows, use Task Manager) and restart the service ({})",
            if cfg!(windows) || cfg!(target_os = "macos") {
                "neoleaf-agent install"
            } else {
                "systemctl --user reset-failed neoleaf-agent; systemctl --user restart neoleaf-agent"
            }
        )),
        None => Err(format!(
            "the service did not come up on port {port}; see why with: {}",
            if cfg!(windows) {
                "run `neoleaf-agent.exe background` in a terminal to see the error"
            } else if cfg!(target_os = "macos") {
                "tail -n 20 ~/Library/Logs/neoleaf-agent.log"
            } else {
                "journalctl --user -u neoleaf-agent -n 20"
            }
        )),
    }
}

/// Restarts the service (clearing a "failed" state) and confirms that the expected version is up.
fn restart_and_verify(home: &Path, port: u16, expected: &str) -> Result<(), String> {
    start_service(home)?;
    // with a replaced systemctl (tests) there is no real process, unless the check is requested
    if std::env::var_os("NEOLEAF_SYSTEMCTL").is_some()
        && std::env::var_os("NEOLEAF_VERIFY_RESTART").is_none()
    {
        return Ok(());
    }
    let secs: u64 = std::env::var("NEOLEAF_VERIFY_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8);
    let deadline = std::time::Instant::now() + Duration::from_secs(secs);
    loop {
        let running = running_version(port);
        if running.as_deref() == Some(expected) || std::time::Instant::now() > deadline {
            return verify_outcome(expected, running.as_deref(), port);
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

fn on_path(dir: &Path) -> bool {
    std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| d == dir))
}

pub fn is_installed(home: &Path) -> bool {
    if cfg!(windows) {
        return reg(&["query", RUN_KEY, "/v", RUN_NAME]);
    }
    unit_path(home).exists()
}

/// Installs the service or, if it already exists, updates the binary copy and restarts.
pub fn install(home: &Path, port: u16, version: &str) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let target = installed_exe(home);
    let before = running_version(port);
    let updating = is_installed(home);

    if !same_file(&exe, &target) {
        replace_binary(&exe, &target)?;
    }
    let unit = unit_path(home);
    if !cfg!(windows) {
        fs::create_dir_all(unit.parent().unwrap()).map_err(|e| e.to_string())?;
    }
    if cfg!(windows) {
        if !reg(&[
            "add",
            RUN_KEY,
            "/v",
            RUN_NAME,
            "/t",
            "REG_SZ",
            "/d",
            &run_value(&target),
            "/f",
        ]) {
            return Err("could not register automatic startup (the user's Run key)".into());
        }
    } else if cfg!(target_os = "macos") {
        let log = mac_log(home);
        fs::create_dir_all(log.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(&unit, plist_text(&target, &log)).map_err(|e| e.to_string())?;
    } else {
        fs::write(&unit, unit_text(&target)).map_err(|e| e.to_string())?;
        // the service needs to know which graphical session it is in (clipboard and notifications)
        let vars: Vec<&str> = [
            "WAYLAND_DISPLAY",
            "DISPLAY",
            "XAUTHORITY",
            "DBUS_SESSION_BUS_ADDRESS",
        ]
        .into_iter()
        .filter(|v| std::env::var_os(v).is_some())
        .collect();
        if !vars.is_empty() {
            let mut args = vec!["import-environment"];
            args.extend(vars);
            let _ = ctl(&args);
        }
        ctl(&["daemon-reload"])?;
        ctl(&["enable", UNIT])?;
    }
    // restart (not just --now): with the service already running, this is what puts the new binary up
    println!(
        "Agent {} installed at {}",
        version,
        if cfg!(windows) {
            target.display().to_string().replace('/', "\\")
        } else {
            target.display().to_string()
        }
    );
    restart_and_verify(home, port, version)?;
    match before {
        Some(old) if updating && old != version => println!("Service updated: {old} → {version}"),
        Some(_) if updating => println!("Service restarted (same version)."),
        _ => println!("Service installed and started."),
    }
    if !cfg!(windows) && !on_path(target.parent().unwrap()) {
        println!(
            "Tip: {} is not on the PATH; to use `neoleaf-agent` anywhere, add it to the PATH.",
            target.parent().unwrap().display()
        );
    }
    println!(
        "On the first compilation the browser asks for the pairing code; to generate one now: neoleaf-agent code"
    );
    Ok(())
}

pub fn uninstall(home: &Path) -> Result<(), String> {
    if cfg!(windows) {
        let _ = reg(&["delete", RUN_KEY, "/v", RUN_NAME, "/f"]);
        stop_others();
    } else if cfg!(target_os = "macos") {
        let _ = ctl(&["bootout", &format!("{}/{LABEL}", launchd_domain())]);
        let _ = fs::remove_file(unit_path(home));
    } else {
        let _ = ctl(&["disable", "--now", UNIT]);
        let _ = fs::remove_file(unit_path(home));
        let _ = ctl(&["daemon-reload"]);
    }
    let target = installed_exe(home);
    for f in [
        target.clone(),
        prev_path(&target),
        target.with_extension("old"),
    ] {
        if f.is_file() {
            let _ = fs::remove_file(&f);
        }
    }
    Ok(())
}

pub fn status(home: &Path, port: u16, version: &str) {
    println!(
        "This binary:    {version} ({})",
        std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_default()
    );
    println!(
        "Service:        {}",
        if is_installed(home) {
            format!("installed ({})", installed_exe(home).display())
        } else {
            "not installed (neoleaf-agent install)".to_string()
        }
    );
    match running_version(port) {
        Some(v) => println!("Running:        yes, version {v} on port {port}"),
        None => println!("Running:        no"),
    }
}

/// Version published on the site and the binary's SHA-256.
#[derive(Debug, Clone)]
pub struct Info {
    pub version: String,
    pub sha256: String,
}

/// File published for this platform and the key of its SHA-256 in version.json (Linux's is the old `sha256`).
pub fn published_asset(os: &str, arch: &str) -> Option<(&'static str, &'static str)> {
    match (os, arch) {
        ("linux", "x86_64") => Some(("neoleaf-agent-linux-x86_64", "sha256")),
        ("macos", "aarch64" | "x86_64") => Some(("neoleaf-agent-macos-universal", "sha256_macos")),
        ("windows", "x86_64" | "aarch64") => {
            Some(("neoleaf-agent-windows-x86_64.exe", "sha256_windows"))
        } // on ARM it runs emulated
        _ => None,
    }
}

pub fn parse_info(text: &str, hash_key: &str) -> Result<Info, String> {
    let info: Value =
        serde_json::from_str(text).map_err(|e| format!("invalid version.json: {e}"))?;
    let version = info["version"]
        .as_str()
        .filter(|v| {
            !v.is_empty()
                && v.len() <= 20
                && v.split('.').count() <= 3
                && v.split('.')
                    .all(|p| !p.is_empty() && p.bytes().all(|c| c.is_ascii_digit()))
        })
        .ok_or("version.json without a valid version")?
        .to_string();
    let sha256 = info[hash_key].as_str().filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())).ok_or("version.json without a valid SHA-256 for this platform: I will not update without being able to verify")?.to_lowercase();
    Ok(Info { version, sha256 })
}

pub fn fetch_info(site: &str) -> Result<Info, String> {
    let (_, key) = published_asset(std::env::consts::OS, std::env::consts::ARCH)
        .ok_or("there is no published binary for this system")?;
    let base = site.trim_end_matches('/');
    parse_info(
        &fetch_text(&format!("{base}/static/agent/version.json"))?,
        key,
    )
}

fn prev_path(dest: &Path) -> PathBuf {
    dest.with_extension("prev")
}

/// Downloads the binary, checks the SHA-256 and the version, keeps the current one as `.prev`, swaps and restarts the service (if any).
pub fn apply(home: &Path, site: &str, info: &Info, port: u16) -> Result<(), String> {
    let (asset, _) = published_asset(std::env::consts::OS, std::env::consts::ARCH)
        .ok_or("binaries are only published for Linux x86_64, macOS and Windows")?;
    let remote = &info.version;
    let dir = crate::config::cache_dir().join("downloads");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!(
        "neoleaf-agent-{remote}{}",
        std::env::consts::EXE_SUFFIX
    ));
    let _ = fs::remove_file(&file);
    download(
        &format!("{}/static/agent/{asset}", site.trim_end_matches('/')),
        &file,
    )?;
    if sha256_file(&file)? != info.sha256 {
        let _ = fs::remove_file(&file);
        return Err(
            "the downloaded file's SHA-256 does not match the published one: nothing was changed"
                .into(),
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    adhoc_sign(&file);
    // check that the new binary runs and is the announced version before replacing the current one
    let out = Command::new(&file)
        .arg("--version")
        .output()
        .map_err(|e| format!("the downloaded binary does not run: {e}"))?;
    if !String::from_utf8_lossy(&out.stdout).contains(remote.as_str()) {
        let _ = fs::remove_file(&file);
        return Err(
            "the downloaded binary is not the announced version: nothing was changed".into(),
        );
    }
    let installed = is_installed(home);
    let dest = if installed {
        installed_exe(home)
    } else {
        std::env::current_exe().map_err(|e| e.to_string())?
    };
    if dest.is_file() {
        let _ = fs::copy(&dest, prev_path(&dest)); // for `rollback`
    }
    replace_binary(&file, &dest)?;
    let _ = fs::remove_file(&file);
    if installed {
        restart_and_verify(home, port, remote).map_err(|e| {
            format!(
                "the update to {remote} was written to {}, but {e}",
                dest.display()
            )
        })?;
        println!("Updated to {remote} and service restarted.");
    } else {
        println!(
            "Updated to {remote} at {} (the service is not installed; restart the agent if it is running).",
            dest.display()
        );
    }
    Ok(())
}

/// Downloads the version published on the site (checking the SHA-256) and puts it in place; restarts the service if any.
pub fn update(home: &Path, site: &str, version: &str, yes: bool, port: u16) -> Result<(), String> {
    let info = fetch_info(site)?;
    if !is_newer(&info.version, version) {
        println!("You are already on the latest version ({version}).");
        return Ok(());
    }
    println!("New version available: {version} → {}", info.version);
    if !confirm("Update now?", yes)? {
        println!("Cancelled.");
        return Ok(());
    }
    apply(home, site, &info, port)
}

/// Goes back to the previous version (kept at the last update).
pub fn rollback(home: &Path) -> Result<(), String> {
    let dest = if is_installed(home) {
        installed_exe(home)
    } else {
        std::env::current_exe().map_err(|e| e.to_string())?
    };
    let prev = prev_path(&dest);
    if !prev.is_file() {
        return Err("there is no previous version saved".into());
    }
    replace_binary(&prev, &dest)?;
    if is_installed(home) {
        start_service(home)?;
    }
    println!("Previous version restored at {}.", dest.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_ordering() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(is_newer("0.10.0", "0.9.9"));
        assert!(is_newer("1.0", "0.9.9"));
        assert!(is_newer("v0.1.1", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
        assert!(!is_newer("0.1.0-beta", "0.1.0"));
    }

    #[test]
    fn verify_outcome_explains_a_port_conflict() {
        assert!(verify_outcome("0.2.2", Some("0.2.2"), 47474).is_ok());
        let e = verify_outcome("0.2.2", Some("0.2.1"), 47474).unwrap_err();
        assert!(
            e.contains("0.2.1") && e.contains("another copy") && e.contains("reset-failed"),
            "{e}"
        );
        assert!(
            verify_outcome("0.2.2", None, 47474)
                .unwrap_err()
                .contains("journalctl")
        );
    }

    #[test]
    fn unit_points_at_the_stable_path_and_quotes_it() {
        let u = unit_text(Path::new("/home/ana maria/.local/bin/neoleaf-agent"));
        assert!(u.contains("ExecStart=\"/home/ana maria/.local/bin/neoleaf-agent\""));
        assert!(u.contains("Restart=on-failure") && u.contains("WantedBy=default.target"));
    }

    #[test]
    fn plist_has_label_keepalive_and_escapes() {
        let p = plist_text(
            Path::new("/Users/a&b/.local/bin/neoleaf-agent"),
            Path::new("/Users/a&b/Library/Logs/x.log"),
        );
        assert!(
            p.contains("<string>science.neoleaf.agent</string>")
                && p.contains("<key>RunAtLoad</key>")
                && p.contains("<key>SuccessfulExit</key>")
        );
        assert!(p.contains("/Users/a&amp;b/.local/bin/neoleaf-agent") && !p.contains("a&b"));
    }

    #[test]
    fn windows_run_value_uses_only_backslashes() {
        // the agent's real path on Windows, as the installer builds it (mixed slashes)
        assert_eq!(
            run_value(Path::new(
                r"C:\Users\Docker\AppData/Local/Programs/neoleaf-agent/neoleaf-agent.exe"
            )),
            r#""C:\Users\Docker\AppData\Local\Programs\neoleaf-agent\neoleaf-agent.exe" launch"#
        );
    }

    #[test]
    fn windows_run_value_quotes_and_asset() {
        assert_eq!(
            run_value(Path::new(
                r"C:\Users\Ana Maria\AppData\Local\Programs\neoleaf-agent\neoleaf-agent.exe"
            )),
            r#""C:\Users\Ana Maria\AppData\Local\Programs\neoleaf-agent\neoleaf-agent.exe" launch"#
        );
        assert_eq!(
            published_asset("windows", "x86_64"),
            Some(("neoleaf-agent-windows-x86_64.exe", "sha256_windows"))
        );
    }

    #[test]
    fn published_asset_per_platform_and_info_key() {
        assert_eq!(
            published_asset("linux", "x86_64"),
            Some(("neoleaf-agent-linux-x86_64", "sha256"))
        );
        assert_eq!(
            published_asset("macos", "aarch64").unwrap().0,
            "neoleaf-agent-macos-universal"
        );
        assert_eq!(
            published_asset("macos", "x86_64").unwrap().1,
            "sha256_macos"
        );
        assert!(
            published_asset("linux", "aarch64").is_none()
                && published_asset("freebsd", "x86_64").is_none()
        );
        let (a, b) = ("a".repeat(64), "B".repeat(64));
        let json = format!(r#"{{"version":"0.3.0","sha256":"{a}","sha256_macos":"{b}"}}"#);
        assert_eq!(parse_info(&json, "sha256").unwrap().sha256, a);
        assert_eq!(
            parse_info(&json, "sha256_macos").unwrap().sha256,
            "b".repeat(64)
        );
        assert!(
            parse_info(
                &format!(r#"{{"version":"0.3.0","sha256":"{a}"}}"#),
                "sha256_macos"
            )
            .is_err()
        );
    }

    #[test]
    fn replace_binary_is_atomic_and_executable() {
        let d = std::env::temp_dir().join(format!("nl-svc-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let (src, dest) = (d.join("new"), d.join("bin/agent"));
        fs::write(&src, b"new").unwrap();
        fs::create_dir_all(d.join("bin")).unwrap();
        fs::write(&dest, b"old").unwrap();
        replace_binary(&src, &dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"new");
        assert!(!d.join("bin/agent.new").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&dest).unwrap().permissions().mode() & 0o111,
                0o111
            );
        }
        let _ = fs::remove_dir_all(&d);
    }
}
