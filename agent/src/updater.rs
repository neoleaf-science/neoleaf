//! Agent update check: notifies (default) or updates itself (opt-in).
//!
//! Modes (`neoleaf-agent auto-update off|notify|on`, stored in `settings.json`):
//! - `off`: does not query the site;
//! - `notify` (default): queries the site from time to time and notifies through a notification, the tray and the site itself;
//! - `on`: besides notifying, installs the update when the agent is idle (only if installed as a service).

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::service::{self, Info};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Off,
    Notify,
    On,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s.to_lowercase().as_str() {
            "off" => Some(Mode::Off),
            "notify" => Some(Mode::Notify),
            "on" | "auto" => Some(Mode::On),
            _ => None,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Mode::Off => "off",
            Mode::Notify => "notify",
            Mode::On => "on",
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Settings {
    auto_update: Mode,
}

pub fn load_mode(dir: &Path) -> Mode {
    fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .map(|s| s.auto_update)
        .unwrap_or(Mode::Notify)
}

pub fn save_mode(dir: &Path, mode: Mode) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(
        dir.join("settings.json"),
        serde_json::to_string_pretty(&Settings { auto_update: mode }).unwrap_or_default(),
    )
    .map_err(|e| e.to_string())
}

/// Latest new version found (for /v1/status, the tray and the site).
static AVAILABLE: Mutex<Option<String>> = Mutex::new(None);

pub fn available() -> Option<String> {
    AVAILABLE.lock().ok().and_then(|g| g.clone())
}

/// Short message for the tray menu (result of "Check for updates" or of the update done from the menu).
static STATUS: Mutex<String> = Mutex::new(String::new());
static CHECKING: AtomicBool = AtomicBool::new(false);
/// Site and version in use, stored when the check loop starts (the tray menu does not carry this data).
static CTX: OnceLock<(String, &'static str)> = OnceLock::new();

pub fn status() -> String {
    STATUS.lock().map(|g| g.clone()).unwrap_or_default()
}

pub fn set_status(s: impl Into<String>) {
    if let Ok(mut g) = STATUS.lock() {
        *g = s.into();
    }
}

pub fn is_checking() -> bool {
    CHECKING.load(Ordering::Relaxed)
}

/// The menu's "Check for updates": queries the site now (in any mode, because the person asked) and leaves the result in the status.
pub fn check_now() {
    let Some((site, version)) = CTX.get().cloned() else {
        set_status("The check is still starting; try again in a moment");
        return;
    };
    if CHECKING.swap(true, Ordering::SeqCst) {
        return;
    }
    set_status("");
    std::thread::spawn(move || {
        match service::fetch_info(&site) {
            Ok(info) if service::is_newer(&info.version, version) => {
                set_available(Some(info.version.clone()));
                set_status(format!("New version {} available", info.version));
            }
            Ok(_) => {
                set_available(None);
                set_status(format!("You are on the latest version ({version})"));
            }
            Err(e) => set_status(format!(
                "Could not check right now: {}",
                e.lines().next().unwrap_or("error")
            )),
        }
        CHECKING.store(false, Ordering::SeqCst);
    });
}

fn set_available(v: Option<String>) {
    if let Ok(mut g) = AVAILABLE.lock() {
        *g = v;
    }
}

fn env_secs(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// One round: queries the site and acts according to the mode. `idle` tells whether no compilation is running.
/// Returns the new version found (if any).
pub fn check_once(
    paths: (&Path, &Path),
    site_version: (&str, &str),
    idle: &dyn Fn() -> bool,
    notify: &dyn Fn(&str, &str),
    last_notified: &mut Option<String>,
    port: u16,
) -> Result<Option<Info>, String> {
    let (home, config) = paths;
    let (site, version) = site_version;
    let mode = load_mode(config);
    if mode == Mode::Off {
        set_available(None);
        return Ok(None);
    }
    let info = service::fetch_info(site)?;
    if !service::is_newer(&info.version, version) {
        set_available(None);
        return Ok(None);
    }
    set_available(Some(info.version.clone()));
    if mode == Mode::On && service::is_installed(home) && idle() {
        service::apply(home, site, &info, port)?; // restarts the service: this process is replaced
        return Ok(Some(info));
    }
    if last_notified.as_deref() != Some(info.version.as_str()) {
        *last_notified = Some(info.version.clone());
        let how = if mode == Mode::On {
            "It will be installed when the agent is idle."
        } else {
            "To update: neoleaf-agent update (or from the tray icon)."
        };
        notify(
            "NeoLeaf: agent update",
            &format!(
                "New version of the local agent: {version} → {}. {how}",
                info.version
            ),
        );
    }
    Ok(Some(info))
}

/// Background loop: first check shortly after starting, then every 6 h.
pub fn spawn(
    port: u16,
    home: std::path::PathBuf,
    config: std::path::PathBuf,
    site: String,
    version: &'static str,
    idle: Box<dyn Fn() -> bool + Send>,
    notify: fn(&str, &str),
) {
    let _ = CTX.set((site.clone(), version));
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(env_secs(
            "NEOLEAF_UPDATE_FIRST_SECS",
            30,
        )));
        let mut last = None;
        loop {
            if let Err(e) = check_once(
                (&home, &config),
                (&site, version),
                &*idle,
                &notify,
                &mut last,
                port,
            ) {
                eprintln!("Update check: {e}");
            }
            std::thread::sleep(Duration::from_secs(env_secs(
                "NEOLEAF_UPDATE_INTERVAL_SECS",
                6 * 3600,
            )));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "nl-upd-{}-{}",
            std::process::id(),
            rand::random::<u32>()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn default_mode_is_notify_and_persists() {
        let d = tmp();
        assert_eq!(load_mode(&d), Mode::Notify);
        save_mode(&d, Mode::On).unwrap();
        assert_eq!(load_mode(&d), Mode::On);
        save_mode(&d, Mode::Off).unwrap();
        assert_eq!(load_mode(&d), Mode::Off);
        fs::write(d.join("settings.json"), "garbage").unwrap();
        assert_eq!(load_mode(&d), Mode::Notify);
    }

    #[test]
    fn mode_parsing() {
        assert_eq!(Mode::parse("ON"), Some(Mode::On));
        assert_eq!(Mode::parse("notify"), Some(Mode::Notify));
        assert_eq!(Mode::parse("off"), Some(Mode::Off));
        assert_eq!(Mode::parse("maybe"), None);
    }
}
