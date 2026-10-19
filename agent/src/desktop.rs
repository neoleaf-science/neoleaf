//! Desktop integration: clipboard and notifications (pairing code, updates).

use crate::config::home;
use crate::engines::find_binary;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Graphical session variables. A systemd --user service may not have them; tries to find them from the sockets in /run/user.
pub(crate) fn session_env() -> Vec<(String, String)> {
    #[cfg(not(target_os = "linux"))]
    return Vec::new(); // macOS and Windows: clip, pbcopy and notifications work directly in the user's session
    #[cfg(target_os = "linux")]
    session_env_linux()
}

#[cfg(target_os = "linux")]
fn session_env_linux() -> Vec<(String, String)> {
    let uid = fs::metadata(home())
        .ok()
        .map(|m| {
            use std::os::unix::fs::MetadataExt;
            m.uid()
        })
        .unwrap_or(1000);
    let runtime = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| format!("/run/user/{uid}"));
    let mut env = vec![("XDG_RUNTIME_DIR".to_string(), runtime.clone())];
    if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none() {
        env.push((
            "DBUS_SESSION_BUS_ADDRESS".into(),
            format!("unix:path={runtime}/bus"),
        ));
    }
    if std::env::var_os("WAYLAND_DISPLAY").is_none()
        && let Some(sock) = fs::read_dir(&runtime).ok().and_then(|rd| {
            rd.flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.starts_with("wayland-") && !n.ends_with(".lock") && !n.contains('.'))
                .min()
        })
    {
        env.push(("WAYLAND_DISPLAY".into(), sock));
    }
    if std::env::var_os("DISPLAY").is_none() && Path::new("/tmp/.X11-unix/X0").exists() {
        env.push(("DISPLAY".into(), ":0".into()));
    }
    env
}

/// Copies the text to the clipboard (wl-copy on Wayland; xclip or xsel on X11).
pub(crate) fn copy_to_clipboard(text: &str) -> bool {
    let env = session_env();
    let attempts: &[(&str, &[&str])] = if cfg!(windows) {
        &[("clip", &[])]
    } else if cfg!(target_os = "macos") {
        &[("pbcopy", &[])]
    } else {
        &[
            ("wl-copy", &[]),
            ("xclip", &["-selection", "clipboard"]),
            ("xsel", &["--clipboard", "--input"]),
        ]
    };
    for &(bin, args) in attempts {
        let Some(path) = find_binary(bin) else {
            continue;
        };
        let child = Command::new(path)
            .args(args)
            .envs(env.iter().cloned())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        let Ok(mut child) = child else { continue };
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(text.as_bytes());
        }
        // the program keeps the selection in the background and the main process exits soon
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(st)) => {
                    if st.success() {
                        return true;
                    }
                    break;
                }
                Ok(None) if Instant::now() > deadline => {
                    return true;
                } // still holding the selection: it copied
                Ok(None) => std::thread::sleep(Duration::from_millis(40)),
                Err(_) => break,
            }
        }
    }
    false
}

/// Notification in the system notification area (notify-send; or gdbus, without depending on extra packages).
pub(crate) fn notify(title: &str, body: &str) -> bool {
    if cfg!(windows) {
        return win_notify(title, body);
    }
    if cfg!(target_os = "macos") {
        return mac_notify(title, body);
    }
    let env = session_env();
    if let Some(bin) = find_binary("notify-send") {
        let ok = Command::new(bin)
            .args([
                "-a",
                "NeoLeaf",
                "-i",
                "dialog-password",
                "-u",
                "critical",
                "-t",
                "120000",
                title,
                body,
            ])
            .envs(env.iter().cloned())
            .stdin(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return true;
        }
    }
    if let Some(bin) = find_binary("gdbus") {
        // GVariant as text: strings between single quotes
        let q = |s: &str| format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"));
        return Command::new(bin)
            .args([
                "call",
                "--session",
                "--dest",
                "org.freedesktop.Notifications",
                "--object-path",
                "/org/freedesktop/Notifications",
                "--method",
                "org.freedesktop.Notifications.Notify",
            ])
            .args([
                q("NeoLeaf"),
                "0".to_string(),
                q("dialog-password"),
                q(title),
                q(body),
                "[]".to_string(),
                "{}".to_string(),
                "120000".to_string(),
            ])
            .envs(env.iter().cloned())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    }
    false
}

/// AppleScript text literal (quotes and backslashes escaped; line breaks become spaces).
pub(crate) fn applescript_str(s: &str) -> String {
    format!(
        "\"{}\"",
        s.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace(['\n', '\r'], " ")
    )
}

/// macOS notification through osascript (appears as "Script Editor" in the Notification Center).
fn mac_notify(title: &str, body: &str) -> bool {
    let script = format!(
        "display notification {} with title {}",
        applescript_str(body),
        applescript_str(title)
    );
    Command::new("osascript")
        .args(["-e", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// PowerShell script that shows a Windows toast (title and text come through environment variables, with no quoting problems).
const WIN_TOAST: &str = "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; \
$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); \
$n = $x.GetElementsByTagName('text'); \
$n.Item(0).AppendChild($x.CreateTextNode($env:NL_TITLE)) | Out-Null; \
$n.Item(1).AppendChild($x.CreateTextNode($env:NL_BODY)) | Out-Null; \
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))";

/// Windows notification (toast) through the PowerShell that ships with the system.
fn win_notify(title: &str, body: &str) -> bool {
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            WIN_TOAST,
        ])
        .env("NL_TITLE", title)
        .env("NL_BODY", body)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Ordinary notice (not urgent): updates etc.
pub(crate) fn notify_info(title: &str, body: &str) {
    if cfg!(windows) {
        win_notify(title, body);
        return;
    }
    if cfg!(target_os = "macos") {
        mac_notify(title, body);
        return;
    }
    let env = session_env();
    if let Some(bin) = find_binary("notify-send") {
        let _ = Command::new(bin)
            .args([
                "-a",
                "NeoLeaf",
                "-i",
                "software-update-available",
                "-t",
                "30000",
                title,
                body,
            ])
            .envs(env.iter().cloned())
            .stdin(Stdio::null())
            .status();
    }
}
