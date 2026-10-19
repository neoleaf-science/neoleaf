//! No tray icon outside Linux (on macOS the agent runs as a launchd service, without an icon).

#![allow(dead_code)]
pub struct AgentTray {
    pub port: u16,
    pub engines: Vec<String>,
    pub site: String,
    pub on_copy_code: fn(),
    pub on_install_tinytex: fn(),
    pub detect: fn() -> Vec<String>,
    pub update: Option<String>,
    pub on_update: fn(),
    pub check_update: fn() -> Option<String>,
    pub is_busy: fn() -> bool,
    pub busy: bool,
    pub version: &'static str,
    pub on_check: fn(),
    pub is_checking: fn() -> bool,
    pub is_updating: fn() -> bool,
    pub get_status: fn() -> String,
    pub status: String,
    pub checking: bool,
    pub updating: bool,
}

pub fn start(_tray: AgentTray) -> bool {
    false
}
