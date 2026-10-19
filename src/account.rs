//! Deleting one's own account: removes access and whatever NeoLeaf stores on the server about the person.
//!
//! Never touches GitHub repositories. The only per-person data on the server are the sessions (with the access token):
//! the project lives in the browser and on their GitHub. The app's authorization on the GitHub account is revoked so the
//! token stops being valid there too.

/// Revokes NeoLeaf's authorization on the GitHub account (all of this person's tokens for this app).
/// Needs the OAuth client id/secret; without them there is nothing to revoke.
pub async fn revoke_github_grant(
    client_id: &str,
    client_secret: &str,
    access_token: &str,
) -> Result<(), String> {
    if client_id.is_empty() || client_secret.is_empty() {
        return Err("GitHub OAuth is not configured on this server".to_string());
    }
    let resp = reqwest::Client::new()
        .delete(format!(
            "{}/applications/{client_id}/grant",
            crate::drive::client::github_api()
        ))
        .basic_auth(client_id, Some(client_secret))
        .header("User-Agent", "NeoLeaf-LaTeX")
        .header("Accept", "application/vnd.github+json")
        .json(&serde_json::json!({ "access_token": access_token }))
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    // 204: revoked; 404: the authorization no longer existed
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(format!("GitHub responded {}", resp.status()))
    }
}
