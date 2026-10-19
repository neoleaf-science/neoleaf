//! New project name (creation and import): the rest of the import happens in the browser (`static/js/project-import.js`).

/// Project name = GitHub repository name: 1 to 100 characters among letters (no accents), digits, `-`, `_` and `.`.
/// Spaces become `-` (as GitHub itself does). Nothing else is changed silently: a name outside the rule is rejected.
pub fn clean_project_name(name: &str) -> Result<String, String> {
    let n = crate::drive::client::display_name(name.trim())
        .trim()
        .replace(' ', "-");
    if n.is_empty() || n.chars().count() > 100 {
        return Err("The project name must be 1 to 100 characters long".to_string());
    }
    if !n
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
    {
        return Err("Use only unaccented letters, digits, hyphen (-), underscore (_) and dot (.) in the project name".to_string());
    }
    if n == "." || n == ".." || n.to_ascii_lowercase().ends_with(".git") {
        return Err(
            "GitHub does not accept this name (\".\", \"..\" or ending in .git)".to_string(),
        );
    }
    if n.starts_with('.') {
        return Err("The project name cannot start with a dot".to_string());
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::clean_project_name as clean;

    #[test]
    fn follows_github_repository_name_rules() {
        assert_eq!(clean("my paper_v1.2-final").unwrap(), "my-paper_v1.2-final");
        assert_eq!(clean(&"a".repeat(100)).unwrap().len(), 100);
        for bad in [
            "", "   ", ".", "..", ".hidden", "x.git", "X.GIT", "café", "a/b", "a\\b", "a$b", "a\nb",
        ] {
            assert!(clean(bad).is_err(), "{bad:?}");
        }
        assert!(clean(&"a".repeat(101)).is_err());
    }
}
