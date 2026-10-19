//! NeoLeaf administration and system metrics module.
//!
//! Collects VPS metrics (CPU, RAM, disk, uptime)
//! and manages the users and active sessions of the system.

use std::{
    collections::HashMap,
    sync::OnceLock,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use crate::auth::github::GitHubUser;
use serde::Serialize;

static PROCESS_START: OnceLock<Instant> = OnceLock::new();

pub fn init_process_start() {
    if PROCESS_START.set(Instant::now()).is_ok() {
        warn_admin_matching(); // once, at startup
    }
}

fn process_uptime_secs() -> u64 {
    PROCESS_START
        .get()
        .map(|i| i.elapsed().as_secs())
        .unwrap_or(0)
}

/// `ADMIN_GITHUB_IDS` (comma-separated numeric GitHub ids), when set and not empty.
fn admin_ids_env() -> Option<String> {
    std::env::var("ADMIN_GITHUB_IDS")
        .ok()
        .filter(|v| !v.trim().is_empty())
}

/// Prints one startup line saying how administrators are recognised (never prints ids, logins or e-mails).
fn warn_admin_matching() {
    match admin_ids_env() {
        Some(list) => {
            let bad = list
                .split(',')
                .map(str::trim)
                .filter(|e| !e.is_empty() && e.parse::<u64>().is_err())
                .count();
            if bad > 0 {
                eprintln!(
                    "Warning: ADMIN_GITHUB_IDS has {bad} entry(ies) that are not numeric ids; they are ignored"
                );
            }
        }
        None => eprintln!(
            "Warning: ADMIN_GITHUB_IDS is not set; administrators are matched by the logins or e-mails in ADMIN_EMAILS (if any), which can change hands. Set ADMIN_GITHUB_IDS (numeric GitHub ids) to match by id instead"
        ),
    }
}

/// Checks whether the user has administrator privileges.
pub fn is_admin(user: &GitHubUser) -> bool {
    is_admin_with(
        user,
        admin_ids_env().as_deref(),
        std::env::var("ADMIN_EMAILS").ok().as_deref(),
    )
}

/// The rule behind `is_admin`, with the two settings passed in (so it can be tested without touching the environment).
/// An administrator is always a GitHub account: on Codeberg anyone can register the same login, so it never counts.
/// With a non-empty `ADMIN_GITHUB_IDS`, only the numeric ids in it count and the login/e-mail rules are ignored.
fn is_admin_with(user: &GitHubUser, github_ids: Option<&str>, extra_admins: Option<&str>) -> bool {
    if user.provider != crate::provider::Provider::GitHub {
        return false;
    }
    if let Some(ids) = github_ids.filter(|v| !v.trim().is_empty()) {
        return user.id != 0
            && ids
                .split(',')
                .filter_map(|e| e.trim().parse::<u64>().ok())
                .any(|id| id == user.id);
    }
    // Without ADMIN_GITHUB_IDS: a list of e-mails or logins from .env, ADMIN_EMAILS="email1@...,email2@..."
    if let Some(extra_admins) = extra_admins {
        for adm in extra_admins.split(',') {
            let adm = adm.trim();
            if !adm.is_empty() {
                if let Some(ref email) = user.email
                    && email.eq_ignore_ascii_case(adm)
                {
                    return true;
                }
                if user.login.eq_ignore_ascii_case(adm) {
                    return true;
                }
            }
        }
    }

    false
}

#[derive(Debug, Clone, Serialize)]
pub struct CpuMetrics {
    pub cores: usize,
    pub load_1m: f64,
    pub load_5m: f64,
    pub load_15m: f64,
    pub percent_estimate: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryMetrics {
    pub total_mb: u64,
    pub used_mb: u64,
    pub free_mb: u64,
    pub available_mb: u64,
    pub percent_used: f64,
    pub swap_total_mb: u64,
    pub swap_used_mb: u64,
    pub swap_percent_used: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiskMetrics {
    pub total_gb: f64,
    pub used_gb: f64,
    pub free_gb: f64,
    pub percent_used: f64,
    pub mount_point: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessMetrics {
    pub pid: u32,
    pub rss_mb: f64,
    pub uptime_secs: u64,
    pub uptime_formatted: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminUserSummary {
    pub provider: crate::provider::Provider,
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub session_count: usize,
    pub latest_session_created: u64,
    pub latest_session_formatted: String,
    pub is_admin: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemStats {
    pub hostname: String,
    pub os_name: String,
    pub kernel_version: String,
    pub system_uptime_secs: u64,
    pub system_uptime_formatted: String,
    pub cpu: CpuMetrics,
    pub memory: MemoryMetrics,
    pub disk: DiskMetrics,
    pub process: ProcessMetrics,
    pub collab_rooms: usize,
    pub collab_peers: usize,
    pub total_sessions: usize,
    pub unique_users_count: usize,
    pub users: Vec<AdminUserSummary>,
    /// blocked users (the list does not depend on an active session)
    pub blocked: Vec<crate::blocklist::Blocked>,
    /// on-disk cache of the TeX Live 2023 packages
    pub tl_cache: crate::ctan::CacheStats,
}

fn format_duration(seconds: u64) -> String {
    let days = seconds / 86400;
    let hours = (seconds % 86400) / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;

    if days > 0 {
        format!("{}d {}h {}m", days, hours, minutes)
    } else if hours > 0 {
        format!("{}h {}m {}s", hours, minutes, secs)
    } else {
        format!("{}m {}s", minutes, secs)
    }
}

fn format_timestamp_ago(ts: u64) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if ts >= now {
        return "right now".to_string();
    }
    let diff = now - ts;
    if diff < 60 {
        "a few seconds ago".to_string()
    } else if diff < 3600 {
        format!("{} min ago", diff / 60)
    } else if diff < 86400 {
        format!("{} h ago", diff / 3600)
    } else {
        format!("{} days ago", diff / 86400)
    }
}

/// Reads a trimmed text file, or returns the fallback when it cannot be read.
fn read_trimmed_or(path: &str, fallback: &str) -> String {
    std::fs::read_to_string(path)
        .unwrap_or_else(|_| fallback.to_string())
        .trim()
        .to_string()
}

/// Pretty OS name from `/etc/os-release`.
fn read_os_name() -> String {
    if let Ok(os_rel) = std::fs::read_to_string("/etc/os-release") {
        os_rel
            .lines()
            .find(|l| l.starts_with("PRETTY_NAME="))
            .map(|l| {
                l.trim_start_matches("PRETTY_NAME=")
                    .trim_matches('"')
                    .to_string()
            })
            .unwrap_or_else(|| "Linux (Ubuntu)".to_string())
    } else {
        "Linux".to_string()
    }
}

/// System uptime in seconds from `/proc/uptime`.
fn read_system_uptime_secs() -> u64 {
    std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| {
            s.split_whitespace()
                .next()
                .and_then(|v| v.parse::<f64>().ok())
        })
        .map(|f| f as u64)
        .unwrap_or(0)
}

/// CPU core count and load averages from `/proc/loadavg`.
fn read_cpu_metrics() -> CpuMetrics {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let mut load_1m = 0.0;
    let mut load_5m = 0.0;
    let mut load_15m = 0.0;
    if let Ok(loadavg) = std::fs::read_to_string("/proc/loadavg") {
        let parts: Vec<&str> = loadavg.split_whitespace().collect();
        if parts.len() >= 3 {
            load_1m = parts[0].parse().unwrap_or(0.0);
            load_5m = parts[1].parse().unwrap_or(0.0);
            load_15m = parts[2].parse().unwrap_or(0.0);
        }
    }
    let percent_estimate = if cores > 0 {
        ((load_1m / cores as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    CpuMetrics {
        cores,
        load_1m,
        load_5m,
        load_15m,
        percent_estimate,
    }
}

/// RAM and swap figures from `/proc/meminfo`.
fn read_memory_metrics() -> MemoryMetrics {
    let mut total_kb = 0u64;
    let mut free_kb = 0u64;
    let mut avail_kb = 0u64;
    let mut swap_total_kb = 0u64;
    let mut swap_free_kb = 0u64;
    if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
        for line in meminfo.lines() {
            let mut parts = line.split_whitespace();
            let key = parts.next().unwrap_or("");
            let val = parts
                .next()
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0);
            match key {
                "MemTotal:" => total_kb = val,
                "MemFree:" => free_kb = val,
                "MemAvailable:" => avail_kb = val,
                "SwapTotal:" => swap_total_kb = val,
                "SwapFree:" => swap_free_kb = val,
                _ => {}
            }
        }
    }
    let total_mb = total_kb / 1024;
    let available_mb = avail_kb / 1024;
    let free_mb = free_kb / 1024;
    let used_mb = total_mb.saturating_sub(available_mb);
    let mem_percent = if total_mb > 0 {
        (used_mb as f64 / total_mb as f64) * 100.0
    } else {
        0.0
    };

    let swap_total_mb = swap_total_kb / 1024;
    let swap_used_mb = swap_total_mb.saturating_sub(swap_free_kb / 1024);
    let swap_percent = if swap_total_mb > 0 {
        (swap_used_mb as f64 / swap_total_mb as f64) * 100.0
    } else {
        0.0
    };
    MemoryMetrics {
        total_mb,
        used_mb,
        free_mb,
        available_mb,
        percent_used: mem_percent,
        swap_total_mb,
        swap_used_mb,
        swap_percent_used: swap_percent,
    }
}

/// Root filesystem usage from `df`.
fn read_disk_metrics() -> DiskMetrics {
    let mut disk_total_gb = 0.0;
    let mut disk_used_gb = 0.0;
    let mut disk_free_gb = 0.0;
    let mut disk_percent = 0.0;
    let mount_point = "/".to_string();
    if let Ok(out) = std::process::Command::new("df")
        .args(["-k", "-P", "/"])
        .output()
        && let Ok(text) = String::from_utf8(out.stdout)
        && let Some(line) = text.lines().nth(1)
    {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            let total_k = parts[1].parse::<f64>().unwrap_or(0.0);
            let used_k = parts[2].parse::<f64>().unwrap_or(0.0);
            let free_k = parts[3].parse::<f64>().unwrap_or(0.0);
            disk_total_gb = total_k / 1024.0 / 1024.0;
            disk_used_gb = used_k / 1024.0 / 1024.0;
            disk_free_gb = free_k / 1024.0 / 1024.0;
            if disk_total_gb > 0.0 {
                disk_percent = (disk_used_gb / disk_total_gb) * 100.0;
            }
        }
    }
    DiskMetrics {
        total_gb: disk_total_gb,
        used_gb: disk_used_gb,
        free_gb: disk_free_gb,
        percent_used: disk_percent,
        mount_point,
    }
}

/// Resident memory, pid and uptime of the NeoLeaf process.
fn read_process_metrics() -> ProcessMetrics {
    let pid = std::process::id();
    let mut rss_mb = 0.0;
    if let Ok(statm) = std::fs::read_to_string("/proc/self/statm")
        && let Some(rss_pages) = statm
            .split_whitespace()
            .nth(1)
            .and_then(|v| v.parse::<f64>().ok())
    {
        rss_mb = (rss_pages * 4096.0) / 1024.0 / 1024.0;
    }
    let p_uptime = process_uptime_secs();
    ProcessMetrics {
        pid,
        rss_mb,
        uptime_secs: p_uptime,
        uptime_formatted: format_duration(p_uptime),
    }
}

/// Groups sessions per user: admins first, then the most recent login.
fn summarize_users(sessions: Vec<crate::session::SessionSummary>) -> Vec<AdminUserSummary> {
    let mut user_map: HashMap<String, AdminUserSummary> = HashMap::new();
    for s in sessions {
        let key = format!("{}:{}:{}", s.user.provider.id(), s.user.id, s.user.login);
        let entry = user_map.entry(key).or_insert_with(|| AdminUserSummary {
            provider: s.user.provider,
            id: s.user.id,
            login: s.user.login.clone(),
            name: s.user.name.clone(),
            email: s.user.email.clone(),
            avatar_url: s.user.avatar_url.clone(),
            session_count: 0,
            latest_session_created: s.created_at,
            latest_session_formatted: format_timestamp_ago(s.created_at),
            is_admin: is_admin(&s.user),
        });
        entry.session_count += 1;
        if s.created_at > entry.latest_session_created {
            entry.latest_session_created = s.created_at;
            entry.latest_session_formatted = format_timestamp_ago(s.created_at);
        }
    }

    let mut users: Vec<AdminUserSummary> = user_map.into_values().collect();
    // Sort administrators first, then the most recent
    users.sort_by(|a, b| {
        b.is_admin
            .cmp(&a.is_admin)
            .then_with(|| b.latest_session_created.cmp(&a.latest_session_created))
    });
    users
}

/// Gathers host, process, collaboration, session and cache figures for the admin panel.
pub async fn collect_system_stats() -> SystemStats {
    init_process_start();

    let hostname = read_trimmed_or("/proc/sys/kernel/hostname", "neoleaf-server");
    let kernel_version = read_trimmed_or("/proc/sys/kernel/osrelease", "Linux");
    let os_name = read_os_name();
    let sys_uptime_secs = read_system_uptime_secs();
    let cpu = read_cpu_metrics();
    let memory = read_memory_metrics();
    let disk = read_disk_metrics();
    let process = read_process_metrics();

    let (collab_rooms, collab_peers) = crate::collab::active_rooms_info().await;

    let sessions = crate::session::list_sessions().await;
    let total_sessions = sessions.len();
    let users = summarize_users(sessions);
    let unique_users_count = users.len();

    SystemStats {
        hostname,
        os_name,
        kernel_version,
        system_uptime_secs: sys_uptime_secs,
        system_uptime_formatted: format_duration(sys_uptime_secs),
        cpu,
        memory,
        disk,
        process,
        collab_rooms,
        collab_peers,
        total_sessions,
        unique_users_count,
        users,
        blocked: crate::blocklist::list(),
        tl_cache: crate::ctan::cache_stats().await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gh(id: u64, login: &str, email: Option<&str>) -> GitHubUser {
        GitHubUser {
            id,
            login: login.into(),
            email: email.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn admin_by_numeric_id_ignores_login_and_email_rules() {
        let ids = Some(" 42 , 4242,not-a-number,");
        assert!(is_admin_with(&gh(42, "anyone", None), ids, None));
        assert!(is_admin_with(&gh(4242, "other", None), ids, None));
        // someone who took over a listed login or e-mail is NOT an admin once ids are configured
        assert!(!is_admin_with(
            &gh(7, "olduser", Some("old@x.org")),
            ids,
            Some("old@x.org,olduser")
        ));
        assert!(!is_admin_with(
            &gh(7, "someone", Some("someone@x.org")),
            ids,
            Some("someone@x.org,someone")
        ));
        // id 0 never matches, nor does a partial number
        assert!(!is_admin_with(&gh(0, "x", None), Some("0"), None));
        assert!(!is_admin_with(&gh(4, "x", None), ids, None));
        // Codeberg never counts, even with a listed id
        let mut cb = gh(42, "anyone", None);
        cb.provider = crate::provider::Provider::Codeberg;
        assert!(!is_admin_with(&cb, ids, None));
        // a list with no valid id means nobody (it must not fall back to the name rules)
        assert!(!is_admin_with(
            &gh(7, "olduser", None),
            Some("abc"),
            Some("olduser")
        ));
    }

    #[test]
    fn without_ids_only_the_configured_list_applies() {
        for empty in [None, Some(""), Some("  ")] {
            // no built-in administrator: a fork that sets nothing has no admin
            assert!(!is_admin_with(
                &gh(7, "someone", Some("someone@x.org")),
                empty,
                None
            ));
            assert!(is_admin_with(
                &gh(7, "ana", Some("ADA@x.org")),
                empty,
                Some("ada@x.org")
            ));
            assert!(!is_admin_with(
                &gh(7, "ana", Some("ana@x.org")),
                empty,
                Some("ada@x.org")
            ));
        }
    }

    #[tokio::test]
    async fn test_collect_stats_runs() {
        let stats = collect_system_stats().await;
        assert!(stats.cpu.cores >= 1);
        assert!(!stats.hostname.is_empty());
    }
}
