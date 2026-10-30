//! The institution's logo (`neoleaf.toml`, see `config.rs`). The bytes were checked and loaded at startup, so nothing here
//! touches the disk; without the file (the public site) both addresses answer 404.

use crate::*;

use super::*;

fn logo_response(logo: Option<&config::Logo>) -> Response {
    let Some(l) = logo else {
        return plain(404, "no logo configured");
    };
    Response::builder()
        .header("Content-Type", l.content_type)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "public, max-age=300")
        // an SVG opened on its own address must not run anything; as an <img> it never does
        .header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        )
        .body(Body::from(l.bytes.clone()))
        .unwrap()
}

// GET /brand/logo - the institution's logo (the dark one is used when only that one was given)
#[route(GET "/brand/logo")]
pub(crate) async fn brand_logo() -> Result<Response> {
    let b = config::get().map(|c| &c.brand);
    Ok(logo_response(
        b.and_then(|b| b.logo.as_ref().or(b.logo_dark.as_ref())),
    ))
}

// GET /brand/logo-dark - the logo for dark themes
#[route(GET "/brand/logo-dark")]
pub(crate) async fn brand_logo_dark() -> Result<Response> {
    Ok(logo_response(
        config::get().and_then(|c| c.brand.logo_dark.as_ref()),
    ))
}
