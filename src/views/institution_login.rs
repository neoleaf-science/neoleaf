//! Sign-in screen of an institution install (the server runs with `neoleaf.toml`, see `config.rs`): the logo, the name and
//! one button per enabled provider, with the contact and the legal links in the footer. Without the file the public site keeps
//! showing the NeoLeaf landing page (`login_page.rs`).
//!
//! Everything that comes from the file is escaped here, and the logo is an `<img>` fed by `/brand/logo`, never inline markup.

use super::esc;
use crate::config::{self, Config};
use crate::provider::Provider;

/// Message above the buttons, chosen by the query string of `/` (the same ones the landing page understands).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Notice {
    SessionExpired,
    AccountDeleted,
    AccountBlocked,
}

impl Notice {
    fn text(self) -> &'static str {
        match self {
            Notice::SessionExpired => "Your session expired or was revoked. Please sign in again.",
            Notice::AccountDeleted => {
                "Your stored session was removed from this server. Your repositories were not changed."
            }
            Notice::AccountBlocked => "This account was blocked by the administrator.",
        }
    }
}

fn button(p: Provider) -> String {
    let (href, label) = match p {
        Provider::GitHub => ("/auth/login".to_string(), "Sign in with GitHub".to_string()),
        Provider::Codeberg => (
            "/auth/login/codeberg".to_string(),
            "Sign in with Codeberg".to_string(),
        ),
        // the administrator writes the whole text of the button (`label` in neoleaf.toml), so it is shown as written
        Provider::Custom(id) => (format!("/auth/login/{id}"), esc(p.label())),
    };
    format!(
        r#"<a class="inst-btn" href="{href}">{}<span>{label}</span></a>"#,
        super::provider_icon(p, 20)
    )
}

