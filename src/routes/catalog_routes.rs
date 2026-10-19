//! Project templates: the public list, the admin management and the ZIP proxy.

use crate::*;

use super::*;

// ---------------------------------------------------------------- template catalog (metadata only; the files come from GitHub)

// GET /api/templates - active templates, for the "New project" gallery and the home page (public, no user data)
#[route(GET "/api/templates")]
pub(crate) async fn list_templates() -> Result<Response> {
    let body = serde_json::json!({ "templates": catalog::enabled().iter().map(|m| m.public()).collect::<Vec<_>>() });
    Ok(Response::builder()
        .header("Content-Type", "application/json")
        .header("Cache-Control", "public, max-age=60")
        .body(Body::from(body.to_string()))
        .unwrap())
}

// GET /api/admin/templates - all templates, including disabled ones
#[route(GET "/api/admin/templates")]
pub(crate) async fn admin_list_templates(cx: &Cx) -> Result<Json<serde_json::Value>> {
    let Some(me) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    if !admin::is_admin(&me.user) {
        return Ok(err_json("Access denied"));
    }
    Ok(Json(
        serde_json::json!({ "success": true, "templates": catalog::all() }),
    ))
}

// POST /api/admin/templates/save - creates or updates a template (by id)
#[route(POST "/api/admin/templates/save")]
pub(crate) async fn admin_save_template(
    cx: &Cx,
    Json(p): Json<catalog::ModelInput>,
) -> Result<Json<serde_json::Value>> {
    let Some(me) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    if !admin::is_admin(&me.user) {
        return Ok(err_json("Access denied"));
    }
    let model = match catalog::normalize(p, &me.user.login, blocklist::now()) {
        Ok(m) => m,
        Err(e) => return Ok(err_json(e)),
    };
    if let Err(e) = catalog::upsert(model.clone()) {
        return Ok(err_json(e));
    }
    eprintln!("Admin @{} saved the template {}", me.user.login, model.id);
    Ok(Json(
        serde_json::json!({ "success": true, "template": model }),
    ))
}

#[derive(Debug, Deserialize)]
pub(crate) struct TemplateIdPayload {
    id: String,
}

// POST /api/admin/templates/delete - removes a template from the catalog
#[route(POST "/api/admin/templates/delete")]
pub(crate) async fn admin_delete_template(
    cx: &Cx,
    Json(p): Json<TemplateIdPayload>,
) -> Result<Json<serde_json::Value>> {
    let Some(me) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    if !admin::is_admin(&me.user) {
        return Ok(err_json("Access denied"));
    }
    match catalog::remove(p.id.trim()) {
        Ok(true) => {
            eprintln!(
                "Admin @{} removed the template {}",
                me.user.login,
                p.id.trim()
            );
            Ok(Json(serde_json::json!({ "success": true })))
        }
        Ok(false) => Ok(err_json("Template not found")),
        Err(e) => Ok(err_json(e)),
    }
}

// POST /api/admin/templates/check - (GitHub sessions only) checks on GitHub that the source (repository, version and main file) exists
#[route(POST "/api/admin/templates/check")]
pub(crate) async fn admin_check_template(
    cx: &Cx,
    Json(p): Json<catalog::ModelInput>,
) -> Result<Response> {
    let Some(me) = get_session(cx).await else {
        return Ok(json_status(200, err_json("Not signed in")));
    };
    if me.user.provider != provider::Provider::GitHub {
        return Ok(templates_github_only());
    }
    if !admin::is_admin(&me.user) {
        return Ok(json_status(200, err_json("Access denied")));
    }
    let m = match catalog::normalize(p, &me.user.login, 0) {
        Ok(m) => m,
        Err(e) => return Ok(json_status(200, err_json(e))),
    };
    let path = match (m.subdir.is_empty(), m.main_file.is_empty()) {
        (true, true) => String::new(),
        (true, false) => m.main_file.clone(),
        (false, true) => m.subdir.clone(),
        (false, false) => format!("{}/{}", m.subdir, m.main_file),
    };
    let drive = DriveClient::for_session(&me);
    Ok(json_status(
        200,
        match drive.check_source(&m.source, &m.git_ref, &path).await {
            Ok(msg) => Json(serde_json::json!({ "success": true, "message": msg })),
            Err(e) => err_json(e),
        },
    ))
}

/// The template sources are GitHub repositories: with a Codeberg session the API prefix would be rewritten to another repository of
/// the same name, so templates are available only to people signed in with GitHub.
fn templates_github_only() -> Response {
    Response::builder()
        .status(403)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Cache-Control", "no-store")
        .body(Body::from(serde_json::json!({ "error": "Templates are available only when you sign in with GitHub." }).to_string()))
        .unwrap()
}

/// A JSON body with an explicit status.
fn json_status(status: u16, body: Json<serde_json::Value>) -> Response {
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Cache-Control", "no-store")
        .body(Body::from(body.0.to_string()))
        .unwrap()
}

path_param!(pub template_id: String);

// GET /api/templates/{template_id}/zip - the ZIP of the template source (stateless proxy: only repositories registered by the admin)
#[route(GET "/api/templates/{template_id}/zip")]
pub(crate) async fn template_zip(cx: &Cx) -> Result<Response> {
    let id = match topcoat::router::path_param::<TemplateId>(cx) {
        Ok(id) if catalog::valid_id(id) => id.clone(),
        _ => return Ok(plain(400, "Invalid ID")),
    };
    let Some(session) = get_session(cx).await else {
        return Ok(plain(401, "Not signed in"));
    };
    if session.user.provider != provider::Provider::GitHub {
        return Ok(templates_github_only());
    }
    let Some(model) = catalog::get(&id) else {
        return Ok(plain(404, "Template not found"));
    };
    if !model.enabled && !admin::is_admin(&session.user) {
        return Ok(plain(404, "Template not found"));
    }
    let drive = DriveClient::for_session(&session);
    // streams it through (up to 100 MB would otherwise sit in memory); past the limit the stream is cut
    Ok(
        match drive.zipball_response(&model.source, &model.git_ref).await {
            Ok(resp) => {
                use futures_util::StreamExt;
                let mut total = 0usize;
                let frames = resp.bytes_stream().map(move |r| match r {
                    Ok(chunk) => {
                        total += chunk.len();
                        if total > drive::client::ZIP_MAX {
                            Err(std::io::Error::other("Template too large (maximum 100 MB)"))
                        } else {
                            Ok(http_body::Frame::data(chunk))
                        }
                    }
                    Err(e) => Err(std::io::Error::other(e)),
                });
                Response::builder()
                    .header("Content-Type", "application/zip")
                    .header("Cache-Control", "no-store")
                    .body(Body::new(http_body_util::StreamBody::new(frames)))
                    .unwrap()
            }
            Err(_) => plain(502, "Could not download the template from GitHub"),
        },
    )
}
