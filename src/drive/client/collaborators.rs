use super::*;

use serde::Deserialize;

/// One entry of the repository collaborators list.
#[derive(Deserialize)]
struct Collab {
    login: String,
    avatar_url: Option<String>,
    permissions: Option<serde_json::Value>,
}

impl DriveClient {
    pub async fn get_project_collaborators(
        &self,
        owner: &str,
        repo: &str,
        current_login: &str,
    ) -> Vec<ProjectCollaborator> {
        let mut collabs = Vec::new();
        let url = self.u(format!(
            "https://api.github.com/repos/{}/{}/collaborators",
            owner, repo
        ));
        if let Ok(resp) = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            && resp.status().is_success()
        {
            #[derive(Deserialize)]
            struct CollabItem {
                login: String,
                avatar_url: Option<String>,
            }
            if let Ok(items) = resp.json::<Vec<CollabItem>>().await {
                for c in items {
                    if !current_login.is_empty() && c.login.eq_ignore_ascii_case(current_login) {
                        continue;
                    }
                    if c.login.eq_ignore_ascii_case(owner) {
                        continue;
                    }
                    collabs.push(ProjectCollaborator {
                        login: c.login,
                        avatar_url: c.avatar_url,
                        is_pending: false,
                    });
                }
            }
        }

        let inv_url = self.u(format!(
            "https://api.github.com/repos/{}/{}/invitations",
            owner, repo
        ));
        if let Ok(resp) = self
            .http
            .get(&inv_url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            && resp.status().is_success()
        {
            #[derive(Deserialize)]
            struct InvItem {
                invitee: Option<Invitee>,
            }
            #[derive(Deserialize)]
            struct Invitee {
                login: String,
                avatar_url: Option<String>,
            }
            if let Ok(items) = resp.json::<Vec<InvItem>>().await {
                for inv in items {
                    if let Some(invitee) = inv.invitee {
                        if !current_login.is_empty()
                            && invitee.login.eq_ignore_ascii_case(current_login)
                        {
                            continue;
                        }
                        collabs.push(ProjectCollaborator {
                            login: invitee.login,
                            avatar_url: invitee.avatar_url,
                            is_pending: true,
                        });
                    }
                }
            }
        }

        collabs
    }

    /// Forgejo does not return permissions in the list: asks each person's role.
    async fn forgejo_roles(
        &self,
        repo: &str,
        collabs: &[Collab],
    ) -> std::collections::HashMap<String, &'static str> {
        let futs = collabs.iter().map(|c| {
            let u = self.u(format!(
                "https://api.github.com/repos/{}/collaborators/{}/permission",
                repo, c.login
            ));
            let login = c.login.clone();
            async move {
                let v: serde_json::Value = match self
                    .http
                    .get(u)
                    .header("Authorization", format!("Bearer {}", self.access_token))
                    .header("User-Agent", "NeoLeaf-LaTeX")
                    .send()
                    .await
                {
                    Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
                    _ => serde_json::Value::Null,
                };
                let role = match v["permission"].as_str().unwrap_or("") {
                    "owner" | "admin" => "owner",
                    "write" => "writer",
                    _ => "reader",
                };
                (login, role)
            }
        });
        futures_util::future::join_all(futs)
            .await
            .into_iter()
            .collect()
    }

