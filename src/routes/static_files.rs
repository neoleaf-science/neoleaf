//! Static files: the page styles, the install scripts, the local agent binaries, the TeX Live / BibTeX / Biber / Pyodide assets and the vendored libraries.

use crate::*;

use super::*;

// Home page: CSS and JS read from `site/` (see views::login_page::site_file)
#[route(GET "/site/home.css")]
pub(crate) async fn serve_home_css() -> Result<Response> {
    Ok(owned_response(
        views::login_page::site_file("home.css"),
        "text/css; charset=utf-8",
    ))
}

#[route(GET "/site/home.js")]
pub(crate) async fn serve_home_js() -> Result<Response> {
    Ok(owned_response(
        views::login_page::site_file("home.js"),
        "application/javascript; charset=utf-8",
    ))
}

path_param!(pub agent_file: String);

// Local agent binary (built by `mise run agent`; may not exist)
#[route(GET "/static/agent/{agent_file}")]
pub(crate) async fn serve_agent_binary(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<AgentFile>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    if name == "version.json" {
        // version and SHA-256 of the published binary (built by `mise run agent`); used by `neoleaf-agent update`
        return match tokio::fs::read(format!("static/agent/{name}")).await {
            Ok(data) => Ok(Response::builder()
                .header("Content-Type", "application/json")
                .header("Cache-Control", "no-cache")
                .body(Body::from(data))
                .unwrap()),
            Err(_) => Ok(plain(404, "agent unavailable on this server")),
        };
    }
    if ![
        "neoleaf-agent-linux-x86_64",
        "neoleaf-agent-macos-universal",
        "neoleaf-agent-windows-x86_64.exe",
    ]
    .contains(&name.as_str())
    {
        return Ok(plain(404, "not found"));
    }
    match tokio::fs::read(format!("static/agent/{name}")).await {
        Ok(data) => Ok(Response::builder()
            .header("Content-Type", "application/octet-stream")
            .header(
                "Content-Disposition",
                format!("attachment; filename=\"{name}\""),
            )
            .body(Body::from(data))
            .unwrap()),
        Err(_) => Ok(plain(404, "agent unavailable on this server")),
    }
}

/// Site address for the install script: the server's own address on loopback (development and tests) or one of the
/// known domains; any other Host value falls back to the main domain (the Host comes from the client).
pub(crate) fn install_site(host: Option<&str>) -> String {
    const KNOWN: [&str; 3] = [
        "neoleaf.science",
        "www.neoleaf.science",
        "neoleaf.duckdns.org",
    ];
    let host = host.unwrap_or("").trim().to_ascii_lowercase();
    let name = host.split(':').next().unwrap_or("");
    let port_ok = host
        .split(':')
        .nth(1)
        .is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()));
    if port_ok && matches!(name, "127.0.0.1" | "localhost") {
        return format!("http://{host}");
    }
    if KNOWN.contains(&name) {
        return format!("https://{name}");
    }
    "https://neoleaf.science".to_string()
}

// GET /install.sh - one-line installer of the local agent: curl -fsSL https://neoleaf.science/install.sh | sh
#[route(GET "/install.sh")]
pub(crate) async fn serve_install_script(cx: &Cx) -> Result<Response> {
    let host = topcoat::router::request::headers(cx)
        .get("host")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let script =
        include_str!("../../static/install.sh").replace("__SITE__", &install_site(host.as_deref()));
    Ok(Response::builder()
        .header("Content-Type", "text/x-shellscript; charset=utf-8")
        .header("Cache-Control", "no-cache")
        .body(Body::from(script))
        .unwrap())
}

// GET /install.ps1 - o mesmo para Windows: irm https://neoleaf.science/install.ps1 | iex
#[route(GET "/install.ps1")]
pub(crate) async fn serve_install_ps1(cx: &Cx) -> Result<Response> {
    let host = topcoat::router::request::headers(cx)
        .get("host")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let script = include_str!("../../static/install.ps1")
        .replace("__SITE__", &install_site(host.as_deref()));
    Ok(Response::builder()
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Cache-Control", "no-cache")
        .body(Body::from(script))
        .unwrap())
}

