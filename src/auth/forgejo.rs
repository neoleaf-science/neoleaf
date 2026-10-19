//! Login with Codeberg (Forgejo): OAuth2 with authorization code and token renewal (the token expires, by default after 1 hour).

use serde::Deserialize;

use crate::auth::github::{GitHubUser, TokenResponse};
use crate::provider::{Provider, codeberg_web};

pub fn get_auth_url(client_id: &str, redirect_uri: &str, state: &str) -> String {
    format!(
        "{}/login/oauth/authorize?client_id={}&redirect_uri={}&response_type=code&state={}",
        codeberg_web(),
        urlencoding::encode(client_id),
        urlencoding::encode(redirect_uri),
        urlencoding::encode(state)
    )
}

/// Why renewing the access token failed: the difference decides whether the session is kept.
#[derive(Debug, PartialEq)]
pub enum RefreshError {
    /// the provider definitively refused the refresh token (revoked, already used, expired): the session cannot be renewed
    Refused(String),
    /// network error, timeout, 5xx or an answer we could not read: nothing was decided, try again later
    Transient(String),
}

/// A 400 or 401 from the token endpoint with an OAuth error such as `invalid_grant` means the refresh token is dead.
/// `invalid_client` (and its kin) means NeoLeaf's own application keys are wrong: that says nothing about the person's token.
fn is_definitive_refusal(status: u16, body: &str) -> bool {
    if status != 400 && status != 401 {
        return false;
    }
    let error = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str().map(str::to_string)));
    !matches!(
        error.as_deref(),
        Some(
            "invalid_client" | "unauthorized_client" | "invalid_request" | "unsupported_grant_type"
        )
    )
}

async fn token_request(
    client: &reqwest::Client,
    params: &[(&str, &str)],
) -> Result<TokenResponse, RefreshError> {
    let resp = client
        .post(format!("{}/login/oauth/access_token", codeberg_web()))
        .header("Accept", "application/json")
        .header("User-Agent", "NeoLeaf-LaTeX")
        .form(params)
        .send()
        .await
        .map_err(|e| RefreshError::Transient(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let msg = format!("Codeberg rejected the request ({status})");
        return Err(if is_definitive_refusal(status.as_u16(), &body) {
            RefreshError::Refused(msg)
        } else {
            RefreshError::Transient(msg)
        });
    }
    resp.json::<TokenResponse>()
        .await
        .map_err(|e| RefreshError::Transient(e.to_string()))
}

fn message(e: RefreshError) -> String {
    match e {
        RefreshError::Refused(m) | RefreshError::Transient(m) => m,
    }
}

pub async fn exchange_code(
    client: &reqwest::Client,
    code: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, String> {
    token_request(
        client,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri),
        ],
    )
    .await
    .map_err(message)
}

pub async fn refresh(
    client: &reqwest::Client,
    refresh_token: &str,
) -> Result<TokenResponse, RefreshError> {
    token_request(
        client,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &Provider::Codeberg.client_id()),
            ("client_secret", &Provider::Codeberg.client_secret()),
        ],
    )
    .await
}

#[derive(Debug, Deserialize)]
struct ForgejoUser {
    id: u64,
    login: String,
    #[serde(default)]
    full_name: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    avatar_url: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    location: Option<String>,
    #[serde(default)]
    website: Option<String>,
    #[serde(default)]
    followers_count: Option<u64>,
    #[serde(default)]
    following_count: Option<u64>,
    #[serde(default)]
    created: Option<String>,
}

impl ForgejoUser {
    fn into_user(self) -> GitHubUser {
        GitHubUser {
            provider: Provider::Codeberg,
            id: self.id,
            login: self.login,
            name: self.full_name,
            email: self.email.filter(|e| !e.is_empty()),
            avatar_url: self.avatar_url,
            html_url: self.html_url,
            bio: self.description.filter(|d| !d.is_empty()),
            company: None,
            location: self.location.filter(|d| !d.is_empty()),
            blog: self.website.filter(|d| !d.is_empty()),
            public_repos: None,
            public_gists: None,
            followers: self.followers_count,
            following: self.following_count,
            created_at: self.created,
        }
    }
}

pub async fn get_user_info(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<GitHubUser, String> {
    let resp = client
        .get(format!("{}/user", Provider::Codeberg.api()))
        .header("Authorization", format!("Bearer {access_token}"))
        .header("User-Agent", "NeoLeaf-LaTeX")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Codeberg rejected the token ({})", resp.status()));
    }
    Ok(resp
        .json::<ForgejoUser>()
        .await
        .map_err(|e| e.to_string())?
        .into_user())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forgejo_user_becomes_the_neoleaf_user() {
        let v: ForgejoUser = serde_json::from_str(r#"{"id":7,"login":"ana","full_name":"Ana Souza","email":"","avatar_url":"https://x/a.png","html_url":"https://codeberg.org/ana","description":"","location":"Salvador","website":"","followers_count":3,"following_count":4,"created":"2024-01-01T00:00:00Z"}"#).unwrap();
        let u = v.into_user();
        assert_eq!(u.provider, Provider::Codeberg);
        assert_eq!(
            (u.id, u.login.as_str(), u.name.as_deref()),
            (7, "ana", Some("Ana Souza"))
        );
        assert_eq!(u.email, None);
        assert_eq!(u.bio, None);
        assert_eq!(u.location.as_deref(), Some("Salvador"));
        assert_eq!(u.followers, Some(3));
    }

    #[test]
    fn only_a_dead_refresh_token_is_a_definitive_refusal() {
        assert!(is_definitive_refusal(400, r#"{"error":"invalid_grant"}"#));
        assert!(is_definitive_refusal(
            401,
            r#"{"error":"invalid_grant","error_description":"refresh token not found"}"#
        ));
        assert!(is_definitive_refusal(400, "not json"));
        // NeoLeaf's own keys are wrong, or the provider is struggling: the person's session must survive
        assert!(!is_definitive_refusal(401, r#"{"error":"invalid_client"}"#));
        for status in [429, 500, 502, 503, 504, 404] {
            assert!(
                !is_definitive_refusal(status, r#"{"error":"invalid_grant"}"#),
                "{status}"
            );
        }
    }

    #[test]
    fn endereco_de_login() {
        let u = get_auth_url("id", "http://localhost:3000/auth/callback/codeberg", "st");
        assert!(
            u.contains("/login/oauth/authorize?client_id=id")
                && u.contains("response_type=code")
                && u.contains("state=st"),
            "{u}"
        );
    }
}