fn logos(cfg: &Config) -> String {
    let b = &cfg.brand;
    let alt = esc(&b.name);
    match (&b.logo, &b.logo_dark) {
        (Some(_), Some(_)) => format!(
            r#"<img class="inst-logo inst-logo-light" src="/brand/logo" alt="{alt}"><img class="inst-logo inst-logo-dark" src="/brand/logo-dark" alt="{alt}" hidden>"#
        ),
        (Some(_), None) => {
            format!(r#"<img class="inst-logo" src="/brand/logo" alt="{alt}">"#)
        }
        (None, Some(_)) => {
            format!(r#"<img class="inst-logo" src="/brand/logo-dark" alt="{alt}">"#)
        }
        (None, None) => {
            format!(r#"<img class="inst-logo" src="/static/img/neoleaf_logo_vet.svg" alt="{alt}">"#)
        }
    }
}

/// The page. `providers` are the ones that are on and have their keys (the caller filters).
pub fn render(cfg: &Config, providers: &[Provider], notice: Option<Notice>) -> String {
    let name = esc(&cfg.brand.name);
    let accent = match &cfg.brand.accent {
        Some(a) => format!(
            ":root{{--inst-accent:{a};--inst-on:{}}}",
            config::on_color(a)
        ),
        None => String::new(),
    };
    let notice = notice
        .map(|n| {
            format!(
                r#"<div class="inst-notice" role="alert">{}</div>"#,
                n.text()
            )
        })
        .unwrap_or_default();
    let buttons = if providers.is_empty() {
        r#"<p class="inst-empty">No sign-in method is enabled. Ask the administrator of this server.</p>"#
            .to_string()
    } else {
        providers.iter().map(|p| button(*p)).collect::<String>()
    };
    let mut foot = Vec::new();
    if let Some(mail) = &cfg.brand.contact_email {
        let m = esc(mail);
        foot.push(format!(
            r#"<span>Contact:</span> <a href="mailto:{m}">{m}</a>"#
        ));
    }
    foot.push(r#"<a href="/terms">Terms of Use</a>"#.to_string());
    foot.push(r#"<a href="/privacy">Privacy Policy</a>"#.to_string());
    let foot = foot.join(r#"<span class="inst-dot" aria-hidden="true">·</span>"#);
    let toggle = if cfg.brand.logo.is_some() && cfg.brand.logo_dark.is_some() {
        r#"<script>(function(){var l=document.querySelector('.inst-logo-light'),d=document.querySelector('.inst-logo-dark');if(!l||!d)return;function f(){var k=(getComputedStyle(document.documentElement).colorScheme||'').indexOf('dark')===0;l.hidden=k;d.hidden=!k}f();window.addEventListener('ld-theme-change',f)})();</script>"#
    } else {
        ""
    };
    let logos = logos(cfg);
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{name}</title>
    <link rel="icon" type="image/png" href="/static/img/favicon.png">
    <script src="/static/js/theme.js"></script>
    <script src="/static/js/i18n.js"></script>
    <link rel="stylesheet" href="/static/css/editor.css">
    <style>
        {accent}
        .inst-body {{ min-height: 100vh; margin: 0; display: flex; flex-direction: column; background: var(--bg-primary); color: var(--text-primary); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }}
        .inst-top {{ display: flex; justify-content: flex-end; gap: 8px; align-items: center; padding: 12px 16px; }}
        .inst-main {{ flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px; }}
        .inst-card {{ width: 100%; max-width: 400px; padding: 32px 28px; text-align: center; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 14px; box-sizing: border-box; }}
        .inst-logo {{ display: block; margin: 0 auto 16px; max-width: 220px; max-height: 96px; width: auto; height: auto; object-fit: contain; }}
        .inst-logo[hidden] {{ display: none; }}
        .inst-card h1 {{ margin: 0 0 4px; font-size: 24px; color: var(--text-bright); overflow-wrap: anywhere; }}
        .inst-sub {{ margin: 0 0 24px; font-size: 14px; color: var(--muted); }}
        .inst-btn {{ display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 10px; padding: 11px 16px; border-radius: 8px; font-size: 15px; font-weight: 600; text-decoration: none; background: var(--inst-accent, var(--green-btn)); color: var(--inst-on, var(--on-btn)); }}
        .inst-btn:hover, .inst-btn:focus-visible {{ filter: brightness(1.08); }}
        .inst-btn:focus-visible {{ outline: 2px solid var(--text-bright); outline-offset: 2px; }}
        .inst-empty {{ margin: 0; font-size: 14px; color: var(--muted); }}
        .inst-notice {{ margin: 0 0 18px; padding: 9px 12px; border-radius: 8px; font-size: 13px; text-align: left; background: color-mix(in srgb, var(--warn) 16%, var(--bg-secondary)); border: 1px solid var(--warn); color: var(--text-bright); }}
        .inst-foot {{ padding: 16px; text-align: center; font-size: 13px; color: var(--muted); }}
        .inst-foot a {{ color: var(--link); text-decoration: none; }}
        .inst-foot a:hover {{ text-decoration: underline; }}
        .inst-dot {{ margin: 0 8px; }}
    </style>
</head>
<body class="inst-body">
    <div class="inst-top"><span data-lang-picker></span><span data-theme-picker></span></div>
    <main class="inst-main">
        <div class="inst-card">
            {notice}
            {logos}
            <h1>{name}</h1>
            <p class="inst-sub">Collaborative LaTeX editor</p>
            {buttons}
        </div>
    </main>
    <footer class="inst-foot">{foot}</footer>
    {toggle}
</body>
</html>
"##
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(toml: &str) -> Config {
        let d = tempfile::tempdir().unwrap();
        config::parse(toml, d.path()).unwrap()
    }

    #[test]
    fn name_and_contact_are_escaped_and_only_given_providers_appear() {
        let c = cfg(r#"
            [brand]
            name = "A <b>&\"x\""
            contact_email = "a+b@u.edu.br"
            "#);
        let html = render(&c, &[Provider::Codeberg], None);
        assert!(html.contains("A &lt;b&gt;&amp;&quot;x&quot;"));
        assert!(!html.contains("<b>&"));
        assert!(html.contains(r#"mailto:a+b@u.edu.br"#));
        assert!(html.contains("/auth/login/codeberg"));
        assert!(!html.contains(r#"href="/auth/login""#));
        assert!(
            html.contains("/static/img/neoleaf_logo_vet.svg"),
            "default logo"
        );
        assert!(!html.contains("--inst-accent:"), "no accent unless set");
    }

    #[test]
    fn accent_and_notice_and_empty_state() {
        let c = cfg("[brand]\naccent = \"#1a7f37\"");
        let html = render(&c, &[], Some(Notice::AccountBlocked));
        assert!(html.contains("--inst-accent:#1a7f37;--inst-on:#ffffff"));
        assert!(html.contains("blocked by the administrator"));
        assert!(html.contains("No sign-in method is enabled"));
        assert!(!html.contains("inst-btn\" href"));
    }
}
