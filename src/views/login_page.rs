/// Landing page files (`site/`). Read from disk on every request so the text can change without recompiling
/// (the deploy ships the `site/` folder); if the folder is missing, the copy embedded in the binary is used.
pub fn site_file(name: &str) -> String {
    if let Ok(s) = std::fs::read_to_string(format!("site/{name}")) {
        return s;
    }
    match name {
        "index.html" => include_str!("../../site/index.html"),
        "home.css" => include_str!("../../site/home.css"),
        "home.js" => include_str!("../../site/home.js"),
        "carbon.json" => include_str!("../../site/carbon.json"),
        _ => "",
    }
    .to_string()
}

/// The Website Carbon snapshot (`site/carbon.json`, written by `scripts/fetch_carbon.py`) as the footer badge.
/// Everything is validated and formatted here, so nothing from the file reaches the page as HTML; without a valid file the badge is left out.
fn carbon_badge(json: &str) -> String {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else {
        return String::new();
    };
    let source = v["source"].as_str().unwrap_or("");
    let rating = v["rating"].as_str().unwrap_or("");
    let tested = v["tested"].as_str().unwrap_or("");
    let (Some(co2), Some(cleaner)) = (v["co2"].as_f64(), v["cleaner_than"].as_u64()) else {
        return String::new();
    };
    let date_ok = tested.len() == 10
        && tested.bytes().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                c == b'-'
            } else {
                c.is_ascii_digit()
            }
        });
    let rating_ok = !rating.is_empty()
        && rating.len() <= 2
        && rating.bytes().all(|c| matches!(c, b'A'..=b'F' | b'+'));
    if !source.starts_with("https://www.websitecarbon.com/")
        || !date_ok
        || !rating_ok
        || !(0.0..1000.0).contains(&co2)
        || cleaner > 100
    {
        return String::new();
    }
    let source = super::esc(source);
    format!(
        r#"<a class="nl-carbon" href="{source}" target="_blank" rel="noopener" title="See the full result on Website Carbon">
                    <span class="nl-carbon-main"><span class="nl-carbon-g">{co2} g of CO₂ per page view</span><span class="nl-carbon-brand">Website Carbon</span></span>
                    <span class="nl-carbon-sub">Cleaner than {cleaner}% of pages tested</span>
                    <span class="nl-carbon-sub">Rating {rating} · Tested on {tested}</span>
                </a>"#
    )
}

/// Sign-in buttons: GitHub on the left and, if the server has the Codeberg keys, Codeberg on the right, side by side.
fn auth_button(
    href: &str,
    class: &str,
    provider: crate::provider::Provider,
    size: u32,
    label: &str,
    sub: Option<&str>,
    title: Option<&str>,
) -> String {
    let icon = super::provider_icon(provider, size);
    let text = match sub {
        Some(sub) => format!("<span><strong>{label}</strong><small>{sub}</small></span>"),
        None => format!("<span>{label}</span>"),
    };
    let title = title
        .map(|t| format!(r#" title="{t}""#))
        .unwrap_or_default();
    format!(r#"<a href="{href}" class="nl-btn {class}"{title}>{icon}{text}</a>"#)
}

pub fn render(client_id_configured: bool, codeberg: bool) -> String {
    use crate::provider::Provider::{Codeberg, GitHub};
    let (nav_auth_action, hero_auth_action, bottom_auth_action) = if client_id_configured {
        const SUB: &str = "100% Free · No Card · No Limits";
        let row = |class: &str, inner: String| format!(r#"<div class="{class}">{inner}</div>"#);
        // GitHub on the left, Codeberg on the right
        let nav = {
            if codeberg {
                // the top bar cannot fit two buttons with the full text: only the names, with the full sentence in the tooltip
                let gh = auth_button(
                    "/auth/login",
                    "nl-btn-primary nl-btn-sm",
                    GitHub,
                    16,
                    "GitHub",
                    None,
                    Some("Sign in with GitHub"),
                );
                let cb = auth_button(
                    "/auth/login/codeberg",
                    "nl-btn-codeberg nl-btn-sm",
                    Codeberg,
                    16,
                    "Codeberg",
                    None,
                    Some("Sign in with Codeberg"),
                );
                format!(r#"<span class="nl-auth-row nl-auth-row-nav">{gh}{cb}</span>"#)
            } else {
                auth_button(
                    "/auth/login",
                    "nl-btn-primary nl-btn-sm",
                    GitHub,
                    16,
                    "Sign in with GitHub",
                    None,
                    None,
                )
            }
        };
        let hero = {
            let gh = auth_button(
                "/auth/login",
                "nl-btn-lg nl-btn-github",
                GitHub,
                22,
                "Get Started with GitHub",
                Some(SUB),
                None,
            );
            let cb = if codeberg {
                auth_button(
                    "/auth/login/codeberg",
                    "nl-btn-lg nl-btn-codeberg",
                    Codeberg,
                    22,
                    "Get Started with Codeberg",
                    Some(SUB),
                    None,
                )
            } else {
                String::new()
            };
            row(
                if codeberg {
                    "nl-hero-cta-wrapper nl-cta-row"
                } else {
                    "nl-hero-cta-wrapper"
                },
                format!("{gh}{cb}"),
            )
        };
        let bottom = {
            let gh = auth_button(
                "/auth/login",
                "nl-btn-lg nl-btn-github",
                GitHub,
                22,
                "Sign in Free with GitHub",
                None,
                None,
            );
            let cb = if codeberg {
                auth_button(
                    "/auth/login/codeberg",
                    "nl-btn-lg nl-btn-codeberg",
                    Codeberg,
                    22,
                    "Sign in Free with Codeberg",
                    None,
                    None,
                )
            } else {
                String::new()
            };
            format!(r#"<span class="nl-auth-row">{gh}{cb}</span>"#)
        };
        (nav, hero, bottom)
    } else {
        let warning_block = r##"<div class="nl-hero-config-warning">
            <div class="nl-warning-badge">⚠️ GitHub login not configured</div>
            <p class="nl-warning-desc">The GitHub OAuth credentials have not been set in your <code>.env</code> file yet.</p>
            <div class="nl-warning-code">
                <code>GITHUB_CLIENT_ID=your_client_id<br>GITHUB_CLIENT_SECRET=your_client_secret<br>REDIRECT_URI=http://localhost:3000/auth/callback</code>
            </div>
            <p class="nl-warning-desc" style="margin-top:10px;">To develop without a GitHub account, run <code>mise run dev:fake</code> (a local fake GitHub).</p>
        </div>"##.to_string();
        (String::new(), warning_block, String::new())
    };

    let template = site_file("index.html");
    template
        .replace("{{NAV_AUTH_ACTION}}", &nav_auth_action)
        .replace("{{HERO_AUTH_ACTION}}", &hero_auth_action)
        .replace("{{BOTTOM_AUTH_ACTION}}", &bottom_auth_action)
        .replace("{{CARBON_BADGE}}", &carbon_badge(&site_file("carbon.json")))
}