// Static texlive-wasm / BusyTeX Routes
#[route(GET "/static/texlive/texlive.js")]
pub(crate) async fn serve_texlive_js() -> Result<Response> {
    serve_file(
        "static/texlive/texlive.js",
        "application/javascript; charset=utf-8",
        None,
    )
    .await
}

#[route(GET "/static/texlive/worker.js")]
pub(crate) async fn serve_texlive_worker() -> Result<Response> {
    serve_file(
        "static/texlive/worker.js",
        "application/javascript; charset=utf-8",
        None,
    )
    .await
}

#[route(GET "/static/texlive/pdflatex.js")]
pub(crate) async fn serve_texlive_pdflatex_js() -> Result<Response> {
    serve_file(
        "static/texlive/pdflatex.js",
        "application/javascript; charset=utf-8",
        None,
    )
    .await
}

#[route(GET "/static/texlive/pdflatex.wasm")]
pub(crate) async fn serve_texlive_pdflatex_wasm() -> Result<Response> {
    serve_file("static/texlive/pdflatex.wasm", "application/wasm", None).await
}

// BibTeX in WebAssembly (built by scripts/fetch_bibtex_assets.py; in production Caddy serves these files)
pub(crate) async fn serve_asset(path: &str, content_type: &'static str) -> Result<Response> {
    serve_file(path, content_type, None).await
}

/// Reads a static file from disk. A missing file is a 404 with `no-store` (never an empty 200 that the browser would keep as `immutable`).
pub(crate) async fn serve_file(
    path: &str,
    content_type: &'static str,
    cache_control: Option<&'static str>,
) -> Result<Response> {
    Ok(match tokio::fs::read(path).await {
        Ok(data) => {
            let mut b = Response::builder().header("Content-Type", content_type);
            if let Some(cc) = cache_control {
                b = b.header("Cache-Control", cc);
            }
            b.body(Body::from(data)).unwrap()
        }
        Err(_) => Response::builder()
            .status(404)
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("Cache-Control", "no-store")
            .body(Body::from("file unavailable"))
            .unwrap(),
    })
}

#[route(GET "/static/texlive/bibtexu/emscripten/bibtexu.js")]
pub(crate) async fn serve_bibtexu_js() -> Result<Response> {
    serve_asset(
        "static/texlive/bibtexu/emscripten/bibtexu.js",
        "application/javascript; charset=utf-8",
    )
    .await
}

#[route(GET "/static/texlive/bibtexu/emscripten/bibtexu.wasm")]
pub(crate) async fn serve_bibtexu_wasm() -> Result<Response> {
    serve_asset(
        "static/texlive/bibtexu/emscripten/bibtexu.wasm",
        "application/wasm",
    )
    .await
}

// Biber in WebAssembly (built by scripts/fetch_biber_assets.py): the browser's biblatex
#[route(GET "/static/texlive/biber/emscripten/biber.js")]
pub(crate) async fn serve_biber_js() -> Result<Response> {
    serve_asset(
        "static/texlive/biber/emscripten/biber.js",
        "application/javascript; charset=utf-8",
    )
    .await
}

#[route(GET "/static/texlive/biber/emscripten/biber.wasm")]
pub(crate) async fn serve_biber_wasm() -> Result<Response> {
    serve_asset(
        "static/texlive/biber/emscripten/biber.wasm",
        "application/wasm",
    )
    .await
}

#[route(GET "/static/texlive/biber/emscripten/biber-vfs.tar.gz")]
pub(crate) async fn serve_biber_vfs() -> Result<Response> {
    serve_asset(
        "static/texlive/biber/emscripten/biber-vfs.tar.gz",
        "application/gzip",
    )
    .await
}

#[route(GET "/static/texlive/icudt78l.dat")]
pub(crate) async fn serve_icu_data() -> Result<Response> {
    serve_asset("static/texlive/icudt78l.dat", "application/octet-stream").await
}

