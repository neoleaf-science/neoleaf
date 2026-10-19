//! Sessions stored on the server. The browser cookie carries only a random identifier;
//! the provider tokens live here, are renewed automatically and survive restarts
//! (`sessions.json` file, mode 0600, encrypted with AES-256-GCM using `SESSION_KEY`; without the key, memory only).

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::auth::github::GitHubUser;

const MAX_AGE_SECS: u64 = 30 * 24 * 3600;
/// Global cap, only a last resort (the per-person cap is the one that normally applies).
const MAX_SESSIONS: usize = 2000;
/// Sessions one person (provider + numeric id) may hold at once; the next sign-in evicts that person's own oldest.
const MAX_PER_PERSON: usize = 8;
/// The profile is re-read from the provider at most this often per session.
const PROFILE_REFRESH_SECS: u64 = 300;

fn max_per_person() -> usize {
    std::env::var("MAX_SESSIONS_PER_USER")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(MAX_PER_PERSON)
}

/// One HTTP client for every call to the providers' token and user endpoints (10 s timeout, so a slow provider never hangs a request).
pub fn http_client() -> &'static reqwest::Client {
    static HTTP: OnceLock<reqwest::Client> = OnceLock::new();
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default()
    })
}

#[derive(Clone, Serialize, Deserialize)]
struct Stored {
    user: GitHubUser,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
    created_at: u64,
    /// when the profile was last re-read from the provider (memory only, never written to disk)
    #[serde(skip)]
    profile_checked_at: u64,
}

/// Session ready to use, with a valid access token.
#[derive(Clone)]
pub struct Active {
    pub sid: String,
    pub user: GitHubUser,
    pub access_token: String,
}

static STORE: OnceLock<Mutex<HashMap<String, Stored>>> = OnceLock::new();

fn store() -> &'static Mutex<HashMap<String, Stored>> {
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn file_path() -> PathBuf {
    PathBuf::from(std::env::var("SESSIONS_FILE").unwrap_or_else(|_| "sessions.json".to_string()))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Prefix of the encrypted file (format version 1: prefix, 12-byte nonce, AES-256-GCM ciphertext with its tag).
const MAGIC: &[u8; 4] = b"NLS1";

/// The key that encrypts `sessions.json`: `SESSION_KEY`, 32 random bytes in base64. `Ok(None)` when it is not set.
fn key() -> Result<Option<[u8; 32]>, String> {
    let Ok(raw) = std::env::var("SESSION_KEY") else {
        return Ok(None);
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|_| "SESSION_KEY is not valid base64".to_string())?;
    <[u8; 32]>::try_from(bytes.as_slice())
        .map(Some)
        .map_err(|_| {
            format!(
                "SESSION_KEY must be 32 bytes (got {}); generate one with: openssl rand -base64 32",
                bytes.len()
            )
        })
}

fn seal(key: &[u8; 32], plain: &[u8]) -> Option<Vec<u8>> {
    use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let nonce: [u8; 12] = rand::random();
    let ct = cipher.encrypt((&nonce).into(), plain).ok()?;
    let mut out = Vec::with_capacity(MAGIC.len() + nonce.len() + ct.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Some(out)
}

fn open(key: &[u8; 32], data: &[u8]) -> Option<Vec<u8>> {
    use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};
    let rest = data.strip_prefix(MAGIC.as_slice())?;
    let (nonce, ct) = rest.split_at_checked(12)?;
    let nonce: [u8; 12] = nonce.try_into().ok()?;
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    cipher.decrypt((&nonce).into(), ct).ok()
}

/// Loads the sessions from disk (call once at startup). The file only exists encrypted: anything that cannot be
/// opened with the current key (old plain-text file, other key, corruption) is deleted and everybody signs in again.
pub fn load() {
    let key = match key() {
        Ok(k) => k,
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    };
    let path = file_path();
    let Some(key) = key else {
        // no key: sessions live in memory only and no token is ever written to disk
        let _ = std::fs::remove_file(&path);
        eprintln!(
            "Warning: SESSION_KEY is not set, sessions are kept in memory only (a restart signs everybody out)"
        );
        return;
    };
    let Ok(data) = std::fs::read(&path) else {
        return;
    };
    let Some(mut map) =
        open(&key, &data).and_then(|p| serde_json::from_slice::<HashMap<String, Stored>>(&p).ok())
    else {
        eprintln!(
            "Warning: {} could not be decrypted with SESSION_KEY, all sessions were dropped",
            path.display()
        );
        let _ = std::fs::remove_file(&path);
        return;
    };
    let t = now();
    map.retain(|_, s| t.saturating_sub(s.created_at) < MAX_AGE_SECS);
    let n = map.len();
    if let Ok(mut g) = store().try_lock() {
        *g = map;
    }
    println!("🔐 {n} session(s) restored");
}

/// Serializes the writers, so the file always ends with the newest state.
static WRITER: Mutex<()> = Mutex::const_new(());

/// Writes the sessions to disk. The store lock is held only to take the snapshot, never during the write.
async fn persist_now() {
    use std::os::unix::fs::OpenOptionsExt;
    let _writer = WRITER.lock().await;
    let json = {
        let map = store().lock().await;
        serde_json::to_vec(&*map)
    };
    let Ok(json) = json else { return };
    // without SESSION_KEY nothing is written (see `load`); a bad key was already refused at startup
    let Ok(Some(key)) = key() else { return };
    let Some(json) = seal(&key, &json) else {
        return;
    };
    let path = file_path();
    let tmp = path.with_extension("tmp");
    let res = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(&json)?;
        f.sync_all()?;
        std::fs::rename(&tmp, &path)
    })
    .await;
    if !matches!(res, Ok(Ok(()))) {
        eprintln!("Warning: could not write the sessions to disk");
    }
}

