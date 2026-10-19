//! Lookups the browser cannot do itself because of CORS: article search (arXiv, DBLP) and TeX Live package resolution.

use crate::*;

use super::*;

#[query_params]
pub(crate) struct ScholarQuery {
    source: Option<String>,
    q: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

pub(crate) fn scholar_error(status: u16, msg: impl ToString) -> Response {
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Cache-Control", "no-store")
        .body(Body::from(
            serde_json::json!({ "error": msg.to_string() }).to_string(),
        ))
        .unwrap()
}

// GET /api/scholar?source=arxiv|dblp&q=...&limit=&offset= - article search on the sources the browser cannot reach because of CORS.
// Stateless proxy (src/scholar.rs): fixed host built here, requires a session, limits text, size, time and requests per person, no logging.
#[route(GET "/api/scholar")]
pub(crate) async fn scholar_search(cx: &Cx) -> Result<Response> {
    let Some(session) = get_session(cx).await else {
        return Ok(scholar_error(401, "Not signed in"));
    };
    let Ok(query) = topcoat::router::query_params::<ScholarQuery>(cx) else {
        return Ok(scholar_error(400, "Invalid parameters"));
    };
    let Some(src) = query.source.as_deref().and_then(scholar::Source::parse) else {
        return Ok(scholar_error(400, "Unknown source"));
    };
    let q = match scholar::valid_query(query.q.as_deref().unwrap_or("")) {
        Ok(q) => q,
        Err(e) => return Ok(scholar_error(400, e)),
    };
    if !scholar::allow(&format!("{:?}:{}", session.user.provider, session.user.id)) {
        return Ok(scholar_error(
            429,
            "Too many searches in a short time; wait a minute",
        ));
    }
    Ok(
        match scholar::fetch(
            src,
            &q,
            scholar::clamp_limit(query.limit),
            scholar::clamp_offset(query.offset),
        )
        .await
        {
            Ok(body) => Response::builder()
                .header("Content-Type", src.content_type())
                .header("Cache-Control", "no-store")
                .body(Body::from(body))
                .unwrap(),
            Err(e) => scholar_error(502, e),
        },
    )
}

#[derive(Deserialize)]
pub(crate) struct CtanPackagePayload {
    package: Option<String>,
    file: Option<String>,
}

// POST /api/ctan/package - downloads a TeX Live/CTAN package and returns the usable LaTeX files.
// Stateless proxy: the browser cannot reach CTAN because of CORS; nothing is stored on the server (the project belongs to the browser).
#[route(POST "/api/ctan/package")]
pub(crate) async fn ctan_package(cx: &Cx, Json(p): Json<CtanPackagePayload>) -> Result<Response> {
    Ok(json_reply(ctan_package_inner(cx, p).await))
}

/// JSON body with its status (429 and 503 for the limits, 200 otherwise: the page reads `error` from the body).
fn json_reply((status, body): (u16, Json<serde_json::Value>)) -> Response {
    let mut r = Response::builder()
        .status(status)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Cache-Control", "no-store");
    if status == 429 || status == 503 {
        r = r.header("Retry-After", "10"); // the browser waits and tries again instead of failing the compilation
    }
    r.body(Body::from(body.0.to_string())).unwrap()
}

/// Calls per minute and person for `/api/ctan/*` (memory only). A big template needs a lot of them: a query and a download per
/// package, repeated by every pass (acmart alone brings about eight packages); 30 made first compilations fail.
const CTAN_RATE_MAX: usize = 240;

/// Per-person limit shared by `/api/ctan/*`.
fn ctan_allowed(s: &session::Active) -> bool {
    scholar::allow_max(
        &format!("ctan:{}:{}", s.user.provider.id(), s.user.id),
        CTAN_RATE_MAX,
    )
}

async fn ctan_package_inner(cx: &Cx, p: CtanPackagePayload) -> (u16, Json<serde_json::Value>) {
    use base64::Engine;
    let Some(s) = get_session(cx).await else {
        return (200, err_json("Not signed in"));
    };
    if !ctan_allowed(&s) {
        return (
            429,
            err_json("Too many package requests in a short time; wait a minute"),
        );
    }
    let Some(_slot) = ctan::acquire_fetch_slot().await else {
        return (
            503,
            err_json("The package server is busy; try again in a moment"),
        );
    };
    let ok = |b: Json<serde_json::Value>| (200, b);
    let err = |m: String| (200, err_json(m));
    let pkg = match (&p.file, &p.package) {
        (Some(file), _) => match ctan::package_for_file(file).await {
            Ok(Some(pkg)) => pkg,
            Ok(None) => return err(format!("No TeX Live package contains the file \"{file}\"")),
            Err(e) => return err(e),
        },
        (None, Some(pkg)) => pkg.trim().to_string(),
        _ => return err("Enter the package or the file".to_string()),
    };
    match ctan::fetch_package(&pkg).await {
        Ok(files) if !files.is_empty() => ok(Json(serde_json::json!({
            "package": pkg,
            "files": files.iter().map(|(n, b)| serde_json::json!({ "name": n, "b64": base64::engine::general_purpose::STANDARD.encode(b) })).collect::<Vec<_>>(),
        }))),
        Ok(_) => err(format!(
            "The package \"{pkg}\" has no ready-made files (.sty/.cls...): it must be generated from the .ins. Upload the generated files manually."
        )),
        Err(e) => err(e),
    }
}

#[derive(Deserialize)]
pub(crate) struct CtanResolvePayload {
    files: Vec<String>,
}

// POST /api/ctan/resolve - for each missing LaTeX file: does the browser compiler already ship it? which TeX Live package contains it?
#[route(POST "/api/ctan/resolve")]
pub(crate) async fn ctan_resolve(cx: &Cx, Json(p): Json<CtanResolvePayload>) -> Result<Response> {
    let Some(s) = get_session(cx).await else {
        return Ok(json_reply((200, err_json("Not signed in"))));
    };
    if !ctan_allowed(&s) {
        return Ok(json_reply((
            429,
            err_json("Too many package requests in a short time; wait a minute"),
        )));
    }
    if p.files.len() > 200 {
        return Ok(json_reply((200, err_json("Too many files"))));
    }
    let base = deps::bundle_files().await;
    let mut results = Vec::new();
    for file in &p.files {
        let in_base = base.is_some_and(|b| b.contains(file));
        let package = if in_base {
            None
        } else {
            ctan::package_for_file(file).await.ok().flatten()
        };
        results.push(serde_json::json!({ "file": file, "base": in_base, "package": package }));
    }
    Ok(json_reply((
        200,
        Json(serde_json::json!({ "results": results })),
    )))
}
