mod script;
mod shell;

use super::{esc, fill};
use crate::auth::github::GitHubUser;
use crate::drive::client::{NeoLeafInvitation, ProjectCollaborator, ProjectInfo};

/// Deterministic tag color from a hash of the lowercased tag (same algorithm as the page script).
fn tag_color(tag: &str) -> &'static str {
    const COLORS: &[&str] = &[
        "#388bfd", // vivid blue
        "#2ea043", // green
        "#a371f7", // purple
        "#d29922", // gold / amber
        "#f778ba", // pink
        "#39c5cf", // cyan
        "#f85149", // coral
        "#56d364", // light green / mint
        "#bc8cff", // lilac
        "#58a6ff", // sky blue
        "#f0883e", // orange
        "#238636", // emerald
        "#ec4899", // magenta
        "#06b6d4", // pool blue
        "#8b5cf6", // indigo
        "#eab308", // yellow
    ];
    let lower = tag.to_lowercase();
    let mut h: u32 = 0;
    for b in lower.as_bytes() {
        h = h.wrapping_mul(31).wrapping_add(*b as u32);
    }
    COLORS[(h as usize) % COLORS.len()]
}

/// Renders the projects page: sidebar, projects list, invitations and the modals.
pub fn render(
    user: &GitHubUser,
    projects: &[ProjectInfo],
    list_error: Option<&str>,
    invitations: &[NeoLeafInvitation],
    is_admin: bool,
) -> String {
    let error_html = error_banner(list_error);
    let invitations_html = invitations_markup(invitations);
    let projects_html = projects_markup(projects, user);

    let admin_sidebar_link = if is_admin {
        r#"<a href="/admin" style="color: var(--green); text-decoration: none; font-weight: 600; display: flex; align-items: center; gap: 4px;">🛡️ Admin Panel</a>"#
    } else {
        ""
    };

    let trash_count = projects
        .iter()
        .filter(|p| p.deleted_at.is_some())
        .count()
        .to_string();
    let user_button = super::user_topbar_button(user, false);
    let user_profile_modal = super::user_profile_modal_html(user);

    fill(
        &page_template(),
        &[
            ("USER_BUTTON", &user_button),
            ("USER_PROFILE_MODAL", &user_profile_modal),
            ("PROJECTS", &projects_html),
            ("ERROR", &error_html),
            ("TRASH_COUNT", &trash_count),
            ("INVITATIONS", &invitations_html),
            ("ADMIN_SIDEBAR_LINK", admin_sidebar_link),
            ("PROVIDER", user.provider.id()),
            ("APP_VERSION", env!("CARGO_PKG_VERSION")),
        ],
    )
}

/// Page template (with `{{PLACEHOLDERS}}`) assembled from the static blocks, in page order.
fn page_template() -> String {
    [
        shell::head(),
        shell::body_and_top_bar(),
        "",
        r#"    <div class="pl-layout">"#,
        shell::sidebar(),
        shell::main_column(),
        "    </div>",
        "",
        shell::new_project_modal(),
        "",
        shell::delete_modal(),
        "",
        shell::import_modal(),
        "",
        shell::edit_topics_modal(),
        "",
        script::list_script(),
        "",
        script::actions_script(),
        "    {{USER_PROFILE_MODAL}}",
        "</body>",
        "</html>",
    ]
    .join("\n")
}

/// Red banner shown when listing the projects on the provider failed (empty when there was no error).
fn error_banner(list_error: Option<&str>) -> String {
    match list_error {
        Some(e) => format!(
            r#"<div style="background:color-mix(in srgb, var(--danger-color) 14%, var(--bg-primary));border:1px solid color-mix(in srgb, var(--danger-color) 50%, var(--bg-primary));color:var(--danger-color);padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:13px;">Could not list your projects on GitHub: {}<br>Try signing out and signing in again with your GitHub account.</div>"#,
            e.replace('<', "&lt;")
        ),
        None => String::new(),
    }
}

/// List of pending collaboration invitations (empty when there are none).
fn invitations_markup(invitations: &[NeoLeafInvitation]) -> String {
    if invitations.is_empty() {
        return String::new();
    }
    let cards = invitations
        .iter()
        .map(invitation_card)
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        r#"<div class="inv-list" style="margin-bottom:16px;">{}</div>"#,
        cards
    )
}