fn new_sid() -> String {
    let bytes: [u8; 32] = rand::random();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Who a session belongs to: provider and numeric id (the login only when the id is unknown).
fn person(u: &GitHubUser) -> (crate::provider::Provider, u64, String) {
    (
        u.provider,
        u.id,
        if u.id == 0 {
            u.login.to_ascii_lowercase()
        } else {
            String::new()
        },
    )
}

/// Makes room for a new session of `user`: drops expired ones, then that person's own oldest above the per-person cap.
/// Only when the whole server is full does it evict, and then from whoever holds the most sessions, never an unrelated person.
fn make_room(map: &mut HashMap<String, Stored>, user: &GitHubUser, t: u64, per_person: usize) {
    map.retain(|_, s| t.saturating_sub(s.created_at) < MAX_AGE_SECS);
    let me = person(user);
    loop {
        let oldest = map
            .iter()
            .filter(|(_, s)| person(&s.user) == me)
            .min_by_key(|(_, s)| s.created_at)
            .map(|(k, _)| k.clone());
        let count = map.values().filter(|s| person(&s.user) == me).count();
        match oldest {
            Some(k) if count >= per_person => {
                map.remove(&k);
            }
            _ => break,
        }
    }
    if map.len() >= MAX_SESSIONS {
        let mut counts: HashMap<(crate::provider::Provider, u64, String), usize> = HashMap::new();
        for s in map.values() {
            *counts.entry(person(&s.user)).or_default() += 1;
        }
        if let Some(heaviest) = counts.into_iter().max_by_key(|(_, n)| *n).map(|(k, _)| k)
            && let Some(k) = map
                .iter()
                .filter(|(_, s)| person(&s.user) == heaviest)
                .min_by_key(|(_, s)| s.created_at)
                .map(|(k, _)| k.clone())
        {
            map.remove(&k);
        }
    }
}

async fn insert(stored: Stored) -> String {
    let sid = new_sid();
    {
        let mut map = store().lock().await;
        make_room(&mut map, &stored.user, now(), max_per_person());
        map.insert(sid.clone(), stored);
    }
    persist_now().await;
    sid
}

pub async fn create(
    user: GitHubUser,
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
) -> String {
    let t = now();
    insert(Stored {
        user,
        access_token,
        refresh_token,
        expires_at: t + expires_in.unwrap_or(MAX_AGE_SECS),
        created_at: t,
        profile_checked_at: 0,
    })
    .await
}

pub async fn remove(sid: &str) {
    let removed = store().lock().await.remove(sid).is_some();
    if removed {
        persist_now().await;
    }
}

/// Ends all sessions of a user (by id or login). Returns how many there were.
pub async fn remove_user(provider: crate::provider::Provider, id: u64, login: &str) -> usize {
    let removed = {
        let mut map = store().lock().await;
        let before = map.len();
        map.retain(|_, s| {
            !(s.user.provider == provider
                && ((id != 0 && s.user.id == id) || s.user.login.eq_ignore_ascii_case(login)))
        });
        before - map.len()
    };
    if removed > 0 {
        persist_now().await;
    }
    removed
}

/// Stores the fresh profile; the file is rewritten only when something actually changed.
/// Returns whether anything changed (and was written).
pub async fn update_user(sid: &str, user: GitHubUser) -> bool {
    let changed = {
        let mut map = store().lock().await;
        match map.get_mut(sid) {
            Some(entry) if entry.user != user => {
                entry.user = user;
                true
            }
            _ => false,
        }
    };
    if changed {
        persist_now().await;
    }
    changed
}

/// True at most once every 5 minutes per session: whether the profile should be re-read from the provider now.
pub async fn profile_refresh_due(sid: &str) -> bool {
    let t = now();
    let mut map = store().lock().await;
    match map.get_mut(sid) {
        Some(entry) if t.saturating_sub(entry.profile_checked_at) >= PROFILE_REFRESH_SECS => {
            entry.profile_checked_at = t;
            true
        }
        _ => false,
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub sid_prefix: String,
    pub user: GitHubUser,
    pub created_at: u64,
    pub expires_at: u64,
}

/// Returns the list of all active sessions on the server (for the admin panel).
pub async fn list_sessions() -> Vec<SessionSummary> {
    let map = store().lock().await;
    map.iter()
        .map(|(sid, s)| {
            let prefix = if sid.len() > 8 { &sid[..8] } else { sid };
            SessionSummary {
                sid_prefix: format!("{}...", prefix),
                user: s.user.clone(),
                created_at: s.created_at,
                expires_at: s.expires_at,
            }
        })
        .collect()
}

/// Outcome of renewing a Codeberg access token.
enum Renewal {
    Fresh(Box<Stored>),
    /// the provider definitively refused the refresh token (or there is none): the session cannot be renewed
    Refused,
    /// network error, timeout or 5xx: nothing was decided, the session stays as it is
    Unavailable,
}

type RefreshLocks = std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>;

fn refresh_locks() -> &'static RefreshLocks {
    static LOCKS: OnceLock<RefreshLocks> = OnceLock::new();
    LOCKS.get_or_init(Default::default)
}

/// One lock per session id: a refresh token is single use, so two requests must never refresh the same session at once.
fn refresh_lock(sid: &str) -> Arc<Mutex<()>> {
    refresh_locks()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .entry(sid.to_string())
        .or_default()
        .clone()
}

/// Forgets the lock once nobody else holds or waits for it (`lock` is our own handle).
fn release_refresh_lock(sid: &str, lock: Arc<Mutex<()>>) {
    let mut g = refresh_locks().lock().unwrap_or_else(|e| e.into_inner());
    // the registry's reference plus ours: nobody else is waiting
    if Arc::strong_count(&lock) <= 2 {
        g.remove(sid);
    }
}

async fn renew(sid: &str) -> Renewal {
    let lock = refresh_lock(sid);
    let result = {
        let _turn = lock.lock().await;
        renew_locked(sid).await
    };
    release_refresh_lock(sid, lock);
    result
}

async fn renew_locked(sid: &str) -> Renewal {
    // read again after waiting for our turn: another request may already have renewed the token (and used up the refresh token)
    let Some(current) = store().lock().await.get(sid).cloned() else {
        return Renewal::Refused;
    };
    if current.expires_at > now() + 60 {
        return Renewal::Fresh(Box::new(current));
    }
    let Some(rt) = current.refresh_token.clone() else {
        return Renewal::Refused;
    };
    match crate::auth::forgejo::refresh(http_client(), &rt).await {
        Ok(tok) => {
            let fresh = {
                let mut map = store().lock().await;
                let Some(entry) = map.get_mut(sid) else {
                    return Renewal::Refused;
                };
                entry.access_token = tok.access_token.clone();
                if tok.refresh_token.is_some() {
                    entry.refresh_token = tok.refresh_token.clone();
                }
                entry.expires_at = now() + tok.expires_in.unwrap_or(3600);
                entry.clone()
            };
            persist_now().await;
            Renewal::Fresh(Box::new(fresh))
        }
        Err(crate::auth::forgejo::RefreshError::Refused(why)) => {
            eprintln!("Session ended: the provider refused the refresh token ({why})");
            Renewal::Refused
        }
        Err(crate::auth::forgejo::RefreshError::Transient(why)) => {
            eprintln!("Token renewal failed for now, the session was kept: {why}");
            Renewal::Unavailable
        }
    }
}

/// Returns the session with a valid access token.
pub async fn active(sid: &str) -> Option<Active> {
    if sid.is_empty() || sid.len() > 128 {
        return None;
    }
    let current = { store().lock().await.get(sid).cloned()? };
    let t = now();

    if t.saturating_sub(current.created_at) >= MAX_AGE_SECS {
        remove(sid).await;
        return None;
    }

    // blocked by the administrator: the session stops being valid immediately
    if crate::blocklist::is_blocked(current.user.provider, current.user.id, &current.user.login) {
        remove(sid).await;
        return None;
    }

    // Codeberg: the token expires (after 1 hour by default) and is renewed with the refresh token.
    // A definitive refusal ends the session. A transient failure (network, timeout, 5xx) keeps it and answers "no session" for
    // this request only: handing out the expired token would make the next API call fail with 401, and the browser treats that
    // as a revoked session and signs the person out, so the next request (after the provider recovers) renews it instead.
    let mut current = current;
    if current.expires_at <= t + 60 && current.user.provider == crate::provider::Provider::Codeberg
    {
        match renew(sid).await {
            Renewal::Fresh(s) => current = *s,
            Renewal::Refused => {
                remove(sid).await;
                return None;
            }
            Renewal::Unavailable => return None,
        }
    }

    Some(Active {
        sid: sid.to_string(),
        user: current.user,
        access_token: current.access_token,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Valid access token of a session (only tests need this).
    async fn token_for(sid: &str) -> Result<String, String> {
        active(sid)
            .await
            .map(|a| a.access_token)
            .ok_or_else(|| "Session expired".to_string())
    }

    fn blocked_user(id: u64, login: &str) -> GitHubUser {
        GitHubUser {
            id,
            login: login.into(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn blocked_user_loses_the_session_and_cannot_recover_it() {
        temp_store();
        let user = blocked_user(990_001, "blocked-session-test");
        let sid = create(user.clone(), "test-token".to_string(), None, None).await;
        let sid2 = create(user.clone(), "test-token".to_string(), None, None).await;
        let other = create(
            blocked_user(990_002, "other-session-test"),
            "test-token".to_string(),
            None,
            None,
        )
        .await;
        assert!(active(&sid).await.is_some());

        crate::blocklist::block(crate::blocklist::Blocked {
            provider: user.provider,
            id: user.id,
            login: user.login.clone(),
            name: None,
            avatar_url: None,
            reason: String::new(),
            blocked_at: 1,
            blocked_by: "admin".into(),
        })
        .unwrap();
        // even without ending the sessions by hand, `active` already refuses (and cleans up)
        assert!(active(&sid).await.is_none());
        assert!(store().lock().await.get(&sid).is_none());
        // remove_user drops the person's remaining sessions and only theirs
        assert_eq!(remove_user(user.provider, user.id, &user.login).await, 1);
        assert!(active(&sid2).await.is_none());
        assert!(active(&other).await.is_some());

        assert!(crate::blocklist::unblock(user.provider, &user.login));
        // old sessions do not come back, but a new login works
        let fresh = create(user, "test-token".to_string(), None, None).await;
        assert!(active(&fresh).await.is_some());
    }

    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn set_env(key: &str, value: &str) {
        // SAFETY: only this test changes these variables and no other thread reads them at the same time.
        unsafe { std::env::set_var(key, value) }
    }

    /// Tests write to a temporary file, never to the real `sessions.json`.
    fn temp_store() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            set_env(
                "SESSION_KEY",
                "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
            );
            set_env(
                "SESSIONS_FILE",
                &std::env::temp_dir()
                    .join(format!("neoleaf-sessions-test-{}.json", std::process::id()))
                    .to_string_lossy(),
            );
        });
    }

    #[test]
    fn sessions_file_encryption() {
        let key = [7u8; 32];
        let plain = br#"{"sid":{"access_token":"gho_secret"}}"#;
        let sealed = seal(&key, plain).unwrap();
        assert!(sealed.starts_with(MAGIC));
        assert!(
            !sealed.windows(10).any(|w| w == b"gho_secret"),
            "token must not appear in the file"
        );
        assert_eq!(open(&key, &sealed).unwrap(), plain);
        // a new nonce every time
        assert_ne!(sealed, seal(&key, plain).unwrap());
        // wrong key, tampered data, old plain-text file and truncated file are all refused
        assert!(open(&[8u8; 32], &sealed).is_none());
        let mut bad = sealed.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(open(&key, &bad).is_none());
        assert!(open(&key, plain).is_none());
        assert!(open(&key, &sealed[..10]).is_none());
    }

    fn person_user(provider: crate::provider::Provider, id: u64) -> GitHubUser {
        GitHubUser {
            provider,
            id,
            login: format!("person{id}"),
            email: Some("a@b.com".into()),
            name: Some("A".into()),
            ..Default::default()
        }
    }

    fn stored(
        user: GitHubUser,
        access: &str,
        refresh: Option<&str>,
        expires_at: u64,
        created_at: u64,
    ) -> Stored {
        Stored {
            user,
            access_token: access.into(),
            refresh_token: refresh.map(str::to_string),
            expires_at,
            created_at,
            profile_checked_at: 0,
        }
    }

    async fn put(
        sid: &str,
        user: GitHubUser,
        access: &str,
        refresh: Option<&str>,
        expires_at: u64,
        created_at: u64,
    ) {
        store().lock().await.insert(
            sid.to_string(),
            stored(user, access, refresh, expires_at, created_at),
        );
    }

    /// Minimal HTTP server that always answers with the same status/body. Returns the base address (what CODEBERG_URL takes).
    async fn fake_token_server(status: &'static str, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = [0u8; 4096];
                let _ = sock.read(&mut buf).await;
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            }
        });
        format!("http://{addr}")
    }

    /// Token server with a single-use refresh token (like Forgejo): the current one works once and is replaced; any other is
    /// `invalid_grant`. Answers slowly so that parallel requests overlap. Returns the address and the count of accepted refreshes.
    async fn rotating_token_server(first: &'static str) -> (String, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let accepted = Arc::new(AtomicUsize::new(0));
        let counter = accepted.clone();
        let current = Arc::new(std::sync::Mutex::new(first.to_string()));
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let (counter, current) = (counter.clone(), current.clone());
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let sent = req
                        .split("refresh_token=")
                        .nth(1)
                        .map(|r| r.split('&').next().unwrap_or("").to_string())
                        .unwrap_or_default();
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                    let (status, body) = {
                        let mut cur = current.lock().unwrap();
                        if sent == *cur {
                            let k = counter.fetch_add(1, Ordering::SeqCst) + 1;
                            *cur = format!("rot{k}");
                            (
                                "200 OK",
                                format!(
                                    r#"{{"access_token":"tok-{k}","token_type":"Bearer","refresh_token":"rot{k}","expires_in":3600}}"#
                                ),
                            )
                        } else {
                            (
                                "400 Bad Request",
                                r#"{"error":"invalid_grant"}"#.to_string(),
                            )
                        }
                    };
                    let resp = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                });
            }
        });
        (format!("http://{addr}"), accepted)
    }

    #[tokio::test]
    async fn sessions_expire_and_renew() {
        use crate::provider::Provider::{Codeberg, GitHub};
        temp_store();
        let t = now();
        set_env("CODEBERG_CLIENT_ID", "id");
        set_env("CODEBERG_CLIENT_SECRET", "secret");

        // token still valid: returned as is, without renewing
        put(
            "valida",
            person_user(Codeberg, 810_001),
            "tok-antigo",
            Some("r"),
            t + 3000,
            t,
        )
        .await;
        assert_eq!(active("valida").await.unwrap().access_token, "tok-antigo");

        // GitHub tokens do not expire: never renewed
        put(
            "gh",
            person_user(GitHub, 810_002),
            "gh-tok",
            None,
            t - 10,
            t,
        )
        .await;
        assert_eq!(active("gh").await.unwrap().access_token, "gh-tok");

        // session too old (> 30 days): removed
        put(
            "velha",
            person_user(Codeberg, 810_003),
            "x",
            Some("r"),
            t + 3000,
            t - MAX_AGE_SECS - 10,
        )
        .await;
        assert!(active("velha").await.is_none());
        assert!(store().lock().await.get("velha").is_none());

        // expired and without a refresh token: nothing can renew it, removed
        put(
            "sem-refresh",
            person_user(Codeberg, 810_004),
            "x",
            None,
            t - 10,
            t,
        )
        .await;
        assert!(active("sem-refresh").await.is_none());
        assert!(store().lock().await.get("sem-refresh").is_none());

        // invalid identifier
        assert!(active("").await.is_none());
        assert!(active("nao-existe").await.is_none());

        // expired with a refresh token: the provider returns a new token
        let ok = fake_token_server(
            "200 OK",
            r#"{"access_token":"tok-new","token_type":"Bearer","expires_in":3599}"#,
        )
        .await;
        set_env("CODEBERG_URL", &ok);
        put(
            "renova",
            person_user(Codeberg, 810_005),
            "tok-antigo",
            Some("r"),
            t - 10,
            t,
        )
        .await;
        let a = active("renova").await.unwrap();
        assert_eq!(a.access_token, "tok-new");
        let s = store().lock().await.get("renova").cloned().unwrap();
        assert!(s.expires_at > t + 3000, "new expiry recorded");
        assert_eq!(
            s.refresh_token.as_deref(),
            Some("r"),
            "refresh token kept when the provider sends no new one"
        );
        assert_eq!(token_for("renova").await.unwrap(), "tok-new");

        // refresh token revoked (400 invalid_grant): session removed
        let bad = fake_token_server("400 Bad Request", r#"{"error":"invalid_grant"}"#).await;
        set_env("CODEBERG_URL", &bad);
        put(
            "revogada",
            person_user(Codeberg, 810_006),
            "tok-antigo",
            Some("r"),
            t - 10,
            t,
        )
        .await;
        assert!(active("revogada").await.is_none());
        assert!(store().lock().await.get("revogada").is_none());
        assert!(token_for("revogada").await.is_err());

        // transient failures (503 or an unreachable provider): no session for this request, but it is NOT deleted
        let down = fake_token_server("503 Service Unavailable", "unavailable").await;
        set_env("CODEBERG_URL", &down);
        put(
            "provedor-fora",
            person_user(Codeberg, 810_007),
            "tok-antigo",
            Some("r"),
            t - 10,
            t,
        )
        .await;
        assert!(active("provedor-fora").await.is_none());
        let kept = store()
            .lock()
            .await
            .get("provedor-fora")
            .cloned()
            .expect("a transient failure keeps the session");
        assert_eq!(kept.refresh_token.as_deref(), Some("r"));
        set_env("CODEBERG_URL", "http://127.0.0.1:1");
        assert!(active("provedor-fora").await.is_none());
        assert!(
            store().lock().await.get("provedor-fora").is_some(),
            "connection refused keeps it too"
        );
        // the provider recovers: the very next request renews it
        set_env("CODEBERG_URL", &ok);
        assert_eq!(
            active("provedor-fora").await.unwrap().access_token,
            "tok-new"
        );

        // two requests at once after the token expired: one refresh (the token is single use), both succeed, session kept
        let (rot, accepted) = rotating_token_server("r0").await;
        set_env("CODEBERG_URL", &rot);
        put(
            "paralela",
            person_user(Codeberg, 810_008),
            "tok-antigo",
            Some("r0"),
            t - 10,
            t,
        )
        .await;
        let (a, b, c) = tokio::join!(active("paralela"), active("paralela"), active("paralela"));
        assert_eq!(a.expect("first").access_token, "tok-1");
        assert_eq!(b.expect("second").access_token, "tok-1");
        assert_eq!(c.expect("third").access_token, "tok-1");
        assert_eq!(
            accepted.load(Ordering::SeqCst),
            1,
            "only one refresh reached the provider"
        );
        let s = store()
            .lock()
            .await
            .get("paralela")
            .cloned()
            .expect("session kept");
        assert_eq!(
            s.refresh_token.as_deref(),
            Some("rot1"),
            "the rotated refresh token was stored"
        );
        assert!(
            refresh_locks().lock().unwrap().get("paralela").is_none(),
            "the per-session lock is forgotten"
        );
    }

    #[tokio::test]
    async fn one_person_cannot_log_everybody_else_out() {
        use crate::provider::Provider::{Codeberg, GitHub};
        temp_store();
        let t = now();
        let greedy = person_user(GitHub, 820_001);
        let neighbour = person_user(GitHub, 820_002);
        let same_id_elsewhere = person_user(Codeberg, 820_001);
        for (sid, u) in [("viz-a", &neighbour), ("viz-b", &same_id_elsewhere)] {
            put(sid, u.clone(), "x", None, t + 3000, t - 500).await;
        }
        // the neighbours are the oldest sessions of the server: with the old global rule they would go first
        let mut mine = vec![];
        for i in 0..(MAX_PER_PERSON + 3) {
            let sid = insert(stored(
                greedy.clone(),
                "x",
                None,
                t + 3000,
                t - 100 + i as u64,
            ))
            .await;
            mine.push(sid);
        }
        let map = store().lock().await;
        let alive: Vec<_> = mine.iter().filter(|s| map.contains_key(*s)).collect();
        assert_eq!(
            alive.len(),
            MAX_PER_PERSON,
            "the person keeps at most {MAX_PER_PERSON}"
        );
        assert!(
            mine[..3].iter().all(|s| !map.contains_key(s)),
            "their own oldest ones were evicted"
        );
        assert!(
            mine[3..].iter().all(|s| map.contains_key(s)),
            "the newest ones stay"
        );
        assert!(
            map.contains_key("viz-a") && map.contains_key("viz-b"),
            "other people (and the same id on another provider) keep theirs"
        );
    }

    #[test]
    fn the_global_cap_takes_from_whoever_holds_the_most() {
        use crate::provider::Provider::GitHub;
        let t = now();
        let mut map: HashMap<String, Stored> = HashMap::new();
        for i in 0..MAX_SESSIONS {
            // one heavy person with most of the sessions, plus single-session people (older)
            let (id, created) = if i < 10 {
                (830_000 + i as u64, t - 1000)
            } else {
                (830_100, t - 500 + i as u64 % 400)
            };
            map.insert(
                format!("s{i}"),
                stored(person_user(GitHub, id), "x", None, t + 3000, created),
            );
        }
        make_room(&mut map, &person_user(GitHub, 830_999), t, 1000);
        assert_eq!(map.len(), MAX_SESSIONS - 1);
        assert!(
            (0..10).all(|i| map.contains_key(&format!("s{i}"))),
            "the oldest sessions of unrelated people stay"
        );
    }

    #[tokio::test]
    async fn profile_refresh_is_throttled_and_the_file_is_not_rewritten_without_changes() {
        temp_store();
        let t = now();
        let user = person_user(crate::provider::Provider::GitHub, 840_001);
        put("perfil", user.clone(), "x", None, t + 3000, t).await;
        assert!(profile_refresh_due("perfil").await, "first time");
        assert!(
            !profile_refresh_due("perfil").await,
            "then not again for 5 minutes"
        );
        assert!(!profile_refresh_due("nao-existe").await);

        assert!(
            !update_user("perfil", user.clone()).await,
            "same profile: nothing written"
        );
        let mut changed = user.clone();
        changed.name = Some("New Name".into());
        assert!(
            update_user("perfil", changed.clone()).await,
            "changed profile: written"
        );
        assert!(!update_user("perfil", changed).await, "and not again");
        assert_eq!(
            store()
                .lock()
                .await
                .get("perfil")
                .unwrap()
                .user
                .name
                .as_deref(),
            Some("New Name")
        );
    }
}
