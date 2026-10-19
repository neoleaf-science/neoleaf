//! Fonts of the installed TeX for XeLaTeX.
//!
//! XeTeX finds fonts by name (`\setmainfont{FontAwesome}`, `fontawesome.sty`...) through fontconfig, which only sees
//! the folders the configuration lists. TinyTeX ships a `texlive-fontconfig.conf` with paths from the machine that built
//! it (`/home/runner/.TinyTeX/...`), so TeX's own OTF/TTF fonts stay invisible. We generate a configuration that
//! includes the system one and adds this machine's TeX font folders.

use std::fs;
use std::path::{Path, PathBuf};

pub fn conf_text(dirs: &[PathBuf]) -> String {
    let esc = |p: &Path| {
        p.display()
            .to_string()
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
    let mut s = String::from(
        "<?xml version=\"1.0\"?>\n<!DOCTYPE fontconfig SYSTEM \"urn:fontconfig:fonts.dtd\">\n<fontconfig>\n  <include ignore_missing=\"yes\">/etc/fonts/fonts.conf</include>\n",
    );
    for d in dirs {
        s.push_str(&format!("  <dir>{}</dir>\n", esc(d)));
    }
    s.push_str("</fontconfig>\n");
    s
}

/// `fonts/opentype` and `fonts/truetype` folders that exist inside the given texmf trees.
pub fn font_dirs(trees: &[PathBuf]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for t in trees {
        for sub in ["fonts/opentype", "fonts/truetype"] {
            let d = t.join(sub);
            if d.is_dir() && !out.contains(&d) {
                out.push(d);
            }
        }
    }
    out
}

/// Writes the configuration to `target` (if it changed) and returns the path; None if there are no font folders to add.
pub fn write_conf(trees: &[PathBuf], target: &Path) -> Option<PathBuf> {
    let dirs = font_dirs(trees);
    if dirs.is_empty() {
        return None;
    }
    let text = conf_text(&dirs);
    if fs::read_to_string(target).ok().as_deref() != Some(text.as_str()) {
        fs::create_dir_all(target.parent()?).ok()?;
        fs::write(target, text).ok()?;
    }
    Some(target.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "nl-fonts-{}-{}",
            std::process::id(),
            rand::random::<u32>()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn conf_includes_system_config_and_dirs_escaped() {
        let t = conf_text(&[PathBuf::from("/a/b"), PathBuf::from("/x&y/<z>")]);
        assert!(t.contains("<include ignore_missing=\"yes\">/etc/fonts/fonts.conf</include>"));
        assert!(t.contains("<dir>/a/b</dir>") && t.contains("<dir>/x&amp;y/&lt;z&gt;</dir>"));
        assert!(t.trim_end().ends_with("</fontconfig>"));
    }

    #[test]
    fn only_existing_font_dirs_are_listed() {
        let root = tmp();
        fs::create_dir_all(root.join("a/fonts/opentype")).unwrap();
        fs::create_dir_all(root.join("b/fonts/type1")).unwrap();
        let dirs = font_dirs(&[root.join("a"), root.join("b"), root.join("does-not-exist")]);
        assert_eq!(dirs, vec![root.join("a/fonts/opentype")]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writes_conf_only_when_there_is_something_to_add() {
        let root = tmp();
        let target = root.join("cache/fonts.conf");
        assert!(write_conf(&[root.join("empty")], &target).is_none());
        fs::create_dir_all(root.join("t/fonts/truetype")).unwrap();
        assert_eq!(write_conf(&[root.join("t")], &target), Some(target.clone()));
        assert!(
            fs::read_to_string(&target)
                .unwrap()
                .contains("fonts/truetype")
        );
        let _ = fs::remove_dir_all(&root);
    }
}
