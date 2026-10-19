//! Tray icon pieces shared by every system (Linux, Windows): images, status dot and menu text.
#![allow(dead_code)]

pub const ICON64: &[u8] = include_bytes!("../assets/icon64.argb");
pub const ICON32: &[u8] = include_bytes!("../assets/icon32.argb");

pub const RED: [u8; 3] = [0xE5, 0x48, 0x4D];
pub const GREEN: [u8; 3] = [0x30, 0xA4, 0x6C];

/// Paints a status dot in the bottom right corner of an ARGB pixmap (4 bytes per pixel, A R G B),
/// with a thin white outline so it shows on any background.
pub fn paint_dot(size: i32, data: &[u8], rgb: [u8; 3]) -> Vec<u8> {
    let mut out = data.to_vec();
    let s = size as f32;
    let r = s * 0.22;
    let (cx, cy) = (s - r - s * 0.03, s - r - s * 0.03);
    for y in 0..size {
        for x in 0..size {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let color = if d <= r - s * 0.05 {
                rgb
            } else if d <= r {
                [0xFF; 3]
            } else {
                continue;
            };
            let i = (y * size + x) as usize * 4;
            out[i..i + 4].copy_from_slice(&[0xFF, color[0], color[1], color[2]]);
        }
    }
    out
}

/// ARGB (A R G B per pixel) to RGBA (R G B A), as the Windows icon expects.
pub fn argb_to_rgba(argb: &[u8]) -> Vec<u8> {
    argb.as_chunks::<4>()
        .0
        .iter()
        .flat_map(|p| [p[1], p[2], p[3], p[0]])
        .collect()
}

/// Update status line in the menu: what is happening now, the new version or the last message.
pub fn update_line(
    updating: bool,
    checking: bool,
    update: &Option<String>,
    status: &str,
) -> String {
    if updating {
        "Updating the agent...".to_string()
    } else if checking {
        "Checking for updates...".to_string()
    } else if let Some(v) = update {
        format!("Update available: version {v}")
    } else {
        status.to_string()
    }
}

/// Cuts the text to fit in the menu (tray menus hide the excess with "...").
pub fn shorten(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!(
            "{}…",
            s.chars()
                .take(max.saturating_sub(1))
                .collect::<String>()
                .trim_end()
        )
    }
}

/// First menu line: state and port, short.
pub fn run_line(busy: bool, port: u16) -> String {
    format!(
        "{} · port {}",
        if busy {
            "Compiling..."
        } else {
            "Agent running"
        },
        port
    )
}

/// Version line, already with the update state (a single line, instead of two long ones).
pub fn version_line(
    version: &str,
    updating: bool,
    checking: bool,
    update: &Option<String>,
    status: &str,
) -> String {
    if updating {
        format!("Version {version} · updating...")
    } else if checking {
        format!("Version {version} · checking...")
    } else if let Some(v) = update {
        format!("Version {version} · new: {v}")
    } else if status.contains("latest version") {
        format!("Version {version} · up to date")
    } else {
        format!("Version {version}")
    }
}

/// Extra message from the checker (for example, a network error), cut short; empty when the version line already says it all.
pub fn status_extra(
    updating: bool,
    checking: bool,
    update: &Option<String>,
    status: &str,
) -> String {
    if updating
        || checking
        || update.is_some()
        || status.is_empty()
        || status.contains("latest version")
    {
        String::new()
    } else {
        shorten(status, 40)
    }
}

/// Title of the compilers item (the full list goes in a submenu).
pub fn engines_title(engines: &[String]) -> String {
    if engines.is_empty() {
        "Compilers: none found".to_string()
    } else {
        format!("Compilers ({})", engines.len())
    }
}