/// One invitation card with the inviter avatar and the accept/decline buttons.
fn invitation_card(inv: &NeoLeafInvitation) -> String {
    let avatar = match &inv.inviter_avatar {
        Some(url) if url.starts_with("https://") => format!(
            r#"<img src="{}" style="width:28px;height:28px;border-radius:50%;" alt="">"#,
            esc(url)
        ),
        _ => r#"<span style="font-size:20px;">📬</span>"#.to_string(),
    };
    format!(
        r#"<div class="inv-card" id="inv-card-{id}" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(56,139,253,0.08);border:1px solid rgba(56,139,253,0.35);border-radius:6px;margin-bottom:12px;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        {avatar}
                        <div>
                            <div style="font-size:13px;font-weight:600;color:var(--text-bright);" data-i18n-html>
                                Invitation to collaborate: <code>{repo}</code>
                            </div>
                            <div style="font-size:12px;color:var(--muted);margin-top:2px;" data-i18n-html>
                                <strong>@{inviter}</strong> invited you to this LaTeX project.
                            </div>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button type="button" class="btn" onclick="declineInvitation({id})" style="padding:4px 10px;font-size:12px;">Decline</button>
                        <button type="button" class="btn btn-primary" onclick="acceptInvitation(event, {id})" style="padding:4px 12px;font-size:12px;background:#238636;border-color:#2ea043;">✔ Accept on NeoLeaf</button>
                    </div>
                </div>"#,
        id = inv.id,
        avatar = avatar,
        repo = esc(&inv.repo_full_name),
        inviter = esc(&inv.inviter_login)
    )
}

/// Projects card content: the empty-state box or the sortable table of projects.
fn projects_markup(projects: &[ProjectInfo], user: &GitHubUser) -> String {
    if projects.is_empty() {
        return empty_projects_markup();
    }
    let rows = projects
        .iter()
        .map(|p| project_row(p, user))
        .collect::<Vec<_>>()
        .join("\n");
    projects_table(&rows)
}

/// Empty state shown when no repository carries the `neoleaf` tag.
fn empty_projects_markup() -> String {
    r#"<div class="pl-empty">
            <p data-i18n-html>No repository with the <code>neoleaf</code> tag found on your GitHub.</p>
            <p style="font-size: 13px; color: var(--muted); margin-bottom: 16px;" data-i18n-html>Create a new paper below or add the <code>neoleaf</code> tag (topic) to any existing repository of yours or shared with you on GitHub.</p>
            <button class="btn btn-primary" onclick="openNewProjectModal()">+ Create my first project</button>
        </div>"#.to_string()
}

/// Table wrapper (header and "no match" box) around the already rendered rows.
fn projects_table(rows: &str) -> String {
    format!(
        r#"<table class="pl-table">
                <thead><tr>
                    <th class="pl-th sortable" data-sort="name">Title <span class="arrow"></span></th>
                    <th class="pl-th">Owner</th>
                    <th class="pl-th">Sharing</th>
                    <th class="pl-th sortable" data-sort="time">Last modified <span class="arrow">↓</span></th>
                    <th class="pl-th">Local copy</th>
                    <th class="pl-th"></th>
                </tr></thead>
                <tbody id="pl-body">{}</tbody>
            </table>
            <div id="pl-none" class="pl-empty" style="display:none"><p id="pl-none-text">No project matches the search.</p></div>"#,
        rows
    )
}

