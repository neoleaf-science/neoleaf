//! User profile modal (top bar) and the account deletion modal.

use super::{esc, provider_icon};
use crate::auth::github::GitHubUser;

/// Builds the user profile modal with GitHub information and its scripts.
pub fn user_profile_modal_html(user: &GitHubUser) -> String {
    [
        banner(user),
        stats(user),
        details(user),
        footer(user),
        script().to_string(),
        account_delete_html(user),
    ]
    .concat()
}

/// Escaped link to the user's profile on the provider.
fn profile_url(user: &GitHubUser) -> String {
    esc(&user
        .html_url
        .clone()
        .unwrap_or_else(|| user.provider.repo_url(&user.login)))
}

/// Escaped first letter of the user's name, for the avatar placeholder.
fn initial_of(user: &GitHubUser) -> String {
    esc(&user
        .first_name()
        .chars()
        .next()
        .unwrap_or('U')
        .to_uppercase()
        .to_string())
}

/// Modal opening and gradient banner: avatar, name, login link and bio.
fn banner(user: &GitHubUser) -> String {
    let display_name = esc(&user.display_name());
    let login = esc(&user.login);
    let provider_label = user.provider.label();
    let provider_id = user.provider.id();
    let github_url = profile_url(user);
    let initial = initial_of(user);

    let avatar_large = match &user.avatar_url {
        Some(url) => format!(
            r#"<img src="{}" alt="{login}" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.2); box-shadow: 0 4px 12px rgba(0,0,0,0.3);">"#,
            esc(url)
        ),
        None => format!(
            r#"<div style="width: 64px; height: 64px; border-radius: 50%; background: #374151; color: #f3f4f6; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; border: 2px solid rgba(255,255,255,0.2);">{initial}</div>"#
        ),
    };

    let bio_display = if let Some(b) = &user.bio {
        if b.trim().is_empty() { "none" } else { "block" }
    } else {
        "none"
    };
    let bio_text = esc(user.bio.as_deref().unwrap_or(""));

    format!(
        r##"
    <!-- GitHub user profile modal -->
    <div id="user-profile-modal" class="modal-backdrop" style="display:none;" data-account-login="{login}" data-account-provider="{provider_id}" onclick="if (event.target === this) closeUserProfileModal()">
        <div class="modal-box" style="max-width: 480px; padding: 0; overflow: hidden; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.2);">
            <!-- Banner / header with subtle gradient -->
            <div style="background: linear-gradient(135deg, #1e293b, #0f172a); padding: 22px 24px 18px; position: relative; border-bottom: 1px solid var(--border-color, #334155); color: #fff;">
                <button type="button" class="btn" onclick="closeUserProfileModal()" style="position: absolute; top: 12px; right: 12px; padding: 4px 8px; font-size: 14px; background: rgba(0,0,0,0.3); border: none; color: #fff; border-radius: 6px; cursor: pointer;" title="Close">✕</button>
                <div style="display: flex; align-items: center; gap: 16px;">
                    <div id="upm-avatar-container" style="flex-shrink: 0;">
                        {avatar_large}
                    </div>
                    <div style="min-width: 0; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <h3 id="upm-name" style="margin: 0; font-size: 18px; font-weight: 600; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{display_name}</h3>
                            <span style="font-size: 10px; font-weight: 600; background: rgba(255,255,255,0.15); color: #e2e8f0; padding: 2px 6px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.5px;">{provider_label}</span>
                        </div>
                        <div style="margin-top: 3px; font-size: 13px;">
                            <a id="upm-login-link" href="{github_url}" target="_blank" rel="noopener" style="color: #60a5fa; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
                                <span>@<span id="upm-login">{login}</span></span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            </a>
                        </div>
                    </div>
                </div>
                <p id="upm-bio" style="display: {bio_display}; margin: 14px 0 0; font-size: 13px; color: #cbd5e1; line-height: 1.45; font-style: italic;">
                    {bio_text}
                </p>
            </div>

"##
    )
}

