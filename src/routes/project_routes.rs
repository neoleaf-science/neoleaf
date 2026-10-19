//! Projects: the editor shell, creation, collaborators and invitations, the live-edit WebSocket, the GitHub ZIP and the trash.

use crate::*;

use super::*;

#[derive(Debug, Deserialize)]
pub(crate) struct CreateProjectPayload {
    name: String,
    template: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SharePayload {
    email: String,
    role: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RolePayload {
    role: String,
}

#[query_params]
pub(crate) struct WsQuery {
    project: Option<String>,
}

path_param!(pub project_id: String);

// GET /project/{project_id} - Editor page
#[route(GET "/project/{project_id}")]
pub(crate) async fn project_editor(cx: &Cx) -> Result<Response> {
    let project_id_param = match topcoat::router::path_param::<ProjectId>(cx) {
        Ok(id) if ids::valid_project_id(id) => id.clone(),
        _ => return Ok(html_response("Invalid project ID.".to_string())),
    };

    let session = match get_session(cx).await {
        Some(s) => s,
        None => {
            return Ok(html_response(
                "<script>window.location.href='/';</script>".to_string(),
            ));
        }
    };

    let drive = DriveClient::for_session(&session);

    // The page is only the "shell": the tree, the open file and everything in the project come from the clone in the browser (BrowserGit).
    // The server only checks with GitHub whether the person has access and what the project name is.
    let (project_name, project_title) = match drive.project_summary(&project_id_param).await {
        Ok(summary) => summary,
        Err(e) if is_auth_expired(&e) => return Ok(redirect_session_expired()),
        Err(_) => return Ok(html_response("<!DOCTYPE html><meta charset=\"utf-8\"><p style=\"font-family:sans-serif;padding:24px\">Could not open this project (not found or no access). <a href=\"/\">Back to projects</a></p>".to_string())),
    };
    let active_file = drive::client::DriveFile {
        id: String::new(),
        name: String::new(),
        mime_type: "text/x-tex".to_string(),
        ..Default::default()
    };

    let github_url = session
        .user
        .provider
        .repo_url(&drive::client::repo_full_name(&project_id_param));

    let html = views::editor_page::render(
        &project_id_param,
        (&project_name, project_title.as_deref()),
        "[]",
        &active_file,
        "",
        &session.user,
        &github_url,
    );

    Ok(html_response(html))
}

// POST /api/project/create
#[route(POST "/api/project/create")]
pub(crate) async fn create_project(
    cx: &Cx,
    Json(payload): Json<CreateProjectPayload>,
) -> Result<Json<serde_json::Value>> {
    let session = match get_session(cx).await {
        Some(s) => s,
        None => return Ok(Json(serde_json::json!({ "error": "Not signed in" }))),
    };

    // The server only creates the (empty) repository on GitHub. The template files go to the browser, which writes them to the
    // local clone, commits and pushes (nothing of the project ends up living here).
    let name = match import::clean_project_name(&payload.name) {
        Ok(n) => n,
        Err(e) => return Ok(err_json(e)),
    };
    let drive = DriveClient::for_session(&session);
    match drive.create_empty_project(&name).await {
        Ok(id) => {
            let files: Vec<serde_json::Value> =
                DriveClient::template_files(&payload.name, payload.template.as_deref())
                    .into_iter()
                    .map(|(path, text)| serde_json::json!({ "path": path, "text": text }))
                    .collect();
            Ok(Json(serde_json::json!({ "id": id, "files": files })))
        }
        Err(e) => Ok(Json(serde_json::json!({ "error": e.to_string() }))),
    }
}

#[derive(Deserialize)]
pub(crate) struct CreateEmptyPayload {
    name: String,
}

// POST /api/project/create-empty - creates only the empty repository on GitHub (ZIP import: the files come from the browser)
#[route(POST "/api/project/create-empty")]
pub(crate) async fn create_empty_project(
    cx: &Cx,
    Json(p): Json<CreateEmptyPayload>,
) -> Result<Json<serde_json::Value>> {
    let Some(session) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    let name = match import::clean_project_name(&p.name) {
        Ok(n) => n,
        Err(e) => return Ok(err_json(e)),
    };
    let drive = DriveClient::for_session(&session);
    Ok(match drive.create_empty_project(&name).await {
        Ok(id) => Json(serde_json::json!({ "id": id })),
        Err(e) => err_json(e),
    })
}

path_param!(pub file_id: String);

pub(crate) fn valid_role(role: &str) -> bool {
    matches!(role, "writer" | "reader" | "admin" | "owner")
}

pub(crate) fn valid_collaborator(name: &str) -> bool {
    let t = name.trim();
    !t.is_empty() && t.len() <= 100 && !t.contains(char::is_whitespace)
}

path_param!(pub invitation_id: u64);

// POST /api/invitations/{invitation_id}/accept
#[route(POST "/api/invitations/{invitation_id}/accept")]
pub(crate) async fn api_accept_invitation(cx: &Cx) -> Result<Json<serde_json::Value>> {
    let Ok(inv_id) = topcoat::router::path_param::<InvitationId>(cx) else {
        return Ok(err_json("Invalid ID"));
    };
    let Some(session) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    let drive = DriveClient::for_session(&session);
    match drive.accept_invitation(*inv_id).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Ok(err_json(e)),
    }
}

// POST /api/invitations/{invitation_id}/decline
#[route(POST "/api/invitations/{invitation_id}/decline")]
pub(crate) async fn api_decline_invitation(cx: &Cx) -> Result<Json<serde_json::Value>> {
    let Ok(inv_id) = topcoat::router::path_param::<InvitationId>(cx) else {
        return Ok(err_json("Invalid ID"));
    };
    let Some(session) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    let drive = DriveClient::for_session(&session);
    match drive.decline_invitation(*inv_id).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Ok(err_json(e)),
    }
}

