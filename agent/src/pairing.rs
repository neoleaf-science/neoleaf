//! Pairing endpoints: the browser asks for a code and then confirms it to get its token.

use crate::auth;
use crate::config::config_dir;
use crate::desktop::{copy_to_clipboard, notify};
use crate::http::json_response;
use std::sync::atomic::{AtomicU64, Ordering};
use tiny_http::Response;

static LAST_PAIR_REQUEST: AtomicU64 = AtomicU64::new(0);

/// The browser asked for the code: copies it to the clipboard and notifies
pub(crate) fn pair_request(origin: Option<&str>) -> Response<std::io::Cursor<Vec<u8>>> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let last = LAST_PAIR_REQUEST.swap(now, Ordering::Relaxed);
    if now.saturating_sub(last) < 3 {
        return json_response(
            429,
            origin,
            serde_json::json!({ "error": "wait a few seconds" }),
        );
    }
    let code = auth::create_pending(&config_dir());
    let clipboard = copy_to_clipboard(&code);
    let body = format!(
        "Code: {}\n\nThis is the pairing code of the NeoLeaf local agent: it links the browser to this program, which compiles your projects with the LaTeX on this machine.{}\nType or paste the code in the NeoLeaf window (valid for 5 minutes and can only be used once). This notification is in the system notification area.",
        code,
        if clipboard {
            "\nThe code has already been copied to the clipboard: just paste it (Ctrl+V)."
        } else {
            ""
        }
    );
    let notified = notify("NeoLeaf: pairing code", &body);
    json_response(
        200,
        origin,
        serde_json::json!({ "clipboard": clipboard, "notified": notified }),
    )
}

/// The browser returns the code typed by the user and receives its own token
pub(crate) fn pair_confirm(
    v: &serde_json::Value,
    browser_origin: &str,
    origin: Option<&str>,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let code = v["code"].as_str().unwrap_or("");
    match auth::confirm(&config_dir(), code, browser_origin) {
        auth::Confirm::Paired(token, id) => json_response(
            200,
            origin,
            serde_json::json!({ "token": token, "deviceId": id }),
        ),
        auth::Confirm::Invalid => json_response(
            401,
            origin,
            serde_json::json!({ "error": "invalid code", "reason": "invalid" }),
        ),
        auth::Confirm::Expired => json_response(
            401,
            origin,
            serde_json::json!({ "error": "expired code", "reason": "expired" }),
        ),
        auth::Confirm::Locked => json_response(
            429,
            origin,
            serde_json::json!({ "error": "too many attempts: ask for a new code", "reason": "locked" }),
        ),
        auth::Confirm::TooMany => json_response(
            409,
            origin,
            serde_json::json!({ "error": "paired browser limit reached (neoleaf-agent revoke)", "reason": "too_many" }),
        ),
    }
}
