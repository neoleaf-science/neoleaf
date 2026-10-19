mod script;
mod shell;
mod styles;

use super::{esc, fill};
use crate::admin::{AdminUserSummary, SystemStats};
use crate::auth::github::GitHubUser;

/// Renders the admin panel: metrics, users, blocked users and the template catalog.
pub fn render(stats: &SystemStats, user: &GitHubUser) -> String {
    let users_rows = users_rows(stats, user);
    let blocked_rows = blocked_rows(stats);

    let user_button = super::user_topbar_button(user, false);
    let user_profile_modal = super::user_profile_modal_html(user);

    fill(
        &page_template(),
        &[
            ("USER_BUTTON", &user_button),
            ("USER_PROFILE_MODAL", &user_profile_modal),
            ("APP_VERSION", env!("CARGO_PKG_VERSION")),
            ("CPU_CORES", &stats.cpu.cores.to_string()),
            ("CPU_LOAD_1M", &format!("{:.2}", stats.cpu.load_1m)),
            ("CPU_LOAD_5M", &format!("{:.2}", stats.cpu.load_5m)),
            ("CPU_LOAD_15M", &format!("{:.2}", stats.cpu.load_15m)),
            ("CPU_PERCENT", &format!("{:.1}", stats.cpu.percent_estimate)),
            ("MEM_USED_MB", &stats.memory.used_mb.to_string()),
            ("MEM_TOTAL_MB", &stats.memory.total_mb.to_string()),
            ("MEM_FREE_MB", &stats.memory.free_mb.to_string()),
            ("MEM_PERCENT", &format!("{:.1}", stats.memory.percent_used)),
            ("TL_CACHE", &tl_cache_text(&stats.tl_cache)),
            ("SWAP_USED_MB", &stats.memory.swap_used_mb.to_string()),
            ("SWAP_TOTAL_MB", &stats.memory.swap_total_mb.to_string()),
            (
                "SWAP_PERCENT",
                &format!("{:.1}", stats.memory.swap_percent_used),
            ),
            ("DISK_USED_GB", &format!("{:.1}", stats.disk.used_gb)),
            ("DISK_TOTAL_GB", &format!("{:.1}", stats.disk.total_gb)),
            ("DISK_FREE_GB", &format!("{:.1}", stats.disk.free_gb)),
            ("DISK_PERCENT", &format!("{:.1}", stats.disk.percent_used)),
            ("DISK_MOUNT", &esc(&stats.disk.mount_point)),
            ("SYS_UPTIME", &esc(&stats.system_uptime_formatted)),
            ("PROC_PID", &stats.process.pid.to_string()),
            ("PROC_RSS", &format!("{:.1}", stats.process.rss_mb)),
            ("PROC_UPTIME", &esc(&stats.process.uptime_formatted)),
            ("UNIQUE_USERS", &stats.unique_users_count.to_string()),
            ("TOTAL_SESSIONS", &stats.total_sessions.to_string()),
            ("COLLAB_ROOMS", &stats.collab_rooms.to_string()),
            ("COLLAB_PEERS", &stats.collab_peers.to_string()),
            ("SERVER_HOSTNAME", &esc(&stats.hostname)),
            ("SERVER_OS", &esc(&stats.os_name)),
            ("SERVER_KERNEL", &esc(&stats.kernel_version)),
            ("USERS_ROWS", &users_rows),
            ("BLOCKED_ROWS", &blocked_rows),
            ("BLOCKED_COUNT", &stats.blocked.len().to_string()),
        ],
    )
}

/// Page template (with `{{PLACEHOLDERS}}`) assembled from the static blocks, in page order.
fn page_template() -> String {
    [
        shell::head(),
        styles::styles(),
        "</head>",
        shell::body_and_top_bar(),
        "",
        r#"    <div class="admin-wrap">"#,
        shell::page_header(),
        "",
        shell::tabs_nav(),
        "",
        r#"        <div id="tab-overview">"#,
        shell::metric_cards(),
        "",
        shell::counter_cards(),
        "",
        shell::vps_box(),
        "        </div>",
        "",
        shell::users_tab_open(),
        shell::users_table(),
        "",
        shell::blocked_box(),
        "        </div>",
        "",
        shell::block_modal(),
        "",
        shell::models_tab_open(),
        shell::models_table(),
        "",
        shell::model_form(),
        "",
        shell::suggest_box(),
        "        </div>",
        "    </div>",
        "",
        "    <script>",
        script::live_stats_js(),
        "",
        script::block_users_js(),
        "",
        script::template_catalog_js(),
        "",
        script::suggested_templates_js(),
        "    </script>",
        "    {{USER_PROFILE_MODAL}}",
        "</body>",
        "</html>",
    ]
    .join("\n")
}

/// Table rows of the registered users.
fn users_rows(stats: &SystemStats, user: &GitHubUser) -> String {
    let mut rows = String::new();
    for u in &stats.users {
        rows.push_str(&user_row(u, user));
    }
    rows
}

