//! neoleaf-agent: bridge between NeoLeaf (in the browser) and the LaTeX compilers on this machine.
//!
//! Listens only on 127.0.0.1, accepts only requests coming from NeoLeaf's address and requires a pairing code.
//!
//!   neoleaf-agent            runs the agent (shows the pairing code)
//!   neoleaf-agent code       generates a pairing code (5 min, single use)
//!   neoleaf-agent devices    lists the paired browsers
//!   neoleaf-agent revoke ID  revokes a browser (or "all")
//!   neoleaf-agent engines    lists the compilers found
//!   neoleaf-agent install-tinytex    installs TinyTeX (LaTeX) in ~/.TinyTeX, if there is no compiler
//!   neoleaf-agent uninstall-tinytex  removes ~/.TinyTeX
//!   neoleaf-agent install    installs (or updates) as a user service: copies to ~/.local/bin and restarts
//!   neoleaf-agent update     downloads the version published on the site (SHA-256 checked) and restarts the service
//!   neoleaf-agent status     shows version, service and whether it is running
//!   neoleaf-agent uninstall  removes the service

mod agent;
mod auth;
mod cli;
mod compile;
mod config;
mod desktop;
mod engines;
mod fonts;
mod http;
mod net;
mod packages;
mod pairing;
mod project;
mod service;
mod texlog;
mod tinytex;
mod tlmgr;
#[cfg_attr(target_os = "linux", path = "tray.rs")]
#[cfg_attr(windows, path = "tray_win.rs")]
#[cfg_attr(not(any(target_os = "linux", windows)), path = "tray_stub.rs")]
mod tray;
mod tray_actions;
mod tray_common;
mod updater;

fn main() {
    if cli::run() {
        return;
    }
    agent::run();
}
