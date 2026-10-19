//! Folders, port, version and the origins NeoLeaf is served from.

use std::path::PathBuf;

pub(crate) const DEFAULT_PORT: u16 = 47474;

pub(crate) fn port() -> u16 {
    std::env::var("NEOLEAF_AGENT_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}
pub(crate) const VERSION: &str = env!("CARGO_PKG_VERSION");
pub(crate) const DEFAULT_ORIGINS: [&str; 7] = [
    "https://neoleaf.science",
    "https://www.neoleaf.science",
    "https://neoleaf.duckdns.org",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3012",
    "http://127.0.0.1:3012",
];

pub(crate) fn home() -> PathBuf {
    if cfg!(windows) {
        return PathBuf::from(
            std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .unwrap_or_else(|| "C:\\".into()),
        );
    }
    PathBuf::from(std::env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
}

pub(crate) fn config_dir() -> PathBuf {
    let default = if cfg!(target_os = "macos") {
        home().join("Library/Application Support")
    } else if cfg!(windows) {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData/Roaming"))
    } else {
        home().join(".config")
    };
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or(default)
        .join("neoleaf-agent")
}

pub(crate) fn cache_dir() -> PathBuf {
    let default = if cfg!(target_os = "macos") {
        home().join("Library/Caches")
    } else if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData/Local"))
    } else {
        home().join(".cache")
    };
    std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .unwrap_or(default)
        .join("neoleaf-agent")
}
