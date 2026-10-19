//! Command line subcommands (code, devices, revoke, engines, install, update, ...).

use crate::auth;
use crate::config::{VERSION, config_dir, home, port};
use crate::engines::detect_engines;
use crate::{service, tinytex, updater};

/// Runs the subcommand named by the first argument. Returns false when there is none (the agent itself should run).
pub(crate) fn run() -> bool {
    let arg = std::env::args().nth(1).unwrap_or_default();
    match arg.as_str() {
        "code" => {
            println!(
                "{}\n(valid for {} minutes and can only be used once)",
                auth::create_pending(&config_dir()),
                auth::CODE_TTL / 60
            );
            return true;
        }
        "devices" => {
            let (list, legacy) = auth::list(&config_dir());
            if list.is_empty() && !legacy {
                println!("No paired browsers.");
            }
            if legacy {
                println!(
                    "{:10} {:24} old permanent code (revoke with: neoleaf-agent revoke legacy)",
                    "legacy", "-"
                );
            }
            for d in list {
                println!(
                    "{:10} {:24} paired {} days ago, last used {} days ago",
                    d.id,
                    d.label,
                    auth::now().saturating_sub(d.created) / 86400,
                    auth::now().saturating_sub(d.last_used) / 86400
                );
            }
            return true;
        }
        "revoke" => {
            let target = std::env::args().nth(2).unwrap_or_default();
            if target.is_empty() {
                eprintln!("usage: neoleaf-agent revoke <id|legacy|all>");
                return true;
            }
            let n = if target == "all" {
                auth::revoke_all(&config_dir())
            } else {
                auth::revoke(&config_dir(), &target)
            };
            println!("{n} access(es) revoked.");
            return true;
        }
        "engines" => {
            let list = detect_engines();
            if list.is_empty() {
                println!(
                    "No compiler found (needs latexmk + pdflatex/xelatex/lualatex, tectonic or ConTeXt)."
                );
            }
            for e in list {
                println!("{:16} {:10} {}", e.id, e.name, e.version);
            }
            return true;
        }
        "install-tinytex" => {
            let yes = std::env::args().any(|a| a == "--yes" || a == "-y");
            if let Err(e) = tinytex::install(&home(), yes, &|| {
                detect_engines()
                    .iter()
                    .map(|e| e.name.to_string())
                    .collect()
            }) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
            return true;
        }
        "uninstall-tinytex" => {
            let yes = std::env::args().any(|a| a == "--yes" || a == "-y");
            if let Err(e) = tinytex::uninstall(&home(), yes) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
            return true;
        }
        // used by Windows startup: starts the agent without a console window and exits
        "launch" => {
            if let Err(e) = service::spawn_background(&std::env::current_exe().unwrap_or_default())
            {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
            return true;
        }
        "-V" | "--version" | "version" => {
            println!("neoleaf-agent {VERSION}");
            return true;
        }
        "install" => {
            if let Err(e) = service::install(&home(), port(), VERSION) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
            return true;
        }
        "update" => {
            let yes = std::env::args().any(|a| a == "--yes" || a == "-y");
            let site = std::env::var("NEOLEAF_SITE")
                .unwrap_or_else(|_| "https://neoleaf.science".to_string());
            if let Err(e) = service::update(&home(), &site, VERSION, yes, port()) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
            return true;
        }
        "auto-update" => {
            match std::env::args().nth(2) {
                None => println!(
                    "Automatic update: {} (off = does not query; notify = only notifies; on = installs by itself)",
                    updater::load_mode(&config_dir()).name()
                ),
                Some(m) => match updater::Mode::parse(&m) {
                    Some(mode) => match updater::save_mode(&config_dir(), mode) {
                        Ok(()) => println!(
                            "Automatic update: {} (takes effect from the agent's next start; restart the service if it is running)",
                            mode.name()
                        ),
                        Err(e) => {
                            eprintln!("Error: {e}");
                            std::process::exit(1);
                        }
                    },
                    None => {
                        eprintln!("usage: neoleaf-agent auto-update [off|notify|on]");
                        std::process::exit(1);
                    }
                },
            }
            return true;
        }
        "rollback" => {
            if let Err(e) = service::rollback(&home()) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
            return true;
        }
        "status" => {
            service::status(&home(), port(), VERSION);
            println!(
                "Updates:        {}",
                updater::load_mode(&config_dir()).name()
            );
            return true;
        }
        "uninstall" => {
            let _ = service::uninstall(&home());
            println!("Service removed.");
            return true;
        }
        "-h" | "--help" | "help" => {
            println!(
                "neoleaf-agent [code|devices|revoke|engines|install-tinytex|uninstall-tinytex|install|update|auto-update|rollback|status|uninstall|--version]\nWithout an argument, it runs the agent on 127.0.0.1:{}.",
                port()
            );
            return true;
        }
        _ => {}
    }
    false
}
