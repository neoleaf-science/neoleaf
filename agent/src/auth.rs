//! Pairing and authorization for the agent.
//!
//! - The **pairing code** (XXXX-XXXX-XXXX) is valid for 5 minutes, 5 attempts and a single use.
//! - When the code is confirmed, the browser receives its **own token** (`nlt_…`). The agent keeps only the hash (SHA-256)
//!   in `devices.json`; the token expires after 90 days without use and can be revoked (`neoleaf-agent revoke`).
//! - Old installations had a permanent code in `config.json`: it stays valid until `revoke all`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const CODE_TTL: u64 = 300;
pub const MAX_ATTEMPTS: u32 = 5;
pub const IDLE_EXPIRY: u64 = 90 * 24 * 3600;
pub const MAX_DEVICES: usize = 20;
const TOUCH_EVERY: u64 = 60;
pub const TOKEN_PREFIX: &str = "nlt_";

/// serializes reads/writes of the state files inside the process
static LOCK: Mutex<()> = Mutex::new(());

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Device {
    pub id: String,
    pub hash: String,
    pub label: String,
    pub created: u64,
    pub last_used: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct Devices {
    devices: Vec<Device>,
}

#[derive(Serialize, Deserialize)]
struct Pending {
    code: String,
    expires: u64,
    attempts: u32,
}

#[derive(Deserialize)]
struct LegacyConfig {
    token: String,
}

#[derive(Debug, PartialEq)]
pub enum Confirm {
    /// (browser token, device id)
    Paired(String, String),
    /// wrong or missing code
    Invalid,
    Expired,
    /// attempts exhausted: the code was invalidated
    Locked,
    /// paired device limit reached
    TooMany,
}

fn path(dir: &Path, name: &str) -> PathBuf {
    dir.join(name)
}

fn write_private(p: &Path, bytes: &[u8]) {
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp = p.with_extension("tmp");
    if fs::write(&tmp, bytes).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
        }
        let _ = fs::rename(&tmp, p);
    }
}

fn load<T: for<'de> Deserialize<'de>>(p: &Path) -> Option<T> {
    fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

/// Ignores case, hyphens and spaces (the code may be pasted from a notification or typed by hand).
pub fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn ct_eq(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

pub fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn new_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let raw: Vec<u8> = (0..12)
        .map(|_| ALPHABET[rand::random_range(0..ALPHABET.len())])
        .collect();
    raw.chunks(4)
        .map(|c| String::from_utf8_lossy(c).to_string())
        .collect::<Vec<_>>()
        .join("-")
}

fn new_token() -> String {
    let bytes: Vec<u8> = (0..32).map(|_| rand::random::<u8>()).collect();
    format!(
        "{TOKEN_PREFIX}{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    )
}

/// Generates a new pairing code (replacing the previous one) and writes it to `pairing.json`.
pub fn create_pending(dir: &Path) -> String {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let code = new_code();
    let p = Pending {
        code: code.clone(),
        expires: now() + CODE_TTL,
        attempts: 0,
    };
    write_private(
        &path(dir, "pairing.json"),
        serde_json::to_string(&p).unwrap_or_default().as_bytes(),
    );
    code
}

fn load_devices(dir: &Path) -> Devices {
    load(&path(dir, "devices.json")).unwrap_or_default()
}

fn save_devices(dir: &Path, d: &Devices) {
    write_private(
        &path(dir, "devices.json"),
        serde_json::to_string_pretty(d)
            .unwrap_or_default()
            .as_bytes(),
    );
}

/// Checks the code typed in the browser; if valid, creates the device token.
pub fn confirm(dir: &Path, code: &str, label: &str) -> Confirm {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let pp = path(dir, "pairing.json");
    let Some(mut pending) = load::<Pending>(&pp) else {
        return Confirm::Invalid;
    };
    if now() > pending.expires {
        let _ = fs::remove_file(&pp);
        return Confirm::Expired;
    }
    if !ct_eq(&normalize(code), &normalize(&pending.code)) {
        pending.attempts += 1;
        if pending.attempts >= MAX_ATTEMPTS {
            let _ = fs::remove_file(&pp);
            return Confirm::Locked;
        }
        write_private(
            &pp,
            serde_json::to_string(&pending)
                .unwrap_or_default()
                .as_bytes(),
        );
        return Confirm::Invalid;
    }
    let mut devices = load_devices(dir);
    let t = now();
    devices
        .devices
        .retain(|d| t.saturating_sub(d.last_used) < IDLE_EXPIRY);
    if devices.devices.len() >= MAX_DEVICES {
        return Confirm::TooMany;
    }
    let _ = fs::remove_file(&pp); // single use
    let token = new_token();
    let id = hash_token(&token)[..8].to_string();
    devices.devices.push(Device {
        id: id.clone(),
        hash: hash_token(&token),
        label: label.chars().take(60).collect(),
        created: t,
        last_used: t,
    });
    save_devices(dir, &devices);
    Confirm::Paired(token, id)
}

fn legacy_token(dir: &Path) -> Option<String> {
    load::<LegacyConfig>(&path(dir, "config.json"))
        .map(|c| c.token)
        .filter(|t| !t.is_empty())
}

/// Returns the id of the device authorized by `Authorization: Bearer …` (or "legacy").
pub fn authorize(dir: &Path, bearer: &str) -> Option<String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tok) = bearer.strip_prefix(TOKEN_PREFIX).map(|_| bearer) {
        let h = hash_token(tok);
        let mut devices = load_devices(dir);
        let t = now();
        let pos = devices.devices.iter().position(|d| ct_eq(&d.hash, &h))?;
        if t.saturating_sub(devices.devices[pos].last_used) >= IDLE_EXPIRY {
            devices.devices.remove(pos);
            save_devices(dir, &devices);
            return None;
        }
        let id = devices.devices[pos].id.clone();
        if t.saturating_sub(devices.devices[pos].last_used) >= TOUCH_EVERY {
            devices.devices[pos].last_used = t;
            save_devices(dir, &devices);
        }
        return Some(id);
    }
    let legacy = legacy_token(dir)?;
    if !bearer.is_empty() && ct_eq(&normalize(bearer), &normalize(&legacy)) {
        return Some("legacy".to_string());
    }
    None
}

