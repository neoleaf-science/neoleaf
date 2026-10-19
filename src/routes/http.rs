//! Response helpers, cookies and session access shared by every route.

use crate::*;

/// Identifier of this server run (the time it started). Each deploy restarts the service and changes the value.
pub(crate) fn build_id() -> &'static str {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
            .to_string()
    })
}

/// Adds `?v=<id>` to the `/static/js/*.js` and `/static/css/*.css` addresses of a page. Cloudflare forces a 4 hour browser
/// cache even with `no-cache` at the origin; with a new address on every deploy, nobody keeps the old JavaScript.
pub(crate) fn bust_static(html: &str, id: &str) -> String {
    let mut out = String::with_capacity(html.len() + 512);
    let mut rest = html;
    while let Some(i) = ["/static/js/", "/static/css/", "/static/texlive/"]
        .iter()
        .filter_map(|p| rest.find(p))
        .min()
    {
        let (head, tail) = rest.split_at(i);
        out.push_str(head);
        let end = tail
            .find(['"', '\'', '`', ')', ' ', '<', '>', '?', '\n'])
            .unwrap_or(tail.len());
        let path = &tail[..end];
        out.push_str(path);
        let after = &tail[end..];
        if (path.ends_with(".js") || path.ends_with(".css")) && !after.starts_with('?') {
            out.push_str("?v=");
            out.push_str(id);
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

pub(crate) fn html_response(html: String) -> Response {
    Response::builder()
        .header("Content-Type", "text/html; charset=utf-8")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(bust_static(&html, build_id())))
        .unwrap()
}

pub(crate) fn forbidden_response(msg: &str) -> Response {
    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Restricted Access - NeoLeaf</title>
    <link rel="stylesheet" href="/static/css/editor.css">
</head>
<body class="dashboard-body" style="display:flex;align-items:center;justify-content:center;min-height:80vh;text-align:center;padding:20px;">
    <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:36px;max-width:500px;box-shadow:0 4px 16px rgba(0,0,0,0.1);">
        <div style="font-size:42px;margin-bottom:12px;">🚫</div>
        <h2 style="color:var(--text-bright);margin-bottom:12px;">Restricted Access for Administrators</h2>
        <p style="color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:24px;">{}</p>
        <a href="/" class="btn btn-primary" style="text-decoration:none;padding:10px 20px;">Back to Projects</a>
    </div>
</body>
</html>"#,
        views::esc(msg)
    );
    Response::builder()
        .status(403)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(html))
        .unwrap()
}

pub(crate) fn owned_response(content: String, content_type: &'static str) -> Response {
    Response::builder()
        .header("Content-Type", content_type)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-cache")
        .body(Body::from(content))
        .unwrap()
}

/// `Secure` cookies unless REDIRECT_URI explicitly points at a local development address (http://localhost or http://127.0.0.1).
/// A missing or odd REDIRECT_URI therefore never silently turns the flag off.
pub(crate) fn secure_cookies() -> bool {
    secure_for(std::env::var("REDIRECT_URI").ok().as_deref())
}

fn secure_for(redirect_uri: Option<&str>) -> bool {
    let local = |u: &str| {
        ["http://localhost", "http://127.0.0.1"].iter().any(|p| {
            u.strip_prefix(p)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with([':', '/']))
        })
    };
    !redirect_uri.is_some_and(|u| local(u.trim()))
}

pub(crate) fn build_cookie(
    name: &'static str,
    value: String,
    max_age_secs: i64,
) -> Cookie<'static> {
    Cookie::build((name, value))
        .path("/")
        .http_only(true)
        .secure(secure_cookies())
        .same_site(cookie::SameSite::Lax)
        .max_age(cookie::time::Duration::seconds(max_age_secs))
        .build()
}

/// The user's session (with a valid access token, renewed if needed). The cookie only carries a random id.
pub(crate) async fn get_session(cx: &Cx) -> Option<Active> {
    let sid = cookies(cx).get("latex_session")?.value().to_string();
    session::active(&sid).await
}

pub(crate) fn set_session(cx: &Cx, sid: String) {
    cookies(cx).add(build_cookie("latex_session", sid, 30 * 24 * 3600));
}

/// Removes a cookie with the same Path and flags it was set with (a browser matches on name, domain and path).
pub(crate) fn clear_cookie(cx: &Cx, name: &'static str) {
    cookies(cx).remove(
        Cookie::build((name, ""))
            .path("/")
            .http_only(true)
            .secure(secure_cookies())
            .same_site(cookie::SameSite::Lax)
            .build(),
    );
}

pub(crate) fn clear_session(cx: &Cx) {
    clear_cookie(cx, "latex_session");
}

