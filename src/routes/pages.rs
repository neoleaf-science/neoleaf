//! Server-rendered pages (home, privacy, terms, agent) and their redirects.

use crate::*;

use super::*;

// GET / - Dashboard or Login
#[route(GET "/")]
pub(crate) async fn home(cx: &Cx) -> Result<Response> {
    let has_github_creds = github_configured();

    if let Some(session) = get_session(cx).await {
        let drive = DriveClient::for_session(&session);
        let (projects, list_error) = match drive.list_projects().await {
            Ok((p, warn)) => (p, warn),
            Err(e) => {
                eprintln!("Error listing projects from GitHub: {e}");
                // token rejected by GitHub: staying on this screen is pointless, go to the login
                if is_auth_expired(&e) {
                    return Ok(redirect_session_expired());
                }
                (Vec::new(), Some(e.to_string()))
            }
        };
        let invitations = drive.list_invitations().await.unwrap_or_default();
        let is_admin = admin::is_admin(&session.user);

        let html = views::dashboard_page::render(
            &session.user,
            &projects,
            list_error.as_deref(),
            &invitations,
            is_admin,
        );
        Ok(html_response(html))
    } else {
        let query = topcoat::router::query_params::<HomeQuery>(cx).ok();
        // with `neoleaf.toml` (an institution install) the sign-in screen is the branded one; without it, the NeoLeaf landing page
        if let Some(cfg) = config::get() {
            let notice = match query.as_ref() {
                Some(q) if q.deleted.is_some() => {
                    Some(views::institution_login::Notice::AccountDeleted)
                }
                Some(q) if q.blocked.is_some() => {
                    Some(views::institution_login::Notice::AccountBlocked)
                }
                Some(q) if q.expired.is_some() => {
                    Some(views::institution_login::Notice::SessionExpired)
                }
                _ => None,
            };
            let providers: Vec<_> = cfg
                .enabled_providers()
                .into_iter()
                .filter(|p| p.enabled())
                .collect();
            return Ok(html_response(views::institution_login::render(
                cfg, &providers, notice,
            )));
        }
        let mut html =
            views::login_page::render(has_github_creds, provider::Provider::Codeberg.enabled());
        if query.as_ref().and_then(|q| q.deleted.clone()).is_some() {
            html = views::with_account_deleted_notice(&html);
        } else if query.as_ref().and_then(|q| q.blocked.clone()).is_some() {
            html = views::with_blocked_notice(&html);
        } else if query.as_ref().and_then(|q| q.expired.clone()).is_some() {
            html = views::with_session_expired_notice(&html);
        }
        Ok(html_response(html))
    }
}

// GET /privacy - Privacy Policy
#[route(GET "/privacy")]
pub(crate) async fn privacy(_cx: &Cx) -> Result<Response> {
    // an institution install points to its own policy (`[legal]` in neoleaf.toml); the built-in text speaks for neoleaf.science
    if let Some(url) = config::get().and_then(|c| c.legal.privacy_url.clone()) {
        return Ok(redirect_to(&url));
    }
    Ok(html_response(views::privacy_page::render()))
}

// GET /terms - Terms of Use
#[route(GET "/terms")]
pub(crate) async fn terms(_cx: &Cx) -> Result<Response> {
    if let Some(url) = config::get().and_then(|c| c.legal.terms_url.clone()) {
        return Ok(redirect_to(&url));
    }
    Ok(html_response(views::terms_page::render()))
}

// GET /licenses - open-source licenses and notices
#[route(GET "/licenses")]
pub(crate) async fn licenses(_cx: &Cx) -> Result<Response> {
    Ok(html_response(views::licenses_page::render()))
}

// GET /agent - explains the compilation engines (WASM vs local agent) and the agent download
#[route(GET "/agent")]
pub(crate) async fn agent_page(_cx: &Cx) -> Result<Response> {
    Ok(html_response(views::agent_page::render()))
}

// Legacy Portuguese addresses, kept only so links published before the English paths keep working.
#[route(GET "/privacidade")]
pub(crate) async fn privacy_legacy(_cx: &Cx) -> Result<SeeOther> {
    Ok(see_other("/privacy"))
}

#[route(GET "/termos")]
pub(crate) async fn terms_legacy(_cx: &Cx) -> Result<SeeOther> {
    Ok(see_other("/terms"))
}

#[route(GET "/agente")]
pub(crate) async fn agent_legacy(_cx: &Cx) -> Result<SeeOther> {
    Ok(see_other("/agent"))
}

// GET /download/agent - direct download of the compiled agent binary
#[route(GET "/download/agent")]
pub(crate) async fn agent_download_redirect(_cx: &Cx) -> Result<SeeOther> {
    Ok(see_other("/static/agent/neoleaf-agent-linux-x86_64"))
}

#[query_params]
pub(crate) struct HomeQuery {
    pub(crate) expired: Option<String>,
    pub(crate) blocked: Option<String>,
    pub(crate) deleted: Option<String>,
}

/// 303 to an address that `config.rs` already validated (https, no spaces or quotes).
fn redirect_to(url: &str) -> Response {
    Response::builder()
        .status(303)
        .header("Location", url)
        .header("Cache-Control", "no-store")
        .body(Body::empty())
        .unwrap()
}
