//! Users blocked by the administrator.
//!
//! A block applies by GitHub **id** (which does not change if the person renames their login) and by login (case
//! insensitive), so it can also block someone who has not signed in yet. It lives in `blocked.json` (mode 0600) and survives
//! restarts. A blocked person loses their sessions, cannot sign in again and is disconnected from live editing.

use std::{
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::provider::Provider;

const MAX_BLOCKED: usize = 2000;
const MAX_REASON: usize = 200;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Blocked {
    /// which service (GitHub or Codeberg) the block applies to: ids and logins of each service are independent
    #[serde(default)]
    pub provider: Provider,
    /// account id on the service; 0 when blocked by login only (the person had not signed in yet)
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub reason: String,
    pub blocked_at: u64,
    pub blocked_by: String,
}

static LIST: Mutex<Vec<Blocked>> = Mutex::new(Vec::new());

fn file_path() -> PathBuf {
    PathBuf::from(std::env::var("BLOCKLIST_FILE").unwrap_or_else(|_| "blocked.json".to_string()))
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Loads the list from disk (call once at startup).
pub fn load() {
    let Ok(text) = std::fs::read_to_string(file_path()) else {
        return;
    };
    match serde_json::from_str::<Vec<Blocked>>(&text) {
        Ok(list) => {
            let n = list.len();
            *LIST.lock().unwrap_or_else(|e| e.into_inner()) = list;
            if n > 0 {
                println!("🚫 {n} blocked user(s)");
            }
        }
        Err(_) => eprintln!("Warning: could not read {}", file_path().display()),
    }
}

fn persist(list: &[Blocked]) {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let path = file_path();
    let tmp = path.with_extension("tmp");
    let Ok(json) = serde_json::to_vec_pretty(list) else {
        return;
    };
    let res = (|| -> std::io::Result<()> {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(&json)?;
        f.sync_all()?;
        std::fs::rename(&tmp, &path)
    })();
    if res.is_err() {
        eprintln!("Warning: could not write the blocked list to disk");
    }
}

fn same(b: &Blocked, provider: Provider, id: u64, login: &str) -> bool {
    b.provider == provider
        && ((b.id != 0 && id != 0 && b.id == id) || b.login.eq_ignore_ascii_case(login))
}

/// Is this account blocked? An entry made by login only (id 0) learns the numeric id the first time the person shows up with
/// it, so the block survives a rename of the account.
pub fn is_blocked(provider: Provider, id: u64, login: &str) -> bool {
    let mut list = LIST.lock().unwrap_or_else(|e| e.into_inner());
    let Some(hit) = list.iter().position(|b| same(b, provider, id, login)) else {
        return false;
    };
    if list[hit].id == 0 && id != 0 {
        list[hit].id = id;
        persist(&list);
    }
    true
}

/// Most recent first.
pub fn list() -> Vec<Blocked> {
    let mut v = LIST.lock().unwrap_or_else(|e| e.into_inner()).clone();
    v.sort_by_key(|b| std::cmp::Reverse(b.blocked_at));
    v
}

/// Valid login for the service: GitHub allows letters, digits and hyphen (up to 39 characters); Codeberg also `.` and `_`.
pub fn valid_login(provider: Provider, login: &str) -> bool {
    match provider.kind() {
        crate::provider::Kind::GitHub => {
            !login.is_empty()
                && login.len() <= 39
                && login
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        }
        crate::provider::Kind::Forgejo => crate::ids::valid_login(login),
    }
}

pub fn clean_reason(reason: &str) -> String {
    reason
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_REASON)
        .collect()
}

/// Blocks (or updates the reason of someone already blocked).
pub fn block(entry: Blocked) -> Result<(), String> {
    if !valid_login(entry.provider, &entry.login) {
        return Err("Invalid login".to_string());
    }
    let mut list = LIST.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = list
        .iter_mut()
        .find(|b| same(b, entry.provider, entry.id, &entry.login))
    {
        *existing = Blocked {
            id: if entry.id != 0 { entry.id } else { existing.id },
            ..entry
        };
    } else {
        if list.len() >= MAX_BLOCKED {
            return Err("The blocked list is full".to_string());
        }
        list.push(entry);
    }
    persist(&list);
    Ok(())
}

/// Unblocks by login, on the given service. Returns whether there was someone to unblock.
pub fn unblock(provider: Provider, login: &str) -> bool {
    let mut list = LIST.lock().unwrap_or_else(|e| e.into_inner());
    let before = list.len();
    list.retain(|b| !(b.provider == provider && b.login.eq_ignore_ascii_case(login)));
    let changed = list.len() != before;
    if changed {
        persist(&list);
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: u64, login: &str) -> Blocked {
        Blocked {
            provider: Provider::GitHub,
            id,
            login: login.into(),
            name: None,
            avatar_url: None,
            reason: "teste".into(),
            blocked_at: now(),
            blocked_by: "admin".into(),
        }
    }

    /// Tests share the global list: each one uses its own logins and writes to a temporary file.
    fn setup() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            let p = std::env::temp_dir()
                .join(format!("neoleaf-blocked-test-{}.json", std::process::id()));
            // SAFETY: set only once, before any write, and only by tests
            unsafe { std::env::set_var("BLOCKLIST_FILE", p) };
        });
    }

    #[test]
    fn blocks_by_id_and_by_login_case_insensitively() {
        setup();
        block(entry(4242, "Fulano-Teste")).unwrap();
        assert!(
            is_blocked(Provider::GitHub, 4242, "outro-login"),
            "same id, login changed"
        );
        assert!(
            is_blocked(Provider::GitHub, 0, "fulano-teste"),
            "lowercase login"
        );
        assert!(is_blocked(Provider::GitHub, 9, "FULANO-TESTE"));
        assert!(!is_blocked(Provider::GitHub, 4243, "fulano-teste2"));
        assert!(unblock(Provider::GitHub, "FULANO-teste"));
        assert!(!is_blocked(Provider::GitHub, 4242, "fulano-teste"));
        assert!(
            !unblock(Provider::GitHub, "fulano-teste"),
            "already unblocked"
        );
    }

    #[test]
    fn block_by_login_only_then_learn_the_id() {
        setup();
        block(entry(0, "ainda-nao-entrou")).unwrap();
        assert!(is_blocked(Provider::GitHub, 777, "ainda-nao-entrou"));
        // blocking again with the known id updates the same entry
        block(entry(777, "ainda-nao-entrou")).unwrap();
        assert_eq!(
            list()
                .iter()
                .filter(|b| b.login == "ainda-nao-entrou")
                .count(),
            1
        );
        assert_eq!(
            list()
                .iter()
                .find(|b| b.login == "ainda-nao-entrou")
                .unwrap()
                .id,
            777
        );
        assert!(unblock(Provider::GitHub, "ainda-nao-entrou"));
    }

    #[test]
    fn block_applies_only_to_the_service_where_it_was_made() {
        setup();
        block(entry(5151, "mesmo-nome-teste")).unwrap();
        assert!(is_blocked(Provider::GitHub, 5151, "mesmo-nome-teste"));
        // the same person (or another with the same login and id) on Codeberg is not blocked
        assert!(!is_blocked(Provider::Codeberg, 5151, "mesmo-nome-teste"));
        assert!(!unblock(Provider::Codeberg, "mesmo-nome-teste"));
        assert!(is_blocked(Provider::GitHub, 5151, "mesmo-nome-teste"));
        assert!(unblock(Provider::GitHub, "mesmo-nome-teste"));
    }

    #[test]
    fn login_rules_follow_the_service() {
        setup();
        for login in ["ana_silva", "ana.silva", "a.b_c-d"] {
            assert!(
                valid_login(Provider::Codeberg, login),
                "{login} on Codeberg"
            );
            assert!(!valid_login(Provider::GitHub, login), "{login} on GitHub");
        }
        for login in ["ana-silva", "Ana99"] {
            assert!(
                valid_login(Provider::Codeberg, login) && valid_login(Provider::GitHub, login),
                "{login}"
            );
        }
        for bad in ["", ".", "..", "a b", "a/b", "a?b", "a%2Fb"] {
            assert!(!valid_login(Provider::Codeberg, bad), "{bad:?} on Codeberg");
        }
        assert!(!valid_login(Provider::Codeberg, &"a".repeat(41)));
        // and block() applies the rule of the entry's own service
        let mut cb = entry(8801, "ana_cb.teste");
        cb.provider = Provider::Codeberg;
        block(cb).unwrap();
        assert!(is_blocked(Provider::Codeberg, 8801, "ana_cb.teste"));
        assert!(
            block(entry(8802, "ana_gh.teste")).is_err(),
            "the same login is refused for GitHub"
        );
        assert!(unblock(Provider::Codeberg, "ana_cb.teste"));
    }

    #[test]
    fn an_entry_made_by_login_learns_the_id_when_the_person_signs_in() {
        setup();
        block(entry(0, "vai-renomear")).unwrap();
        assert_eq!(
            list()
                .iter()
                .find(|b| b.login == "vai-renomear")
                .unwrap()
                .id,
            0
        );
        // signs in: the id is stored on the entry
        assert!(is_blocked(Provider::GitHub, 9191, "Vai-Renomear"));
        assert_eq!(
            list()
                .iter()
                .find(|b| b.login == "vai-renomear")
                .unwrap()
                .id,
            9191
        );
        // after renaming the account the id still matches; someone else with the old login and another id is still blocked by login
        assert!(is_blocked(Provider::GitHub, 9191, "nome-novo"));
        assert!(is_blocked(Provider::GitHub, 9192, "vai-renomear"));
        assert!(!is_blocked(Provider::GitHub, 9192, "nome-novo"));
        // a lookup without id (0) does not erase or change it
        assert!(is_blocked(Provider::GitHub, 0, "vai-renomear"));
        assert_eq!(
            list()
                .iter()
                .find(|b| b.login == "vai-renomear")
                .unwrap()
                .id,
            9191
        );
        assert!(unblock(Provider::GitHub, "vai-renomear"));
    }

    #[test]
    fn validates_login_and_limits_the_reason() {
        setup();
        assert!(block(entry(1, "tem espaço")).is_err());
        assert!(block(entry(1, "")).is_err());
        assert!(block(entry(1, &"a".repeat(40))).is_err());
        assert_eq!(clean_reason("  abuso\n\tgrave  "), "abusograve");
        assert_eq!(clean_reason(&"x".repeat(500)).chars().count(), 200);
    }

    #[test]
    fn persists_to_disk_and_reloads() {
        setup();
        block(entry(31337, "persistido-teste")).unwrap();
        let text = std::fs::read_to_string(file_path()).unwrap();
        assert!(text.contains("persistido-teste"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(file_path()).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert!(unblock(Provider::GitHub, "persistido-teste"));
    }
}