/// Counters block: repositories, followers and following.
fn stats(user: &GitHubUser) -> String {
    let repos = user.public_repos.unwrap_or(0);
    let followers = user.followers.unwrap_or(0);
    let following = user.following.unwrap_or(0);

    format!(
        r##"            <style>
                .upm-tab {{ background: none; border: 0; border-bottom: 2px solid transparent; color: var(--muted, #8b949e); padding: 10px 14px; font-size: 13px; cursor: pointer; }}
                .upm-tab[aria-selected="true"] {{ color: var(--text-primary, #c9d1d9); border-bottom-color: var(--accent-color, #58a6ff); font-weight: 600; }}
            </style>
            <div role="tablist" id="upm-tabs" style="display: flex; gap: 2px; padding: 0 16px; background: var(--bg-primary, #0d1117); border-bottom: 1px solid var(--border-color, #30363d);">
                <button type="button" role="tab" class="upm-tab" id="upm-tab-btn-profile" aria-selected="true" onclick="upmShowTab('profile')">Profile</button>
                <button type="button" role="tab" class="upm-tab" id="upm-tab-btn-storage" aria-selected="false" onclick="upmShowTab('storage')">Storage</button>
            </div>
            <!-- Body with metrics and detailed information -->
            <div style="padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; background: var(--bg-primary, #0d1117); color: var(--text-primary, #c9d1d9);">
                <div id="upm-pane-profile" role="tabpanel" style="display: flex; flex-direction: column; gap: 16px;">
                <!-- Contadores GitHub -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center; background: var(--bg-secondary, rgba(255,255,255,0.03)); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color, #30363d);">
                    <div>
                        <div id="upm-repos" style="font-size: 18px; font-weight: 700; color: #58a6ff;">{repos}</div>
                        <div style="font-size: 11px; color: var(--muted, #8b949e); text-transform: uppercase; margin-top: 2px;">Repositories</div>
                    </div>
                    <div>
                        <div id="upm-followers" style="font-size: 18px; font-weight: 700; color: var(--text-primary, #c9d1d9);">{followers}</div>
                        <div style="font-size: 11px; color: var(--muted, #8b949e); text-transform: uppercase; margin-top: 2px;">Followers</div>
                    </div>
                    <div>
                        <div id="upm-following" style="font-size: 18px; font-weight: 700; color: var(--text-primary, #c9d1d9);">{following}</div>
                        <div style="font-size: 11px; color: var(--muted, #8b949e); text-transform: uppercase; margin-top: 2px;">Following</div>
                    </div>
                </div>

"##
    )
}

/// Details list: email, company, location, blog and member since.
fn details(user: &GitHubUser) -> String {
    let provider_label = user.provider.label();

    let (email_disp, email_text) = match &user.email {
        Some(e) if !e.trim().is_empty() => ("flex", esc(e)),
        _ => ("none", String::new()),
    };

    let (company_disp, company_text) = match &user.company {
        Some(c) if !c.trim().is_empty() => ("flex", esc(c)),
        _ => ("none", String::new()),
    };

    let (location_disp, location_text) = match &user.location {
        Some(l) if !l.trim().is_empty() => ("flex", esc(l)),
        _ => ("none", String::new()),
    };

    let (blog_disp, blog_text, blog_href) = match &user.blog {
        Some(b) if !b.trim().is_empty() => {
            let href = if b.starts_with("http://") || b.starts_with("https://") {
                b.clone()
            } else {
                format!("https://{}", b)
            };
            ("flex", esc(b), esc(&href))
        }
        _ => ("none", String::new(), "#".to_string()),
    };

    let (created_disp, created_text) = match &user.created_at {
        Some(c) if !c.trim().is_empty() => {
            let formatted = if c.len() >= 10 { &c[..10] } else { c };
            ("flex", esc(formatted))
        }
        _ => ("none", String::new()),
    };

    format!(
        r##"                <!-- Details list -->
                <div style="display: flex; flex-direction: column; gap: 10px; font-size: 13px;">
                    <div id="upm-email-row" style="display: {email_disp}; align-items: center; gap: 10px; color: var(--text-secondary, #8b949e);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; opacity: 0.8;"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                        <span id="upm-email" style="word-break: break-all;">{email_text}</span>
                    </div>
                    <div id="upm-company-row" style="display: {company_disp}; align-items: center; gap: 10px; color: var(--text-secondary, #8b949e);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; opacity: 0.8;"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M16 14h.01"/></svg>
                        <span id="upm-company">{company_text}</span>
                    </div>
                    <div id="upm-location-row" style="display: {location_disp}; align-items: center; gap: 10px; color: var(--text-secondary, #8b949e);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; opacity: 0.8;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                        <span id="upm-location">{location_text}</span>
                    </div>
                    <div id="upm-blog-row" style="display: {blog_disp}; align-items: center; gap: 10px; color: var(--text-secondary, #8b949e);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; opacity: 0.8;"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
                        <a id="upm-blog-link" href="{blog_href}" target="_blank" rel="noopener" style="color: var(--accent-color, #58a6ff); text-decoration: none; word-break: break-all;">
                            <span id="upm-blog">{blog_text}</span>
                        </a>
                    </div>
                    <div id="upm-created-row" style="display: {created_disp}; align-items: center; gap: 10px; color: var(--text-secondary, #8b949e);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; opacity: 0.8;"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        <span>Member of {provider_label} since <strong id="upm-created" style="font-weight: 500; color: var(--text-primary, #c9d1d9);">{created_text}</strong></span>
                    </div>
                </div>

"##
    )
}

/// Preferences, danger zone and action buttons; closes the modal markup.
fn footer(user: &GitHubUser) -> String {
    let provider_label = user.provider.label();
    let provider_icon = provider_icon(user.provider, 14);
    let github_url = profile_url(user);
    let danger_zone = danger_zone();
    let admin_button = admin_button(user);

    format!(
        r##"                <!-- Preferences (kept only in this browser) -->
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px;">
                    <span style="color: var(--muted, #8b949e);">Language and theme</span>
                    <span data-lang-picker></span> <span data-theme-picker></span>
                </div>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                    <input type="checkbox" id="upm-mascot">
                    <span>Show the NeoLeaf mascot in the editor</span>
                </label>

                {danger_zone}
                </div>

                <!-- Storage tab -->
                <div id="upm-pane-storage" role="tabpanel" style="display: none; flex-direction: column; gap: 14px;">
                    <div>
                        <div style="display: flex; justify-content: space-between; gap: 8px; font-size: 13px; flex-wrap: wrap;">
                            <strong>Browser storage</strong>
                            <span id="upm-st-text"></span>
                        </div>
                        <div id="upm-st-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="height: 12px; border-radius: 6px; background: var(--bg-secondary, rgba(255,255,255,0.08)); border: 1px solid var(--border-color, #30363d); overflow: hidden; margin-top: 8px;">
                            <div id="upm-st-used" style="height: 100%; width: 0; background: #238636; transition: width 0.3s;"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--muted, #8b949e); margin-top: 5px;">
                            <span id="upm-st-used-txt"></span>
                            <span id="upm-st-free-txt"></span>
                        </div>
                        <div id="upm-st-break" style="font-size: 12px; color: var(--muted, #8b949e); margin-top: 4px;"></div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--muted, #8b949e); margin-top: 6px;">
                            <span id="upm-st-persist"></span>
                            <button type="button" class="btn" id="upm-st-persist-btn" onclick="StorageManager.askPersist()" style="display: none; font-size: 12px; padding: 3px 9px;">Ask for protection</button>
                        </div>
                    </div>

                    <div style="border-top: 1px solid var(--border-color, #30363d); padding-top: 12px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                            <span id="upm-st-cache-info" style="font-size: 13px;"></span>
                            <button type="button" class="btn" id="upm-st-cache-btn" onclick="StorageManager.clearCache()" style="font-size: 12px; padding: 5px 10px;">Clear compiler cache</button>
                        </div>
                        <div style="font-size: 12px; color: var(--muted, #8b949e); margin-top: 5px; line-height: 1.45;">The compiler files (packages and fonts) are downloaded again when needed. Your projects are not touched.</div>
                    </div>

                    <div style="border-top: 1px solid var(--border-color, #30363d); padding-top: 12px;">
                        <div style="font-size: 13px; font-weight: 600; margin-bottom: 4px;">Projects stored in this browser</div>
                        <div id="upm-st-list" style="max-height: 220px; overflow-y: auto;"></div>
                        <div id="upm-st-others" style="font-size: 12px; color: var(--muted, #8b949e); margin-top: 6px;"></div>
                    </div>

                    <div style="border-top: 1px solid var(--border-color, #30363d); padding-top: 12px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                            <span style="font-size: 13px; font-weight: 600;">All local data</span>
                            <button type="button" class="btn" id="upm-st-clear-all" onclick="StorageManager.clearAll()" style="font-size: 12px; padding: 5px 10px; color: var(--danger-color, #f85149);">Delete all local data</button>
                        </div>
                        <div style="font-size: 12px; color: var(--muted, #8b949e); margin-top: 5px; line-height: 1.45;">Removes every project copy (of all accounts), the compiler cache and the extra packages stored in this browser. Nothing is deleted on GitHub or Codeberg. Signing out does the same. Your language and theme choices are kept.</div>
                    </div>
                </div>

                <!-- Actions footer: links to other places on top, the session buttons below -->
                <style>
                    .upm-actions {{ display: flex; flex-direction: column; gap: 10px; margin-top: 6px; padding-top: 14px; border-top: 1px solid var(--border-color, #30363d); }}
                    .upm-links {{ display: flex; flex-wrap: wrap; gap: 8px; }}
                    .upm-session {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; }}
                    .upm-act {{ display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; min-height: 32px; padding: 6px 12px; font-size: 13px; text-decoration: none; white-space: nowrap; }}
                </style>
                <div class="upm-actions">
                    <div class="upm-links">
                        <a id="upm-btn-github" href="{github_url}" target="_blank" rel="noopener" class="btn upm-act">
                            {provider_icon}
                            View on {provider_label}
                        </a>
                        {admin_button}
                    </div>
                    <div class="upm-session">
                        <a id="upm-btn-logout" href="/auth/logout" class="btn upm-act" title="Sign out and delete the local data of this browser" onclick="return StorageManager.signOut(event)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>
                            Sign out
                        </a>
                        <button type="button" class="btn btn-primary upm-act" onclick="closeUserProfileModal()">Close</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

"##
    )
}

/// Account deletion button inside the profile modal.
fn danger_zone() -> String {
    r##"<div id="upm-danger-zone" style="border: 1px solid color-mix(in srgb, var(--danger-color, #f85149) 45%, var(--border-color, #30363d)); border-radius: 8px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                    <div style="font-size: 12px; color: var(--muted, #8b949e); line-height: 1.5;">Deletes your access and your data on the NeoLeaf server. Your GitHub repositories are not changed.</div>
                    <button type="button" id="upm-delete-account" class="btn" onclick="openDeleteAccountModal()" style="flex: none; font-size: 12px; padding: 6px 10px; color: var(--danger-color, #f85149); border-color: color-mix(in srgb, var(--danger-color, #f85149) 50%, var(--border-color, #30363d));">Delete my account...</button>
                </div>"##.to_string()
}

/// Link to the admin panel, only for administrators.
fn admin_button(user: &GitHubUser) -> &'static str {
    // only administrators see the link to the panel (the /admin route checks again on the server)
    if crate::admin::is_admin(user) {
        r#"<a id="upm-btn-admin" href="/admin" class="btn upm-act"><span>🛡️</span> <span>Admin panel</span></a>"#
    } else {
        ""
    }
}

/// Profile modal script: open, close and refresh the modal from `/api/user/profile`.
fn script() -> &'static str {
    r##"    <script src="/static/js/storage-manager.js"></script>
    <script>
        // The mascot is off by default; the choice stays in this browser and the editor reacts at once.
        (function () {
            const box = document.getElementById('upm-mascot');
            if (!box) return;
            try { box.checked = localStorage.getItem('ld-mascot') === '1'; } catch (_) {}
            box.addEventListener('change', () => {
                try { localStorage.setItem('ld-mascot', box.checked ? '1' : '0'); } catch (_) {}
                window.dispatchEvent(new CustomEvent('ld-mascot-change'));
            });
        })();
        async function openUserProfileModal() {
            const m = document.getElementById('user-profile-modal');
            if (!m) return;
            m.style.display = 'flex';
            try {
                const res = await fetch('/api/user/profile');
                if (res.ok) {
                    const data = await res.json();
                    if (data && !data.error) {
                        updateUserProfileModalUI(data);
                    }
                }
            } catch (e) {
                console.warn('Error updating GitHub profile:', e);
            }
        }

        function closeUserProfileModal() {
            const m = document.getElementById('user-profile-modal');
            if (m) m.style.display = 'none';
        }

        function updateUserProfileModalUI(u) {
            if (!u) return;
            const nameEl = document.getElementById('upm-name');
            if (nameEl) nameEl.textContent = u.name || u.login;

            const loginEl = document.getElementById('upm-login');
            if (loginEl) loginEl.textContent = u.login;

            const loginLink = document.getElementById('upm-login-link');
            const githubBtn = document.getElementById('upm-btn-github');
            const ghUrl = u.html_url || ('https://github.com/' + u.login);
            if (loginLink) loginLink.href = ghUrl;
            if (githubBtn) githubBtn.href = ghUrl;

            const bioEl = document.getElementById('upm-bio');
            if (bioEl) {
                if (u.bio && u.bio.trim()) {
                    bioEl.textContent = u.bio;
                    bioEl.style.display = 'block';
                } else {
                    bioEl.style.display = 'none';
                }
            }

            const reposEl = document.getElementById('upm-repos');
            if (reposEl) reposEl.textContent = u.public_repos ?? 0;

            const followersEl = document.getElementById('upm-followers');
            if (followersEl) followersEl.textContent = u.followers ?? 0;

            const followingEl = document.getElementById('upm-following');
            if (followingEl) followingEl.textContent = u.following ?? 0;

            const emailRow = document.getElementById('upm-email-row');
            const emailEl = document.getElementById('upm-email');
            if (emailRow && emailEl) {
                if (u.email && u.email.trim()) {
                    emailEl.textContent = u.email;
                    emailRow.style.display = 'flex';
                } else {
                    emailRow.style.display = 'none';
                }
            }

            const compRow = document.getElementById('upm-company-row');
            const compEl = document.getElementById('upm-company');
            if (compRow && compEl) {
                if (u.company && u.company.trim()) {
                    compEl.textContent = u.company;
                    compRow.style.display = 'flex';
                } else {
                    compRow.style.display = 'none';
                }
            }

            const locRow = document.getElementById('upm-location-row');
            const locEl = document.getElementById('upm-location');
            if (locRow && locEl) {
                if (u.location && u.location.trim()) {
                    locEl.textContent = u.location;
                    locRow.style.display = 'flex';
                } else {
                    locRow.style.display = 'none';
                }
            }

            const blogRow = document.getElementById('upm-blog-row');
            const blogEl = document.getElementById('upm-blog');
            const blogLink = document.getElementById('upm-blog-link');
            if (blogRow && blogEl && blogLink) {
                if (u.blog && u.blog.trim()) {
                    let href = u.blog.trim();
                    if (!href.startsWith('http://') && !href.startsWith('https://')) href = 'https://' + href;
                    blogEl.textContent = u.blog;
                    blogLink.href = href;
                    blogRow.style.display = 'flex';
                } else {
                    blogRow.style.display = 'none';
                }
            }

            const createdRow = document.getElementById('upm-created-row');
            const createdEl = document.getElementById('upm-created');
            if (createdRow && createdEl) {
                if (u.created_at) {
                    try {
                        const d = new Date(u.created_at);
                        createdEl.textContent = d.toLocaleDateString(document.documentElement.lang || 'pt-BR', { month: 'long', year: 'numeric' });
                        createdRow.style.display = 'flex';
                    } catch (_) {
                        createdRow.style.display = 'none';
                    }
                } else {
                    createdRow.style.display = 'none';
                }
            }

            const avatarBox = document.getElementById('upm-avatar-container');
            if (avatarBox) {
                if (u.avatar_url) {
                    avatarBox.innerHTML = `<img src="${u.avatar_url}" alt="${u.login}" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.2); box-shadow: 0 4px 12px rgba(0,0,0,0.3);">`;
                } else {
                    const initial = (u.name || u.login || 'U').trim().charAt(0).toUpperCase();
                    avatarBox.innerHTML = `<div style="width: 64px; height: 64px; border-radius: 50%; background: #374151; color: #f3f4f6; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; border: 2px solid rgba(255,255,255,0.2);">${initial}</div>`;
                }
            }
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeUserProfileModal();
        });
    </script>
"##
}

/// Account deletion modal, in two steps: (1) what will and will not be deleted, with confirmation; (2) typing the login.
fn account_delete_html(user: &crate::auth::github::GitHubUser) -> String {
    let _ = user;
    r##"
    <!-- Delete my account modal -->
    <div id="delete-account-modal" class="modal-backdrop" style="display:none;" onclick="if (event.target === this) closeDeleteAccountModal()">
        <div class="modal-box" style="max-width: 500px;">
            <h3 style="color: var(--text-bright); margin-bottom: 12px;">Delete my NeoLeaf account</h3>

            <div id="dac-step1">
                <p style="font-size: 13px; margin: 0 0 6px; color: var(--text-bright);"><strong>What will be deleted:</strong></p>
                <ul style="font-size: 13px; line-height: 1.6; margin: 0 0 12px 18px;">
                    <li>Your access to NeoLeaf: all sessions will be ended and NeoLeaf's authorization on your GitHub account will be revoked.</li>
                    <li>The information NeoLeaf keeps on the server: the session, with your GitHub access token. Your project files are not on the server: they live in your browser and on your GitHub.</li>
                </ul>
                <p style="font-size: 13px; margin: 0 0 6px; color: var(--text-bright);"><strong>What will not be touched:</strong></p>
                <ul style="font-size: 13px; line-height: 1.6; margin: 0 0 12px 18px;">
                    <li data-i18n-html>Your <strong>GitHub repositories</strong> (files, history, collaborators and tags) stay exactly as they are.</li>
                    <li>Other people's projects you collaborate on.</li>
                </ul>
                <p style="font-size: 12px; color: var(--muted, #8b949e); line-height: 1.55; margin: 0 0 14px;" data-i18n-html>This request is the exercise of your right to erasure, provided for in <strong>art. 18 of the LGPD</strong> (Brazilian Law 13.709/2018). Only the technical connection records (IP, date and time) remain, which the law requires us to keep (Marco Civil da Internet, art. 15).</p>
                <label style="display:flex; gap:8px; align-items:flex-start; font-size:13px; cursor:pointer;">
                    <input type="checkbox" id="dac-understand" style="margin-top:3px;" onchange="document.getElementById('dac-continue').disabled = !this.checked">
                    <span>I understand this cannot be undone.</span>
                </label>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
                    <button type="button" class="btn" onclick="closeDeleteAccountModal()">Cancel</button>
                    <button type="button" class="btn btn-primary" id="dac-continue" disabled onclick="deleteAccountStep2()">Continue</button>
                </div>
            </div>

            <div id="dac-step2" style="display:none;">
                <p style="font-size: 13px; margin: 0 0 4px;">To confirm, type your GitHub login:</p>
                <p style="margin: 0 0 8px;"><strong id="dac-login" style="color:var(--text-bright);">__LOGIN__</strong></p>
                <input type="text" id="dac-input" class="form-control" autocomplete="off" spellcheck="false" placeholder="your-login" oninput="deleteAccountCheck()">
                <div id="dac-error" style="display:none; color:var(--danger-color); font-size:13px; margin-top:10px;"></div>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
                    <button type="button" class="btn" onclick="deleteAccountStep1()" id="dac-back">Back</button>
                    <button type="button" class="btn btn-primary" id="dac-confirm" disabled onclick="confirmDeleteAccount()" style="background:var(--danger-color); border-color:var(--danger-color);">Delete my account</button>
                </div>
            </div>
        </div>
    </div>
    <script>
        (function () {
            const LOGIN = document.getElementById('dac-login').textContent.trim();
            const $ = id => document.getElementById(id);
            window.openDeleteAccountModal = function () {
                closeUserProfileModal();
                $('dac-understand').checked = false;
                $('dac-continue').disabled = true;
                deleteAccountStep1();
                $('delete-account-modal').style.display = 'flex';
            };
            window.closeDeleteAccountModal = function () { $('delete-account-modal').style.display = 'none'; };
            window.deleteAccountStep1 = function () { $('dac-step1').style.display = 'block'; $('dac-step2').style.display = 'none'; };
            window.deleteAccountStep2 = function () {
                $('dac-step1').style.display = 'none';
                $('dac-step2').style.display = 'block';
                $('dac-input').value = '';
                $('dac-error').style.display = 'none';
                $('dac-confirm').disabled = true;
                $('dac-input').focus();
            };
            window.deleteAccountCheck = function () {
                $('dac-confirm').disabled = $('dac-input').value.trim().replace(/^@/, '').toLowerCase() !== LOGIN.toLowerCase();
            };
            window.confirmDeleteAccount = async function () {
                const btn = $('dac-confirm'), back = $('dac-back'), err = $('dac-error');
                btn.disabled = true; back.disabled = true; err.style.display = 'none';
                btn.textContent = 'Deleting...';
                try {
                    const res = await fetch('/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm_login: $('dac-input').value }) });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.error || 'Unknown error');
                    location.href = '/?deleted=1';
                } catch (e) {
                    err.textContent = e.message;
                    err.style.display = 'block';
                    btn.textContent = 'Delete my account';
                    btn.disabled = false; back.disabled = false;
                }
            };
            document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDeleteAccountModal(); });
        })();
    </script>
"##.replace("__LOGIN__", &esc(&user.login))
}