    /// Appends the pending GitHub invitations of the repository to `perms`.
    async fn push_pending_invitations(&self, repo: &str, perms: &mut Vec<Permission>) {
        let inv_url = self.u(format!("https://api.github.com/repos/{}/invitations", repo));
        if let Ok(inv_resp) = self
            .http
            .get(&inv_url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            && inv_resp.status().is_success()
        {
            #[derive(Deserialize)]
            struct Inv {
                id: u64,
                invitee: Option<Collab>,
                permissions: Option<String>,
            }
            if let Ok(invs) = inv_resp.json::<Vec<Inv>>().await {
                for inv in invs {
                    if let Some(invitee) = inv.invitee {
                        perms.push(Permission {
                            id: format!("inv_{}", inv.id),
                            role: inv.permissions.unwrap_or_else(|| "writer".to_string()),
                            kind: "invitation".to_string(),
                            email: None,
                            name: Some(format!("{} (pending invitation)", invitee.login)),
                            photo: invitee.avatar_url,
                        });
                    }
                }
            }
        }
    }

    pub async fn list_permissions(&self, project_id: &str) -> Result<Vec<Permission>, String> {
        let repo = repo_full_name(project_id);
        let url = self.u(format!(
            "https://api.github.com/repos/{}/collaborators",
            repo
        ));
        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Ok(Vec::new());
        }

        let collabs: Vec<Collab> = resp.json().await.unwrap_or_default();
        let forgejo_roles = if self.codeberg() {
            self.forgejo_roles(&repo, &collabs).await
        } else {
            Default::default()
        };
        let mut perms: Vec<Permission> = collabs
            .into_iter()
            .map(|c| {
                let role = if let Some(r) = forgejo_roles.get(&c.login) {
                    r
                } else if c
                    .permissions
                    .as_ref()
                    .and_then(|p| p.get("admin"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    "owner"
                } else if c
                    .permissions
                    .as_ref()
                    .and_then(|p| p.get("push"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    "writer"
                } else {
                    "reader"
                };
                Permission {
                    id: c.login.clone(),
                    role: role.to_string(),
                    kind: "user".to_string(),
                    email: None,
                    name: Some(c.login.clone()),
                    photo: c.avatar_url,
                }
            })
            .collect();

        if self.codeberg() {
            return Ok(perms); // Forgejo has no pending invitations: the person joins directly
        }
        self.push_pending_invitations(&repo, &mut perms).await;

        Ok(perms)
    }

    pub async fn add_permission(
        &self,
        project_id: &str,
        username: &str,
        role: &str,
    ) -> Result<Permission, String> {
        if !crate::ids::valid_login(username) {
            return Err("Invalid user name".to_string());
        }
        let repo = repo_full_name(project_id);
        let gh_role = match (role, self.codeberg()) {
            ("admin" | "owner", _) => "admin",
            ("reader", true) => "read",
            ("reader", false) => "pull",
            (_, true) => "write",
            _ => "push",
        };
        let url = self.u(format!(
            "https://api.github.com/repos/{}/collaborators/{}",
            repo, username
        ));
        let resp = self
            .http
            .put(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .json(&serde_json::json!({ "permission": gh_role }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!(
                "{} refused to add the collaborator: {}",
                self.svc(),
                resp.status()
            ));
        }

        Ok(Permission {
            id: username.to_string(),
            role: role.to_string(),
            kind: "user".to_string(),
            email: None,
            name: Some(username.to_string()),
            photo: None,
        })
    }

    pub async fn update_permission(
        &self,
        project_id: &str,
        username_or_inv: &str,
        role: &str,
    ) -> Result<(), String> {
        if let Some(inv_id) = username_or_inv.strip_prefix("inv_") {
            // a pending invitation is not a user: change the permission of the invitation itself (GitHub only; Forgejo has none)
            if self.codeberg() || !crate::ids::valid_permission_id(username_or_inv) {
                return Err("Pending invitations cannot be changed here; remove the invitation and invite again".to_string());
            }
            let gh_role = match role {
                "admin" | "owner" => "admin",
                "reader" => "read",
                _ => "write",
            };
            let url = self.u(format!(
                "https://api.github.com/repos/{}/invitations/{}",
                repo_full_name(project_id),
                inv_id
            ));
            let resp = self
                .http
                .patch(&url)
                .header("Authorization", format!("Bearer {}", self.access_token))
                .header("User-Agent", "NeoLeaf-LaTeX")
                .header("Accept", "application/vnd.github+json")
                .json(&serde_json::json!({ "permissions": gh_role }))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!(
                    "{} refused to change the invitation: {}",
                    self.svc(),
                    resp.status()
                ));
            }
            return Ok(());
        }
        self.add_permission(project_id, username_or_inv, role)
            .await
            .map(|_| ())
    }

    pub async fn remove_permission(
        &self,
        project_id: &str,
        username_or_inv: &str,
    ) -> Result<(), String> {
        if !crate::ids::valid_permission_id(username_or_inv) {
            return Err("Invalid permission ID".to_string());
        }
        let repo = repo_full_name(project_id);
        let url = match (username_or_inv.strip_prefix("inv_"), self.codeberg()) {
            (Some(inv_id), false) => self.u(format!(
                "https://api.github.com/repos/{}/invitations/{}",
                repo, inv_id
            )),
            (Some(_), true) => {
                return Err("Pending invitations do not exist on Codeberg".to_string());
            }
            (None, _) => self.u(format!(
                "https://api.github.com/repos/{}/collaborators/{}",
                repo, username_or_inv
            )),
        };
        let resp = self
            .http
            .delete(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Error contacting {}: {e}", self.svc()))?;
        if !resp.status().is_success() {
            return Err(format!(
                "{} refused to remove the access: {}",
                self.svc(),
                resp.status()
            ));
        }
        Ok(())
    }

    pub async fn list_invitations(&self) -> Result<Vec<NeoLeafInvitation>, String> {
        if self.codeberg() {
            return Ok(Vec::new()); // on Forgejo whoever is added as a collaborator joins directly, without an invitation
        }
        let resp = self
            .http
            .get(self.u("https://api.github.com/user/repository_invitations".to_string()))
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Error fetching invitations on GitHub: {e}"))?;

        if !resp.status().is_success() {
            return Ok(Vec::new());
        }

        let invitations: Vec<GitHubInvitation> = resp.json().await.unwrap_or_default();
        let mut out = Vec::new();

        for inv in invitations {
            let r = &inv.repository;
            if r.is_neoleaf_project() {
                let inviter_login = inv
                    .inviter
                    .as_ref()
                    .map(|i| i.login.clone())
                    .unwrap_or_else(|| r.owner.login.clone());
                let inviter_avatar = inv.inviter.as_ref().and_then(|i| i.avatar_url.clone());
                out.push(NeoLeafInvitation {
                    id: inv.id,
                    repo_name: display_name(&r.name),
                    repo_full_name: r.full_name.clone(),
                    owner_login: r.owner.login.clone(),
                    inviter_login,
                    inviter_avatar,
                    permissions: inv.permissions.unwrap_or_else(|| "write".to_string()),
                });
            }
        }

        Ok(out)
    }

    pub async fn accept_invitation(&self, invitation_id: u64) -> Result<(), String> {
        if self.codeberg() {
            return Err("Codeberg does not use invitations.".to_string());
        }
        let url = self.u(format!(
            "https://api.github.com/user/repository_invitations/{}",
            invitation_id
        ));
        let resp = self
            .http
            .patch(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .header("Content-Length", "0")
            .send()
            .await
            .map_err(|e| format!("Network error accepting the invitation: {e}"))?;

        if resp.status().is_success() || resp.status() == reqwest::StatusCode::NOT_MODIFIED {
            Ok(())
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("GitHub returned {status}: {body}"))
        }
    }

    pub async fn decline_invitation(&self, invitation_id: u64) -> Result<(), String> {
        if self.codeberg() {
            return Err("Codeberg does not use invitations.".to_string());
        }
        let url = self.u(format!(
            "https://api.github.com/user/repository_invitations/{}",
            invitation_id
        ));
        let resp = self
            .http
            .delete(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Network error declining the invitation: {e}"))?;

        if resp.status().is_success() {
            Ok(())
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("GitHub returned {status}: {body}"))
        }
    }
}
