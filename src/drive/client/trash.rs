use super::*;

use serde::Deserialize;

/// Does the repository the server answered with carry exactly this name? (A redirect from an old name answers with another repository.)
fn name_is_taken(answer: &serde_json::Value, wanted: &str) -> bool {
    answer
        .get("name")
        .and_then(|n| n.as_str())
        .is_none_or(|n| n.eq_ignore_ascii_case(wanted))
}

impl DriveClient {
    /// Sends the project to the trash: renames the repository with the deletion date and time at the end and adds the `deleted` tag.
    /// Returns the new project id.
    pub async fn delete_project(&self, project_id: &str) -> Result<String, String> {
        let (owner, repo) = Self::split_project_id(project_id)?;
        if parse_trashed(&repo).is_some() {
            return Err("This project is already in the trash.".to_string());
        }
        let new_repo = trashed_name(&repo, &iso_now());
        let new_id = format!("{owner}__{new_repo}");

        self.ensure_owner(&owner).await?;
        self.rename_repo(&owner, &repo, &new_repo).await?;
        let mut topics = self.repo_topics(&owner, &new_repo).await;
        if topics.is_empty() {
            topics.push("neoleaf".to_string());
        }
        if !topics.iter().any(|t| t == DELETED_TOPIC) {
            topics.push(DELETED_TOPIC.to_string());
        }
        // already renamed: if the tag fails, the project stays in the trash (the name suffix is what counts)
        if let Err(e) = self.set_repo_topics(&owner, &new_repo, &topics).await {
            eprintln!("Trash: could not set the {DELETED_TOPIC} tag on {owner}/{new_repo}: {e}");
        }
        Ok(new_id)
    }

    /// Takes the project out of the trash: goes back to the original name and removes the `deleted` tag. Returns the new id.
    pub async fn restore_project(&self, project_id: &str) -> Result<String, String> {
        let (owner, repo) = Self::split_project_id(project_id)?;
        let (original, _) =
            parse_trashed(&repo).ok_or_else(|| "This project is not in the trash.".to_string())?;
        let new_id = format!("{owner}__{original}");

        self.ensure_owner(&owner).await?;
        // Forgejo and Gitea keep a redirect from the old name of a renamed repository: asking for the original name then answers with
        // the trashed repository itself, whose own name is different. Only a repository that really has that name blocks the restore.
        let taken = self
            .gh_json(
                self.http
                    .get(self.u(format!("https://api.github.com/repos/{owner}/{original}"))),
                "check the name",
            )
            .await
            .is_ok_and(|v| name_is_taken(&v, &original));
        if taken {
            return Err(format!(
                "A repository named \"{original}\" already exists; rename or delete it before restoring."
            ));
        }
        let topics: Vec<String> = self
            .repo_topics(&owner, &repo)
            .await
            .into_iter()
            .filter(|t| t != DELETED_TOPIC)
            .collect();
        self.rename_repo(&owner, &repo, &original).await?;
        let topics = if topics.is_empty() {
            vec!["neoleaf".to_string()]
        } else {
            topics
        };
        if let Err(e) = self.set_repo_topics(&owner, &original, &topics).await {
            eprintln!(
                "Trash: could not remove the {DELETED_TOPIC} tag from {owner}/{original}: {e}"
            );
        }
        Ok(new_id)
    }

    pub async fn update_topics(
        &self,
        project_id: &str,
        raw_topics: Vec<String>,
    ) -> Result<Vec<String>, String> {
        let names = sanitize_topics(raw_topics);

        let repo = repo_full_name(project_id);
        let url = self.u(format!("https://api.github.com/repos/{}/topics", repo));

        let resp = self
            .http
            .put(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .json(&self.topics_body(&names))
            .send()
            .await
            .map_err(|e| format!("Network error updating topics on {}: {e}", self.svc()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub returned {status}: {body}"));
        }

        if self.forgejo() {
            return Ok(names); // Forgejo answers 204, with no body
        }
        #[derive(Deserialize)]
        struct TopicsResp {
            names: Option<Vec<String>>,
        }
        let res: TopicsResp = resp
            .json()
            .await
            .map_err(|e| format!("Error decoding the response: {e}"))?;
        Ok(res.names.unwrap_or(names))
    }
}

#[cfg(test)]
mod name_tests {
    use super::name_is_taken;

    #[test]
    fn a_redirect_from_an_old_name_does_not_count_as_a_repository_with_that_name() {
        let j = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        assert!(name_is_taken(&j(r#"{"name":"tese"}"#), "tese"));
        assert!(
            name_is_taken(&j(r#"{"name":"Tese"}"#), "tese"),
            "names are not case sensitive"
        );
        assert!(!name_is_taken(
            &j(r#"{"name":"tese-deleted-20261030-120000"}"#),
            "tese"
        ));
        assert!(
            name_is_taken(&j(r#"{"id":1}"#), "tese"),
            "an answer without a name is treated as taken, as before"
        );
    }
}