// Light pack that already includes the font family maps (built by scripts/build_font_packs.py)
#[route(GET "/static/texlive/texmf-core-neoleaf.tar.gz")]
pub(crate) async fn serve_texlive_neoleaf_bundle() -> Result<Response> {
    serve_file(
        "static/texlive/texmf-core-neoleaf.tar.gz",
        "application/gzip",
        Some("public, max-age=31536000, immutable"),
    )
    .await
}

path_param!(pub font_pack: String);

// Font packs per family (and manifest.json) - in production Caddy serves these files straight from disk
#[route(GET "/static/texlive/fonts/{font_pack}")]
pub(crate) async fn serve_font_pack(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<FontPack>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    let ok = !name.is_empty()
        && name.len() <= 60
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
    let (ctype, cache) = if name.ends_with(".tar.gz") {
        ("application/gzip", "public, max-age=31536000, immutable")
    } else if name == "manifest.json" {
        ("application/json", "no-cache")
    } else {
        return Ok(plain(404, "not found"));
    };
    if !ok || name.starts_with('.') {
        return Ok(plain(400, "invalid name"));
    }
    let Ok(data) = tokio::fs::read(format!("static/texlive/fonts/{name}")).await else {
        return Ok(Response::builder()
            .status(404)
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("Cache-Control", "no-store")
            .body(Body::from("not found"))
            .unwrap());
    };
    Ok(Response::builder()
        .header("Content-Type", ctype)
        .header("Cache-Control", cache)
        .body(Body::from(data))
        .unwrap())
}

path_param!(pub pyodide_file: String);
path_param!(pub katex_file: String);

/// Serves a public file from a `static/` folder as a stream (the Pyodide engine and SciPy are over 9 MB). `Access-Control-Allow-Origin: *`
/// because Python and the notebooks run in isolated iframes (opaque origin) and fetch from here, and fonts only load with CORS. `Content-Encoding: identity`
/// keeps the server's compression layer away (with a streaming body it cut the response off; Caddy compresses in production).
pub(crate) async fn serve_public_file(dir: &str, name: &str) -> Response {
    let ok = !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '+'));
    if !ok {
        return plain(400, "invalid name");
    }
    let ctype = match name.rsplit('.').next().unwrap_or("") {
        "wasm" => "application/wasm",
        "mjs" | "js" => "application/javascript; charset=utf-8",
        "json" => "application/json",
        "zip" | "whl" => "application/zip",
        "css" => "text/css; charset=utf-8",
        "woff2" => "font/woff2",
        "otf" => "font/otf",
        "ttf" => "font/ttf",
        _ => return plain(404, "not found"),
    };
    let Ok(file) = tokio::fs::File::open(format!("{dir}/{name}")).await else {
        return plain(404, "not found");
    };
    let len = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let stream = futures_util::stream::unfold(file, |mut f| async move {
        use tokio::io::AsyncReadExt;
        let mut buf = vec![0u8; 64 * 1024];
        match f.read(&mut buf).await {
            Ok(0) | Err(_) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((
                    Ok::<_, std::io::Error>(http_body::Frame::data(bytes::Bytes::from(buf))),
                    f,
                ))
            }
        }
    });
    Response::builder()
        .header("Content-Type", ctype)
        .header("Content-Length", len.to_string())
        .header("Content-Encoding", "identity")
        .header(
            "Cache-Control",
            if name == "pyodide-lock.json" {
                "no-cache"
            } else {
                "public, max-age=31536000, immutable"
            },
        )
        .header("Access-Control-Allow-Origin", "*")
        .body(Body::new(http_body_util::StreamBody::new(stream)))
        .unwrap()
}

// Files embedded in the binary (see assets.rs): the editor scripts and styles, vendored libraries and images.
pub(crate) fn embedded_response(dir: &str, name: &str) -> Response {
    match assets::find(dir, name) {
        Some(a) => Response::builder()
            .header("Content-Type", a.content_type)
            .header("Cache-Control", a.cache_control)
            .body(Body::from(a.body))
            .unwrap(),
        None => plain(404, "not found"),
    }
}

