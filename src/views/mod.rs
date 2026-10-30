pub mod admin_page;
pub mod agent_page;
pub mod dashboard_page;
pub mod editor_page;
pub mod institution_login;
pub mod licenses_page;
pub mod login_page;
pub mod privacy_page;
mod profile_modal;
pub mod terms_page;

pub use profile_modal::user_profile_modal_html;

/// Banner at the top of the login page when the GitHub session expired (or was revoked).
pub fn with_session_expired_notice(html: &str) -> String {
    with_notice(
        html,
        "session-expired",
        "Your GitHub session expired or was revoked. Please sign in again.",
    )
}

/// Notice shown after the person deleted their own account.
pub fn with_account_deleted_notice(html: &str) -> String {
    with_notice(
        html,
        "account-deleted",
        "NeoLeaf removed your stored session from the server and, for GitHub accounts, asked GitHub to revoke the NeoLeaf authorization. Your repositories were not changed.",
    )
}

/// Notice shown when the account was blocked by the administrator.
pub fn with_blocked_notice(html: &str) -> String {
    with_notice(
        html,
        "account-blocked",
        "This account was blocked by the administrator. If you think this was a mistake, write to contact@neoleaf.science.",
    )
}

/// Fixed banner just below the login navigation bar, with a close button.
fn with_notice(html: &str, id: &str, message: &str) -> String {
    // fixed just below the navigation bar (68 px, z-index 1000): it must not cover the sign-in button
    let banner = format!(
        r#"<div id="{id}" role="alert" style="position:fixed;top:68px;left:0;right:0;z-index:999;background:#9a6700;color:#fff;padding:9px 44px;text-align:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.2);">{message}<button type="button" aria-label="Close" onclick="this.parentNode.remove()" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:0;color:#fff;font-size:18px;line-height:1;cursor:pointer;">✕</button></div>"#
    );
    match html
        .find("<body")
        .and_then(|i| html[i..].find('>').map(|j| i + j + 1))
    {
        Some(end) => format!("{}{}{}", &html[..end], banner, &html[end..]),
        None => format!("{banner}{html}"),
    }
}

