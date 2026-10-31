use base64::Engine;
use serde::Deserialize;
use topcoat::{
    Result,
    context::Cx,
    cookie::{Cookie, Cookies, RouterBuilderCookieExt, cookies},
    router::{
        Body, Router,
        content::Json,
        content::websocket::WebSocketUpgrade,
        error::{SeeOther, see_other},
        path_param, query_params,
        response::Response,
        route,
    },
};

mod account;
mod admin;
mod assets;
mod auth;
mod blocklist;
mod catalog;
mod collab;
mod config;
mod ctan;
mod deps;
mod drive;
mod ids;
mod import;
mod init;
mod provider;
mod routes;
mod scholar;
mod session;
mod views;

use auth::github::GitHubUser;
use drive::client::DriveClient;
use routes::*;
use session::Active;

/// Tunes the glibc allocator before the threads start. Without it, each thread keeps the memory it freed (one "arena" per thread)
/// and large blocks come from the shared heap, which almost never shrinks: after a few ZIPs and clones the process holds
/// hundreds of MB with no user around. Measured under local load: 187 MB retained become about 50 MB.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn tune_malloc() {
    // values from <malloc.h>: M_TRIM_THRESHOLD -1, M_MMAP_THRESHOLD -3, M_ARENA_MAX -8; only if the operator did not set them in the environment
    let set = |env: &str, param: libc::c_int, value: libc::c_int| {
        if std::env::var_os(env).is_none() {
            // SAFETY: mallopt only adjusts allocator parameters and is called at startup, before any other thread exists.
            unsafe { libc::mallopt(param, value) };
        }
    };
    set("MALLOC_ARENA_MAX", -8, 2);
    set("MALLOC_MMAP_THRESHOLD_", -3, 256 * 1024);
    set("MALLOC_TRIM_THRESHOLD_", -1, 256 * 1024);
}
#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
fn tune_malloc() {}

/// Asks glibc to give free memory back to the system (after large one-off jobs, such as building the TeX Live index).
#[cfg(all(target_os = "linux", target_env = "gnu"))]
pub(crate) fn trim_memory() {
    // SAFETY: malloc_trim only returns free pages to the system; it can be called from any thread.
    unsafe { libc::malloc_trim(0) };
}
#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
pub(crate) fn trim_memory() {}

fn main() {
    // `neoleaf init ...` writes the files of an institution install and exits (no server, no runtime)
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("init") {
        std::process::exit(init::run(&args[1..]));
    }
    tune_malloc();
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Tokio runtime")
        .block_on(run());
}

async fn run() {
    let _ = dotenvy::dotenv();
    // `neoleaf --check-config`: validates neoleaf.toml, prints what it means (never a secret) and exits
    let check = std::env::args().any(|a| a == "--check-config");
    match config::load() {
        Ok(Some(cfg)) => {
            println!("📄 Institution mode: neoleaf.toml loaded");
            if check {
                for line in config::summary(cfg) {
                    println!("   {line}");
                }
                return;
            }
        }
        Ok(None) => {
            if check {
                println!("No neoleaf.toml: the server runs as the public NeoLeaf site.");
                return;
            }
        }
        Err(e) => {
            eprintln!("❌ Invalid configuration: {e}");
            std::process::exit(1);
        }
    }
    admin::init_process_start();
    // TeX Live index ready before the first package request (and to check what goes into the disk cache)
    tokio::spawn(ctan::warm_index());
    session::load();
    blocklist::load();
    catalog::load();
    drive::client::purge_legacy_workspace();

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    println!("🚀 NeoLeaf starting at http://localhost:{}", port);
    println!("📁 Projects synced with GitHub (tag: [neoleaf])");
    println!(
        "⚡ Compilation: in the browser (WebAssembly) or in the local agent; the server neither compiles nor stores projects"
    );

    let router = Router::builder()
        .layer(topcoat::router::BodyLimit::max(12 * 1024 * 1024).at("/api/project"))
        .layer(topcoat::router::BodyLimit::max(50 * 1024 * 1024).at("/api/git"))
        .cookies()
        .route(serve_home_css)
        .route(serve_home_js)
        .route(git_proxy_info_refs_options)
        .route(git_proxy_info_refs)
        .route(git_proxy_upload_pack_options)
        .route(git_proxy_upload_pack)
        .route(git_proxy_receive_pack_options)
        .route(git_proxy_receive_pack)
        .route(serve_embedded_js)
        .route(serve_embedded_css)
        .route(serve_embedded_vendor)
        .route(serve_embedded_img)
        .route(serve_embedded_licenses)
        .route(serve_favicon_ico)
        .route(serve_pyodide)
        .route(serve_katex)
        .route(serve_typst)
        .route(serve_typst_font)
        .route(scholar_search)
        .route(serve_install_script)
        .route(serve_install_ps1)
        .route(serve_agent_binary)
        .route(collab_ws)
        .route(serve_texlive_js)
        .route(serve_texlive_worker)
        .route(serve_texlive_pdflatex_js)
        .route(serve_texlive_pdflatex_wasm)
        .route(serve_texlive_bundle)
        .route(serve_texlive_neoleaf_bundle)
        .route(serve_font_pack)
        .route(serve_bibtexu_js)
        .route(serve_bibtexu_wasm)
        .route(serve_biber_js)
        .route(serve_biber_wasm)
        .route(serve_biber_vfs)
        .route(serve_icu_data)
        .route(serve_xelatex_js)
        .route(serve_xelatex_wasm)
        .route(serve_xdvipdfmx_js)
        .route(serve_xdvipdfmx_wasm)
        .route(serve_texlive_xelatex_bundle)
        .route(serve_lualatex_js)
        .route(serve_lualatex_wasm)
        .route(serve_texlive_lualatex_bundle)
        .route(home)
        .route(admin_dashboard)
        .route(admin_block_user)
        .route(delete_own_account)
        .route(admin_unblock_user)
        .route(list_templates)
        .route(admin_list_templates)
        .route(admin_save_template)
        .route(admin_delete_template)
        .route(admin_check_template)
        .route(template_zip)
        .route(admin_api_stats)
        .route(privacy)
        .route(privacy_legacy)
        .route(terms)
        .route(terms_legacy)
        .route(licenses)
        .route(agent_page)
        .route(agent_legacy)
        .route(agent_download_redirect)
        .route(brand_logo)
        .route(brand_logo_dark)
        .route(auth_login)
        .route(auth_login_forgejo)
        .route(auth_callback_forgejo)
        .route(auth_logout)
        .route(auth_logout_post)
        .route(api_user_profile)
        .route(auth_callback)
        .route(auth_github_callback)
        .route(api_accept_invitation)
        .route(api_decline_invitation)
        .route(project_editor)
        .route(create_project)
        .route(create_empty_project)
        .route(list_permissions)
        .route(add_permission)
        .route(update_permission)
        .route(remove_permission)
        .route(github_zip)
        .route(ctan_package)
        .route(ctan_resolve)
        .route(update_project_topics)
        .route(update_project_title)
        .route(delete_project_route)
        .route(restore_project_route)
        .build();

    topcoat::start(router).await.unwrap();
}
