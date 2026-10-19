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

impl Provider {
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

    pub fn client_id(self) -> String {
        std::env::var(match self {
            Provider::GitHub => "GITHUB_CLIENT_ID",
            Provider::Codeberg => "CODEBERG_CLIENT_ID",
        })
        .unwrap_or_default()
    }

    pub fn client_secret(self) -> String {
        std::env::var(match self {
            Provider::GitHub => "GITHUB_CLIENT_SECRET",
            Provider::Codeberg => "CODEBERG_CLIENT_SECRET",
        })
        .unwrap_or_default()
    }

    /// Is login with this provider configured? (GitHub always shows; Codeberg only with the OAuth app keys)
    pub fn enabled(self) -> bool {
        match self {
            Provider::GitHub => true,
            Provider::Codeberg => !self.client_id().is_empty() && !self.client_secret().is_empty(),
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
}
