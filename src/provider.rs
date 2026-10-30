//! Repository providers: GitHub (the default) and Codeberg (Forgejo). Each session belongs to one provider, chosen at login;
//! projects are always repositories of that provider, and the project id (`owner__repo`) is valid within it.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    #[default]
    GitHub,
    Codeberg,
}

fn env_url(name: &str, default: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
        .trim_end_matches('/')
        .to_string()
}

/// Codeberg "web" address (login, Git protocol); `CODEBERG_URL` swaps it for a test Forgejo or another instance.
pub fn codeberg_web() -> String {
    env_url("CODEBERG_URL", "https://codeberg.org")
}

/// The API dialect of a provider: what decides how NeoLeaf talks to it (paths, tokens, Git login), as opposed to who it is.
/// GitHub-style paths are the base; Forgejo (Codeberg, and any Forgejo or Gitea) differs in a few places that the code names by `Kind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    GitHub,
    Forgejo,
}

impl Provider {
    pub fn kind(self) -> Kind {
        match self {
            Provider::GitHub => Kind::GitHub,
            Provider::Codeberg => Kind::Forgejo,
        }
    }

    /// Does the access token expire and get renewed with a refresh token? (Forgejo: after 1 hour by default; GitHub: no.)
    pub fn renews_token(self) -> bool {
        self.kind() == Kind::Forgejo
    }

    /// User name of the Git over HTTP login: GitHub wants `x-access-token`, Forgejo the person's own login.
    pub fn git_user(self, login: &str) -> String {
        match self.kind() {
            Kind::GitHub => "x-access-token".to_string(),
            Kind::Forgejo => login.to_string(),
        }
    }