pub fn fill(template: &str, vars: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len() + 1024);
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}") {
            Some(end) => {
                let name = &after[..end];
                match vars.iter().find(|(k, _)| *k == name) {
                    Some((_, v)) => out.push_str(v),
                    None => {
                        out.push_str("{{");
                        out.push_str(name);
                        out.push_str("}}");
                    }
                }
                rest = &after[end + 2..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// Escapes text for use in HTML (content and quoted attributes).
pub fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Text for use inside a double-quoted JavaScript string, inside a `<script>`.
pub fn js_str(s: &str) -> String {
    let json = serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string());
    // without the outer quotes; `<` becomes `\u003c`, so the text can neither close the <script> nor open an HTML comment (`<!--`)
    json[1..json.len() - 1]
        .replace('<', "\\u003c")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// JSON of a text, safe to insert directly in a `<script>`.
pub fn js_json(s: &str) -> String {
    serde_json::to_string(s)
        .unwrap_or_else(|_| "\"\"".to_string())
        .replace('<', "\\u003c")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// Builds the top-bar user button showing the compact avatar and ONLY the first name.
pub fn user_topbar_button(user: &crate::auth::github::GitHubUser, compact: bool) -> String {
    let first_name = esc(&user.first_name());
    let display_name = esc(&user.display_name());
    let initial = esc(&user
        .first_name()
        .chars()
        .next()
        .unwrap_or('U')
        .to_uppercase()
        .to_string());
    let (size, font_size, gap, padding) = if compact {
        ("22px", "12px", "6px", "3px 6px")
    } else {
        ("28px", "13px", "8px", "4px 8px")
    };
    let avatar_markup = match &user.avatar_url {
        Some(url) => format!(
            r#"<img src="{}" alt="" style="width: {size}; height: {size}; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-color); flex-shrink: 0;">"#,
            esc(url)
        ),
        None => format!(
            r#"<div style="width: {size}; height: {size}; border-radius: 50%; background: var(--bg-tertiary); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: var(--muted); border: 1px solid var(--border-color); flex-shrink: 0;">{initial}</div>"#
        ),
    };

    format!(
        r#"<button type="button" class="btn btn-user-profile" onclick="openUserProfileModal()" title="View GitHub profile" aria-label="Profile of {display_name}" style="display: inline-flex; align-items: center; gap: {gap}; padding: {padding}; font-size: {font_size}; font-weight: 500; border-radius: 6px; cursor: pointer; background: transparent; border: 1px solid transparent; color: inherit; transition: background 0.15s, border-color 0.15s;">{avatar_markup}<span>{first_name}</span></button>"#
    )
}

/// Service icon (GitHub or Codeberg) for buttons and links.
pub fn provider_icon(provider: crate::provider::Provider, size: u32) -> String {
    match provider {
        crate::provider::Provider::GitHub => format!(
            r#"<svg width="{size}" height="{size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>"#
        ),
        // Codeberg logo (Simple Icons, public domain CC0)
        // your own Git server: a plain branch icon (own drawing)
        crate::provider::Provider::Custom(_) => format!(
            r#"<svg width="{size}" height="{size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="6" r="1.6"/><path d="M4 5.1v5.8M12 7.6c0 2.4-3 2.2-7 3.8"/></svg>"#
        ),
        crate::provider::Provider::Codeberg => format!(
            r#"<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.955.49A12 12 0 0 0 0 12.49a12 12 0 0 0 1.832 6.373L11.838 5.928a.187.187 0 0 1 .324 0l10.006 12.935A12 12 0 0 0 24 12.49a12 12 0 0 0-12-12 12 12 0 0 0-.045 0zm.375 6.467l4.416 16.553a12 12 0 0 0 5.137-4.213z"/></svg>"#
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes() {
        assert_eq!(
            esc("<img src=x onerror=\"a('b')\">&"),
            "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;"
        );
        assert!(!js_json("end </script><script>alert(1)").contains("</script>"));
        assert_eq!(js_str("a\"b"), "a\\\"b");
        for attack in [
            "</script><script>alert(1)</script>",
            "<!--<script>",
            "<!-- x",
            "a</SCRIPT>",
        ] {
            assert!(
                !js_str(attack).contains('<') && !js_json(attack).contains('<'),
                "{attack:?} must not keep a < in a script"
            );
        }
        // the inserted value is not treated as a template
        assert_eq!(
            fill("<{{A}}|{{B}}|{{X}}>", &[("A", "{{B}}"), ("B", "2")]),
            "<{{B}}|2|{{X}}>"
        );
    }

    #[test]
    fn test_login_page_renders() {
        let rendered_configured = login_page::render(true, false);
        assert!(rendered_configured.contains("NeoLeaf"));
        assert!(rendered_configured.contains("/auth/login"));
        assert!(rendered_configured.contains("GitHub"));
        assert!(rendered_configured.contains("WebAssembly"));
        assert!(rendered_configured.contains("Local Agent"));
        assert!(rendered_configured.contains("$0"));

        let rendered_unconfigured = login_page::render(false, false);
        assert!(rendered_unconfigured.contains("NeoLeaf"));
        assert!(
            rendered_unconfigured.contains("GITHUB_CLIENT_ID"),
            "without OAuth configured, the page explains what to configure"
        );
        assert!(
            !rendered_unconfigured.contains("/demo-login"),
            "demo mode no longer exists"
        );
    }

    #[test]
    fn test_dashboard_page_tags_colored() {
        let user = crate::auth::github::GitHubUser {
            login: "alice".into(),
            name: Some("Alice".into()),
            ..Default::default()
        };
        let projects = vec![crate::drive::client::ProjectInfo {
            id: "proj-1".into(),
            name: "SBC Paper".into(),
            is_shared: false,
            modified_time: Some("2026-03-29T12:00:00Z".into()),
            web_view_link: None,
            owner_login: "alice".into(),
            owner_avatar: None,
            collaborators: vec![],
            topics: vec!["neoleaf".into(), "sbc".into(), "paper".into()],
            deleted_at: None,
            title: None,
        }];
        let html = dashboard_page::render(&user, &projects, None, &[], false);
        assert!(html.contains("#sbc"));
        assert!(html.contains("#paper"));
        assert!(!html.contains(">#neoleaf<"));
        assert!(html.contains(r#"style="--tag-color:"#));
        assert!(html.contains("TAG_PALETTE"));
        assert!(html.contains("function tagColor(tag)"));
    }

    #[test]
    fn landing_page_offers_no_demo_mode() {
        for configured in [true, false] {
            let html = login_page::render(configured, false);
            assert!(
                !html.contains("demo-login")
                    && !html.contains("Demo Mode")
                    && !html.contains("nl-demo-link"),
                "demo mode no longer exists"
            );
        }
        assert!(login_page::render(true, false).contains("Get Started with GitHub"));
    }

    #[test]
    fn profile_modal_has_account_deletion_with_legal_basis() {
        let user = crate::auth::github::GitHubUser {
            login: "ana-silva".into(),
            name: Some("Ana".into()),
            ..Default::default()
        };
        let html = user_profile_modal_html(&user);
        assert!(
            html.contains(r#"id="upm-delete-account""#) && html.contains("Delete my account...")
        );
        assert!(html.contains(r#"id="delete-account-modal""#));
        // the two steps: confirmation with a checkbox and typing the login
        assert!(html.contains(r#"id="dac-understand""#) && html.contains(r#"id="dac-input""#));
        // what is and is not deleted, and the legal basis with the caveat about connection records
        assert!(
            html.contains("GitHub repositories</strong>")
                && html.contains("stay exactly as they are")
        );
        assert!(
            html.contains("art. 18 of the LGPD")
                && html.contains("Marco Civil da Internet, art. 15")
        );
        // the login appears escaped
        let hostil = crate::auth::github::GitHubUser {
            login: "<b>x</b>".into(),
            ..Default::default()
        };
        assert!(!user_profile_modal_html(&hostil).contains("<b>x</b>"));
    }

    #[test]
    fn account_deleted_notice_describes_only_what_was_done() {
        let html = with_account_deleted_notice("<body><p>x</p></body>");
        assert!(
            html.contains(r#"id="account-deleted""#)
                && html.contains("removed your stored session")
                && html.contains("repositories were not changed")
        );
        assert!(
            !html.contains("LGPD") && !html.contains("erased"),
            "no legal claim"
        );
    }

    #[test]
    fn session_expired_notice_goes_right_after_body() {
        let html = with_session_expired_notice(
            r#"<html><body class="x" data-a="1"><h1>Login</h1></body></html>"#,
        );
        assert!(
            html.contains(r#"<body class="x" data-a="1"><div id="session-expired""#),
            "{html}"
        );
        assert!(html.contains("Your GitHub session expired or was revoked"));
        assert!(html.contains("<h1>Login</h1>"));
        // without <body> the notice still appears
        assert!(with_session_expired_notice("<p>x</p>").starts_with("<div id=\"session-expired\""));
    }

    #[test]
    fn trash_in_dashboard() {
        use crate::drive::client::ProjectInfo;
        let user = crate::auth::github::GitHubUser {
            login: "alice".into(),
            name: Some("Alice".into()),
            ..Default::default()
        };
        let mk = |id: &str, name: &str, shared: bool, deleted: Option<&str>| ProjectInfo {
            id: id.into(),
            name: name.into(),
            is_shared: shared,
            modified_time: Some("2026-03-29T12:00:00Z".into()),
            web_view_link: None,
            owner_login: if shared { "bob".into() } else { "alice".into() },
            owner_avatar: None,
            collaborators: vec![],
            topics: if deleted.is_some() {
                vec!["neoleaf".into(), "deleted".into()]
            } else {
                vec!["neoleaf".into()]
            },
            deleted_at: deleted.map(str::to_string),
            title: None,
        };
        let projects = vec![
            mk("alice__active", "Active", false, None),
            mk("bob__foreign", "Foreign", true, None),
            mk(
                "alice__old-deleted-20261009-031507",
                "Old",
                false,
                Some("2026-10-09T03:15:07Z"),
            ),
            mk(
                "bob__old2-deleted-20261009-031507",
                "Bob old",
                true,
                Some("2026-10-09T03:15:07Z"),
            ),
        ];
        let html = dashboard_page::render(&user, &projects, None, &[], false);
        // trash counter and menu item
        assert!(html.contains(r#"id="pl-trash-count">2<"#), "counter");
        assert!(html.contains(r#"data-filter="trash""#));
        // only the owner sees the delete button, and only on active projects
        assert!(html.contains("openDeleteModal('alice__active'"));
        assert!(!html.contains("openDeleteModal('bob__foreign'"));
        assert!(!html.contains("openDeleteModal('alice__old-deleted"));
        // in the trash the owner sees "Restore"; the shared one does not
        assert!(html.contains("restoreProject('alice__old-deleted-20261009-031507'"));
        assert!(!html.contains("restoreProject('bob__old2"));
        // rows marked and without a link to open the deleted project
        assert!(
            html.contains(r#"data-deleted="true""#) && html.contains(r#"data-deleted="false""#)
        );
        assert!(html.contains(r#"<span class="pl-title-text">Old</span>"#));
        assert!(!html.contains(r#"<a href="/project/alice__old-deleted"#));
        // the deleted tag appears as a pill, but tags cannot be edited in the trash
        assert!(html.contains("#deleted"));
        assert!(!html.contains("openEditTopicsModal('alice__old-deleted"));
        // the deletion date is the one that orders the row
        assert!(html.contains(r#"data-time="2026-10-09T03:15:07Z""#));
    }

    #[test]
    fn titles_show_with_the_repository_name_and_only_the_owner_can_edit_them() {
        let user = crate::auth::github::GitHubUser {
            login: "alice".into(),
            ..Default::default()
        };
        let mk = |id: &str, shared: bool, title: Option<&str>| crate::drive::client::ProjectInfo {
            id: id.into(),
            name: "repo-name".into(),
            is_shared: shared,
            modified_time: None,
            web_view_link: None,
            owner_login: if shared { "bob".into() } else { "alice".into() },
            owner_avatar: None,
            collaborators: vec![],
            topics: vec!["neoleaf".into()],
            deleted_at: None,
            title: title.map(str::to_string),
        };
        let html = dashboard_page::render(
            &user,
            &[
                mk("alice__one", false, Some("My <b>thesis</b>")),
                mk("bob__two", true, Some("Shared title")),
                mk("alice__three", false, None),
            ],
            None,
            &[],
            false,
        );
        // the title is the label, escaped, with the repository name below it
        assert!(html.contains(
            r#">My &lt;b&gt;thesis&lt;/b&gt;</a><span class="pl-subname">repo-name</span>"#
        ));
        assert!(html.contains(r#"data-title="My &lt;b&gt;thesis&lt;/b&gt;""#));
        // only the owner's projects get the pencil
        assert!(html.contains("editProjectTitle('alice__one')"));
        assert!(html.contains("editProjectTitle('alice__three')"));
        assert!(!html.contains("editProjectTitle('bob__two')"));
        // no title: the name alone, with an empty hidden sub-label
        assert!(html.contains(r#"<span class="pl-subname" hidden></span>"#));
        // search and sorting use the title as well as the name
        assert!(html.contains(r#"data-search="my <b>thesis</b> repo-name""#.replace('<', "&lt;").replace('>', "&gt;").as_str()));
    }
}
