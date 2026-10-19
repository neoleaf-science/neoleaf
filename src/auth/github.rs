use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct GitHubUser {
    /// which service this account belongs to (old sessions, without the field, are GitHub's)
    #[serde(default)]
    pub provider: crate::provider::Provider,
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub bio: Option<String>,
    #[serde(default)]
    pub company: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub blog: Option<String>,
    #[serde(default)]
    pub public_repos: Option<u64>,
    #[serde(default)]
    pub public_gists: Option<u64>,
    #[serde(default)]
    pub followers: Option<u64>,
    #[serde(default)]
    pub following: Option<u64>,
    #[serde(default)]
    pub created_at: Option<String>,
}

impl GitHubUser {
    #[allow(dead_code)]
    pub fn display_name(&self) -> String {
        let name_valid = self
            .name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        name_valid.unwrap_or(&self.login).to_string()
    }

    /// Returns only the user's first name (or the login, if there is no name).
    pub fn first_name(&self) -> String {
        let name_valid = self
            .name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let full = name_valid.unwrap_or(&self.login).trim();
        full.split_whitespace().next().unwrap_or(full).to_string()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub token_type: String,
    #[serde(default)]
    pub scope: Option<String>,
    /// Codeberg (Forgejo): the token expires (`expires_in`, in seconds) and is renewed with the `refresh_token`
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GitHubEmail {
    email: String,
    primary: bool,
    verified: bool,
}

pub fn get_auth_url(client_id: &str, redirect_uri: &str, state: &str) -> String {
    let scopes = "repo,user:email,read:user";
    format!(
        "{}/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}",
        crate::drive::client::github_web(),
        urlencoding::encode(client_id),
        urlencoding::encode(redirect_uri),
        urlencoding::encode(scopes),
        urlencoding::encode(state)
    )
}

pub async fn exchange_code(
    client: &reqwest::Client,
    code: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, reqwest::Error> {
    let params = [
        ("code", code),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("redirect_uri", redirect_uri),
    ];

    let resp = client
        .post(format!(
            "{}/login/oauth/access_token",
            crate::drive::client::github_web()
        ))
        .header("Accept", "application/json")
        .header("User-Agent", "NeoLeaf-LaTeX")
        .form(&params)
        .send()
        .await?
        .error_for_status()?;

    resp.json::<TokenResponse>().await
}

pub async fn get_user_info(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<GitHubUser, reqwest::Error> {
    let mut user = client
        .get(format!("{}/user", crate::drive::client::github_api()))
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "NeoLeaf-LaTeX")
        .send()
        .await?
        .error_for_status()?
        .json::<GitHubUser>()
        .await?;

    if user.email.is_none()
        && let Ok(emails_resp) = client
            .get(format!(
                "{}/user/emails",
                crate::drive::client::github_api()
            ))
            .header("Authorization", format!("Bearer {}", access_token))
            .header("User-Agent", "NeoLeaf-LaTeX")
            .send()
            .await
        && let Ok(emails) = emails_resp.json::<Vec<GitHubEmail>>().await
        && let Some(primary) = emails.into_iter().find(|e| e.primary && e.verified)
    {
        user.email = Some(primary.email);
    }

    Ok(user)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_first_name() {
        let u1 = GitHubUser {
            name: Some("José Álvaro".into()),
            login: "jdoe".into(),
            ..Default::default()
        };
        assert_eq!(u1.first_name(), "José");

        let u2 = GitHubUser {
            name: Some("   Maria   Silva  ".into()),
            login: "maria".into(),
            ..Default::default()
        };
        assert_eq!(u2.first_name(), "Maria");

        let u3 = GitHubUser {
            name: None,
            login: "jdoe".into(),
            ..Default::default()
        };
        assert_eq!(u3.first_name(), "jdoe");

        let u4 = GitHubUser {
            name: Some("".into()),
            login: "dev".into(),
            ..Default::default()
        };
        assert_eq!(u4.first_name(), "dev");
    }
}
