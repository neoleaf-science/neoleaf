//! Helpers shared by the unit tests of the submodules (the environment variables are process wide, so one lock for all).

use super::*;

/// Locks the tests that touch the module's environment variables (the environment is process wide).
pub(crate) static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(crate) fn tar_xz_of(path: &str, data: &str) -> Vec<u8> {
    let mut tar_bytes = Vec::new();
    {
        let mut b = tar::Builder::new(&mut tar_bytes);
        let mut h = tar::Header::new_gnu();
        h.set_size(data.len() as u64);
        h.set_mode(0o644);
        h.set_path(path).unwrap();
        h.set_cksum();
        b.append(&h, data.as_bytes()).unwrap();
        b.finish().unwrap();
    }
    let mut xz = Vec::new();
    lzma_rs::xz_compress(&mut Cursor::new(tar_bytes), &mut xz).unwrap();
    xz
}

/// Minimal server: answers 200 with the body of the first route whose fragment appears in the requested path (404 if none).
/// Without routes, it accepts the connection and never answers ("hangs", as ctan.org used to).
pub(crate) async fn fake_server(
    routes: Vec<(&'static str, Vec<u8>)>,
    connections: std::sync::Arc<std::sync::atomic::AtomicUsize>,
) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                break;
            };
            connections.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let routes = routes.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = request.split_whitespace().nth(1).unwrap_or("").to_string();
                if routes.is_empty() {
                    tokio::time::sleep(Duration::from_secs(600)).await;
                    return;
                }
                let (status, body) = match routes.iter().find(|(k, _)| path.contains(k)) {
                    Some((_, b)) => ("200 OK", b.clone()),
                    None => ("404 Not Found", Vec::new()),
                };
                let head = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = sock.write_all(head.as_bytes()).await;
                let _ = sock.write_all(&body).await;
            });
        }
    });
    format!("http://{addr}")
}

pub(crate) fn new_dir() -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!(
        "tlcache-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}
