//! HTTP routes, grouped by area. `main.rs` only builds the router from these.

/// Session + Drive client, or the JSON error response.
macro_rules! need_drive {
    ($cx:expr) => {{
        match get_session($cx).await {
            Some(s) => (DriveClient::for_session(&s), s),
            None => return Ok(err_json("Not signed in")),
        }
    }};
}

macro_rules! need_project {
    ($cx:expr) => {{
        match topcoat::router::path_param::<ProjectId>($cx) {
            Ok(id) if crate::ids::valid_project_id(id) => id.clone(),
            _ => return Ok(err_json("Invalid project ID")),
        }
    }};
}

mod admin_routes;
mod auth_routes;
mod brand_routes;
mod catalog_routes;
mod git_proxy;
mod http;
mod lookup_routes;
mod pages;
mod project_routes;
mod static_files;

pub(crate) use admin_routes::*;
pub(crate) use auth_routes::*;
pub(crate) use brand_routes::*;
pub(crate) use catalog_routes::*;
pub(crate) use git_proxy::*;
pub(crate) use http::*;
pub(crate) use lookup_routes::*;
pub(crate) use pages::*;
pub(crate) use project_routes::*;
pub(crate) use static_files::*;
