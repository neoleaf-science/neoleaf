//! System tray icon (StatusNotifierItem): shows that the agent is running and gives a quick menu.
//! Works on KDE, GNOME (with the AppIndicator extension), Waybar, DankMaterialShell and others that have a tray.
//! If there is no tray, the agent keeps working normally.

use ksni::{
    Icon, MenuItem, ToolTip,
    menu::{StandardItem, SubMenu},
};

use crate::tray_common::{
    GREEN, ICON32, ICON64, RED, engines_title, paint_dot, run_line, status_extra, tooltip_text,
    version_line,
};

#[derive(Clone)]
pub struct AgentTray {
    pub port: u16,
    pub engines: Vec<String>,
    pub site: String,
    pub on_copy_code: fn(),
    pub on_install_tinytex: fn(),
    /// names of the compilers found right now (the menu updates itself after installing TinyTeX)
    pub detect: fn() -> Vec<String>,
    /// new version available (None if there is none), from the update checker
    pub update: Option<String>,
    pub on_update: fn(),
    pub check_update: fn() -> Option<String>,
    /// true while some compilation is running (red dot; green when idle)
    pub is_busy: fn() -> bool,
    pub busy: bool,
    pub version: &'static str,
    /// "Check for updates": queries the site now
    pub on_check: fn(),
    pub is_checking: fn() -> bool,
    pub is_updating: fn() -> bool,
    /// short message with the result of the check or of the update
    pub get_status: fn() -> String,
    pub status: String,
    pub checking: bool,
    pub updating: bool,
}

fn icon(size: i32, data: &[u8], busy: bool) -> Icon {
    Icon {
        width: size,
        height: size,
        data: paint_dot(size, data, if busy { RED } else { GREEN }),
    }
}

impl ksni::Tray for AgentTray {
    /// the left click also opens the menu (by default only the right one did)
    const MENU_ON_ACTIVATE: bool = true;

