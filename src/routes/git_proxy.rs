//! Stateless proxy for the Git smart HTTP protocol (GitHub does not allow CORS on it). Nothing is stored here.
//!
//! The browser calls it from the app's own origin, so there is no CORS: no `Access-Control-*` header is sent unless the `Origin`
//! is the app itself. Every response is `no-store`, streamed with a size cap, and a person can have only a few requests in flight.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;

use crate::*;

use super::*;

path_param!(pub git_owner: String);
path_param!(pub git_repo: String);

#[query_params]
pub(crate) struct GitInfoRefsQuery {
    service: Option<String>,
}

/// Largest response relayed to the browser (a clone of a big repository); past it the stream is aborted.
const RESPONSE_MAX: usize = 100 * 1024 * 1024;
/// Simultaneous Git proxy requests per person.
const CONCURRENT_MAX: usize = 4;

/// One client for every proxied request: connection reuse, a connect timeout and an overall one suited to a large clone or push.
/// Redirects are followed only inside the same host (the `Authorization` header never leaves it).
fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(600))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                let same_host = attempt.previous().last().is_some_and(|prev| {
                    prev.host_str() == attempt.url().host_str()
                        && prev.port_or_known_default() == attempt.url().port_or_known_default()
                });
                if same_host && attempt.previous().len() < 3 {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .expect("HTTP client of the Git proxy")
    })
}

static IN_FLIGHT: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();

/// Slot of a person's concurrency limit; released when dropped (also when the streamed body is dropped).
pub(crate) struct GitSlot(String);

impl GitSlot {
    /// `None` when the person already has `CONCURRENT_MAX` requests in flight.
    pub(crate) fn acquire(key: &str) -> Option<GitSlot> {
        let mut map = IN_FLIGHT
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let n = map.entry(key.to_string()).or_insert(0);
        if *n >= CONCURRENT_MAX {
            return None;
        }
        *n += 1;
        Some(GitSlot(key.to_string()))
    }
}

impl Drop for GitSlot {
    fn drop(&mut self) {
        let mut map = IN_FLIGHT
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(n) = map.get_mut(&self.0) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                map.remove(&self.0);
            }
        }
    }
}

/// The `Origin` of the request when it is the app itself (same host and port as `Host`); `None` otherwise or without `Origin`.
fn own_origin(cx: &Cx) -> Option<String> {
    let hdrs = topcoat::router::request::headers(cx);
    let origin = hdrs.get("origin").and_then(|v| v.to_str().ok())?;
    let host = hdrs.get("host").and_then(|v| v.to_str().ok())?;
    let origin_host = origin.split_once("://")?.1;
    (!host.is_empty() && origin_host == host).then(|| origin.to_string())
}

/// Common headers of every proxy response: never cached, varies by `Origin`, CORS only for the app's own origin.
fn reply(cx: &Cx, status: u16, extra: &[(&str, String)], body: Body) -> Response {
    let mut b = Response::builder()
        .status(status)
        .header("Cache-Control", "no-store")
        .header("Vary", "Origin");
    if let Some(origin) = own_origin(cx) {
        b = b.header("Access-Control-Allow-Origin", origin).header(
            "Access-Control-Expose-Headers",
            "Content-Type, x-git-protocol",
        );
    }
    for (k, v) in extra {
        b = b.header(*k, v.as_str());
    }
    b.body(body).unwrap()
}

pub(crate) fn git_cors_preflight(cx: &Cx) -> Response {
    if own_origin(cx).is_none() {
        return reply(cx, 403, &[], Body::from(""));
    }
    let extra = [
        (
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS".to_string(),
        ),
        (
            "Access-Control-Allow-Headers",
            "Content-Type, Accept, x-git-protocol".to_string(),
        ),
        ("Access-Control-Max-Age", "600".to_string()),
    ];
    reply(cx, 204, &extra, Body::from(""))
}

fn git_text(cx: &Cx, status: u16, msg: &'static str) -> Response {
    reply(
        cx,
        status,
        &[("Content-Type", "text/plain; charset=utf-8".to_string())],
        Body::from(msg),
    )
}

/// Streams the upstream response through (a large clone costs a few KB of RAM), aborting beyond `RESPONSE_MAX`.
/// The concurrency slot is held until the body is finished or dropped.
fn git_resp_stream(cx: &Cx, status: u16, upstream: reqwest::Response, slot: GitSlot) -> Response {
    let ct = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let extra: Vec<(&str, String)> = ct.into_iter().map(|c| ("Content-Type", c)).collect();
    let mut total = 0usize;
    let frames = upstream.bytes_stream().map(move |r| {
        let _held = &slot;
        match r {
            Ok(chunk) => {
                total += chunk.len();
                if total > RESPONSE_MAX {
                    Err(std::io::Error::other("Response too large"))
                } else {
                    Ok(http_body::Frame::data(chunk))
                }
            }
            Err(e) => Err(std::io::Error::other(e)),
        }
    });
    reply(
        cx,
        status,
        &extra,
        Body::new(http_body_util::StreamBody::new(frames)),
    )
}

/// Git proxy authentication. GitHub: `x-access-token:<token>`; Codeberg (Forgejo): `<login>:<token>`.
pub(crate) fn git_basic_auth(s: &session::Active) -> String {
    let user = s.user.provider.git_user(&s.user.login);
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(format!("{user}:{}", s.access_token))
    )
}

/// Only these two Git services exist on the smart HTTP protocol; the query sent upstream is built here, never copied.
pub(crate) fn valid_service(s: &str) -> bool {
    matches!(s, "git-upload-pack" | "git-receive-pack")
}

