//! Actions started from the tray icon: update the agent and install TinyTeX in a terminal.

use crate::desktop::{applescript_str, notify, notify_info, session_env};
use crate::engines::{find_binary, search_dirs};
use crate::updater;
use std::process::{Command, Stdio};

/// Click on "Update the agent" in the tray: runs `neoleaf-agent update --yes` and reports the result.
pub(crate) static TRAY_UPDATING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub(crate) fn update_from_tray() {
    use std::sync::atomic::Ordering;
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    if TRAY_UPDATING.swap(true, Ordering::SeqCst) {
        return;
    }
    updater::set_status("");
    std::thread::spawn(move || {
        match Command::new(&exe)
            .args(["update", "--yes"])
            .stdin(Stdio::null())
            .output()
        {
            Ok(o) if o.status.success() => {
                let last = String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .last()
                    .unwrap_or("Updated.")
                    .to_string();
                updater::set_status(format!("Updated: {last}"));
                notify_info("NeoLeaf: agent updated", &last);
            }
            Ok(o) => {
                let last = String::from_utf8_lossy(&o.stderr)
                    .lines()
                    .last()
                    .unwrap_or("error")
                    .to_string();
                updater::set_status(format!("Update failed: {last}"));
                notify_info("NeoLeaf: agent update failed", &last);
            }
            Err(e) => {
                updater::set_status(format!("Update failed: {e}"));
                notify_info("NeoLeaf: agent update failed", &e.to_string());
            }
        }
        TRAY_UPDATING.store(false, Ordering::SeqCst);
    });
}

// ------------------------------------------------------------------ TinyTeX from the tray icon

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Opens a terminal running `neoleaf-agent install-tinytex`, so the user sees the question and the progress.
/// Without a graphical terminal, notifies which command to run.
pub(crate) fn install_tinytex_in_terminal() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let script = format!(
        "{} install-tinytex; echo; printf 'Press Enter to close...'; read -r _",
        shell_quote(&exe.display().to_string())
    );
    if cfg!(windows) {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let ok = Command::new("cmd")
                .raw_arg(format!(
                    "/c start \"NeoLeaf\" cmd /k \"\"{}\" install-tinytex\"",
                    exe.display()
                ))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success());
            if ok {
                return;
            }
        }
        notify(
            "NeoLeaf: install TinyTeX",
            &format!(
                "Open the Command Prompt and run: \"{}\" install-tinytex",
                exe.display()
            ),
        );
        return;
    }
    if cfg!(target_os = "macos") {
        let osa = format!(
            "tell application \"Terminal\"\nactivate\ndo script {}\nend tell",
            applescript_str(&script)
        );
        if Command::new("osascript")
            .args(["-e", &osa])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
        {
            return;
        }
        notify(
            "NeoLeaf: install TinyTeX",
            &format!(
                "Open the Terminal and run: {} install-tinytex",
                exe.display()
            ),
        );
        return;
    }
    // (program, arguments before the command)
    let mut candidates: Vec<(String, Vec<&str>)> = Vec::new();
    if let Ok(t) = std::env::var("TERMINAL")
        && !t.is_empty()
    {
        candidates.push((t, vec!["-e"]));
    }
    for (bin, args) in [
        ("x-terminal-emulator", vec!["-e"]),
        ("xdg-terminal-exec", vec![]),
        ("kgx", vec!["-e"]),
        ("gnome-terminal", vec!["--"]),
        ("ptyxis", vec!["--"]),
        ("konsole", vec!["-e"]),
        ("xfce4-terminal", vec!["-x"]),
        ("kitty", vec![]),
        ("alacritty", vec!["-e"]),
        ("foot", vec![]),
        ("wezterm", vec!["start", "--"]),
        ("xterm", vec!["-e"]),
    ] {
        candidates.push((bin.to_string(), args));
    }
    for (bin, args) in candidates {
        let Some(path) = find_binary(&bin).or_else(|| {
            search_dirs()
                .into_iter()
                .map(|d| d.join(&bin))
                .find(|p| p.is_file())
        }) else {
            continue;
        };
        let mut cmd = Command::new(path);
        cmd.args(&args)
            .args(["sh", "-c", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for (k, v) in session_env() {
            cmd.env(k, v);
        }
        if cmd.spawn().is_ok() {
            return;
        }
    }
    notify(
        "NeoLeaf: install TinyTeX",
        &format!(
            "Could not find a terminal. Open one and run:\n{} install-tinytex",
            exe.display()
        ),
    );
}

#[cfg(test)]
mod tests {
    use super::shell_quote;

    #[cfg(unix)]
    #[test]
    fn quotes_paths_for_sh() {
        assert_eq!(shell_quote("/home/ana/bin/agent"), "'/home/ana/bin/agent'");
        assert_eq!(
            shell_quote("/home/o'neil/agent"),
            "'/home/o'\\''neil/agent'"
        );
        let out = std::process::Command::new("sh")
            .args(["-c", &format!("printf %s {}", shell_quote("a b'c$d"))])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout), "a b'c$d");
    }
}