    /// Host of the "no reply" e-mail the provider gives to people who hide theirs.
    pub fn noreply_host(self) -> &'static str {
        match self {
            Provider::GitHub => "github.com",
            Provider::Codeberg => "codeberg.org",
        }
    }

    /// Author e-mail for commits made by the person (their provider's "no reply" address).
    pub fn commit_email(self, id: u64, login: &str) -> String {
        match self {
            Provider::GitHub => format!("{id}+{login}@users.noreply.github.com"),
            Provider::Codeberg => format!("{id}+{login}@noreply.codeberg.org"),
        }
    }

    /// What a valid login looks like, for the administrator's error message.
    pub fn login_rule(self) -> &'static str {
        match self.kind() {
            Kind::GitHub => "letters, numbers and hyphen",
            Kind::Forgejo => "letters, numbers, hyphen, underscore and dot",
        }
    }

    /// Short identifier (cookie, JSON, `blocked.json`).
    pub fn id(self) -> &'static str {
        match self {
            Provider::GitHub => "github",
            Provider::Codeberg => "codeberg",
        }
    }

    /// Name people read in the interface.
    pub fn label(self) -> &'static str {
        match self {
            Provider::GitHub => "GitHub",
            Provider::Codeberg => "Codeberg",
        }
    }

    pub fn from_id(id: &str) -> Option<Provider> {
        match id.to_ascii_lowercase().as_str() {
            "github" => Some(Provider::GitHub),
            "codeberg" => Some(Provider::Codeberg),
            _ => None,
        }
    }

    /// Web address (pages, OAuth and Git protocol).
    pub fn web(self) -> String {
        match self {
            Provider::GitHub => crate::drive::client::github_web(),
            Provider::Codeberg => codeberg_web(),
        }
    }

    /// REST API address.
    pub fn api(self) -> String {
        match self {
            Provider::GitHub => crate::drive::client::github_api(),
            Provider::Codeberg => format!("{}/api/v1", codeberg_web()),
        }
    }

    /// OAuth client id: from `neoleaf.toml` when the file gives one, otherwise from the environment.
    pub fn client_id(self) -> String {
        if let Some(id) = crate::config::get().and_then(|c| c.provider_client_id(self)) {
            return id;
        }
        std::env::var(match self {
            Provider::GitHub => "GITHUB_CLIENT_ID",
            Provider::Codeberg => "CODEBERG_CLIENT_ID",
        })
        .unwrap_or_default()
    }

    /// OAuth client secret: from the environment variable that `neoleaf.toml` names (`client_secret_env`), otherwise the usual one.
    pub fn client_secret(self) -> String {
        let name = crate::config::get()
            .and_then(|c| c.provider_secret_env(self))
            .unwrap_or_else(|| {
                match self {
                    Provider::GitHub => "GITHUB_CLIENT_SECRET",
                    Provider::Codeberg => "CODEBERG_CLIENT_SECRET",
                }
                .to_string()
            });
        std::env::var(name).unwrap_or_default()
    }

    /// Is login with this provider on? Without `neoleaf.toml`: GitHub always shows, Codeberg only with the OAuth app keys.
    /// With the file: only the providers it switches on, and only when their keys are set.
    pub fn enabled(self) -> bool {
        let keys = !self.client_id().is_empty() && !self.client_secret().is_empty();
        match crate::config::get() {
            Some(c) => c.provider_enabled(self) && keys,
            None => match self {
                Provider::GitHub => true,
                Provider::Codeberg => keys,
            },
        }
    }

    /// OAuth callback address. GitHub: `REDIRECT_URI`; Codeberg: `CODEBERG_REDIRECT_URI` or the same address with `/codeberg`.
    pub fn redirect_uri(self) -> String {
        let github = std::env::var("REDIRECT_URI")
            .unwrap_or_else(|_| "http://localhost:3000/auth/callback".to_string());
        match self {
            Provider::GitHub => github,
            Provider::Codeberg => std::env::var("CODEBERG_REDIRECT_URI")
                .ok()
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| format!("{}/codeberg", github.trim_end_matches('/'))),
        }
    }

    /// Repository page address.
    pub fn repo_url(self, full_name: &str) -> String {
        format!("{}/{}", self.web(), full_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_e_nomes() {
        assert_eq!(Provider::default(), Provider::GitHub);
        assert_eq!(Provider::from_id("Codeberg"), Some(Provider::Codeberg));
        assert_eq!(Provider::from_id("gitlab"), None);
        assert_eq!(
            serde_json::to_string(&Provider::Codeberg).unwrap(),
            "\"codeberg\""
        );
        assert_eq!(
            serde_json::from_str::<Provider>("\"github\"").unwrap(),
            Provider::GitHub
        );
        assert_eq!(Provider::Codeberg.label(), "Codeberg");
    }

    #[test]
    fn usuario_antigo_sem_provedor_e_do_github() {
        let u: crate::auth::github::GitHubUser = serde_json::from_str(
            r#"{"id":1,"login":"a","name":null,"email":null,"avatar_url":null}"#,
        )
        .unwrap();
        assert_eq!(u.provider, Provider::GitHub);
    }

    #[test]
    fn dialect_of_each_provider_keeps_the_behavior_it_had() {
        use super::Kind;
        assert_eq!(Provider::GitHub.kind(), Kind::GitHub);
        assert_eq!(Provider::Codeberg.kind(), Kind::Forgejo);
        assert!(!Provider::GitHub.renews_token() && Provider::Codeberg.renews_token());
        assert_eq!(Provider::GitHub.git_user("ana"), "x-access-token");
        assert_eq!(Provider::Codeberg.git_user("ana"), "ana");
        assert_eq!(Provider::GitHub.noreply_host(), "github.com");
        assert_eq!(Provider::Codeberg.noreply_host(), "codeberg.org");
        assert_eq!(
            Provider::GitHub.commit_email(7, "ana"),
            "7+ana@users.noreply.github.com"
        );
        assert_eq!(
            Provider::Codeberg.commit_email(7, "ana"),
            "7+ana@noreply.codeberg.org"
        );
    }

    /// Files written by 1.35.0 (before `Kind` existed) must still load, and what is written back keeps the same shape.
    #[test]
    fn files_of_the_previous_version_still_load_and_keep_their_shape() {
        let old = r#"[{"provider":"codeberg","id":5,"login":"ana_cb","name":null,"avatar_url":null,"reason":"x","blocked_at":1,"blocked_by":"adm"},
                      {"id":6,"login":"bob","name":null,"avatar_url":null,"reason":"y","blocked_at":2,"blocked_by":"adm"}]"#;
        let v: Vec<crate::blocklist::Blocked> = serde_json::from_str(old).unwrap();
        assert_eq!(v[0].provider, Provider::Codeberg);
        assert_eq!(
            v[1].provider,
            Provider::GitHub,
            "no provider field means GitHub"
        );
        let back = serde_json::to_value(&v).unwrap();
        assert_eq!(back[0]["provider"], "codeberg");
        assert_eq!(back[1]["provider"], "github");
        let user = r#"{"provider":"codeberg","id":1,"login":"a","name":null,"email":null,"avatar_url":null}"#;
        let u: crate::auth::github::GitHubUser = serde_json::from_str(user).unwrap();
        assert_eq!(u.provider, Provider::Codeberg);
        assert_eq!(serde_json::to_value(&u).unwrap()["provider"], "codeberg");
    }
}
