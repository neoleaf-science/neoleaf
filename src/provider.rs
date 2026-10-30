//! Repository providers: GitHub (the default), Codeberg (Forgejo) and, in an institution install (`neoleaf.toml`), the
//! institution's own Git server (Forgejo or Gitea). Each session belongs to one provider, chosen at login;
//! projects are always repositories of that provider, and the project id (`owner__repo`) is valid within it.
//!
//! A provider is a small `Copy` handle written as its id (`"github"`, `"codeberg"`, or the id of your own server). Ids found in
//! `sessions.json` and `blocked.json` are kept even when the configuration no longer has them (a provider switched off for a day
//! must not lose its sessions or blocks): such a provider simply cannot be used, and everything about it is empty.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Provider {
    #[default]
    GitHub,
    Codeberg,
    /// The institution's own Git server, by id (see `config::CustomProvider`).
    Custom(&'static str),
}

/// Ids seen so far, leaked once so that `Provider` can stay `Copy`. Bounded: an id that is not in the configuration only gets here
/// by being written in a local file, and 64 distinct ones is far more than any installation has.
static INTERNED: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());
const MAX_INTERNED: usize = 64;

/// Id of your own Git server: lowercase letters, digits and hyphen, starting with a letter, up to 32; never a built-in name.
pub fn valid_custom_id(id: &str) -> bool {
    let b = id.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && b[0].is_ascii_lowercase()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && !matches!(id, "github" | "codeberg")
}

fn intern(id: &str) -> Option<&'static str> {
    let mut g = INTERNED.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(s) = g.iter().find(|s| **s == id) {
        return Some(s);
    }
    if g.len() >= MAX_INTERNED {
        return None;
    }
    let s: &'static str = Box::leak(id.to_string().into_boxed_str());
    g.push(s);
    Some(s)
}

impl Serialize for Provider {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.id())
    }
}

