//! Validation of the identifiers that end up inside URLs sent to GitHub or Codeberg (and in room keys).
//!
//! Path parameters arrive percent-decoded, so `%2F`, `..`, `?` and `#` reach the handlers as real characters. Every route that
//! takes an owner, a repository, a project id, a collaborator name or a file path must check it here before using it.

/// Characters allowed in a GitHub or Codeberg user, organisation or repository name.
fn name_chars(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

/// A single name segment: 1 to `max` characters from `[A-Za-z0-9._-]`, and never `.` or `..`.
fn segment(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s != "." && s != ".." && name_chars(s)
}

/// A user or organisation name (GitHub allows 39 characters, Forgejo 40).
pub fn valid_owner(s: &str) -> bool {
    segment(s, 40)
}

/// A repository name.
pub fn valid_repo(s: &str) -> bool {
    segment(s, 100)
}

/// A project id: `owner__repo` (the first `__` separates them).
pub fn valid_project_id(id: &str) -> bool {
    id.split_once("__")
        .is_some_and(|(owner, repo)| valid_owner(owner) && valid_repo(repo))
}

/// The id of a collaborator entry: a login, or `inv_<number>` for a pending invitation.
pub fn valid_permission_id(s: &str) -> bool {
    match s.strip_prefix("inv_") {
        Some(n) => !n.is_empty() && n.len() <= 20 && n.bytes().all(|b| b.is_ascii_digit()),
        None => valid_owner(s),
    }
}

/// A collaborator login (what the owner types to share a project).
pub fn valid_login(s: &str) -> bool {
    valid_owner(s)
}

/// The path of a file inside a project (relative, forward slashes, no `..`, no control characters).
pub fn valid_file_path(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 512
        && !s.starts_with('/')
        && !s.contains('\\')
        && !s.chars().any(|c| c.is_control())
        && s.split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_ids() {
        assert!(valid_project_id("ana__artigo-1"));
        assert!(valid_project_id("a_b.c-d__my.repo_2"));
        for bad in [
            "",
            "ana",
            "__repo",
            "ana__",
            "ana__repo/../../user",
            "ana__repo?x=1",
            "ana__repo#x",
            "../x__y",
            "ana__..",
            "..__repo",
            ".__repo",
            "ana__re po",
            "ana__rep\u{0}o",
            "ana/x__repo",
            "ana__repo%2Fx",
        ] {
            assert!(!valid_project_id(bad), "{bad:?} must be refused");
        }
        assert!(!valid_project_id(&format!("{}__r", "a".repeat(41))));
        assert!(!valid_project_id(&format!("o__{}", "r".repeat(101))));
    }

    #[test]
    fn permission_ids_and_logins() {
        assert!(valid_permission_id("inv_123"));
        assert!(valid_permission_id("some-user"));
        for bad in [
            "", "..", ".", "inv_", "inv_12a", "a/b", "a?b", "inv_../x", "x y",
        ] {
            assert!(!valid_permission_id(bad), "{bad:?} must be refused");
        }
        assert!(valid_login("tassio-v"));
        assert!(!valid_login("a b"));
    }

    #[test]
    fn file_paths() {
        assert!(valid_file_path("main.tex"));
        assert!(valid_file_path("sections/intro.tex"));
        for bad in [
            "",
            "/etc/passwd",
            "../x",
            "a/../b",
            "a//b",
            "a\\b",
            "a\u{0}b",
            "a\nb",
            "./x",
        ] {
            assert!(!valid_file_path(bad), "{bad:?} must be refused");
        }
        assert!(!valid_file_path(&"a".repeat(513)));
    }
}