    fn id(&self) -> String {
        "neoleaf-agent".into()
    }
    fn title(&self) -> String {
        "NeoLeaf local agent".into()
    }
    fn category(&self) -> ksni::Category {
        ksni::Category::ApplicationStatus
    }
    fn icon_pixmap(&self) -> Vec<Icon> {
        vec![icon(64, ICON64, self.busy), icon(32, ICON32, self.busy)]
    }
    fn tool_tip(&self) -> ToolTip {
        ToolTip {
            title: "NeoLeaf local agent".into(),
            description: tooltip_text(self.busy, self.port, &self.update),
            icon_name: String::new(),
            icon_pixmap: vec![],
        }
    }
    fn menu(&self) -> Vec<MenuItem<Self>> {
        // short lines: tray menus cut long text with "..."; the compilers list goes in a submenu
        let extra = status_extra(self.updating, self.checking, &self.update, &self.status);
        let engines: Vec<MenuItem<Self>> = if self.engines.is_empty() {
            vec![
                StandardItem {
                    label: "No LaTeX compiler found".into(),
                    enabled: false,
                    ..Default::default()
                }
                .into(),
            ]
        } else {
            self.engines
                .iter()
                .map(|e| {
                    StandardItem {
                        label: e.clone(),
                        enabled: false,
                        ..Default::default()
                    }
                    .into()
                })
                .collect()
        };
        vec![
            StandardItem {
                label: run_line(self.busy, self.port),
                enabled: false,
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: version_line(
                    self.version,
                    self.updating,
                    self.checking,
                    &self.update,
                    &self.status,
                ),
                enabled: false,
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: extra.clone(),
                enabled: false,
                visible: !extra.is_empty(),
                ..Default::default()
            }
            .into(),
            SubMenu {
                label: engines_title(&self.engines),
                submenu: engines,
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: if self.updating {
                    "Updating...".to_string()
                } else {
                    format!(
                        "Update the agent to version {}",
                        self.update.clone().unwrap_or_default()
                    )
                },
                visible: self.update.is_some() || self.updating,
                enabled: !self.updating,
                activate: Box::new(|t: &mut Self| {
                    t.updating = true; // the menu already shows "Updating..." before the next cycle
                    (t.on_update)()
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: if self.checking {
                    "Checking...".to_string()
                } else {
                    "Check for updates".to_string()
                },
                enabled: !self.checking && !self.updating,
                activate: Box::new(|t: &mut Self| {
                    t.checking = true;
                    (t.on_check)()
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Install TinyTeX (LaTeX)...".into(),
                visible: self.engines.is_empty(),
                activate: Box::new(|t: &mut Self| (t.on_install_tinytex)()),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Copy pairing code".into(),
                activate: Box::new(|t: &mut Self| (t.on_copy_code)()),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Open NeoLeaf".into(),
                activate: Box::new(|t: &mut Self| {
                    let _ = std::process::Command::new("xdg-open")
                        .arg(&t.site)
                        .stdin(std::process::Stdio::null())
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .spawn();
                }),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "Quit".into(),
                activate: Box::new(|_| std::process::exit(0)),
                ..Default::default()
            }
            .into(),
        ]
    }
}

type TrayHandle = ksni::blocking::Handle<AgentTray>;

/// Creates the icon. `assume_sni_available`: if the tray (StatusNotifierWatcher) does not exist yet, as right after the computer boots and
/// the service starts before the panel, ksni waits for it to appear and registers the icon then, instead of giving up.
fn spawn_tray(t: AgentTray) -> Result<TrayHandle, ksni::Error> {
    use ksni::blocking::TrayMethods;
    t.assume_sni_available(true).spawn()
}

/// Is the icon in the tray? Asks the StatusNotifierWatcher which items are registered.
/// `Some(true)` present; `Some(false)` the tray exists and the icon is not in it; `None` could not tell
/// (no D-Bus bus or no tray right now: in that case recreating is pointless, ksni registers when it appears).
fn present_in_tray() -> Option<bool> {
    let conn = zbus::blocking::Connection::session().ok()?;
    let watcher = zbus::blocking::Proxy::new(
        &conn,
        "org.kde.StatusNotifierWatcher",
        "/StatusNotifierWatcher",
        "org.kde.StatusNotifierWatcher",
    )
    .ok()?;
    let items: Vec<String> = watcher.get_property("RegisteredStatusNotifierItems").ok()?;
    let mine = format!("StatusNotifierItem-{}-", std::process::id());
    Some(items.iter().any(|i| i.contains(&mine)))
}

/// Shows the icon and keeps it: recreates it if the tray only appeared later, and checks from time to time that it is still there.
/// Returns true if the icon was created now; false if it could not be (the agent keeps trying in the background).
pub fn start(tray: AgentTray) -> bool {
    let first = spawn_tray(tray.clone());
    let ok = first.is_ok();
    if let Err(e) = &first {
        eprintln!("Tray icon unavailable right now: {e} (the agent tries again every few seconds)");
    }
    std::thread::spawn(move || run(tray, first.ok()));
    ok
}

fn run(mut state: AgentTray, mut handle: Option<TrayHandle>) {
    let (detect, check_update, is_busy) = (state.detect, state.check_update, state.is_busy);
    let (get_status, is_checking, is_updating) =
        (state.get_status, state.is_checking, state.is_updating);
    let (mut ticks, mut missing) = (0u32, 0u32);
    // how often to check that the icon is in the tray (default 20 s; tests use less)
    let check_every: u32 = std::env::var("NEOLEAF_TRAY_CHECK_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|v| *v > 0)
        .unwrap_or(20);
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        ticks += 1;

        // still no icon (D-Bus or the tray were not ready): try again every 5 s
        if handle.is_none() {
            if ticks % 5 == 0
                && let Ok(h) = spawn_tray(state.clone())
            {
                println!("System tray icon: active.");
                handle = Some(h);
            }
            continue;
        }

        // agent state (cheap: only reads variables): changes the icon, the menu and the tooltip right away
        let (busy, upd, status, checking, updating) = (
            is_busy(),
            check_update(),
            get_status(),
            is_checking(),
            is_updating(),
        );
        if busy != state.busy
            || upd != state.update
            || status != state.status
            || checking != state.checking
            || updating != state.updating
        {
            state.busy = busy;
            state.update = upd.clone();
            state.status = status.clone();
            state.checking = checking;
            state.updating = updating;
            if let Some(h) = &handle {
                h.update(move |t: &mut AgentTray| {
                    t.busy = busy;
                    t.update = upd;
                    t.status = status;
                    t.checking = checking;
                    t.updating = updating;
                });
            }
        }
        // the compilers list changes when the person installs TinyTeX
        if ticks % 15 == 0 {
            let names = detect();
            if names != state.engines {
                state.engines = names.clone();
                if let Some(h) = &handle {
                    h.update(move |t: &mut AgentTray| t.engines = names);
                }
            }
        }
        // check that the icon is really in the tray; if the tray exists and it is not (2 checks in a row), recreate it
        if ticks % check_every == 0 {
            match present_in_tray() {
                Some(false) => missing += 1,
                _ => missing = 0,
            }
            if missing >= 2 {
                missing = 0;
                println!("The icon was not in the tray: recreating it.");
                if let Some(old) = handle.take() {
                    old.shutdown().wait();
                }
                handle = spawn_tray(state.clone()).ok();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `PREVIEW_DIR=/path cargo test generate_previews -- --ignored` writes PNGs to look at the icons.
    #[test]
    #[ignore]
    fn generate_previews() {
        let dir = std::env::var("PREVIEW_DIR").unwrap();
        for (name, busy) in [("red", true), ("green", false)] {
            let ic = icon(64, ICON64, busy);
            let mut ppm = "P6\n64 64\n255\n".to_string().into_bytes();
            for p in ic.data.chunks(4) {
                let a = p[0] as u32;
                for c in &p[1..4] {
                    ppm.push(((*c as u32 * a + 0x30 * (255 - a)) / 255) as u8); // over a dark gray background
                }
            }
            std::fs::write(format!("{dir}/tray-{name}.ppm"), ppm).unwrap();
        }
    }
}