impl<'de> Deserialize<'de> for Provider {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let id = String::deserialize(d)?;
        Provider::from_stored(&id)
            .ok_or_else(|| serde::de::Error::custom(format!("unknown provider {id:?}")))
    }
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
            // Gitea speaks the same dialect as Forgejo for everything NeoLeaf uses
            Provider::Codeberg | Provider::Custom(_) => Kind::Forgejo,
        }
    }

    /// Can sessions of this provider be used now? Always for GitHub and Codeberg; for your own server only while `neoleaf.toml` has it.
    /// (A session of a server that left the file stays on disk, unused, and works again if the server comes back.)
    pub fn known(self) -> bool {
        !matches!(self, Provider::Custom(_)) || self.custom().is_some()
    }

    /// The institution's server behind a `Custom` provider, if the configuration still has it.
    fn custom(self) -> Option<&'static crate::config::CustomProvider> {
        match self {
            Provider::Custom(id) => crate::config::get().and_then(|c| c.custom_provider(id)),
            _ => None,
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
            Provider::Custom(_) => self.custom().map_or("localhost", |c| c.host.as_str()),
        }
    }

    /// Author e-mail for commits made by the person (their provider's "no reply" address).
    pub fn commit_email(self, id: u64, login: &str) -> String {
        match self {
            Provider::GitHub => format!("{id}+{login}@users.noreply.github.com"),
            Provider::Codeberg => format!("{id}+{login}@noreply.codeberg.org"),
            Provider::Custom(_) => format!("{id}+{login}@noreply.{}", self.noreply_host()),
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
            Provider::Custom(id) => id,
        }
    }

    /// Name people read in the interface.
    pub fn label(self) -> &'static str {
        match self {
            Provider::GitHub => "GitHub",
            Provider::Codeberg => "Codeberg",
            Provider::Custom(id) => self.custom().map_or(id, |c| c.label.as_str()),
        }
    }

    /// A provider that can be used now: GitHub, Codeberg, or your own server that the configuration has.
    /// (For ids typed by someone, such as the administrator's block form.)
    pub fn from_id(id: &str) -> Option<Provider> {
        let id = id.to_ascii_lowercase();
        match id.as_str() {
            "github" => Some(Provider::GitHub),
            "codeberg" => Some(Provider::Codeberg),
            _ => crate::config::get()
                .and_then(|c| c.custom_provider(&id))
                .and_then(|c| Provider::from_stored(&c.id)),
        }
    }

    /// Any well-formed id, even one the configuration does not have (what the files on disk may hold).
    pub fn from_stored(id: &str) -> Option<Provider> {
        match id.to_ascii_lowercase().as_str() {
            "github" => Some(Provider::GitHub),
            "codeberg" => Some(Provider::Codeberg),
            other if valid_custom_id(other) => intern(other).map(Provider::Custom),
            _ => None,
        }
    }

    /// Web address (pages, OAuth and Git protocol).
    pub fn web(self) -> String {
        match self {
            Provider::GitHub => crate::drive::client::github_web(),
            Provider::Codeberg => codeberg_web(),
            Provider::Custom(_) => self.custom().map(|c| c.url.clone()).unwrap_or_default(),
        }
    }

    /// REST API address.
    pub fn api(self) -> String {
        match self {
            Provider::GitHub => crate::drive::client::github_api(),
            Provider::Codeberg => format!("{}/api/v1", codeberg_web()),
            Provider::Custom(_) => format!("{}/api/v1", self.web()),
        }
    }

    /// OAuth client id: from `neoleaf.toml` when the file gives one, otherwise from the environment.
    pub fn client_id(self) -> String {
        if let Some(id) = crate::config::get().and_then(|c| c.provider_client_id(self)) {
            return id;
        }
        match self {
            Provider::GitHub => std::env::var("GITHUB_CLIENT_ID"),
            Provider::Codeberg => std::env::var("CODEBERG_CLIENT_ID"),
            // your own server has its keys in the file only
            Provider::Custom(_) => Ok(String::new()),
        }
        .unwrap_or_default()
    }

    /// OAuth client secret: from the environment variable that `neoleaf.toml` names (`client_secret_env`), otherwise the usual one.
    pub fn client_secret(self) -> String {
        let name = crate::config::get()
            .and_then(|c| c.provider_secret_env(self))
            .or_else(|| match self {
                Provider::GitHub => Some("GITHUB_CLIENT_SECRET".to_string()),
                Provider::Codeberg => Some("CODEBERG_CLIENT_SECRET".to_string()),
                Provider::Custom(_) => None,
            });
        name.and_then(|n| std::env::var(n).ok()).unwrap_or_default()
    }

    /// Is login with this provider on? Without `neoleaf.toml`: GitHub always shows, Codeberg only with the OAuth app keys.
    /// With the file: only the providers it switches on, and only when their keys are set.
    pub fn enabled(self) -> bool {
        let keys = !self.client_id().is_empty() && !self.client_secret().is_empty();
        match crate::config::get() {
            Some(c) => {
                let known = !matches!(self, Provider::Custom(_)) || self.custom().is_some();
                known && c.provider_enabled(self) && keys
            }
            None => match self {
                Provider::GitHub => true,
                Provider::Codeberg => keys,
                Provider::Custom(_) => false,
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
            Provider::Custom(id) => format!("{}/{id}", github.trim_end_matches('/')),
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
        assert_eq!(Provider::from_id("gitlab"), None, "not configured");
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

    /// Your own Git server: ids are interned, serialized as written, and kept even when nothing in the configuration has them.
    #[test]
    fn custom_ids_round_trip_and_survive_without_configuration() {
        let a = Provider::from_stored("git-ifto").unwrap();
        assert_eq!(a, Provider::from_stored("GIT-IFTO").unwrap(), "same handle");
        assert_eq!(a.id(), "git-ifto");
        assert_eq!(serde_json::to_string(&a).unwrap(), "\"git-ifto\"");
        assert_eq!(serde_json::from_str::<Provider>("\"git-ifto\"").unwrap(), a);
        // not configured here: it exists as data, but nothing about it can be used
        assert!(!a.enabled());
        assert_eq!(Provider::from_id("git-ifto"), None, "not for typed ids");
        assert_eq!((a.web().as_str(), a.label()), ("", "git-ifto"));
        assert_eq!(a.kind(), Kind::Forgejo);
        assert_ne!(a, Provider::Codeberg);
        // what is not an id at all is an error, not a provider
        let too_long = "a".repeat(33);
        for bad in ["", "git_x", "9x", "a b", "x/../y", too_long.as_str()] {
            let json = serde_json::to_string(bad).unwrap();
            assert!(serde_json::from_str::<Provider>(&json).is_err(), "{bad:?}");
        }
        assert!(Provider::from_stored("github").is_some_and(|p| p == Provider::GitHub));
    }

    #[test]
    fn same_login_on_two_providers_is_two_people() {
        let a = Provider::from_stored("git-a").unwrap();
        let b = Provider::from_stored("git-b").unwrap();
        let mut m = std::collections::HashMap::new();
        m.insert((a, 5u64), "a");
        m.insert((b, 5u64), "b");
        m.insert((Provider::Codeberg, 5u64), "c");
        assert_eq!(m.len(), 3);
    }
}
