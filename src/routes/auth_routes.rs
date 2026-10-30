//! Sign-in and sign-out (GitHub and Codeberg), the OAuth callbacks, the user profile and account deletion.

use crate::*;

use super::*;

#[derive(Debug, Deserialize)]
pub(crate) struct DeleteAccountPayload {
    /// the person's own login, typed again (second check)
    confirm_login: String,
}

// POST /api/account/delete - the person deletes their own account: removes the access and the data on the NeoLeaf server.
// It does not touch the GitHub repositories.
#[route(POST "/api/account/delete")]
pub(crate) async fn delete_own_account(
    cx: &Cx,
    Json(p): Json<DeleteAccountPayload>,
) -> Result<Json<serde_json::Value>> {
    let Some(me) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    if !p
        .confirm_login
        .trim()
        .trim_start_matches('@')
        .eq_ignore_ascii_case(&me.user.login)
    {
        return Ok(err_json("The login you typed does not match your account"));
    }
    // 1) revoke the authorization on GitHub (needs the token, so it comes before deleting the session)
    // (on Codeberg there is no way to revoke through the API: the person removes NeoLeaf in Settings > Applications)
    let revoked = if me.user.provider != provider::Provider::GitHub {
        false
    } else {
        let id = provider::Provider::GitHub.client_id();
        let secret = provider::Provider::GitHub.client_secret();
        match account::revoke_github_grant(&id, &secret, &me.access_token).await {
            Ok(()) => true,
            Err(e) => {
                eprintln!("Account deletion: could not revoke the authorization on GitHub: {e}");
                false
            }
        }
    };
    // 2) end all of the person's sessions
    let sessions = session::remove_user(me.user.provider, me.user.id, &me.user.login).await;
    clear_session(cx);
    // on purpose without the login: erasing the data must not leave the identification in the application logs
    eprintln!(
        "Account deleted by the person themselves ({sessions} session(s), authorization revoked: {revoked})"
    );
    Ok(Json(
        serde_json::json!({ "success": true, "sessions_removed": sessions, "github_grant_revoked": revoked }),
    ))
}

// GET /auth/login - Redirect to GitHub OAuth
#[route(GET "/auth/login")]
pub(crate) async fn auth_login(cx: &Cx) -> Result<SeeOther> {
    // with `neoleaf.toml` a provider that is not switched on cannot be used, even by typing the address
    if config::get().is_some() && !provider::Provider::GitHub.enabled() {
        return Ok(see_other("/"));
    }
    let client_id = provider::Provider::GitHub.client_id();
    let redirect_uri = std::env::var("REDIRECT_URI")
        .unwrap_or_else(|_| "http://localhost:3000/auth/callback".to_string());

    let state = random_state();
    cookies(cx).add(build_cookie("oauth_state", state.clone(), 600));
    let url = auth::github::get_auth_url(&client_id, &redirect_uri, &state);
    Ok(see_other(url))
}

// GET /auth/logout (kept only for the "sign out" links of the interface) and POST /auth/logout (for anything that is not a plain link)
#[route(GET "/auth/logout")]
pub(crate) async fn auth_logout(cx: &Cx) -> Result<SeeOther> {
    logout(cx).await
}

#[route(POST "/auth/logout")]
pub(crate) async fn auth_logout_post(cx: &Cx) -> Result<SeeOther> {
    logout(cx).await
}

async fn logout(cx: &Cx) -> Result<SeeOther> {
    if let Some(c) = cookies(cx).get("latex_session") {
        session::remove(c.value()).await;
    }
    clear_session(cx);
    let expired = topcoat::router::query_params::<HomeQuery>(cx)
        .ok()
        .and_then(|q| q.expired.clone())
        .is_some();
    Ok(see_other(if expired { "/?expired=1" } else { "/" }))
}

// GET /api/user/profile - returns the user's full data obtained from GitHub
#[route(GET "/api/user/profile")]
pub(crate) async fn api_user_profile(cx: &Cx) -> Result<Json<serde_json::Value>> {
    let session = match get_session(cx).await {
        Some(s) => s,
        None => return Ok(Json(serde_json::json!({ "error": "Not signed in" }))),
    };

    let mut user = session.user.clone();

    // re-read the profile from the provider at most once every 5 minutes per session; the file is rewritten only if it changed
    if session::profile_refresh_due(&session.sid).await {
        let client = session::http_client();
        let fresh = match session.user.provider.kind() {
            provider::Kind::GitHub => auth::github::get_user_info(client, &session.access_token)
                .await
                .map_err(|_| ()),
            provider::Kind::Forgejo => {
                auth::forgejo::get_user_info(client, session.user.provider, &session.access_token)
                    .await
                    .map_err(|_| ())
            }
        };
        if let Ok(fresh) = fresh {
            user = fresh;
            session::update_user(&session.sid, user.clone()).await;
        }
    }

    let first_name = user.first_name();
    let display_name = user.display_name();
    let html_url = user
        .html_url
        .clone()
        .unwrap_or_else(|| user.provider.repo_url(&user.login));

    Ok(Json(serde_json::json!({
        "id": user.id,
        "login": user.login,
        "name": user.name,
        "display_name": display_name,
        "first_name": first_name,
        "email": user.email,
        "avatar_url": user.avatar_url,
        "html_url": html_url,
        "bio": user.bio,
        "company": user.company,
        "location": user.location,
        "blog": user.blog,
        "public_repos": user.public_repos.unwrap_or(0),
        "public_gists": user.public_gists.unwrap_or(0),
        "followers": user.followers.unwrap_or(0),
        "following": user.following.unwrap_or(0),
        "created_at": user.created_at,
    })))
}