path_param!(pub js_file: String);
path_param!(pub css_file: String);
path_param!(pub vendor_file: String);
path_param!(pub img_file: String);
path_param!(pub licenses_file: String);

#[route(GET "/static/js/{js_file}")]
pub(crate) async fn serve_embedded_js(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<JsFile>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    Ok(embedded_response("js", name))
}

#[route(GET "/static/css/{css_file}")]
pub(crate) async fn serve_embedded_css(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<CssFile>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    Ok(embedded_response("css", name))
}

#[route(GET "/static/vendor/{vendor_file}")]
pub(crate) async fn serve_embedded_vendor(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<VendorFile>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    Ok(embedded_response("vendor", name))
}

#[route(GET "/static/img/{img_file}")]
pub(crate) async fn serve_embedded_img(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<ImgFile>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    Ok(embedded_response("img", name))
}

#[route(GET "/static/licenses/{licenses_file}")]
pub(crate) async fn serve_embedded_licenses(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<LicensesFile>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    Ok(embedded_response("licenses", name))
}

#[route(GET "/favicon.ico")]
pub(crate) async fn serve_favicon_ico() -> Result<Response> {
    Ok(embedded_response("img", "favicon.png"))
}

// Pyodide (Python in WebAssembly): engine, standard library and packages downloaded by scripts/fetch_pyodide.py. In production, Caddy can serve this folder.
#[route(GET "/static/pyodide/{pyodide_file}")]
pub(crate) async fn serve_pyodide(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<PyodideFile>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    Ok(serve_public_file("static/pyodide", name).await)
}

// KaTeX (notebook formulas): katex.min.js, auto-render.min.js, katex.min.css and the .woff2 fonts, all in the same folder (see LICENSES.md)
#[route(GET "/static/vendor/katex/{katex_file}")]
pub(crate) async fn serve_katex(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<KatexFile>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    Ok(serve_public_file("static/vendor/katex", name).await)
}

path_param!(pub typst_file: String);
path_param!(pub typst_font: String);

// Typst (typst.ts compiler in WebAssembly and the fonts Typst ships with): generated by scripts/fetch_typst_assets.py, outside Git. The page asks for them
// with ?v=<compiler version>, so they can be cached for a year.
#[route(GET "/static/typst/{typst_file}")]
pub(crate) async fn serve_typst(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<TypstFile>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    Ok(serve_public_file("static/typst", name).await)
}

#[route(GET "/static/typst/fonts/{typst_font}")]
pub(crate) async fn serve_typst_font(cx: &Cx) -> Result<Response> {
    let Ok(name) = topcoat::router::path_param::<TypstFont>(cx) else {
        return Ok(plain(400, "invalid name"));
    };
    Ok(serve_public_file("static/typst/fonts", name).await)
}

#[route(GET "/static/texlive/texmf-core-pdflatex.tar.gz")]
pub(crate) async fn serve_texlive_bundle() -> Result<Response> {
    serve_file(
        "static/texlive/texmf-core-pdflatex.tar.gz",
        "application/gzip",
        Some("public, max-age=31536000, immutable"),
    )
    .await
}

#[route(GET "/static/texlive/xelatex/emscripten/xelatex.js")]
pub(crate) async fn serve_xelatex_js() -> Result<Response> {
    serve_asset(
        "static/texlive/xelatex/emscripten/xelatex.js",
        "application/javascript; charset=utf-8",
    )
    .await
}

#[route(GET "/static/texlive/xelatex/emscripten/xelatex.wasm")]
pub(crate) async fn serve_xelatex_wasm() -> Result<Response> {
    serve_asset(
        "static/texlive/xelatex/emscripten/xelatex.wasm",
        "application/wasm",
    )
    .await
}

