/// GitHub topic (the "#deleted tag") that marks a project as trashed.
pub const DELETED_TOPIC: &str = "deleted";
const TRASH_MARK: &str = "-deleted-";

/// Name of the repository in the trash: `my-paper` + `2026-10-09T03:15:00Z` -> `my-paper-deleted-20261009-031500`
/// (GitHub limits the name to 100 characters: whatever exceeds it is cut from the original name).
pub fn trashed_name(repo: &str, iso: &str) -> String {
    let digits: String = iso.chars().filter(|c| c.is_ascii_digit()).collect();
    let stamp = if digits.len() >= 14 {
        format!("{}-{}", &digits[..8], &digits[8..14])
    } else {
        "00000000-000000".to_string()
    };
    let suffix = format!("{TRASH_MARK}{stamp}");
    let base: String = repo
        .chars()
        .take(100usize.saturating_sub(suffix.len()))
        .collect();
    format!("{base}{suffix}")
}

/// Inverse of `trashed_name`: (original name, when it was deleted in ISO) if the name has the trash suffix.
pub fn parse_trashed(name: &str) -> Option<(String, String)> {
    let idx = name.rfind(TRASH_MARK)?;
    let (base, stamp) = (&name[..idx], &name[idx + TRASH_MARK.len()..]);
    let b = stamp.as_bytes();
    if base.is_empty()
        || b.len() != 15
        || b[8] != b'-'
        || !b
            .iter()
            .enumerate()
            .all(|(i, c)| i == 8 || c.is_ascii_digit())
    {
        return None;
    }
    let n = |r: std::ops::Range<usize>| stamp[r].parse::<u32>().unwrap_or(99);
    let (mo, d, h, mi, se) = (n(4..6), n(6..8), n(9..11), n(11..13), n(13..15));
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 59 {
        return None;
    }
    Some((
        base.to_string(),
        format!(
            "{}-{}-{}T{}:{}:{}Z",
            &stamp[0..4],
            &stamp[4..6],
            &stamp[6..8],
            &stamp[9..11],
            &stamp[11..13],
            &stamp[13..15]
        ),
    ))
}

pub fn display_name(name: &str) -> String {
    let mut n = name.trim();
    if let Some(rest) = n.strip_prefix("[neoleaf]") {
        n = rest.trim();
    } else if let Some(rest) = n.strip_prefix("[NeoLeaf]") {
        n = rest.trim();
    }
    if let Some(rest) = n.strip_suffix("[neoleaf]") {
        n = rest.trim();
    } else if let Some(rest) = n.strip_suffix("[NeoLeaf]") {
        n = rest.trim();
    }
    if let Some(rest) = n.strip_suffix("-neoleaf") {
        n = rest.trim();
    }
    if n.is_empty() {
        name.to_string()
    } else {
        n.to_string()
    }
}

/// `owner__repo` -> `owner/repo`. Only the FIRST `__` separates (a GitHub login has no `_`; the repository name may contain `__`).
pub fn repo_full_name(project_id: &str) -> String {
    match project_id.split_once("__") {
        Some((owner, repo)) => format!("{owner}/{repo}"),
        None => project_id.to_string(),
    }
}

pub fn decode_id(id: &str) -> (String, String) {
    use base64::Engine;
    if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(id.as_bytes())
        && let Ok(s) = String::from_utf8(bytes)
        && let Some((pid, path)) = s.split_once("::")
    {
        return (pid.to_string(), path.to_string());
    }
    if let Some((pid, path)) = id.split_once("::") {
        return (pid.to_string(), path.to_string());
    }
    (id.to_string(), String::new())
}

/// Deletes, without notice, the project copies from when the server stored them: the project lives in the browser and on the
/// person's GitHub, and the server stores nothing of it.
pub fn purge_legacy_workspace() {
    let base = match std::env::var("NEOLEAF_WORKSPACE_DIR") {
        Ok(dir) => std::path::PathBuf::from(dir),
        Err(_) => {
            std::path::PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string()))
                .join(".cache")
                .join("neoleaf")
                .join("repos")
        }
    };
    let Ok(rd) = std::fs::read_dir(&base) else {
        return;
    };
    for e in rd.flatten() {
        let _ = if e.path().is_dir() {
            std::fs::remove_dir_all(e.path())
        } else {
            std::fs::remove_file(e.path())
        };
    }
}