path_param!(pub permission_id: String);
path_param!(pub revision_id: String);

// GET /api/project/{project_id}/permissions - who has access to the project
#[route(GET "/api/project/{project_id}/permissions")]
pub(crate) async fn list_permissions(cx: &Cx) -> Result<Json<serde_json::Value>> {
    let pid = need_project!(cx);
    let Some(session) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    let drive = DriveClient::for_session(&session);
    Ok(match drive.list_permissions(&pid).await {
        Ok(list) => Json(serde_json::json!({ "permissions": list, "me": session.user.login })),
        Err(e) => err_json(e),
    })
}

// POST /api/project/{project_id}/permissions - shares the project with an email
#[route(POST "/api/project/{project_id}/permissions")]
pub(crate) async fn add_permission(
    cx: &Cx,
    Json(payload): Json<SharePayload>,
) -> Result<Json<serde_json::Value>> {
    let pid = need_project!(cx);
    let Some(session) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    if !valid_collaborator(&payload.email) || !ids::valid_login(payload.email.trim()) {
        return Ok(err_json("Enter a valid GitHub user or email"));
    }
    if !valid_role(&payload.role) {
        return Ok(err_json("Invalid role"));
    }
    let drive = DriveClient::for_session(&session);
    Ok(
        match drive
            .add_permission(&pid, payload.email.trim(), &payload.role)
            .await
        {
            Ok(p) => Json(serde_json::json!({ "permission": p })),
            Err(e) => err_json(e),
        },
    )
}

// POST /api/project/{project_id}/permissions/{permission_id}/role - altera o papel
#[route(POST "/api/project/{project_id}/permissions/{permission_id}/role")]
pub(crate) async fn update_permission(
    cx: &Cx,
    Json(payload): Json<RolePayload>,
) -> Result<Json<serde_json::Value>> {
    let pid = need_project!(cx);
    let Ok(perm) = topcoat::router::path_param::<PermissionId>(cx) else {
        return Ok(err_json("Invalid permission ID"));
    };
    if !ids::valid_permission_id(perm) {
        return Ok(err_json("Invalid permission ID"));
    }
    let Some(session) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    if !valid_role(&payload.role) {
        return Ok(err_json("Invalid role"));
    }
    let drive = DriveClient::for_session(&session);
    Ok(
        match drive.update_permission(&pid, perm, &payload.role).await {
            Ok(()) => Json(serde_json::json!({ "success": true })),
            Err(e) => err_json(e),
        },
    )
}