pub(crate) fn random_state() -> String {
    use base64::Engine;
    let bytes: [u8; 24] = rand::random();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn github_configured() -> bool {
    let id = std::env::var("GITHUB_CLIENT_ID").unwrap_or_default();
    !id.is_empty() && !id.contains("seu_")
}

/// GitHub rejected the token (revoked, expired or invalid): the session is no longer usable and the person must sign in again.
pub(crate) fn is_auth_expired(msg: &str) -> bool {
    msg.contains("401") && (msg.contains("Bad credentials") || msg.contains("Unauthorized"))
}

pub(crate) fn err_json(msg: impl ToString) -> Json<serde_json::Value> {
    let msg = msg.to_string();
    // `auth_expired` makes the browser leave the session and go to the login (session-guard.js)
    if is_auth_expired(&msg) {
        return Json(serde_json::json!({ "error": msg, "auth_expired": true }));
    }
    Json(serde_json::json!({ "error": msg }))
}

/// Clears the session and goes back to the login, saying that it expired.
pub(crate) fn redirect_session_expired() -> Response {
    Response::builder()
        .status(303)
        .header("Location", "/auth/logout?expired=1")
        .body(Body::empty())
        .unwrap()
}

pub(crate) fn plain(status: u16, msg: &'static str) -> Response {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(msg))
        .unwrap()
}

#[cfg(test)]
mod cookie_tests {
    use super::*;

    #[test]
    fn secure_unless_explicitly_local() {
        assert!(!secure_for(Some("http://localhost:3000/auth/callback")));
        assert!(!secure_for(Some("http://127.0.0.1:3001/auth/callback")));
        assert!(!secure_for(Some("http://localhost")));
        assert!(secure_for(None), "unset: secure");
        assert!(secure_for(Some("")));
        assert!(secure_for(Some("https://neoleaf.science/auth/callback")));
        assert!(
            secure_for(Some("http://neoleaf.science/auth/callback")),
            "plain http on a real host: still secure"
        );
        assert!(
            secure_for(Some("http://localhost.evil.example/auth/callback")),
            "a look-alike host is not local"
        );
        assert!(secure_for(Some("http://127.0.0.1.evil.example/")));
    }

    #[test]
    fn response_helpers_send_nosniff() {
        assert_eq!(
            html_response("<p>x</p>".into()).headers()["x-content-type-options"],
            "nosniff"
        );
        assert_eq!(
            forbidden_response("no").headers()["x-content-type-options"],
            "nosniff"
        );
        assert_eq!(
            plain(404, "x").headers()["x-content-type-options"],
            "nosniff"
        );
        assert_eq!(
            owned_response("x".into(), "text/css").headers()["x-content-type-options"],
            "nosniff"
        );
    }
}

#[cfg(test)]
mod auth_expired_tests {
    use super::*;

    #[test]
    fn recognizes_a_token_rejected_by_github() {
        let msg = r#"GitHub API retornou 401 Unauthorized: { "message": "Bad credentials", "status": "401" }"#;
        assert!(is_auth_expired(msg));
        assert!(is_auth_expired(
            "GitHub refused (reading the tags, 401 Unauthorized): Bad credentials"
        ));
        assert!(!is_auth_expired(
            "GitHub API retornou 403 Forbidden: rate limit"
        ));
        assert!(!is_auth_expired("GitHub API retornou 404 Not Found"));
        assert!(!is_auth_expired("file 401.tex does not exist"));
    }

    #[test]
    fn err_json_flags_expiry_only_when_it_applies() {
        let v = err_json("GitHub API retornou 401 Unauthorized: Bad credentials").0;
        assert_eq!(v["auth_expired"], true);
        let v = err_json("Project not found").0;
        assert!(v.get("auth_expired").is_none());
        assert_eq!(v["error"], "Project not found");
    }
}

#[cfg(test)]
mod bust_static_tests {
    use super::bust_static;

    #[test]
    fn static_file_addresses_get_a_version() {
        let html = r#"<link href="/static/css/editor.css"><script src="/static/js/a.js"></script><script src="/static/js/b.js?x=1"></script><img src="/static/img/l.png"><script src="/static/vendor/v.js"></script> fetch('/static/js/c.js')"#;
        let v = bust_static(html, "42");
        assert!(v.contains(r#"/static/css/editor.css?v=42""#));
        assert!(v.contains(r#"/static/js/a.js?v=42""#));
        assert!(
            v.contains(r#"/static/js/b.js?x=1""#) && !v.contains("b.js?v="),
            "an address that already has a query is left alone"
        );
        assert!(
            v.contains(r#"/static/img/l.png""#) && v.contains(r#"/static/vendor/v.js""#),
            "images and vendor files stay as they are"
        );
        assert!(v.contains("'/static/js/c.js?v=42'"));
    }

    #[test]
    fn the_engine_scripts_get_a_version_but_not_their_wasm_or_data() {
        let html = r#"import { PdfLatex } from '/static/texlive/texlive.js'; fetch('/static/texlive/pdflatex.wasm'); fetch('/static/texlive/fonts/manifest.json');"#;
        let v = bust_static(html, "42");
        assert!(v.contains("'/static/texlive/texlive.js?v=42'"), "{v}");
        assert!(
            v.contains("'/static/texlive/pdflatex.wasm'")
                && v.contains("'/static/texlive/fonts/manifest.json'"),
            "{v}"
        );
    }
}
