use super::*;

impl DriveClient {
    /// The person's repositories on Codeberg (Forgejo): `/user/repos` in pages of 50; tags come from one call per repository
    /// when the list does not include them.
    async fn forgejo_repos(&self) -> Result<Vec<GitHubRepo>, String> {
        let mut all: Vec<GitHubRepo> = Vec::new();
        for page in 1..=6 {
            let url = self.u(format!(
                "https://api.github.com/user/repos?limit=50&page={page}"
            ));
            let resp = self
                .http
                .get(url)
                .header("Authorization", format!("Bearer {}", self.access_token))
                .header("User-Agent", "NeoLeaf-LaTeX")
                .send()
                .await
                .map_err(|e| format!("Network error querying {}: {e}", self.svc()))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("{} returned {status}: {body}", self.svc()));
            }
            let batch: Vec<GitHubRepo> = resp
                .json()
                .await
                .map_err(|e| format!("Error decoding {} repositories: {e}", self.svc()))?;
            let n = batch.len();
            all.extend(batch);
            if n < 50 {
                break;
            }
        }
        let futs = all.into_iter().map(|mut r| {
            let client = self.clone();
            async move {
                if r.topics.is_none() {
                    let (o, n) = (r.owner.login.clone(), r.name.clone());
                    r.topics = Some(client.repo_topics(&o, &n).await);
                }
                r
            }
        });
        Ok(futures_util::future::join_all(futs).await)
    }

    pub async fn list_projects(&self) -> Result<(Vec<ProjectInfo>, Option<String>), String> {
        let repos: Vec<GitHubRepo> = if self.forgejo() {
            self.forgejo_repos().await?
        } else {
            self.github_repos().await?
        };
        let current_login = self.current_user_login().await.unwrap_or_default();
        self.projects_from(repos, current_login).await
    }

    async fn github_repos(&self) -> Result<Vec<GitHubRepo>, String> {
        let url = self.u("https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100".to_string());
        let resp = self
            .http
            .get(url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Network error querying GitHub: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub API returned {status}: {body}"));
        }

        resp.json()
            .await
            .map_err(|e| format!("Error decoding GitHub repositories: {e}"))
    }

    async fn projects_from(
        &self,
        repos: Vec<GitHubRepo>,
        current_login: String,
    ) -> Result<(Vec<ProjectInfo>, Option<String>), String> {
        let mut candidates = Vec::new();
        for r in repos {
            if r.is_neoleaf_project() {
                let is_shared = !current_login.is_empty()
                    && !r.owner.login.eq_ignore_ascii_case(&current_login);
                let id = format!("{}__{}", r.owner.login, r.name);
                let trashed = parse_trashed(&r.name);
                let name = display_name(
                    trashed
                        .as_ref()
                        .map(|(orig, _)| orig.as_str())
                        .unwrap_or(&r.name),
                );
                let topics = r.topics.unwrap_or_default();
                candidates.push((
                    id,
                    name,
                    is_shared,
                    r.updated_at,
                    r.html_url,
                    r.owner.login,
                    r.owner.avatar_url,
                    r.name,
                    topics,
                    trashed.map(|(_, iso)| iso),
                    super::title::parse_title(r.description.as_deref()),
                ));
            }
        }

        let futs: Vec<_> = candidates
            .into_iter()
            .map(
                |(
                    id,
                    name,
                    is_shared,
                    updated_at,
                    html_url,
                    owner_login,
                    owner_avatar,
                    repo_name,
                    topics,
                    deleted_at,
                    title,
                )| {
                    let client = self.clone();
                    let cur = current_login.clone();
                    async move {
                        // for trashed projects it is not worth spending API calls just to list collaborators
                        let collabs = if deleted_at.is_some() {
                            Vec::new()
                        } else {
                            client
                                .get_project_collaborators(&owner_login, &repo_name, &cur)
                                .await
                        };
                        ProjectInfo {
                            id,
                            name,
                            is_shared,
                            modified_time: updated_at,
                            web_view_link: Some(html_url),
                            owner_login,
                            owner_avatar,
                            collaborators: collabs,
                            topics,
                            deleted_at,
                            title,
                        }
                    }
                },
            )
            .collect();

        let projects = futures_util::future::join_all(futs).await;
        Ok((projects, None))
    }

    /// Initial files of a project created from scratch (the browser writes them, commits and pushes).
    pub fn template_files(name: &str, template: Option<&str>) -> Vec<(String, String)> {
        if template == Some("typst") {
            return vec![
                (
                    "main.typ".to_string(),
                    include_str!("../../templates/typst-article.typ").to_string(),
                ),
                (
                    "refs.bib".to_string(),
                    include_str!("../../templates/typst-refs.bib").to_string(),
                ),
                (".gitignore".to_string(), ".neoleaf/last.*\n".to_string()),
                (
                    "README.md".to_string(),
                    format!(
                        "# {}\n\nTypst project created with [NeoLeaf](https://neoleaf.science).\n",
                        name
                    ),
                ),
            ];
        }
        let main = match template {
            Some("beamer") => include_str!("../../templates/beamer.tex"),
            Some("report") => include_str!("../../templates/report.tex"),
            _ => include_str!("../../templates/article.tex"),
        };
        vec![
            ("main.tex".to_string(), main.to_string()),
            (
                ".gitignore".to_string(),
                "*.aux\n*.log\n*.out\n*.toc\n*.synctex.gz\n*.fls\n*.fdb_latexmk\n.neoleaf/last.*\n"
                    .to_string(),
            ),
            (
                "README.md".to_string(),
                format!(
                    "# {}\n\nLaTeX project created with [NeoLeaf](https://neoleaf.science).\n",
                    name
                ),
            ),
        ]
    }

    /// Creates an empty repository for project import (without injecting README.md or templates).
    pub async fn create_empty_project(&self, name: &str) -> Result<String, String> {
        // `name` has already gone through `import::clean_project_name` (GitHub rules)
        let repo_name = name.to_string();

        let payload = serde_json::json!({
            "name": repo_name,
            "private": true,
            "auto_init": false,
        });

        let resp = self
            .http
            .post(self.u("https://api.github.com/user/repos".to_string()))
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Error creating repository on GitHub: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "GitHub refused to create the repository ({status}): {body}"
            ));
        }

        let repo: GitHubRepo = resp
            .json()
            .await
            .map_err(|e| format!("Error reading the GitHub response: {e}"))?;
        let pid = format!("{}__{}", repo.owner.login, repo.name);

        let topics_url = self.u(format!(
            "https://api.github.com/repos/{}/{}/topics",
            repo.owner.login, repo.name
        ));
        let _ = self
            .http
            .put(&topics_url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .json(&self.topics_body(&["neoleaf".to_string()]))
            .send()
            .await;

        Ok(pid)
    }

    /// Display name of the project, querying only GitHub (nothing of the project is read from the server's disk).
    /// Errors: "401 ... Bad credentials" (expired session), "Project not found or no access".
    pub async fn project_summary(
        &self,
        project_id: &str,
    ) -> Result<(String, Option<String>), String> {
        let repo = project_id
            .split_once("__")
            .map(|(_, r)| r)
            .unwrap_or(project_id);
        let url = self.u(format!(
            "https://api.github.com/repos/{}",
            repo_full_name(project_id)
        ));
        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Error querying GitHub: {e}"))?;
        match resp.status().as_u16() {
            200 => {
                let v: serde_json::Value = resp.json().await.unwrap_or_default();
                Ok((
                    display_name(v["name"].as_str().unwrap_or(repo)),
                    super::title::parse_title(v["description"].as_str()),
                ))
            }
            401 => Err("GitHub returned 401 Unauthorized: Bad credentials".to_string()),
            403 | 404 => Err("Project not found or no access".to_string()),
            c => Err(format!("GitHub returned {c}")),
        }
    }

    /// This person's permission on the project repository: (can read, can edit). Queries GitHub (with a short cache).
    pub async fn project_access(&self, project_id: &str) -> (bool, bool) {
        self.project_access_cached(project_id, true).await
    }

    /// Same as `project_access`, but `use_cache = false` always asks the service (live-edit re-checks).
    pub async fn project_access_cached(&self, project_id: &str, use_cache: bool) -> (bool, bool) {
        use std::collections::HashMap;
        use std::sync::{Mutex, OnceLock};
        use std::time::{Duration, Instant};
        type Access = (bool, bool);
        type AccessCache = Mutex<HashMap<(String, String), (Instant, Access)>>;
        static CACHE: OnceLock<AccessCache> = OnceLock::new();
        let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        let key = (self.access_token.clone(), project_id.to_string());
        if let Some((at, v)) = cache.lock().unwrap().get(&key).filter(|_| use_cache)
            && at.elapsed() < Duration::from_secs(60)
        {
            return *v;
        }
        let url = self.u(format!(
            "https://api.github.com/repos/{}",
            repo_full_name(project_id)
        ));
        let res = match self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {
                let v: serde_json::Value = r.json().await.unwrap_or_default();
                let p = &v["permissions"];
                (
                    true,
                    p["push"].as_bool().unwrap_or(false) || p["admin"].as_bool().unwrap_or(false),
                )
            }
            _ => (false, false),
        };
        let mut c = cache.lock().unwrap();
        c.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(300));
        c.insert(key, (Instant::now(), res));
        res
    }
}