// POST /api/project/{project_id}/permissions/{permission_id}/remove - remove o acesso
#[route(POST "/api/project/{project_id}/permissions/{permission_id}/remove")]
pub(crate) async fn remove_permission(cx: &Cx) -> Result<Json<serde_json::Value>> {
    let pid = need_project!(cx);
    let Ok(perm) = topcoat::router::path_param::<PermissionId>(cx) else {
        return Ok(err_json("Invalid permission ID"));
    };
    if !ids::valid_permission_id(perm) {
        return Ok(err_json("Invalid permission ID"));
    }
    let Some(session) = get_session(cx).await else {
        return Ok(err_json("Not signed in"));
    };
    let drive = DriveClient::for_session(&session);
    Ok(match drive.remove_permission(&pid, perm).await {
        Ok(()) => Json(serde_json::json!({ "success": true })),
        Err(e) => err_json(e),
    })
}

// GET /ws/file/{file_id} - real-time collaborative editing (WebSocket)
#[route(GET "/ws/file/{file_id}")]
pub(crate) async fn collab_ws(cx: &Cx, upgrade: WebSocketUpgrade) -> Result<Response> {
    // Prevents cross-site WebSocket hijacking: the browser Origin must be the same host as the app.
    let hdrs = topcoat::router::request::headers(cx);
    if let Some(origin) = hdrs.get("origin").and_then(|v| v.to_str().ok()) {
        let host = hdrs.get("host").and_then(|v| v.to_str().ok()).unwrap_or("");
        let origin_host = origin.split("://").nth(1).unwrap_or("");
        if origin_host != host {
            return Ok(plain(403, "Origin not allowed"));
        }
    }

    let Ok(fid) = topcoat::router::path_param::<FileId>(cx) else {
        return Ok(plain(400, "Invalid ID"));
    };
    let Some(session) = get_session(cx).await else {
        return Ok(plain(401, "Not signed in"));
    };

    let drive = DriveClient::for_session(&session);
    let project_hint = topcoat::router::query_params::<WsQuery>(cx)
        .ok()
        .and_then(|q| q.project.clone());
    // GitHub decides whether the person has access to the project repository and can edit it.
    let (pid, rel) = collab::split_target(fid, project_hint.as_deref());
    if !ids::valid_project_id(&pid) || !ids::valid_file_path(&rel) {
        return Ok(plain(400, "Invalid project or file"));
    }
    let (can_read, can_edit) = drive.project_access(&pid).await;
    if !can_read {
        return Ok(plain(403, "No access to the project"));
    }
    // the room is per service + project + file: the same owner/repo on GitHub and on Codeberg are different projects
    let room_project = if session.user.provider == provider::Provider::GitHub {
        pid.clone()
    } else {
        format!("{}:{pid}", session.user.provider.id())
    };
    // at most `MAX_CONNS_PER_USER` simultaneous connections per person (released when the connection ends)
    let Some(conn) = collab::try_acquire_conn(&session.user) else {
        return Ok(plain(429, "Too many live-edit connections"));
    };
    let room = match collab::get_or_create_room(&room_project, &rel).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Editing room unavailable: {e}");
            return Ok(plain(503, "Collaborative editing unavailable"));
        }
    };

    let user = session.user.clone();
    let sid = session.sid.clone();
    upgrade
        .max_message_size(4 * 1024 * 1024)
        .on_upgrade(move |socket| collab::serve(socket, room, user, sid, can_edit, pid, conn))
}

path_param!(pub item_id: String);
path_param!(pub milestone_id: String);