/// One row of the users table (avatar, name, e-mail, provider, sessions, last activity and block button).
fn user_row(u: &AdminUserSummary, user: &GitHubUser) -> String {
    let avatar = match &u.avatar_url {
        Some(url) if url.starts_with("https://") => {
            format!(r#"<img src="{}" style="width: 28px; height: 28px; border-radius: 50%; vertical-align: middle; margin-right: 8px;" alt="">"#, esc(url))
        }
        _ => r#"<span style="display:inline-flex; width:28px; height:28px; border-radius:50%; background:var(--border-color); align-items:center; justify-content:center; margin-right:8px; font-size:14px;">👤</span>"#.to_string(),
    };

    let admin_badge = if u.is_admin {
        r#"<span style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; background:color-mix(in srgb, var(--green) 15%, var(--bg-primary)); color:var(--green); font-size:11px; font-weight:700; margin-left:6px;">🛡️ Administrator</span>"#
    } else {
        ""
    };

    let account_type = format!(
        r#"<span style="padding:2px 6px; border-radius:4px; background:rgba(56,139,253,0.12); color:#58a6ff; font-size:11px; font-weight:600;">{} OAuth</span>"#,
        u.provider.label()
    );

    let gh_link = format!(
        r#"<a href="{web}/{login}" target="_blank" rel="noopener" style="color:var(--text-bright); text-decoration:none; font-weight:600;">@{login} ↗</a>"#,
        web = esc(&u.provider.web()),
        login = esc(&u.login)
    );

    let action_cell = block_action_cell(u, user);

    let name_display = u.name.as_deref().unwrap_or("-");
    let email_display = u.email.as_deref().unwrap_or("-");

    format!(
        r#"<tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 12px 14px; display: flex; align-items: center;">
                    {avatar}
                    <div>
                        {gh_link} {admin_badge}
                    </div>
                </td>
                <td style="padding: 12px 14px; font-size: 13px; color: var(--text-primary);">{name}</td>
                <td style="padding: 12px 14px; font-size: 13px; color: var(--text-primary); font-family: monospace;">{email}</td>
                <td style="padding: 12px 14px;">{account_type}</td>
                <td style="padding: 12px 14px; font-size: 13px; text-align: center;"><span style="background:var(--bg-primary); padding:2px 8px; border-radius:10px; font-weight:600;">{sessions}</span></td>
                <td style="padding: 12px 14px; font-size: 12px; color: var(--muted);">{last_seen}</td>
                <td style="padding: 12px 14px; text-align: right;">{action_cell}</td>
            </tr>"#,
        avatar = avatar,
        gh_link = gh_link,
        admin_badge = admin_badge,
        name = esc(name_display),
        email = esc(email_display),
        account_type = account_type,
        sessions = u.session_count,
        last_seen = esc(&u.latest_session_formatted),
        action_cell = action_cell,
    )
}

/// Last cell of a user row: the block button, or a dash for administrators and the current user.
fn block_action_cell(u: &AdminUserSummary, user: &GitHubUser) -> String {
    let is_me = u.login.eq_ignore_ascii_case(&user.login) || (user.id != 0 && u.id == user.id);
    if u.is_admin || is_me {
        r#"<span style="color:var(--muted); font-size:12px;">-</span>"#.to_string()
    } else {
        format!(
            r#"<button type="button" class="btn-block" data-login="{login}" data-provider="{provider}" data-id="{id}" data-name="{name}" onclick="openBlockModal(this)" title="End the sessions and prevent new logins">🚫 Block</button>"#,
            login = esc(&u.login),
            provider = u.provider.id(),
            id = u.id,
            name = esc(u.name.as_deref().unwrap_or(&u.login)),
        )
    }
}

/// Table rows of the blocked users (or the "No blocked users." row).
fn blocked_rows(stats: &SystemStats) -> String {
    if stats.blocked.is_empty() {
        r#"<tr><td colspan="5" style="padding:16px 14px; color:var(--muted); font-size:13px;">No blocked users.</td></tr>"#.to_string()
    } else {
        stats
            .blocked
            .iter()
            .map(blocked_row)
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// One row of the blocked users table with the unblock button.
fn blocked_row(b: &crate::blocklist::Blocked) -> String {
    format!(
        r#"<tr style="border-bottom: 1px solid var(--border-color);" data-blocked-login="{login}">
                    <td style="padding: 12px 14px;"><a href="{web}/{login}" target="_blank" rel="noopener" style="color:var(--text-bright); text-decoration:none; font-weight:600;">@{login} ↗</a><div style="font-size:12px; color:var(--muted);">{name}</div></td>
                    <td style="padding: 12px 14px; font-size: 13px;">{reason}</td>
                    <td style="padding: 12px 14px; font-size: 12px; color: var(--muted);"><span class="blk-when" data-ts="{ts}"></span><br>by @{by}</td>
                    <td style="padding: 12px 14px; text-align: right;"><button type="button" class="btn-unblock" data-login="{login}" data-provider="{provider}" onclick="unblockUser(this)">✅ Unblock</button></td>
                </tr>"#,
        login = esc(&b.login),
        web = esc(&b.provider.web()),
        provider = b.provider.id(),
        name = esc(b.name.as_deref().unwrap_or("")),
        reason = if b.reason.is_empty() {
            r#"<span style="color:var(--muted);">no reason given</span>"#.to_string()
        } else {
            esc(&b.reason)
        },
        ts = b.blocked_at,
        by = esc(&b.blocked_by),
    )
}

/// Sentence about the TeX Live package cache for the panel: how many packages, how much space they take and when the last one came in.
fn tl_cache_text(c: &crate::ctan::CacheStats) -> String {
    let size = |b: u64| {
        if b >= 1_000_000_000 {
            format!("{:.2} GB", b as f64 / 1e9)
        } else {
            format!("{:.1} MB", b as f64 / 1e6)
        }
    };
    let last = match c.last_write_secs {
        Some(t) => {
            let iso = crate::drive::client::iso_from_unix(t); // 2026-10-13T12:34:56Z
            format!(
                "{}/{}/{} {} UTC",
                &iso[8..10],
                &iso[5..7],
                &iso[0..4],
                &iso[11..16]
            )
        }
        None => "none yet".to_string(),
    };
    format!(
        "{} packages, {} of {} · last: {}",
        c.packages,
        size(c.bytes),
        size(c.max_bytes),
        last
    )
}
