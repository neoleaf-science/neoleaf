//! HTTP side of the agent: origin checks, CORS, JSON helpers and routing.

use crate::compile::compile;
use crate::config::{VERSION, config_dir};
use crate::engines::detect_engines;
use crate::pairing::{pair_confirm, pair_request};
use crate::project::{prepare, store_blobs};
use crate::{auth, updater};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use tiny_http::{Header, Method, Request, Response};

const MAX_BODY: u64 = 256 * 1024 * 1024;

/// compilations in progress (the tray icon reads this)
pub(crate) static COMPILING: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

pub(crate) struct State {
    pub(crate) origins: Vec<String>,
    /// one compilation per project at a time (the work folder is shared between compilations)
    pub(crate) busy: Mutex<HashMap<String, ()>>,
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}

fn req_header(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

pub(crate) fn json_response(
    status: u16,
    origin: Option<&str>,
    body: serde_json::Value,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut r = Response::from_string(body.to_string())
        .with_status_code(status)
        .with_header(header("Content-Type", "application/json; charset=utf-8"))
        .with_header(header("Cache-Control", "no-store"));
    if let Some(o) = origin {
        r = r
            .with_header(header("Access-Control-Allow-Origin", o))
            .with_header(header("Vary", "Origin"));
    }
    r
}

fn bearer(req: &Request) -> String {
    req_header(req, "Authorization")
        .unwrap_or_default()
        .strip_prefix("Bearer ")
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Id of the paired device that made the request (or None)
fn authorized(req: &Request) -> Option<String> {
    auth::authorize(&config_dir(), &bearer(req))
}

fn read_json(req: &mut Request) -> Result<serde_json::Value, String> {
    let mut buf = Vec::new();
    req.as_reader()
        .take(MAX_BODY + 1)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    if buf.len() as u64 > MAX_BODY {
        return Err("body too large".into());
    }
    serde_json::from_slice(&buf).map_err(|e| format!("invalid JSON: {e}"))
}

/// DNS rebinding: a page on another name that resolves to 127.0.0.1 would send its own `Host`; only loopback names are served.
pub(crate) fn host_allowed(host: Option<&str>, port: u16) -> bool {
    match host {
        None => false,
        Some(h) => ["127.0.0.1", "localhost", "[::1]"]
            .iter()
            .any(|n| h.eq_ignore_ascii_case(&format!("{n}:{port}")) || h.eq_ignore_ascii_case(n)),
    }
}

pub(crate) fn handle(state: &State, mut req: Request) {
    if !host_allowed(req_header(&req, "Host").as_deref(), crate::config::port()) {
        let _ = req.respond(json_response(
            403,
            None,
            serde_json::json!({ "error": "host not allowed" }),
        ));
        return;
    }
    let origin = req_header(&req, "Origin");
    let allowed_origin = match &origin {
        Some(o) if state.origins.iter().any(|a| a == o) => Some(o.clone()),
        Some(_) => {
            let _ = req.respond(json_response(
                403,
                None,
                serde_json::json!({ "error": "origin not allowed" }),
            ));
            return;
        }
        None => None,
    };
    let o = allowed_origin.as_deref();
    let url = req.url().split('?').next().unwrap_or("").to_string();
    let method = req.method().clone();

    // browser preflight (CORS and local network access)
    if method == Method::Options {
        let mut r = Response::empty(204)
            .with_header(header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"))
            .with_header(header(
                "Access-Control-Allow-Headers",
                "Content-Type, Authorization",
            ))
            .with_header(header("Access-Control-Allow-Private-Network", "true"))
            .with_header(header("Access-Control-Max-Age", "600"));
        if let Some(o) = o {
            r = r
                .with_header(header("Access-Control-Allow-Origin", o))
                .with_header(header("Vary", "Origin"));
        }
        let _ = req.respond(r);
        return;
    }

    let resp = match (method, url.as_str()) {
        (Method::Get, "/v1/status") => {
            let paired = authorized(&req).is_some();
            json_response(
                200,
                o,
                serde_json::json!({ "agent": "neoleaf-agent", "version": VERSION, "paired": paired, "engines": detect_engines(), "update": updater::available().map(|v| serde_json::json!({ "available": v })), "autoUpdate": updater::load_mode(&config_dir()).name() }),
            )
        }
        (Method::Post, "/v1/pair/request") if origin.is_some() => pair_request(o),
        (Method::Post, "/v1/pair/confirm") if origin.is_some() => match read_json(&mut req) {
            Ok(v) => pair_confirm(&v, origin.as_deref().unwrap_or(""), o),
            Err(e) => json_response(400, o, serde_json::json!({ "error": e })),
        },
        (Method::Post, "/v1/unpair") => match authorized(&req) {
            Some(id) => {
                auth::revoke(&config_dir(), &id);
                json_response(200, o, serde_json::json!({ "ok": true }))
            }
            None => json_response(401, o, serde_json::json!({ "error": "not paired" })),
        },
        (Method::Post, "/v1/prepare") if authorized(&req).is_some() => match read_json(&mut req) {
            Ok(v) => prepare(&v, o),
            Err(e) => json_response(400, o, serde_json::json!({ "error": e })),
        },
        (Method::Post, "/v1/blobs") if authorized(&req).is_some() => match read_json(&mut req) {
            Ok(v) => store_blobs(&v, o),
            Err(e) => json_response(400, o, serde_json::json!({ "error": e })),
        },
        (Method::Post, "/v1/compile") if authorized(&req).is_some() => match read_json(&mut req) {
            Ok(v) => compile(state, &v, o),
            Err(e) => json_response(400, o, serde_json::json!({ "error": e })),
        },
        (Method::Post, "/v1/prepare" | "/v1/blobs" | "/v1/compile") => json_response(
            401,
            o,
            serde_json::json!({ "error": "not paired: invalid code or token" }),
        ),
        _ => json_response(404, o, serde_json::json!({ "error": "not found" })),
    };
    let _ = req.respond(resp);
}

#[cfg(test)]
mod host_tests {
    use super::host_allowed;

    #[test]
    fn only_loopback_hosts_are_served() {
        assert!(host_allowed(Some("127.0.0.1:47474"), 47474));
        assert!(host_allowed(Some("localhost:47474"), 47474));
        assert!(host_allowed(Some("[::1]:47474"), 47474));
        for bad in [
            None,
            Some("evil.example:47474"),
            Some("127.0.0.1.evil.example:47474"),
            Some("127.0.0.1:9"),
            Some(""),
        ] {
            assert!(!host_allowed(bad, 47474), "{bad:?}");
        }
    }
}
