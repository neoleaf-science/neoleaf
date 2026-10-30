use super::*;

/// Maximum size of a ZIP downloaded from GitHub (100 MB).
pub const ZIP_MAX: usize = 100 * 1024 * 1024;

impl DriveClient {
    /// Response (not yet read) of the GitHub/Codeberg ZIP, to relay as a stream without holding it whole in memory.
    pub async fn zipball_response(
        &self,
        full_name: &str,
        git_ref: &str,
    ) -> Result<reqwest::Response, String> {
        let url = if self.forgejo() {
            // Forgejo requires the ref: without it, use the repository's default branch
            let git_ref = if git_ref.is_empty() {
                self.gh_json(
                    self.http
                        .get(self.u(format!("https://api.github.com/repos/{full_name}"))),
                    "read the repository",
                )
                .await?["default_branch"]
                    .as_str()
                    .unwrap_or("main")
                    .to_string()
            } else {
                git_ref.to_string()
            };
            self.u(format!(
                "https://api.github.com/repos/{full_name}/archive/{git_ref}.zip"
            ))
        } else {
            let suffix = if git_ref.is_empty() {
                String::new()
            } else {
                format!("/{git_ref}")
            };
            self.u(format!(
                "https://api.github.com/repos/{full_name}/zipball{suffix}"
            ))
        };
        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Error querying {}: {e}", self.svc()))?;
        if !resp.status().is_success() {
            return Err(format!(
                "{} returned {}",
                self.svc(),
                resp.status().as_u16()
            ));
        }
        Ok(resp)
    }

    /// Checks that the repository exists and, if given, that the path exists at that ref. Returns a sentence for the administrator.
    pub async fn check_source(
        &self,
        full_name: &str,
        git_ref: &str,
        path: &str,
    ) -> Result<String, String> {
        let get = |url: String| {
            self.http
                .get(self.u(url))
                .header("Authorization", format!("Bearer {}", self.access_token))
                .header("User-Agent", "NeoLeaf-LaTeX")
                .header("Accept", "application/vnd.github+json")
                .send()
        };
        let repo = get(format!("https://api.github.com/repos/{full_name}"))
            .await
            .map_err(|e| format!("Error querying GitHub: {e}"))?;
        match repo.status().as_u16() {
            200 => {}
            404 | 403 => return Err("Repository not found (or private)".to_string()),
            c => return Err(format!("GitHub returned {c}")),
        }
        let query = if git_ref.is_empty() {
            String::new()
        } else {
            format!("?ref={git_ref}")
        };
        if path.is_empty() {
            let r = get(format!(
                "https://api.github.com/repos/{full_name}/zipball{}",
                if git_ref.is_empty() {
                    String::new()
                } else {
                    format!("/{git_ref}")
                }
            ))
            .await
            .map_err(|e| format!("Error querying GitHub: {e}"))?;
            return match r.status().as_u16() {
                200 => Ok("Repository and version found".to_string()),
                404 | 422 => Err("Version (tag, branch or commit) not found".to_string()),
                c => Err(format!("GitHub returned {c}")),
            };
        }
        let r = get(format!(
            "https://api.github.com/repos/{full_name}/contents/{path}{query}"
        ))
        .await
        .map_err(|e| format!("Error querying GitHub: {e}"))?;
        match r.status().as_u16() {
            200 => Ok(format!("Repository, version and \"{path}\" found")),
            404 => Err(if git_ref.is_empty() {
                format!("The file or folder \"{path}\" was not found in the repository")
            } else {
                format!(
                    "The file or folder \"{path}\" was not found at version \"{git_ref}\" (check the tag and the path)"
                )
            }),
            c => Err(format!("GitHub returned {c}")),
        }
    }
}