pub fn list(dir: &Path) -> (Vec<Device>, bool) {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    (load_devices(dir).devices, legacy_token(dir).is_some())
}

/// Revokes a device by id ("legacy" removes the old permanent code). Returns how many were removed.
pub fn revoke(dir: &Path, id: &str) -> usize {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if id == "legacy" {
        return usize::from(fs::remove_file(path(dir, "config.json")).is_ok());
    }
    let mut devices = load_devices(dir);
    let before = devices.devices.len();
    devices.devices.retain(|d| d.id != id);
    save_devices(dir, &devices);
    before - devices.devices.len()
}

pub fn revoke_all(dir: &Path) -> usize {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let n = load_devices(dir).devices.len() + usize::from(legacy_token(dir).is_some());
    save_devices(dir, &Devices::default());
    let _ = fs::remove_file(path(dir, "config.json"));
    let _ = fs::remove_file(path(dir, "pairing.json"));
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "neoleaf-agent-test-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn pair(dir: &Path) -> (String, String) {
        let code = create_pending(dir);
        match confirm(dir, &code, "test") {
            Confirm::Paired(t, id) => (t, id),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn code_is_single_use() {
        let d = tmp();
        let code = create_pending(&d);
        assert!(matches!(confirm(&d, &code, "a"), Confirm::Paired(..)));
        assert_eq!(confirm(&d, &code, "b"), Confirm::Invalid);
    }

    #[test]
    fn code_is_lenient_about_format() {
        let d = tmp();
        let code = create_pending(&d);
        let sloppy = format!(" {} ", code.to_lowercase().replace('-', " "));
        assert!(matches!(confirm(&d, &sloppy, "a"), Confirm::Paired(..)));
    }

    #[test]
    fn wrong_code_locks_after_max_attempts() {
        let d = tmp();
        let code = create_pending(&d);
        for _ in 0..MAX_ATTEMPTS - 1 {
            assert_eq!(confirm(&d, "AAAA-AAAA-AAAA", "x"), Confirm::Invalid);
        }
        assert_eq!(confirm(&d, "AAAA-AAAA-AAAA", "x"), Confirm::Locked);
        assert_eq!(confirm(&d, &code, "x"), Confirm::Invalid); // the right code was invalidated too
    }

    #[test]
    fn expired_code_is_rejected() {
        let d = tmp();
        let code = create_pending(&d);
        let p = Pending {
            code: code.clone(),
            expires: now() - 1,
            attempts: 0,
        };
        fs::write(d.join("pairing.json"), serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(confirm(&d, &code, "x"), Confirm::Expired);
    }

    #[test]
    fn token_authorizes_and_is_stored_hashed() {
        let d = tmp();
        let (token, id) = pair(&d);
        assert_eq!(authorize(&d, &token), Some(id));
        assert_eq!(authorize(&d, "nlt_wrong"), None);
        assert_eq!(authorize(&d, ""), None);
        let stored = fs::read_to_string(d.join("devices.json")).unwrap();
        assert!(
            !stored.contains(&token),
            "the token must not be stored in plain text"
        );
    }

    #[test]
    fn revoke_removes_access() {
        let d = tmp();
        let (token, id) = pair(&d);
        let (token2, _) = pair(&d);
        assert_eq!(revoke(&d, &id), 1);
        assert_eq!(authorize(&d, &token), None);
        assert!(authorize(&d, &token2).is_some());
        assert_eq!(revoke_all(&d), 1);
        assert_eq!(authorize(&d, &token2), None);
    }

    #[test]
    fn idle_token_expires() {
        let d = tmp();
        let (token, _) = pair(&d);
        let mut devices = load_devices(&d);
        devices.devices[0].last_used = now() - IDLE_EXPIRY - 1;
        save_devices(&d, &devices);
        assert_eq!(authorize(&d, &token), None);
        assert!(list(&d).0.is_empty());
    }

    #[test]
    fn legacy_token_keeps_working_until_revoked() {
        let d = tmp();
        fs::write(d.join("config.json"), r#"{"token":"ABCD-EFGH-JKLM"}"#).unwrap();
        assert_eq!(authorize(&d, "abcd-efgh-jklm"), Some("legacy".into()));
        assert_eq!(authorize(&d, "ABCD-EFGH-JKLX"), None);
        assert_eq!(revoke(&d, "legacy"), 1);
        assert_eq!(authorize(&d, "ABCD-EFGH-JKLM"), None);
    }

    #[test]
    fn device_limit() {
        let d = tmp();
        for _ in 0..MAX_DEVICES {
            pair(&d);
        }
        let code = create_pending(&d);
        assert_eq!(confirm(&d, &code, "x"), Confirm::TooMany);
    }
}
