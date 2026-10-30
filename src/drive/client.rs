use crate::provider::Provider;

mod archive;
mod collaborators;
mod models;
mod names;
mod projects;
mod title;
mod trash;

pub use archive::ZIP_MAX;
pub use models::*;
pub use names::*;
pub use title::FOREIGN_DESCRIPTION;

/// GitHub API address (`GITHUB_API_URL` swaps it for a test GitHub).
pub fn github_api() -> String {
    std::env::var("GITHUB_API_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "https://api.github.com".to_string())
        .trim_end_matches('/')
        .to_string()
}

/// GitHub "web" address (Git protocol and OAuth); `GITHUB_WEB_URL` swaps it for a test GitHub.
pub fn github_web() -> String {
    std::env::var("GITHUB_WEB_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "https://github.com".to_string())
        .trim_end_matches('/')
        .to_string()
}

/// Swaps the public GitHub API address for the configured one (for tests and development without an account).
fn gh(url: String) -> String {
    url.replacen("https://api.github.com", &github_api(), 1)
}

#[derive(Clone)]
pub struct DriveClient {
    pub(crate) http: reqwest::Client,
    pub(crate) access_token: String,
    pub(crate) provider: Provider,
}

impl DriveClient {
    pub fn with_provider(access_token: String, provider: Provider) -> Self {
        Self {
            http: reqwest::Client::new(),
            access_token,
            provider,
        }
    }

    /// Client of the service the person signed in with (GitHub or Codeberg).
    pub fn for_session(session: &crate::session::Active) -> Self {
        Self::with_provider(session.access_token.clone(), session.user.provider)
    }

    /// Does the provider speak the Forgejo dialect (Codeberg, Forgejo, Gitea)? Otherwise it is GitHub's.
    fn forgejo(&self) -> bool {
        self.provider.kind() == crate::provider::Kind::Forgejo
    }

    /// Address on the service API: paths are written as in the GitHub API (`https://api.github.com/...`) and, on Codeberg,
    /// the prefix becomes `<codeberg>/api/v1` (the Forgejo API has almost the same paths).
    fn u(&self, url: String) -> String {
        match self.provider.kind() {
            crate::provider::Kind::GitHub => gh(url),
            crate::provider::Kind::Forgejo => {
                url.replacen("https://api.github.com", &self.provider.api(), 1)
            }
        }
    }

    /// Service name for error messages.
    fn svc(&self) -> &'static str {
        self.provider.label()
    }

    async fn current_user_login(&self) -> Option<String> {
        let resp = self
            .http
            .get(self.u("https://api.github.com/user".to_string()))
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .ok()?;
        let v: serde_json::Value = resp.json().await.ok()?;
        v["login"].as_str().map(str::to_string)
    }

    fn split_project_id(project_id: &str) -> Result<(String, String), String> {
        project_id
            .split_once("__")
            .map(|(o, r)| (o.to_string(), r.to_string()))
            .filter(|(o, r)| !o.is_empty() && !r.is_empty())
            .ok_or_else(|| "Invalid project ID".to_string())
    }

    async fn gh_json(
        &self,
        req: reqwest::RequestBuilder,
        what: &str,
    ) -> Result<serde_json::Value, String> {
        let resp = req
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Network error ({what}): {e}"))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            let msg = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v["message"].as_str().map(str::to_string))
                .unwrap_or(body);
            return Err(format!("GitHub refused ({what}, {status}): {msg}"));
        }
        Ok(serde_json::from_str(&body).unwrap_or(serde_json::Value::Null))
    }

    async fn ensure_owner(&self, owner: &str) -> Result<(), String> {
        let me = self.current_user_login().await.unwrap_or_default();
        if me.eq_ignore_ascii_case(owner) {
            Ok(())
        } else {
            Err("Only the project owner can move it to the trash or restore it.".to_string())
        }
    }

    async fn rename_repo(&self, owner: &str, old: &str, new: &str) -> Result<(), String> {
        self.gh_json(
            self.http
                .patch(self.u(format!("https://api.github.com/repos/{owner}/{old}")))
                .json(&serde_json::json!({ "name": new })),
            "rename the repository",
        )
        .await
        .map(|_| ())
    }

    /// Body of the tags PUT: GitHub uses `names`, Forgejo uses `topics`.
    fn topics_body(&self, names: &[String]) -> serde_json::Value {
        if self.forgejo() {
            serde_json::json!({ "topics": names })
        } else {
            serde_json::json!({ "names": names })
        }
    }

    async fn repo_topics(&self, owner: &str, repo: &str) -> Vec<String> {
        self.gh_json(
            self.http.get(self.u(format!(
                "https://api.github.com/repos/{owner}/{repo}/topics"
            ))),
            "read the tags",
        )
        .await
        .ok()
        .and_then(|v| {
            v.get("names")
                .or(v.get("topics"))
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
        })
        .unwrap_or_default()
    }

    async fn set_repo_topics(
        &self,
        owner: &str,
        repo: &str,
        names: &[String],
    ) -> Result<(), String> {
        self.gh_json(
            self.http
                .put(self.u(format!(
                    "https://api.github.com/repos/{owner}/{repo}/topics"
                )))
                .json(&self.topics_body(names)),
            "save the tags",
        )
        .await
        .map(|_| ())
    }
}