/// Cleans the typed tags (lowercase, no accents, only letters, digits and hyphen) and ensures the `neoleaf` tag.
pub fn sanitize_topics(raw_topics: Vec<String>) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    // Always keep the 'neoleaf' tag so the project stays visible on the dashboard
    names.push("neoleaf".to_string());

    let strip_accent = |c: char| -> char {
        match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
            'ç' | 'Ç' => 'c',
            'ñ' | 'Ñ' => 'n',
            other => other,
        }
    };

    for t in raw_topics {
        let sanitized: String = t
            .trim()
            .chars()
            .map(strip_accent)
            .map(|c| c.to_ascii_lowercase())
            .filter_map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    Some(c)
                } else if c == ' ' || c == '_' {
                    Some('-')
                } else {
                    None
                }
            })
            .collect();
        let trimmed = sanitized.trim_matches('-').to_string();
        if !trimmed.is_empty() && trimmed.len() <= 35 && !names.contains(&trimmed) {
            names.push(trimmed);
        }
    }

    if names.len() > 20 {
        names.truncate(20);
    }
    names
}

pub fn iso_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso_from_unix(secs)
}

/// Converts Unix seconds to `YYYY-MM-DDTHH:MM:SSZ` (civil_from_days algorithm, no dependencies).
pub fn iso_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitiza_e_preserva_topico_neoleaf() {
        let raw = vec![
            "Scientific Article".to_string(),
            "latex".to_string(),
            "--2026--".to_string(),
            "tag_com_underline".to_string(),
        ];
        let res = sanitize_topics(raw);
        assert!(res.contains(&"neoleaf".to_string()));
        assert!(res.contains(&"scientific-article".to_string()));
        assert!(res.contains(&"latex".to_string()));
        assert!(res.contains(&"2026".to_string()));
        assert!(res.contains(&"tag-com-underline".to_string()));
    }

    #[test]
    fn trash_name_and_its_inverse() {
        let n = trashed_name("my-paper", "2026-10-09T03:15:07Z");
        assert_eq!(n, "my-paper-deleted-20261009-031507");
        assert_eq!(
            parse_trashed(&n),
            Some(("my-paper".to_string(), "2026-10-09T03:15:07Z".to_string()))
        );
    }

    #[test]
    fn project_id_only_splits_at_the_first_double_underscore() {
        assert_eq!(repo_full_name("ana__my-paper"), "ana/my-paper");
        assert_eq!(repo_full_name("ana__tese___x__y"), "ana/tese___x__y");
        assert_eq!(repo_full_name("semdono"), "semdono");
    }

    #[test]
    fn ordinary_names_are_not_trash() {
        for n in [
            "my-paper",
            "deleted",
            "x-deleted-",
            "x-deleted-2026",
            "-deleted-20261009-031507",
            "a-deleted-20261309-031507",
            "a-deleted-20261009-251507",
            "a-deleted-2026100x-031507",
        ] {
            assert!(parse_trashed(n).is_none(), "{n}");
        }
    }

    #[test]
    fn suffix_within_the_100_character_limit() {
        let long_name = "a".repeat(120);
        let n = trashed_name(&long_name, "2026-10-09T03:15:07Z");
        assert_eq!(n.chars().count(), 100);
        assert!(parse_trashed(&n).is_some());
    }

    #[test]
    fn deleting_twice_accumulates_the_suffix_but_restores_one_level() {
        let a = trashed_name("proj", "2026-10-09T03:15:07Z");
        let (orig, _) = parse_trashed(&a).unwrap();
        assert_eq!(orig, "proj");
        // a project whose original name already ends like this is still restored to the right name
        let b = trashed_name(&a, "2026-10-10T00:00:00Z");
        assert_eq!(parse_trashed(&b).unwrap().0, a);
    }
}