/// Shared by the three routes: validates `owner` and `repo`, checks the session and the concurrency limit, then relays `suffix`
/// (`info/refs?service=...`, `git-upload-pack`, `git-receive-pack`) to the service.
async fn relay(cx: &Cx, suffix: &str, body: Option<topcoat::router::request::Bytes>) -> Response {
    let owner = match topcoat::router::path_param::<GitOwner>(cx) {
        Ok(o) if ids::valid_owner(o) => o.clone(),
        _ => return git_text(cx, 400, "Invalid repository owner"),
    };
    let repo = match topcoat::router::path_param::<GitRepo>(cx) {
        Ok(r) if ids::valid_repo(r) => r.clone(),
        _ => return git_text(cx, 400, "Invalid repository"),
    };
    let Some(session) = get_session(cx).await else {
        return git_text(cx, 401, "Sign in to NeoLeaf to access the project");
    };
    let Some(slot) = GitSlot::acquire(&format!(
        "{}:{}",
        session.user.provider.id(),
        session.user.id
    )) else {
        return git_text(cx, 429, "Too many simultaneous Git requests; wait a moment");
    };

    let target_url = format!(
        "{}/{}/{}.git/{}",
        session.user.provider.web(),
        owner,
        repo,
        suffix
    );
    let is_post = body.is_some();
    let mut req = match body {
        Some(b) => http().post(&target_url).body(b),
        None => http().get(&target_url),
    };
    if !session.access_token.is_empty() {
        req = req.header("Authorization", git_basic_auth(&session));
    }
    let hdrs = topcoat::router::request::headers(cx);
    if is_post && let Some(ct) = hdrs.get("content-type").and_then(|v| v.to_str().ok()) {
        req = req.header("content-type", ct);
    }
    req = req.header(
        "user-agent",
        hdrs.get("user-agent")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("git/2.40.0"),
    );
    if let Some(proto) = hdrs.get("git-protocol").and_then(|v| v.to_str().ok()) {
        req = req.header("git-protocol", proto);
    }

    match req.send().await {
        Ok(res) => {
            let status = res.status().as_u16();
            git_resp_stream(cx, status, res, slot)
        }
        Err(_) => git_text(cx, 502, "Proxy error: could not reach the Git service"),
    }
}

// OPTIONS /api/git/{git_owner}/{git_repo}/info/refs
#[route(OPTIONS "/api/git/{git_owner}/{git_repo}/info/refs")]
pub(crate) async fn git_proxy_info_refs_options(cx: &Cx) -> Result<Response> {
    Ok(git_cors_preflight(cx))
}

// GET /api/git/{git_owner}/{git_repo}/info/refs
#[route(GET "/api/git/{git_owner}/{git_repo}/info/refs")]
pub(crate) async fn git_proxy_info_refs(cx: &Cx) -> Result<Response> {
    let query = topcoat::router::query_params::<GitInfoRefsQuery>(cx).ok();
    let Some(service) = query
        .as_ref()
        .and_then(|q| q.service.as_deref())
        .filter(|s| valid_service(s))
    else {
        return Ok(git_text(cx, 400, "Invalid Git service"));
    };
    Ok(relay(cx, &format!("info/refs?service={service}"), None).await)
}

// OPTIONS /api/git/{git_owner}/{git_repo}/git-upload-pack
#[route(OPTIONS "/api/git/{git_owner}/{git_repo}/git-upload-pack")]
pub(crate) async fn git_proxy_upload_pack_options(cx: &Cx) -> Result<Response> {
    Ok(git_cors_preflight(cx))
}

// POST /api/git/{git_owner}/{git_repo}/git-upload-pack
#[route(POST "/api/git/{git_owner}/{git_repo}/git-upload-pack")]
pub(crate) async fn git_proxy_upload_pack(
    cx: &Cx,
    body: topcoat::router::request::Bytes,
) -> Result<Response> {
    Ok(relay(cx, "git-upload-pack", Some(body)).await)
}

// OPTIONS /api/git/{git_owner}/{git_repo}/git-receive-pack
#[route(OPTIONS "/api/git/{git_owner}/{git_repo}/git-receive-pack")]
pub(crate) async fn git_proxy_receive_pack_options(cx: &Cx) -> Result<Response> {
    Ok(git_cors_preflight(cx))
}

// POST /api/git/{git_owner}/{git_repo}/git-receive-pack
#[route(POST "/api/git/{git_owner}/{git_repo}/git-receive-pack")]
pub(crate) async fn git_proxy_receive_pack(
    cx: &Cx,
    body: topcoat::router::request::Bytes,
) -> Result<Response> {
    Ok(relay(cx, "git-receive-pack", Some(body)).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_two_git_services() {
        assert!(valid_service("git-upload-pack") && valid_service("git-receive-pack"));
        for bad in [
            "",
            "git-upload-pack&x=1",
            "git-upload-pack/../x",
            "GIT-UPLOAD-PACK",
            "other",
        ] {
            assert!(!valid_service(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_person_has_at_most_four_requests_in_flight() {
        let key = "test:limit-1";
        let slots: Vec<_> = (0..CONCURRENT_MAX)
            .map(|_| GitSlot::acquire(key).expect("slot"))
            .collect();
        assert!(GitSlot::acquire(key).is_none(), "the fifth is refused");
        assert!(
            GitSlot::acquire("test:limit-2").is_some(),
            "another person is not affected"
        );
        drop(slots);
        assert!(
            GitSlot::acquire(key).is_some(),
            "released slots are reusable"
        );
    }
}
