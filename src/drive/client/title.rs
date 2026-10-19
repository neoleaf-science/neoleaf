//! The display title of a project. The project list shows repository names; a person can give a project a nicer title,
//! saved in the repository description (the "About" text) as `NeoLeaf: <title>`. Only descriptions that start with that
//! marker count as titles, so what people wrote in their own descriptions is never shown as a title or overwritten by accident.

use super::*;

const MARKER: &str = "NeoLeaf: ";
pub const MAX_TITLE_CHARS: usize = 80;
/// Said by `set_project_title` when the repository has a description of its own and the caller did not agree to replace it.
pub const FOREIGN_DESCRIPTION: &str = "foreign_description";
const NO_RIGHTS: &str = "Only people with admin access to the repository can change its title.";

/// The title kept in a repository description, if it is one of ours.
pub fn parse_title(description: Option<&str>) -> Option<String> {
    let t = description?.strip_prefix(MARKER)?.trim();
    (!t.is_empty() && t.chars().count() <= MAX_TITLE_CHARS).then(|| t.to_string())
}

/// A title typed by a person: one line, trimmed, up to `MAX_TITLE_CHARS`. Empty means "remove the title".
pub fn clean_title(raw: &str) -> Result<String, String> {
    let t = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().any(char::is_control) {
        return Err("The title cannot have control characters.".to_string());
    }
    if t.chars().count() > MAX_TITLE_CHARS {
        return Err(format!(
            "The title can have at most {MAX_TITLE_CHARS} characters."
        ));
    }
    Ok(t)
}

impl DriveClient {
    /// Sets (or, with an empty `raw`, removes) the title of a project. Returns the title now in place.
    /// Needs admin access to the repository; a description that is not one of ours is only replaced with `overwrite`.
    pub async fn set_project_title(
        &self,
        project_id: &str,
        raw: &str,
        overwrite: bool,
    ) -> Result<Option<String>, String> {
        let title = clean_title(raw)?;
        let repo = repo_full_name(project_id);
        let url = self.u(format!("https://api.github.com/repos/{repo}"));
        let current = self
            .gh_json(self.http.get(&url), "read the repository")
            .await
            .map_err(|_| NO_RIGHTS.to_string())?;
        let description = current["description"].as_str().unwrap_or("");
        let ours = parse_title(Some(description)).is_some() || description.starts_with(MARKER);
        if !description.trim().is_empty() && !ours && !overwrite {
            return if title.is_empty() {
                Ok(None)
            } else {
                Err(FOREIGN_DESCRIPTION.to_string())
            };
        }
        let new_description = if title.is_empty() {
            String::new()
        } else {
            format!("{MARKER}{title}")
        };
        self.gh_json(
            self.http
                .patch(&url)
                .json(&serde_json::json!({ "description": new_description })),
            "change the title",
        )
        .await
        .map_err(|e| {
            if e.contains("403") || e.contains("404") {
                NO_RIGHTS.to_string()
            } else {
                e
            }
        })?;
        Ok((!title.is_empty()).then_some(title))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_marked_descriptions_are_titles() {
        assert_eq!(
            parse_title(Some("NeoLeaf: My thesis")).as_deref(),
            Some("My thesis")
        );
        assert_eq!(
            parse_title(Some("NeoLeaf:   spaced  ")).as_deref(),
            Some("spaced")
        );
        for no in [
            None,
            Some(""),
            Some("My own description"),
            Some("neoleaf: lower case"),
            Some("NeoLeaf: "),
            Some("Notes about NeoLeaf: x"),
        ] {
            assert_eq!(parse_title(no), None, "{no:?}");
        }
        assert_eq!(
            parse_title(Some(&format!(
                "NeoLeaf: {}",
                "x".repeat(MAX_TITLE_CHARS + 1)
            ))),
            None
        );
    }

    #[test]
    fn typed_titles_are_cleaned_and_limited() {
        assert_eq!(clean_title("  A   title \n here ").unwrap(), "A title here");
        assert_eq!(clean_title("   ").unwrap(), "");
        assert_eq!(
            clean_title(&"é".repeat(MAX_TITLE_CHARS))
                .unwrap()
                .chars()
                .count(),
            MAX_TITLE_CHARS
        );
        assert!(clean_title(&"x".repeat(MAX_TITLE_CHARS + 1)).is_err());
        assert!(clean_title("bad\u{7}bell").is_err());
    }
}