/// One table row of the projects list (title, tags, owner, sharing, date and actions).
fn project_row(p: &ProjectInfo, user: &GitHubUser) -> String {
    let modified = p.modified_time.as_deref().unwrap_or("");
    let owner_display = owner_cell(p);
    let is_collab = p.is_shared || !p.collaborators.is_empty();
    let share_display = sharing_cell(p);
    let gh_action = provider_link(p, user);

    let trashed = p.deleted_at.is_some();
    let display_topics: Vec<_> = p
        .topics
        .iter()
        .filter(|t| t.to_lowercase() != "neoleaf")
        .collect();
    let name_js = esc(&p
        .name
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('"', "\\\""));
    let topics_html = tags_cell(p, trashed, &display_topics, &name_js);
    let topics_data = esc(&display_topics
        .iter()
        .map(|s| s.as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase());
    let topics_json = esc(&serde_json::to_string(&p.topics).unwrap_or_else(|_| "[]".to_string()));

    let trash_action = trash_action_button(p, trashed, &name_js);
    // the display title (if any) is the main label and the repository name goes below it, in a lighter colour
    let shown = p.title.as_deref().filter(|_| !trashed).unwrap_or(&p.name);
    let subname = match p.title.as_deref().filter(|_| !trashed) {
        Some(_) => format!(r#"<span class="pl-subname">{}</span>"#, esc(&p.name)),
        None => r#"<span class="pl-subname" hidden></span>"#.to_string(),
    };
    let title_html = if trashed {
        format!(r#"<span class="pl-title-text">{}</span>"#, esc(&p.name))
    } else {
        format!(
            r#"<a class="pl-title-link" href="/project/{}">{}</a>{subname}"#,
            esc(&p.id),
            esc(shown)
        )
    };
    let title_action = title_action_button(p, trashed);
    let time_value = p.deleted_at.as_deref().unwrap_or(modified);

    format!(
        r#"<tr class="pl-row{trash_class}" id="proj-row-{id}" data-id="{id}" data-name="{sort_name}" data-search="{search_name}" data-repo="{repo_name}" data-title="{title_attr}" data-topics="{topics_data}" data-topics-json="{topics_json}" data-shared="{shared}" data-collab="{collab}" data-deleted="{trashed}" data-time="{time}" data-href="/project/{id}" tabindex="0">
                    <td class="pl-title">{title_html}{topics_html}</td>
                    <td class="pl-owner">{owner_display}</td>
                    <td class="pl-sharing">{share_display}</td>
                    <td class="pl-mod" data-iso="{time}"></td>
                    <td class="pl-local"></td>
                    <td class="pl-actions">{title_action}{trash_action}{gh_action}</td>
                </tr>"#,
        trash_class = if trashed { " pl-row-trashed" } else { "" },
        trashed = trashed,
        title_html = title_html,
        trash_action = trash_action,
        sort_name = esc(&shown.to_lowercase()),
        search_name = esc(format!(
            "{} {}",
            p.title.as_deref().unwrap_or("").to_lowercase(),
            p.name.to_lowercase()
        )
        .trim()),
        repo_name = esc(&p.name),
        title_attr = esc(p.title.as_deref().unwrap_or("")),
        title_action = title_action,
        topics_data = topics_data,
        topics_json = topics_json,
        topics_html = topics_html,
        shared = p.is_shared,
        collab = is_collab,
        time = esc(time_value),
        id = esc(&p.id),
        owner_display = owner_display,
        share_display = share_display,
        gh_action = gh_action
    )
}

/// "Owner" cell: "You" or the owner's avatar and login for shared projects.
fn owner_cell(p: &ProjectInfo) -> String {
    if p.is_shared {
        let avatar = match &p.owner_avatar {
            Some(url) if url.starts_with("https://") => format!(
                r#"<img src="{}" class="pl-avatar" style="width:20px;height:20px;vertical-align:middle;margin-right:6px;" alt="">"#,
                esc(url)
            ),
            _ => String::new(),
        };
        format!(
            r#"<span style="display:inline-flex;align-items:center;">{}<strong style="color:var(--text-bright);">@{}</strong></span>"#,
            avatar,
            esc(&p.owner_login)
        )
    } else {
        r#"<span style="color:var(--text-bright);font-weight:500;">You</span>"#.to_string()
    }
}

/// "Sharing" cell: shared-with-you badge, collaborators summary or the private marker.
fn sharing_cell(p: &ProjectInfo) -> String {
    if p.is_shared {
        format!(
            r#"<span class="pl-badge pl-badge-shared" title="Project created by @{owner}">📥 Shared with you</span>"#,
            owner = esc(&p.owner_login)
        )
    } else if !p.collaborators.is_empty() {
        collaborators_summary(&p.collaborators)
    } else {
        r#"<span style="font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:4px;" title="Only you have access">🔒 Private</span>"#.to_string()
    }
}

/// Avatar stack (up to 4), names summary and pending-invitation badge of a project's collaborators.
fn collaborators_summary(collaborators: &[ProjectCollaborator]) -> String {
    let mut avatars = Vec::new();
    let mut names = Vec::new();
    for (idx, c) in collaborators.iter().enumerate() {
        let title = if c.is_pending {
            format!("@{} (pending invitation)", c.login)
        } else {
            format!("@{}", c.login)
        };
        names.push(title.clone());
        let margin = if idx == 0 { 0 } else { -6 };
        if idx < 4 {
            let img = match &c.avatar_url {
                Some(url) if url.starts_with("https://") => format!(
                    r#"<img src="{}" class="pl-avatar" style="width:22px;height:22px;border:2px solid var(--bg-primary);margin-left:{}px;vertical-align:middle;" title="{}" alt="@{}">"#,
                    esc(url),
                    margin,
                    esc(&title),
                    esc(&c.login)
                ),
                _ => format!(
                    r#"<span class="pl-avatar" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:#388bfd;color:#fff;font-size:10px;font-weight:bold;border:2px solid var(--bg-primary);margin-left:{}px;vertical-align:middle;" title="{}">{}</span>"#,
                    margin,
                    esc(&title),
                    esc(&c
                        .login
                        .chars()
                        .next()
                        .unwrap_or('?')
                        .to_uppercase()
                        .to_string())
                ),
            };
            avatars.push(img);
        }
    }
    let extra_count = if collaborators.len() > 4 {
        format!(
            r#"<span style="font-size:11px;color:var(--muted);margin-left:4px;">+{}</span>"#,
            collaborators.len() - 4
        )
    } else {
        String::new()
    };
    let pending_count = collaborators.iter().filter(|c| c.is_pending).count();
    let pending_badge = if pending_count > 0 {
        format!(
            r#"<span style="font-size:11px;color:#d29922;margin-left:6px;" title="{} pending invitation(s)">⏳ {} pending</span>"#,
            pending_count, pending_count
        )
    } else {
        String::new()
    };
    let names_tooltip = esc(&names.join(", "));
    let first_two: Vec<_> = collaborators
        .iter()
        .take(2)
        .map(|c| format!("@{}", c.login))
        .collect();
    let summary_text = if collaborators.len() > 2 {
        format!("{}, +{}", first_two.join(", "), collaborators.len() - 2)
    } else {
        first_two.join(", ")
    };

    format!(
        r#"<div style="display:inline-flex;align-items:center;" title="Shared with: {tooltip}"><div style="display:inline-flex;align-items:center;">{avatars}{extra}</div><span style="margin-left:8px;font-size:12px;color:var(--text-bright);">{summary}{pending}</span></div>"#,
        tooltip = names_tooltip,
        avatars = avatars.join(""),
        extra = extra_count,
        summary = esc(&summary_text),
        pending = pending_badge
    )
}

/// Link to the repository on the provider (empty when the link is missing or not https).
fn provider_link(p: &ProjectInfo, user: &GitHubUser) -> String {
    let github_link = p
        .web_view_link
        .as_deref()
        .filter(|l| l.starts_with("https://"))
        .unwrap_or("");
    if github_link.is_empty() {
        String::new()
    } else {
        format!(
            r#"<a href="{}" target="_blank" rel="noopener" class="pl-action" title="Open repository on {label}" onclick="event.stopPropagation()">{label} ↗</a>"#,
            esc(github_link),
            label = user.provider.label()
        )
    }
}

/// Tag pills of a row plus the "+ tag" button (not offered in the trash).
fn tags_cell(p: &ProjectInfo, trashed: bool, display_topics: &[&String], name_js: &str) -> String {
    let pills = display_topics.iter().map(|t| {
        let color = tag_color(t);
        format!(
            r#"<span class="pl-tag" style="--tag-color:{color};" onclick="event.stopPropagation(); filterByTopic('{tag}')" title="Filter by {tag}">#{tag}</span>"#,
            color = color,
            tag = esc(t)
        )
    }).collect::<Vec<_>>().join("");
    let add_btn = format!(
        r#"<button type="button" class="pl-tag-add" onclick="event.stopPropagation(); openEditTopicsModal('{}', '{}')" title="Manage project tags">+ tag</button>"#,
        esc(&p.id),
        name_js
    );
    // tags are not edited in the trash: "#deleted" is the deletion mark
    let add_btn = if trashed { String::new() } else { add_btn };
    format!(
        r#"<div class="pl-tags" id="tags-{}">{}{}</div>"#,
        esc(&p.id),
        pills,
        add_btn
    )
}

/// Pencil that edits the display title; saving it needs admin access to the repository, so only the owner sees it.
fn title_action_button(p: &ProjectInfo, trashed: bool) -> String {
    if p.is_shared || trashed {
        return String::new();
    }
    format!(
        r#"<button type="button" class="pl-action pl-action-btn pl-action-edit" onclick="event.stopPropagation(); editProjectTitle('{}')" title="Edit title" aria-label="Edit title">✏️</button>"#,
        esc(&p.id)
    )
}

/// Delete or restore button; only the owner can rename the repository on the provider (that is what deleting does).
fn trash_action_button(p: &ProjectInfo, trashed: bool, name_js: &str) -> String {
    if p.is_shared {
        String::new()
    } else if trashed {
        format!(
            r#"<button type="button" class="pl-action pl-action-btn" onclick="event.stopPropagation(); restoreProject('{}', '{}')" title="Take out of the trash and go back to the original name">↩ Restore</button>"#,
            esc(&p.id),
            name_js
        )
    } else {
        format!(
            r#"<button type="button" class="pl-action pl-action-btn pl-action-danger" onclick="event.stopPropagation(); openDeleteModal('{}', '{}')" title="Move to trash" aria-label="Move to trash">🗑️</button>"#,
            esc(&p.id),
            name_js
        )
    }
}
