//! Administration: the dashboard, statistics and blocking of users (GitHub admins only).

use crate::*;

use super::*;

// GET /admin - server administration panel (administrators only)
#[route(GET "/admin")]
pub(crate) async fn admin_dashboard(cx: &Cx) -> Result<Response> {
    let session = match get_session(cx).await {
        Some(s) => s,
        None => {
            return Ok(Response::builder()
                .status(303)
                .header("Location", "/auth/login")
                .body(Body::empty())
                .unwrap());
        }
    };

    if !admin::is_admin(&session.user) {
        return Ok(forbidden_response(
            "Restricted access: this administration panel is only for the administrators of this NeoLeaf server.",
        ));
    }

    let stats = admin::collect_system_stats().await;
    let html = views::admin_page::render(&stats, &session.user);
    Ok(html_response(html))
}

// GET /api/admin/stats - real-time system metrics as JSON
#[route(GET "/api/admin/stats")]
pub(crate) async fn admin_api_stats(cx: &Cx) -> Result<Response> {
    let session = match get_session(cx).await {
        Some(s) => s,
        None => {
            return Ok(Response::builder()
                .status(401)
                .body(Body::from("Not signed in"))
                .unwrap());
        }
    };

    if !admin::is_admin(&session.user) {
        return Ok(Response::builder()
            .status(403)
            .body(Body::from("Access denied"))
            .unwrap());
    }

    let stats = admin::collect_system_stats().await;
    let json = serde_json::to_string(&stats).unwrap_or_else(|_| "{}".to_string());
    Ok(Response::builder()
        .header("Content-Type", "application/json")
        .body(Body::from(json))
        .unwrap())
}

#[derive(Debug, Deserialize)]
pub(crate) struct BlockPayload {
    login: String,
    id: Option<u64>,
    reason: Option<String>,
    /// "github" (default) or "codeberg"
    provider: Option<String>,
}

// POST /api/admin/users/block - blocks a user: ends the sessions and prevents new logins
#[route(POST "/api/admin/users/block")]
pub(crate) async fn admin_block_user(
    cx: &Cx,
    Json(p): Json<BlockPayload>,
) -> Result<Json<serde_json::Value>> {
    let Some(me) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    if !admin::is_admin(&me.user) {
        return Ok(err_json("Access denied"));
    }
    let login = p.login.trim().trim_start_matches('@').to_string();
    let prov = p
        .provider
        .as_deref()
        .and_then(provider::Provider::from_id)
        .unwrap_or_default();
    if !blocklist::valid_login(prov, &login) {
        return Ok(err_json(match prov {
            provider::Provider::GitHub => {
                "Invalid login (use the GitHub login: letters, numbers and hyphen)"
            }
            provider::Provider::Codeberg => {
                "Invalid login (use the Codeberg login: letters, numbers, hyphen, underscore and dot)"
            }
        }));
    }
    // if the person has a session, we use its data (id, name, email, to know whether they are an administrator)
    let known = session::list_sessions()
        .await
        .into_iter()
        .map(|s| s.user)
        .find(|u| {
            u.provider == prov
                && (u.login.eq_ignore_ascii_case(&login)
                    || p.id.is_some_and(|i| i != 0 && i == u.id))
        });
    let target = known.unwrap_or_else(|| GitHubUser {
        provider: prov,
        id: p.id.unwrap_or(0),
        login: login.clone(),
        ..Default::default()
    });
    if target.provider == me.user.provider
        && (target.login.eq_ignore_ascii_case(&me.user.login)
            || (me.user.id != 0 && target.id == me.user.id))
    {
        return Ok(err_json("You cannot block yourself"));
    }
    if admin::is_admin(&target) {
        return Ok(err_json("An administrator cannot be blocked"));
    }
    let entry = blocklist::Blocked {
        provider: target.provider,
        id: target.id,
        login: target.login.clone(),
        name: target.name.clone(),
        avatar_url: target.avatar_url.clone(),
        reason: blocklist::clean_reason(p.reason.as_deref().unwrap_or("")),
        blocked_at: blocklist::now(),
        blocked_by: me.user.login.clone(),
    };
    if let Err(e) = blocklist::block(entry) {
        return Ok(err_json(e));
    }
    let removed = session::remove_user(target.provider, target.id, &target.login).await;
    eprintln!(
        "Admin @{} blocked @{} ({removed} session(s) ended)",
        me.user.login, target.login
    );
    Ok(Json(
        serde_json::json!({ "success": true, "sessions_removed": removed }),
    ))
}

#[derive(Debug, Deserialize)]
pub(crate) struct UnblockPayload {
    login: String,
    provider: Option<String>,
}

// POST /api/admin/users/unblock - removes a user's block
#[route(POST "/api/admin/users/unblock")]
pub(crate) async fn admin_unblock_user(
    cx: &Cx,
    Json(p): Json<UnblockPayload>,
) -> Result<Json<serde_json::Value>> {
    let Some(me) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    if !admin::is_admin(&me.user) {
        return Ok(err_json("Access denied"));
    }
    let login = p.login.trim().trim_start_matches('@');
    let prov = p
        .provider
        .as_deref()
        .and_then(provider::Provider::from_id)
        .unwrap_or_default();
    if !blocklist::unblock(prov, login) {
        return Ok(err_json("This user is not blocked"));
    }
    eprintln!("Admin @{} unblocked @{login}", me.user.login);
    Ok(Json(serde_json::json!({ "success": true })))
}