// GET /auth/callback - GitHub OAuth callback
#[query_params]
pub(crate) struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
}

pub(crate) async fn handle_github_callback(cx: &Cx) -> Result<SeeOther> {
    if config::get().is_some() && !provider::Provider::GitHub.enabled() {
        return Ok(see_other("/"));
    }
    let client_id = provider::Provider::GitHub.client_id();
    let client_secret = provider::Provider::GitHub.client_secret();
    let redirect_uri = std::env::var("REDIRECT_URI")
        .unwrap_or_else(|_| "http://localhost:3000/auth/callback".to_string());

    let expected = cookies(cx)
        .get("oauth_state")
        .map(|c| c.value().to_string());
    clear_cookie(cx, "oauth_state");

    if let Ok(query) = topcoat::router::query_params::<CallbackQuery>(cx) {
        let state_ok =
            matches!((&expected, &query.state), (Some(e), Some(g)) if !e.is_empty() && e == g);
        if !state_ok {
            eprintln!("Login refused: OAuth state missing or different");
            return Ok(see_other("/"));
        }
        if let Some(code) = &query.code {
            let http = session::http_client();
            match auth::github::exchange_code(http, code, &client_id, &client_secret, &redirect_uri)
                .await
            {
                Ok(token_res) => match auth::github::get_user_info(http, &token_res.access_token)
                    .await
                {
                    Ok(user) => {
                        // account blocked by the administrator: no session is created
                        if blocklist::is_blocked(user.provider, user.id, &user.login) {
                            eprintln!("Login refused: @{} is blocked", user.login);
                            return Ok(see_other("/?blocked=1"));
                        }
                        let sid = session::create(user, token_res.access_token, None, None).await;
                        set_session(cx, sid);
                    }
                    Err(e) => eprintln!("Error reading the user data from GitHub: {e}"),
                },
                Err(e) => eprintln!("Error exchanging the GitHub code for a token: {e}"),
            }
        }
    }

    Ok(see_other("/"))
}

// GET /auth/login/codeberg - redirects to the Codeberg OAuth (only if the server has the application keys)
#[route(GET "/auth/login/codeberg")]
pub(crate) async fn auth_login_codeberg(cx: &Cx) -> Result<SeeOther> {
    let prov = provider::Provider::Codeberg;
    if !prov.enabled() {
        return Ok(see_other("/"));
    }
    let state = random_state();
    cookies(cx).add(build_cookie("oauth_state", state.clone(), 600));
    Ok(see_other(auth::forgejo::get_auth_url(
        prov,
        &prov.client_id(),
        &prov.redirect_uri(),
        &state,
    )))
}

// GET /auth/callback/codeberg - back from Codeberg with the code; creates the session (the token expires and is renewed with the refresh token)
#[route(GET "/auth/callback/codeberg")]
pub(crate) async fn auth_callback_codeberg(cx: &Cx) -> Result<SeeOther> {
    let prov = provider::Provider::Codeberg;
    let expected = cookies(cx)
        .get("oauth_state")
        .map(|c| c.value().to_string());
    clear_cookie(cx, "oauth_state");
    if !prov.enabled() {
        return Ok(see_other("/"));
    }
    if let Ok(query) = topcoat::router::query_params::<CallbackQuery>(cx) {
        let state_ok =
            matches!((&expected, &query.state), (Some(e), Some(g)) if !e.is_empty() && e == g);
        if !state_ok {
            eprintln!("Login refused: OAuth state missing or different");
            return Ok(see_other("/"));
        }
        if let Some(code) = &query.code {
            let http = session::http_client();
            match auth::forgejo::exchange_code(
                http,
                prov,
                code,
                &prov.client_id(),
                &prov.client_secret(),
                &prov.redirect_uri(),
            )
            .await
            {
                Ok(tok) => {
                    match auth::forgejo::get_user_info(http, prov, &tok.access_token).await {
                        Ok(user) => {
                            if blocklist::is_blocked(user.provider, user.id, &user.login) {
                                eprintln!("Login refused: @{} is blocked", user.login);
                                return Ok(see_other("/?blocked=1"));
                            }
                            let sid = session::create(
                                user,
                                tok.access_token,
                                tok.refresh_token,
                                Some(tok.expires_in.unwrap_or(3600)),
                            )
                            .await;
                            set_session(cx, sid);
                        }
                        Err(e) => eprintln!("Error reading the user data from Codeberg: {e}"),
                    }
                }
                Err(e) => eprintln!("Error exchanging the Codeberg code for a token: {e}"),
            }
        }
    }
    Ok(see_other("/"))
}

#[route(GET "/auth/callback")]
pub(crate) async fn auth_callback(cx: &Cx) -> Result<SeeOther> {
    handle_github_callback(cx).await
}

#[route(GET "/auth/github/callback")]
pub(crate) async fn auth_github_callback(cx: &Cx) -> Result<SeeOther> {
    handle_github_callback(cx).await
}
