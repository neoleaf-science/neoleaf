use super::*;

pub(super) fn valid_pkg_name(pkg: &str) -> bool {
    !pkg.is_empty()
        && pkg.len() <= 60
        && pkg
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && pkg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '+'))
}

/// Network error message with the cause (reqwest's default text hides the reason).
pub(super) fn net_err(what: &str, e: reqwest::Error) -> String {
    let mut msg = format!("{what}: {e}");
    let mut src = std::error::Error::source(&e);
    while let Some(s) = src {
        msg.push_str(&format!(" ({s})"));
        src = s.source();
    }
    msg
}

/// Error worth retrying (network, 5xx, 408, 429); 404 and other 4xx do not change on a second attempt.
pub(super) fn is_transient(err: &str) -> bool {
    match err
        .strip_prefix("HTTP ")
        .and_then(|c| c.parse::<u16>().ok())
    {
        Some(code) => code >= 500 || code == 408 || code == 429,
        None => !err.starts_with("Download is too large"),
    }
}

/// Downloads with up to 3 attempts (growing wait) for mirrors that occasionally close the connection or are slow.
pub(super) async fn download(http: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut last = String::new();
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(700 * attempt)).await;
        }
        match download_once(http, url).await {
            Ok(data) => return Ok(data),
            Err(e) => {
                let retry = is_transient(&e);
                last = e;
                if !retry {
                    break;
                }
            }
        }
    }
    Err(last)
}

