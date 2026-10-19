//! Starts the agent: HTTP server, system tray icon and the update checker.

use crate::config::{DEFAULT_ORIGINS, VERSION, config_dir, home, port};
use crate::desktop::{copy_to_clipboard, notify, notify_info};
use crate::engines::detect_engines;
use crate::http::{COMPILING, State, handle};
use crate::tray_actions::{TRAY_UPDATING, install_tinytex_in_terminal, update_from_tray};
use crate::{auth, tray, updater};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tiny_http::Server;

/// Runs the agent until the process ends.
pub(crate) fn run() {
    let port = port();
    let mut origins: Vec<String> = DEFAULT_ORIGINS.iter().map(|s| s.to_string()).collect();
    if let Ok(extra) = std::env::var("NEOLEAF_ORIGINS") {
        origins.extend(
            extra
                .split(',')
                .map(|s| s.trim().trim_end_matches('/').to_string())
                .filter(|s| !s.is_empty()),
        );
    }
    let server = match Server::http(("127.0.0.1", port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Could not listen on 127.0.0.1:{port}: {e} (is the agent already running?)");
            std::process::exit(1);
        }
    };
    println!("neoleaf-agent {VERSION} at http://127.0.0.1:{port}");
    println!(
        "To pair a browser: it asks for the code on the first compilation (or run: neoleaf-agent code)."
    );
    let engines = detect_engines();
    if engines.is_empty() {
        println!("No compiler found (latexmk + pdflatex/xelatex/lualatex, tectonic or ConTeXt).");
    }
    for e in &engines {
        println!("  {:8} {}", e.name, e.version);
    }
    if !std::env::args().any(|a| a == "--no-tray") {
        let site =
            std::env::var("NEOLEAF_SITE").unwrap_or_else(|_| "https://neoleaf.science".to_string());
        let ok = tray::start(tray::AgentTray {
            port,
            engines: engines.iter().map(|e| e.name.to_string()).collect(),
            site,
            on_install_tinytex: install_tinytex_in_terminal,
            detect: || {
                detect_engines()
                    .iter()
                    .map(|e| e.name.to_string())
                    .collect()
            },
            update: updater::available(),
            on_update: update_from_tray,
            check_update: updater::available,
            is_busy: || COMPILING.load(std::sync::atomic::Ordering::Relaxed) > 0,
            busy: false,
            version: VERSION,
            on_check: updater::check_now,
            is_checking: updater::is_checking,
            is_updating: || TRAY_UPDATING.load(std::sync::atomic::Ordering::Relaxed),
            get_status: updater::status,
            status: String::new(),
            checking: false,
            updating: false,
            on_copy_code: || {
                let code = auth::create_pending(&config_dir());
                let copied = copy_to_clipboard(&code);
                notify(
                    "NeoLeaf: pairing code",
                    &format!(
                        "Code: {code}{}",
                        if copied {
                            "\nCopied to the clipboard (Ctrl+V)."
                        } else {
                            ""
                        }
                    ),
                );
            },
        });
        println!(
            "{}",
            if ok {
                "System tray icon: active."
            } else {
                "System tray unavailable right now: the agent carries on and tries to show the icon again in the background."
            }
        );
    }
    let state = Arc::new(State {
        origins,
        busy: Mutex::new(HashMap::new()),
    });
    {
        let st = state.clone();
        let site =
            std::env::var("NEOLEAF_SITE").unwrap_or_else(|_| "https://neoleaf.science".to_string());
        updater::spawn(
            port,
            home(),
            config_dir(),
            site,
            VERSION,
            Box::new(move || st.busy.lock().map(|b| b.is_empty()).unwrap_or(false)),
            notify_info,
        );
    }
    for req in server.incoming_requests() {
        let state = state.clone();
        std::thread::spawn(move || handle(&state, req));
    }
}
