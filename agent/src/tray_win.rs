//! Windows notification area (tray) icon: shows that the agent is running (red dot compiling, green idle)
//! and gives a quick menu: version and update, check for updates, update, open NeoLeaf and quit.
//!
//! On Windows the agent runs in the user's session (Run key) and without a console window, so it can have an icon. The icon needs a
//! Windows message loop on the same thread that created it; it runs here, together with the state check every second.
//! Tested on a real Windows 10 LTSC (see tools/windows-vm/): icon, menu, check for updates and open NeoLeaf work.

use std::os::windows::process::CommandExt;
use std::time::{Duration, Instant};

use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIconBuilder};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, MSG, PM_REMOVE, PeekMessageW, TranslateMessage,
};

use crate::tray_common::{
    GREEN, ICON32, RED, argb_to_rgba, paint_dot, run_line, tooltip_text, version_line,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone)]
#[allow(dead_code)] // engines, detect, on_copy_code and on_install_tinytex come in when the menu gets the Linux items
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

fn status_icon(busy: bool) -> Option<Icon> {
    let argb = paint_dot(32, ICON32, if busy { RED } else { GREEN });
    Icon::from_rgba(argb_to_rgba(&argb), 32, 32).ok()
}

/// Opens the address in the default browser, without opening a console window.
fn open_url(url: &str) {
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

/// Handles the Windows messages that arrived for this thread (clicks on the icon and the menu).
fn pump_messages() {
    // SAFETY: MSG is a plain structure filled in by PeekMessageW itself; the calls are those of the standard message loop.
    unsafe {
        let mut msg: MSG = std::mem::zeroed();
        while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

/// Shows the icon. Returns true if the icon thread was started (if Windows refuses the icon, the agent carries on without it).
pub fn start(tray: AgentTray) -> bool {
    std::thread::spawn(move || run(tray));
    true
}

fn run(mut st: AgentTray) {
    let info = MenuItem::new(run_line(false, st.port), false, None);
    let ver = MenuItem::new(
        version_line(st.version, false, false, &None, ""),
        false,
        None,
    );
    let upd = MenuItem::new("Update the agent", false, None);
    let check = MenuItem::new("Check for updates", true, None);
    let open = MenuItem::new("Open NeoLeaf", true, None);
    let quit = MenuItem::new("Quit", true, None);
    let menu = Menu::new();
    let sep = PredefinedMenuItem::separator();
    let sep2 = PredefinedMenuItem::separator();
    if menu
        .append_items(&[&info, &ver, &sep, &upd, &check, &open, &sep2, &quit])
        .is_err()
    {
        eprintln!("Tray icon: could not build the menu");
        return;
    }
    let mut builder = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_menu_on_left_click(true)
        .with_tooltip(tooltip_text(false, st.port, &None));
    if let Some(icon) = status_icon(false) {
        builder = builder.with_icon(icon);
    }
    let tray = match builder.build() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Tray icon unavailable: {e}");
            return;
        }
    };
    println!("System tray icon: active.");

    let (open_id, quit_id, check_id, upd_id) = (
        open.id().clone(),
        quit.id().clone(),
        check.id().clone(),
        upd.id().clone(),
    );
    let mut last_poll = Instant::now() - Duration::from_secs(5);
    loop {
        pump_messages();
        while let Ok(ev) = MenuEvent::receiver().try_recv() {
            if ev.id == open_id {
                open_url(&st.site);
            } else if ev.id == quit_id {
                std::process::exit(0);
            } else if ev.id == check_id {
                st.checking = true;
                (st.on_check)();
            } else if ev.id == upd_id {
                st.updating = true;
                (st.on_update)();
            }
        }
        if last_poll.elapsed() >= Duration::from_secs(1) {
            last_poll = Instant::now();
            let (busy, update, status, checking, updating) = (
                (st.is_busy)(),
                (st.check_update)(),
                (st.get_status)(),
                (st.is_checking)(),
                (st.is_updating)(),
            );
            if busy != st.busy {
                st.busy = busy;
                if let Some(icon) = status_icon(busy) {
                    let _ = tray.set_icon(Some(icon));
                }
            }
            if update != st.update
                || status != st.status
                || checking != st.checking
                || updating != st.updating
                || busy != st.busy
            {
                st.update = update;
                st.status = status;
                st.checking = checking;
                st.updating = updating;
                let _ = tray.set_tooltip(Some(tooltip_text(st.busy, st.port, &st.update)));
                info.set_text(run_line(st.busy, st.port));
                ver.set_text(version_line(
                    st.version,
                    st.updating,
                    st.checking,
                    &st.update,
                    &st.status,
                ));
                upd.set_text(match (&st.update, st.updating) {
                    (_, true) => "Updating...".to_string(),
                    (Some(v), _) => format!("Update the agent to version {v}"),
                    (None, _) => "Update the agent".to_string(),
                });
                upd.set_enabled(st.update.is_some() && !st.updating);
                check.set_text(if st.checking {
                    "Checking..."
                } else {
                    "Check for updates"
                });
                check.set_enabled(!st.checking && !st.updating);
            }
        }
        std::thread::sleep(Duration::from_millis(40));
    }
}