pub(super) async fn download_once(http: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut resp = http
        .get(url)
        .send()
        .await
        .map_err(|e| net_err("Download failed", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let mut data = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| net_err("Download failed", e))?
    {
        data.extend_from_slice(&chunk);
        if data.len() > MAX_DOWNLOAD {
            return Err("Download is too large".to_string());
        }
    }
    Ok(data)
}

/// `archive/<name>.tar.xz` -> `<name>` (the TeX Live package name, which is what the index is keyed by).
fn tar_name(url: &str) -> Option<&str> {
    let file = url.split(['?', '#']).next()?.rsplit('/').next()?;
    file.strip_suffix(".tar.xz").filter(|n| valid_pkg_name(n))
}

/// Reads the package contents (CPU: decompression) outside the threads that serve requests.
pub(super) async fn sanitize_blocking(
    data: std::sync::Arc<Vec<u8>>,
    is_tar: bool,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    tokio::task::spawn_blocking(move || {
        if is_tar {
            sanitize_tar_xz(&data)
        } else {
            sanitize_zip(&data)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Result of trying a list of addresses for a package.
pub(super) struct Attempt {
    pub(super) files: Option<Vec<(String, Vec<u8>)>>,
    /// some address downloaded, but without ready-made files (.sty/.cls...)
    pub(super) saw_empty: bool,
    pub(super) last_err: String,
}

/// Tries each address (url, is it tar.xz?) in order and returns the files of the first that works. The `cacheable` address (TeX Live
/// 2023) is checked against the index SHA-512 and, if it matches, stored in the on-disk cache.
pub(super) async fn try_candidates(
    http: &reqwest::Client,
    pkg: &str,
    candidates: Vec<(String, bool)>,
    cacheable: Option<&str>,
) -> Attempt {
    let mut t = Attempt {
        files: None,
        saw_empty: false,
        last_err: String::new(),
    };
    for (url, is_tar) in candidates {
        match download(http, &url).await {
            Ok(data) => {
                let is_cacheable = cacheable == Some(url.as_str());
                // every TeX Live archive is checked against the index when the index knows its hash (a different hash is refused)
                let mut verified = false;
                if let Some(want) = tar_name(&url).filter(|_| is_tar)
                    && let Some(want) = expected_sum(want).await
                {
                    let got = sha512_hex(&data);
                    if got != want {
                        eprintln!("package {pkg}: SHA-512 differs from the index at {url}");
                        t.last_err = format!("corrupted or altered file ({url})");
                        continue;
                    }
                    verified = true;
                }
                let data = std::sync::Arc::new(data);
                match sanitize_blocking(data.clone(), is_tar).await {
                    Ok(f) if !f.is_empty() => {
                        eprintln!("package {pkg}: {} file(s) from {url}", f.len());
                        if verified && is_cacheable {
                            cache_write(pkg, &data).await;
                        }
                        t.files = Some(f);
                        return t;
                    }
                    Ok(_) => {
                        eprintln!("package {pkg}: no usable file at {url}");
                        t.saw_empty = true;
                    }
                    Err(e) => {
                        eprintln!("package {pkg}: error reading {url}: {e}");
                        t.last_err = e;
                    }
                }
            }
            Err(e) => {
                eprintln!("package {pkg}: failure at {url}: {e}");
                t.last_err = format!("{e} ({url})");
            }
        }
    }
    t
}

/// Reads the package from the on-disk cache, without going to the internet; an invalid cache file is deleted.
async fn read_valid_cache(pkg: &str) -> Option<Vec<(String, Vec<u8>)>> {
    // do we already have this package on disk? Read it from there, without going to the internet
    let raw = cache_read(pkg).await?;
    match sanitize_blocking(std::sync::Arc::new(raw), true).await {
        Ok(f) if !f.is_empty() => Some(f),
        _ => {
            eprintln!("package {pkg}: invalid on-disk cache, deleting");
            if let Some(path) = cache_file(pkg) {
                let _ = tokio::fs::remove_file(path).await;
            }
            None
        }
    }
}

/// Asks the CTAN API about the package (short limit); None when it is unknown or unreachable.
async fn fetch_ctan_meta(http: &reqwest::Client, pkg: &str) -> Option<Value> {
    let api = std::env::var("CTAN_API_URL")
        .unwrap_or_else(|_| "https://ctan.org/json/2.0/pkg".to_string());
    let resp = tokio::time::timeout(
        Duration::from_secs(6),
        http.get(format!("{api}/{pkg}")).send(),
    )
    .await
    .ok()?
    .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let meta: Value = tokio::time::timeout(Duration::from_secs(6), resp.json())
        .await
        .ok()?
        .ok()?;
    (!meta["errors"].is_array() && !meta["name"].is_null()).then_some(meta)
}

/// Extra download candidates from CTAN's metadata (TeX Live name, TDS zip, package directory).
fn extra_candidates(meta: Option<&Value>, pkg: &str, mirror: &str) -> Vec<(String, bool)> {
    let mut more: Vec<(String, bool)> = Vec::new();
    if let Some(meta) = meta {
        if let Some(tl_name) = meta["texlive"]
            .as_str()
            .filter(|n| valid_pkg_name(n) && *n != pkg)
        {
            more.push((
                format!("{}/archive/{tl_name}.tar.xz", historic_tlnet()),
                true,
            ));
            more.push((
                format!("{mirror}/systems/texlive/tlnet/archive/{tl_name}.tar.xz"),
                true,
            ));
        }
        if let Some(install) = meta["install"]
            .as_str()
            .filter(|p| p.starts_with('/') && !p.contains(".."))
        {
            more.push((format!("{mirror}{install}"), false));
        }
        if let Some(path) = meta["ctan"]["path"]
            .as_str()
            .filter(|p| p.starts_with('/') && !p.contains(".."))
        {
            more.push((format!("{mirror}{path}.zip"), false));
        }
    }
    more
}

/// Downloads a package and returns the usable LaTeX files. Goes straight to the TeX Live mirrors, without first asking CTAN
/// whether the package exists (that query hung for up to 90 s from some servers, and Cloudflare cut it off with 524):
/// 1. the TeX Live package from the era of the browser compiler (`tlnet-final/archive/<package>.tar.xz`);
/// 2. the current TeX Live package.
///
/// Only if those fail does it query CTAN (with a short limit) and try the TeX Live name, the "TDS" zip and the package directory.
pub async fn fetch_package(pkg: &str) -> Result<Vec<(String, Vec<u8>)>, String> {
    if !valid_pkg_name(pkg) {
        return Err("Invalid package name".to_string());
    }
    let http = reqwest::Client::builder()
        // redirects only to https (a mirror must not push the download onto plain http) and at most 5 of them
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() == "https" && attempt.previous().len() < 5 {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .timeout(Duration::from_secs(90))
        .user_agent("NeoLeaf/0.1 (+https://neoleaf.science)")
        .build()
        .map_err(|e| e.to_string())?;
    let mirror =
        std::env::var("CTAN_MIRROR_URL").unwrap_or_else(|_| "https://mirrors.ctan.org".to_string());

    // first the TeX Live from the same era as the browser compiler (LaTeX kernel 2023-11): current packages use commands
    // from the newer kernel (e.g. tcolorbox 6.10 needs \NewStructureName) and break compilation; then the current TeX Live.
    if let Some(files) = read_valid_cache(pkg).await {
        return Ok(files);
    }
    let historic = format!("{}/archive/{pkg}.tar.xz", historic_tlnet());
    let direct = vec![
        (historic.clone(), true),
        (
            format!("{mirror}/systems/texlive/tlnet/archive/{pkg}.tar.xz"),
            true,
        ),
    ];
    let first = try_candidates(&http, pkg, direct, Some(&historic)).await;
    if let Some(files) = first.files {
        return Ok(files);
    }

    // Something went wrong: now it is worth asking CTAN (package name in TeX Live, TDS zip, directory), with a short limit
    let meta = fetch_ctan_meta(&http, pkg).await;
    let more = extra_candidates(meta.as_ref(), pkg, &mirror);
    let second = try_candidates(&http, pkg, more, None).await;
    if let Some(files) = second.files {
        return Ok(files);
    }

    if first.saw_empty || second.saw_empty {
        return Err(format!(
            "The package \"{pkg}\" has no ready-made files (.sty/.cls...): it must be generated from the .ins. Upload the generated files manually."
        ));
    }
    if meta.is_none() && first.last_err.starts_with("HTTP 404") {
        return Err(format!("Package \"{pkg}\" not found in TeX Live"));
    }
    let last_err = if second.last_err.is_empty() {
        first.last_err
    } else {
        second.last_err
    };
    Err(format!("Could not download \"{pkg}\": {last_err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ctan::test_support::*;

    #[test]
    fn hash_name_comes_from_the_archive_url() {
        assert_eq!(
            tar_name("https://m.example/archive/tcolorbox.tar.xz"),
            Some("tcolorbox")
        );
        assert_eq!(
            tar_name("https://m.example/archive/x.tar.xz?a=1"),
            Some("x")
        );
        assert_eq!(tar_name("https://m.example/pkg.zip"), None);
    }

    #[test]
    fn only_retries_transient_errors() {
        assert!(is_transient(
            "Download failed: connection closed before message completed"
        ));
        assert!(is_transient("HTTP 503") && is_transient("HTTP 429") && is_transient("HTTP 408"));
        assert!(!is_transient("HTTP 404") && !is_transient("HTTP 403"));
        assert!(!is_transient("Download is too large"));
    }

    #[tokio::test]
    async fn package_downloads_directly_without_asking_ctan() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        let _a = ENV_LOCK.lock().await;
        let mirror = fake_server(
            vec![(
                "direct.tar.xz",
                tar_xz_of("tex/latex/direct/direct.sty", "% sty"),
            )],
            Arc::new(AtomicUsize::new(0)),
        )
        .await;
        let api_connections = Arc::new(AtomicUsize::new(0));
        let api = fake_server(vec![], api_connections.clone()).await; // the CTAN API "hangs": it never answers
        let dir = new_dir();
        // SAFETY: the tests that use these variables serialize on ENV_LOCK.
        unsafe {
            std::env::set_var("TLNET_HISTORIC_URL", &mirror);
            std::env::set_var("CTAN_MIRROR_URL", &mirror);
            std::env::set_var("CTAN_API_URL", &api);
            std::env::set_var("TL_CACHE_DIR", &dir);
        }
        let t0 = std::time::Instant::now();
        let files = fetch_package("direct").await.unwrap();
        assert!(
            t0.elapsed() < Duration::from_secs(5),
            "must not wait for the CTAN API"
        );
        assert_eq!(
            files.iter().map(|f| f.0.as_str()).collect::<Vec<_>>(),
            vec!["direct.sty"]
        );
        assert_eq!(
            api_connections.load(Ordering::SeqCst),
            0,
            "with the download working, CTAN is not even queried"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn package_checks_the_sha512_and_stays_on_disk() {
        use std::sync::{Arc, atomic::AtomicUsize};
        let _a = ENV_LOCK.lock().await;
        let good = tar_xz_of("tex/latex/good/good.sty", "% good");
        let bad = tar_xz_of("tex/latex/bad/bad.sty", "% bad");
        // fake TeX Live index: the "good" one with the right SHA-512; the "bad" one with a hash that does not match
        let tlpdb = format!(
            "name good\ncategory Package\nrunfiles size=1\n texmf-dist/tex/latex/good/good.sty\ncontainerchecksum {}\n\nname bad\ncategory Package\nrunfiles size=1\n texmf-dist/tex/latex/bad/bad.sty\ncontainerchecksum {}\n",
            sha512_hex(&good),
            "0".repeat(128)
        );
        let mut tlpdb_xz = Vec::new();
        lzma_rs::xz_compress(&mut Cursor::new(tlpdb.into_bytes()), &mut tlpdb_xz).unwrap();
        let mirror = fake_server(
            vec![
                ("tlpdb", tlpdb_xz),
                ("good.tar.xz", good),
                ("bad.tar.xz", bad),
            ],
            Arc::new(AtomicUsize::new(0)),
        )
        .await;
        let dir = new_dir();
        unsafe {
            std::env::set_var("TLNET_HISTORIC_URL", &mirror);
            std::env::set_var("CTAN_MIRROR_URL", &mirror);
            std::env::set_var("TLPDB_URL", format!("{mirror}/tlpdb"));
            std::env::set_var("CTAN_API_URL", "http://127.0.0.1:1");
            std::env::set_var("TL_CACHE_DIR", &dir);
        }
        assert_eq!(
            package_for_file("good.sty").await.unwrap().as_deref(),
            Some("good"),
            "loads the index"
        );

        // 1st time: downloads, checks the hash and stores on disk
        assert_eq!(fetch_package("good").await.unwrap()[0].0, "good.sty");
        let st = cache_stats().await;
        assert_eq!(st.packages, 1);
        assert!(st.bytes > 0 && st.last_write_secs.is_some());
        assert!(dir.join("good.tar.xz").exists());

        // 2nd time, with the internet "down": comes from disk
        unsafe {
            std::env::set_var("TLNET_HISTORIC_URL", "http://127.0.0.1:1");
            std::env::set_var("CTAN_MIRROR_URL", "http://127.0.0.1:1");
        }
        assert_eq!(
            fetch_package("good").await.unwrap()[0].0,
            "good.sty",
            "comes from the cache"
        );

        // hash that does not match: not valid and not stored
        unsafe {
            std::env::set_var("TLNET_HISTORIC_URL", &mirror);
            std::env::set_var("CTAN_MIRROR_URL", "http://127.0.0.1:1");
        }
        assert!(fetch_package("bad").await.is_err());
        assert!(!dir.join("bad.tar.xz").exists());
        // the second candidate (current TeX Live mirror) is checked too: historic down, tampered file at the mirror
        unsafe {
            std::env::set_var("TLNET_HISTORIC_URL", "http://127.0.0.1:1");
            std::env::set_var("CTAN_MIRROR_URL", &mirror);
        }
        assert!(
            fetch_package("bad").await.is_err(),
            "a hash that does not match is refused on the second candidate as well"
        );
        unsafe {
            std::env::set_var("TLNET_HISTORIC_URL", &mirror);
            std::env::set_var("CTAN_MIRROR_URL", "http://127.0.0.1:1");
        }

        // corrupted cache file: it is deleted and the package is downloaded again
        std::fs::write(dir.join("good.tar.xz"), b"junk").unwrap();
        assert_eq!(fetch_package("good").await.unwrap()[0].0, "good.sty");
        assert!(std::fs::metadata(dir.join("good.tar.xz")).unwrap().len() > 10);

        // space limit: with a low ceiling, the new package does not enter
        unsafe { std::env::set_var("TL_CACHE_MAX_MB", "1") };
        assert_eq!(cache_stats().await.max_bytes, 1024 * 1024);
        cache_write("big", &vec![7u8; 2 * 1024 * 1024]).await;
        assert!(
            !dir.join("big.tar.xz").exists(),
            "over the limit: does not enter"
        );
        unsafe { std::env::remove_var("TL_CACHE_MAX_MB") };
        let _ = std::fs::remove_dir_all(&dir);
    }
}