/// Icon tooltip: compilation state, port and, if any, the available update.
pub fn tooltip_text(busy: bool, port: u16, update: &Option<String>) -> String {
    format!(
        "{} (127.0.0.1:{}){}",
        if busy { "Compiling..." } else { "Idle" },
        port,
        update
            .as_ref()
            .map(|v| format!(" · Update available: {v}"))
            .unwrap_or_default()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dot_paints_only_the_corner_and_keeps_the_size() {
        let base = vec![0x80u8; 64 * 64 * 4];
        let out = paint_dot(64, &base, RED);
        assert_eq!(out.len(), base.len());
        let px = |x: usize, y: usize| &out[(y * 64 + x) * 4..(y * 64 + x) * 4 + 4];
        let r = 64.0 * 0.22;
        let c = (64.0 - r - 64.0 * 0.03) as usize;
        assert_eq!(px(c, c), &[0xFF, RED[0], RED[1], RED[2]]);
        assert_eq!(px(5, 5), &[0x80; 4], "nothing changes outside the dot");
        assert_eq!(
            paint_dot(32, &vec![0; 32 * 32 * 4], GREEN)[(27 * 32 + 27) * 4 + 2],
            GREEN[1]
        );
    }

    #[test]
    fn argb_becomes_rgba() {
        assert_eq!(
            argb_to_rgba(&[0xFF, 1, 2, 3, 0x80, 4, 5, 6]),
            vec![1, 2, 3, 0xFF, 4, 5, 6, 0x80]
        );
    }

    #[test]
    fn update_line_follows_priority() {
        let v = Some("0.4.6".to_string());
        assert_eq!(update_line(true, true, &v, "x"), "Updating the agent...");
        assert_eq!(update_line(false, true, &v, "x"), "Checking for updates...");
        assert_eq!(
            update_line(false, false, &v, "x"),
            "Update available: version 0.4.6"
        );
        assert_eq!(
            update_line(false, false, &None, "You are on the latest version (0.4.5)"),
            "You are on the latest version (0.4.5)"
        );
        assert_eq!(update_line(false, false, &None, ""), "");
    }

    #[test]
    fn menu_lines_are_short() {
        assert_eq!(run_line(false, 47474), "Agent running · port 47474");
        assert_eq!(run_line(true, 1), "Compiling... · port 1");
        let none: Option<String> = None;
        assert_eq!(
            version_line(
                "0.4.8",
                false,
                false,
                &none,
                "You are on the latest version (0.4.8)"
            ),
            "Version 0.4.8 · up to date"
        );
        assert_eq!(
            version_line("0.4.8", false, false, &Some("0.4.9".into()), ""),
            "Version 0.4.8 · new: 0.4.9"
        );
        assert_eq!(
            version_line("0.4.8", true, false, &none, ""),
            "Version 0.4.8 · updating..."
        );
        assert_eq!(
            version_line("0.4.8", false, true, &none, ""),
            "Version 0.4.8 · checking..."
        );
        assert_eq!(
            version_line("0.4.8", false, false, &none, ""),
            "Version 0.4.8"
        );
        // what does not fit is cut; messages the version line already covers are not repeated
        assert_eq!(
            status_extra(false, false, &none, "You are on the latest version (0.4.8)"),
            ""
        );
        assert_eq!(status_extra(false, false, &none, ""), "");
        assert!(
            status_extra(false, false, &none, &"network error ".repeat(10))
                .chars()
                .count()
                <= 40
        );
        assert_eq!(shorten("short", 10), "short");
        assert_eq!(shorten("abcdefghij", 5), "abcd…");
        assert_eq!(engines_title(&[]), "Compilers: none found");
        assert_eq!(
            engines_title(&["pdfLaTeX".into(), "XeLaTeX".into()]),
            "Compilers (2)"
        );
    }

    #[test]
    fn tooltip_shows_state_port_and_update() {
        assert_eq!(tooltip_text(false, 47474, &None), "Idle (127.0.0.1:47474)");
        assert_eq!(
            tooltip_text(true, 1, &Some("0.5.0".into())),
            "Compiling... (127.0.0.1:1) · Update available: 0.5.0"
        );
    }
}