#[route(GET "/static/texlive/xdvipdfmx/emscripten/xdvipdfmx.js")]
pub(crate) async fn serve_xdvipdfmx_js() -> Result<Response> {
    serve_asset(
        "static/texlive/xdvipdfmx/emscripten/xdvipdfmx.js",
        "application/javascript; charset=utf-8",
    )
    .await
}

#[route(GET "/static/texlive/xdvipdfmx/emscripten/xdvipdfmx.wasm")]
pub(crate) async fn serve_xdvipdfmx_wasm() -> Result<Response> {
    serve_asset(
        "static/texlive/xdvipdfmx/emscripten/xdvipdfmx.wasm",
        "application/wasm",
    )
    .await
}

#[route(GET "/static/texlive/texmf-core-xelatex.tar.gz")]
pub(crate) async fn serve_texlive_xelatex_bundle() -> Result<Response> {
    serve_file(
        "static/texlive/texmf-core-xelatex.tar.gz",
        "application/gzip",
        Some("public, max-age=31536000, immutable"),
    )
    .await
}

#[route(GET "/static/texlive/lualatex/emscripten/lualatex.js")]
pub(crate) async fn serve_lualatex_js() -> Result<Response> {
    serve_asset(
        "static/texlive/lualatex/emscripten/lualatex.js",
        "application/javascript; charset=utf-8",
    )
    .await
}

#[route(GET "/static/texlive/lualatex/emscripten/lualatex.wasm")]
pub(crate) async fn serve_lualatex_wasm() -> Result<Response> {
    serve_asset(
        "static/texlive/lualatex/emscripten/lualatex.wasm",
        "application/wasm",
    )
    .await
}

#[route(GET "/static/texlive/texmf-core-lualatex.tar.gz")]
pub(crate) async fn serve_texlive_lualatex_bundle() -> Result<Response> {
    serve_file(
        "static/texlive/texmf-core-lualatex.tar.gz",
        "application/gzip",
        Some("public, max-age=31536000, immutable"),
    )
    .await
}

#[cfg(test)]
mod install_site_tests {
    use super::install_site;

    #[test]
    fn install_script_site() {
        assert_eq!(
            install_site(Some("neoleaf.science")),
            "https://neoleaf.science"
        );
        assert_eq!(
            install_site(Some("NeoLeaf.Science:443")),
            "https://neoleaf.science"
        );
        assert_eq!(
            install_site(Some("neoleaf.duckdns.org")),
            "https://neoleaf.duckdns.org"
        );
        assert_eq!(
            install_site(Some("127.0.0.1:3001")),
            "http://127.0.0.1:3001"
        );
        assert_eq!(
            install_site(Some("localhost:3000")),
            "http://localhost:3000"
        );
        // A forged Host must not point the script at another server
        assert_eq!(
            install_site(Some("evil.example")),
            "https://neoleaf.science"
        );
        assert_eq!(
            install_site(Some("127.0.0.1.evil.example")),
            "https://neoleaf.science"
        );
        assert_eq!(
            install_site(Some("127.0.0.1:abc")),
            "https://neoleaf.science"
        );
        assert_eq!(
            install_site(Some("evil.example/127.0.0.1")),
            "https://neoleaf.science"
        );
        assert_eq!(install_site(None), "https://neoleaf.science");
    }
}

#[cfg(test)]
mod serve_file_tests {
    use super::serve_file;

    #[tokio::test]
    async fn a_missing_file_is_404_no_store_not_an_empty_immutable_200() {
        let resp = serve_file(
            "static/does-not-exist.wasm",
            "application/wasm",
            Some("public, max-age=31536000, immutable"),
        )
        .await
        .unwrap();
        assert_eq!(resp.status(), 404);
        assert_eq!(resp.headers().get("cache-control").unwrap(), "no-store");
        let ok = serve_file("Cargo.toml", "text/plain", Some("no-cache"))
            .await
            .unwrap();
        assert_eq!(ok.status(), 200);
        assert_eq!(ok.headers().get("cache-control").unwrap(), "no-cache");
    }
}
