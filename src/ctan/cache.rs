use super::*;

// ------------------------------------------------------------------ on-disk cache of TeX Live 2023 (public packages only)

/// Cache folder (`TL_CACHE_DIR`). Keeps only `<package>.tar.xz` of the frozen TeX Live 2023, checked against the index SHA-512:
/// public files, with no user or project data. It stays outside what the deploy replaces.
pub fn cache_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(
        std::env::var("TL_CACHE_DIR")
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "tlcache".to_string()),
    )
}

pub(super) fn cache_max_bytes() -> u64 {
    std::env::var("TL_CACHE_MAX_MB")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(3072)
        * 1024
        * 1024
}

/// Cache numbers for the administration panel.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct CacheStats {
    pub packages: usize,
    pub bytes: u64,
    /// when the last package arrived (seconds since 1970), or None if the cache is empty
    pub last_write_secs: Option<u64>,
    pub max_bytes: u64,
}

pub async fn cache_stats() -> CacheStats {
    let mut st = CacheStats {
        max_bytes: cache_max_bytes(),
        ..Default::default()
    };
    let Ok(mut rd) = tokio::fs::read_dir(cache_dir()).await else {
        return st;
    };
    while let Ok(Some(e)) = rd.next_entry().await {
        if !e.file_name().to_string_lossy().ends_with(".tar.xz") {
            continue;
        }
        let Ok(md) = e.metadata().await else { continue };
        st.packages += 1;
        st.bytes += md.len();
        if let Some(t) = md
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
        {
            st.last_write_secs = Some(st.last_write_secs.map_or(t, |c| c.max(t)));
        }
    }
    st
}

pub(super) fn cache_file(pkg: &str) -> Option<std::path::PathBuf> {
    valid_pkg_name(pkg).then(|| cache_dir().join(format!("{pkg}.tar.xz")))
}

pub(super) async fn cache_read(pkg: &str) -> Option<Vec<u8>> {
    tokio::fs::read(cache_file(pkg)?).await.ok()
}

/// Writes the package (temporary file and rename, so a file is never left half written). Does not write if it would exceed the space limit.
pub(super) async fn cache_write(pkg: &str, data: &[u8]) {
    let Some(path) = cache_file(pkg) else { return };
    if cache_stats().await.bytes + data.len() as u64 > cache_max_bytes() {
        eprintln!("TeX Live cache full: {pkg} was not stored");
        return;
    }
    if tokio::fs::create_dir_all(cache_dir()).await.is_err() {
        return;
    }
    let tmp = cache_dir().join(format!(".{pkg}.tmp-{}", std::process::id()));
    if tokio::fs::write(&tmp, data).await.is_ok() && tokio::fs::rename(&tmp, &path).await.is_ok() {
        return;
    }
    let _ = tokio::fs::remove_file(&tmp).await;
}

/// Expected SHA-512 of `<package>.tar.xz`, read from the on-disk index (None if the index has not been built yet: in that case the package
/// is used to compile but is not stored in the cache).
pub(super) async fn expected_sum(pkg: &str) -> Option<String> {
    let dir = cache_dir();
    if !index_ok(&dir) {
        return None;
    }
    let (path, pkg) = (index_paths(&dir).sums, pkg.to_string());
    tokio::task::spawn_blocking(move || lookup(&path, SUM_KEY_W, SUM_W, &pkg))
        .await
        .ok()
        .flatten()
}

pub(super) fn sha512_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha512};
    Sha512::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