// GET /api/project/{project_id}/github-zip - the source ZIP that is on GitHub (stateless proxy, nothing is stored here)
#[route(GET "/api/project/{project_id}/github-zip")]
pub(crate) async fn github_zip(cx: &Cx) -> Result<Response> {
    let pid = match topcoat::router::path_param::<ProjectId>(cx) {
        Ok(id) if ids::valid_project_id(id) => id.clone(),
        _ => return Ok(plain(400, "Invalid project ID")),
    };
    let pid = &pid;
    let Some(session) = get_session(cx).await else {
        return Ok(plain(401, "Not signed in"));
    };
    let drive = DriveClient::for_session(&session);
    let (can_read, _) = drive.project_access(pid).await;
    if !can_read {
        return Ok(plain(403, "No access to the project"));
    }
    let repo = pid.split_once("__").map(|(_, r)| r).unwrap_or("project");
    let safe: String = repo
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    // streams it through (a large ZIP costs a few KB of RAM, not its size); past 100 MB the stream is cut
    Ok(
        match drive
            .zipball_response(&drive::client::repo_full_name(pid), "")
            .await
        {
            Ok(resp) => {
                use futures_util::StreamExt;
                let mut total = 0usize;
                let frames = resp.bytes_stream().map(move |r| match r {
                    Ok(chunk) => {
                        total += chunk.len();
                        if total > drive::client::ZIP_MAX {
                            Err(std::io::Error::other("Project too large (maximum 100 MB)"))
                        } else {
                            Ok(http_body::Frame::data(chunk))
                        }
                    }
                    Err(e) => Err(std::io::Error::other(e)),
                });
                Response::builder()
                    .header("Content-Type", "application/zip")
                    .header(
                        "Content-Disposition",
                        format!("attachment; filename=\"{safe}.zip\""),
                    )
                    .header("Cache-Control", "no-store")
                    .body(Body::new(http_body_util::StreamBody::new(frames)))
                    .unwrap()
            }
            Err(_) => plain(502, "Could not download the ZIP from GitHub"),
        },
    )
}

#[derive(Deserialize)]
pub(crate) struct TopicsPayload {
    topics: Vec<String>,
}

// POST /api/project/{project_id}/delete - sends the project to the trash (renames it with the date/time and adds the deleted tag)
#[route(POST "/api/project/{project_id}/delete")]
pub(crate) async fn delete_project_route(cx: &Cx) -> Result<Json<serde_json::Value>> {
    let pid = need_project!(cx);
    let (drive, _s) = need_drive!(cx);
    Ok(match drive.delete_project(&pid).await {
        Ok(id) => Json(serde_json::json!({ "success": true, "id": id })),
        Err(e) => err_json(e),
    })
}

// POST /api/project/{project_id}/restore - takes the project out of the trash
#[route(POST "/api/project/{project_id}/restore")]
pub(crate) async fn restore_project_route(cx: &Cx) -> Result<Json<serde_json::Value>> {
    let pid = need_project!(cx);
    let (drive, _s) = need_drive!(cx);
    Ok(match drive.restore_project(&pid).await {
        Ok(id) => Json(serde_json::json!({ "success": true, "id": id })),
        Err(e) => err_json(e),
    })
}

#[derive(serde::Deserialize)]
pub(crate) struct TitlePayload {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub overwrite: bool,
}

// POST /api/project/{project_id}/title - sets or removes the display title (saved in the repository description as "NeoLeaf: <title>")
#[route(POST "/api/project/{project_id}/title")]
pub(crate) async fn update_project_title(
    cx: &Cx,
    Json(p): Json<TitlePayload>,
) -> Result<Json<serde_json::Value>> {
    let pid = need_project!(cx);
    let (drive, _s) = need_drive!(cx);
    Ok(
        match drive.set_project_title(&pid, &p.title, p.overwrite).await {
            Ok(title) => Json(serde_json::json!({ "success": true, "title": title })),
            // the repository already has a description of its own: the browser asks before replacing it
            Err(e) if e == crate::drive::client::FOREIGN_DESCRIPTION => {
                Json(serde_json::json!({ "needs_overwrite": true }))
            }
            Err(e) => err_json(e),
        },
    )
}

// POST /api/project/{project_id}/topics - updates the repository topics/tags on GitHub
#[route(POST "/api/project/{project_id}/topics")]
pub(crate) async fn update_project_topics(
    cx: &Cx,
    Json(p): Json<TopicsPayload>,
) -> Result<Json<serde_json::Value>> {
    let pid = need_project!(cx);
    let (drive, _s) = need_drive!(cx);
    match drive.update_topics(&pid, p.topics).await {
        Ok(topics) => Ok(Json(
            serde_json::json!({ "success": true, "topics": topics }),
        )),
        Err(e) => Ok(err_json(e)),
    }
}
