//! TeX Live/CTAN packages: the browser cannot reach CTAN because of CORS, so the server downloads the package and returns the
//! usable LaTeX files (`/api/ctan/package`) and answers "which package contains this file?" (`/api/ctan/resolve`).
//!
//! It is a stateless proxy: nothing is kept on the server. The person's project lives in the browser (`.neoleaf/texmf/`).
//! Only the public file -> package index (`texlive.tlpdb`) is kept (on disk, see below).

use std::{
    collections::HashMap,
    io::{Cursor, Read, Write},
    time::Duration,
};

use serde_json::Value;

mod cache;
mod fetch;
mod index;
mod resolve;
mod sanitize;
#[cfg(test)]
mod test_support;

use cache::*;
use fetch::*;
use index::*;
#[cfg(test)]
use resolve::*;
use sanitize::*;

pub use cache::{CacheStats, cache_dir, cache_stats};
pub use fetch::fetch_package;
pub use resolve::{package_for_file, warm_index};

/// At most this many package downloads run at once (each one downloads and unpacks tens of MB).
const FETCH_SLOTS: usize = 3;

/// Waits briefly for a download slot; `None` when the server stays busy. Hold the permit while `fetch_package` runs.
pub async fn acquire_fetch_slot() -> Option<tokio::sync::OwnedSemaphorePermit> {
    static SLOTS: std::sync::OnceLock<std::sync::Arc<tokio::sync::Semaphore>> =
        std::sync::OnceLock::new();
    let sem = SLOTS
        .get_or_init(|| std::sync::Arc::new(tokio::sync::Semaphore::new(FETCH_SLOTS)))
        .clone();
    tokio::time::timeout(Duration::from_secs(5), sem.acquire_owned())
        .await
        .ok()?
        .ok()
}
