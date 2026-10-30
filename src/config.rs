//! Optional installation file for institutions (`neoleaf.toml`): which sign-in providers are on, the name, logo, accent colour
//! and contact of the institution, and where its own Terms and Privacy pages are.
//!
//! **Without the file nothing changes**: the server behaves exactly as before (the public site runs without it). With the file
//! the server is in "institution mode": the login page is the plain branded sign-in screen, not the NeoLeaf landing page.
//!
//! The file is read once at startup and validated completely; an invalid file stops the server with a message that says what
//! to fix (a half-applied configuration is worse than none). Logos are read into memory at startup from inside the folder of
//! the file (no `..`, no symlink out of it), so no request ever touches the disk path. Secrets never live in the file: a
//! provider names the environment variable that holds its client secret (`client_secret_env`).

use crate::provider::Provider;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

/// Default file name, looked up in the working directory; `NEOLEAF_CONFIG` points elsewhere (and then the file must exist).
const DEFAULT_FILE: &str = "neoleaf.toml";
const MAX_LOGO_BYTES: u64 = 512 * 1024;

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFile {
    brand: Option<RawBrand>,
    legal: Option<RawLegal>,
    providers: Option<HashMap<String, RawProvider>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBrand {
    name: Option<String>,
    logo: Option<String>,
    logo_dark: Option<String>,
    accent: Option<String>,
    contact_email: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawLegal {
    terms_url: Option<String>,
    privacy_url: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawProvider {
    enabled: Option<bool>,
    client_id: Option<String>,
    client_secret_env: Option<String>,
}

/// An image of the institution, already checked, kept in memory.
#[derive(Debug, Clone)]
pub struct Logo {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

#[derive(Debug, Clone)]
pub struct Brand {
    pub name: String,
    pub logo: Option<Logo>,
    pub logo_dark: Option<Logo>,
    /// `#rrggbb`
    pub accent: Option<String>,
    pub contact_email: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Legal {
    pub terms_url: Option<String>,
    pub privacy_url: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct ProviderCfg {
    enabled: bool,
    client_id: Option<String>,
    client_secret_env: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub brand: Brand,
    pub legal: Legal,
    providers: HashMap<Provider, ProviderCfg>,
}

impl Config {
    /// Is the provider switched on in the file? (a provider that is not mentioned is off)
    pub fn provider_enabled(&self, p: Provider) -> bool {
        self.providers.get(&p).is_some_and(|c| c.enabled)
    }

    pub fn provider_client_id(&self, p: Provider) -> Option<String> {
        self.providers.get(&p).and_then(|c| c.client_id.clone())
    }

    /// Name of the environment variable that holds the client secret, if the file says one.
    pub fn provider_secret_env(&self, p: Provider) -> Option<String> {
        self.providers
            .get(&p)
            .and_then(|c| c.client_secret_env.clone())
    }

    /// Providers that are on in the file, in a fixed order.
    pub fn enabled_providers(&self) -> Vec<Provider> {
        [Provider::GitHub, Provider::Codeberg]
            .into_iter()
            .filter(|p| self.provider_enabled(*p))
            .collect()
    }
}

static CONFIG: OnceLock<Option<Config>> = OnceLock::new();

/// The loaded configuration, or `None` when the server runs without the file (the normal case of the public site).
pub fn get() -> Option<&'static Config> {
    CONFIG.get().and_then(|c| c.as_ref())
}

/// Reads and validates the file once. `Ok(None)` when there is no file (default path only); an error when it is invalid
/// or when `NEOLEAF_CONFIG` points to a file that does not exist.
pub fn load() -> Result<Option<&'static Config>, String> {
    let explicit = std::env::var("NEOLEAF_CONFIG")
        .ok()
        .filter(|v| !v.trim().is_empty());
    let path = PathBuf::from(explicit.clone().unwrap_or_else(|| DEFAULT_FILE.to_string()));
    let cfg = if path.is_file() {
        let text = std::fs::read_to_string(&path)
            .map_err(|e| format!("{}: cannot read the file: {e}", path.display()))?;
        let dir = path.parent().filter(|d| !d.as_os_str().is_empty());
        let dir = dir.unwrap_or_else(|| Path::new("."));
        Some(parse(&text, dir).map_err(|e| format!("{}: {e}", path.display()))?)
    } else if explicit.is_some() {
        return Err(format!(
            "{}: NEOLEAF_CONFIG points to a file that does not exist",
            path.display()
        ));
    } else {
        None
    };
    let _ = CONFIG.set(cfg);
    Ok(get())
}

/// Parses and validates the text of the file; `dir` is the folder of the file, where the logos are looked up.
pub fn parse(text: &str, dir: &Path) -> Result<Config, String> {
    let raw: RawFile = toml::from_str(text).map_err(|e| e.to_string())?;
    let b = raw.brand.unwrap_or_default();
    let name = match b.name.as_deref().map(str::trim) {
        None | Some("") => "NeoLeaf".to_string(),
        Some(n) => {
            if n.chars().count() > 80 || n.chars().any(char::is_control) {
                return Err("brand.name: up to 80 characters, no control characters".into());
            }
            n.to_string()
        }
    };
    let accent = match b.accent.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(a) if valid_hex_color(a) => Some(a.to_ascii_lowercase()),
        Some(_) => return Err("brand.accent: use the form #rrggbb (for example #1a7f37)".into()),
    };
    let contact_email = match b.contact_email.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(e) if valid_email(e) => Some(e.to_string()),
        Some(_) => return Err("brand.contact_email: not a valid e-mail address".into()),
    };
    let logo = read_logo(dir, b.logo.as_deref(), "brand.logo")?;
    let logo_dark = read_logo(dir, b.logo_dark.as_deref(), "brand.logo_dark")?;

    let l = raw.legal.unwrap_or_default();
    let legal = Legal {
        terms_url: valid_url(l.terms_url.as_deref(), "legal.terms_url")?,
        privacy_url: valid_url(l.privacy_url.as_deref(), "legal.privacy_url")?,
    };

    let mut providers = HashMap::new();
    let mut ids: Vec<_> = raw.providers.unwrap_or_default().into_iter().collect();
    ids.sort_by(|a, b| a.0.cmp(&b.0));
    for (id, p) in ids {
        let Some(prov) = Provider::from_id(&id) else {
            return Err(format!(
                "providers.{id}: not supported yet (supported: github, codeberg)"
            ));
        };
        let client_id = match p.client_id.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(c) if c.len() <= 200 && c.chars().all(|c| c.is_ascii_graphic()) => {
                Some(c.to_string())
            }
            Some(_) => return Err(format!("providers.{id}.client_id: invalid value")),
        };
        let client_secret_env = match p.client_secret_env.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(v) if valid_env_name(v) => Some(v.to_string()),
            Some(_) => {
                return Err(format!(
                    "providers.{id}.client_secret_env: must be the NAME of an environment variable (letters, digits and _), not the secret itself"
                ));
            }
        };
        providers.insert(
            prov,
            ProviderCfg {
                enabled: p.enabled.unwrap_or(false),
                client_id,
                client_secret_env,
            },
        );
    }

    Ok(Config {
        brand: Brand {
            name,
            logo,
            logo_dark,
            accent,
            contact_email,
        },
        legal,
        providers,
    })
}

fn valid_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn valid_env_name(s: &str) -> bool {
    let mut it = s.bytes();
    s.len() <= 100
        && it
            .next()
            .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
        && it.all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Deliberately plain: one `@`, a dotted domain, nothing that could break out of an attribute or a header.
fn valid_email(s: &str) -> bool {
    let Some((user, host)) = s.split_once('@') else {
        return false;
    };
    s.len() <= 254
        && !user.is_empty()
        && host.contains('.')
        && !host.contains('@')
        && !host.starts_with('.')
        && !host.ends_with('.')
        && s.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b'@' | b'.' | b'-' | b'_' | b'+' | b'%')
        })
}

/// `https://...` (or `http://` only for a local address, for development).
fn valid_url(v: Option<&str>, field: &str) -> Result<Option<String>, String> {
    let Some(u) = v.map(str::trim).filter(|u| !u.is_empty()) else {
        return Ok(None);
    };
    let local = ["http://localhost", "http://127.0.0.1", "http://[::1]"]
        .iter()
        .any(|p| u.starts_with(p));
    if !(u.starts_with("https://") || local)
        || u.len() > 2048
        || u.chars().any(|c| c.is_control() || c.is_whitespace())
        || u.contains(['"', '\'', '<', '>', '\\'])
    {
        return Err(format!(
            "{field}: must be an https:// address, without spaces"
        ));
    }
    Ok(Some(u.to_string()))
}

/// Reads one logo from inside `dir`. The path must be relative with no `..`; after resolving symlinks it must still be inside `dir`.
fn read_logo(dir: &Path, rel: Option<&str>, field: &str) -> Result<Option<Logo>, String> {
    let Some(rel) = rel.map(str::trim).filter(|r| !r.is_empty()) else {
        return Ok(None);
    };
    let p = Path::new(rel);
    if p.is_absolute()
        || p.components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(format!(
            "{field}: use a path inside the folder of the file (no leading / and no ..)"
        ));
    }
    let full = dir.join(p);
    let root = dir
        .canonicalize()
        .map_err(|e| format!("{field}: cannot open the folder of the file: {e}"))?;
    let real = full
        .canonicalize()
        .map_err(|e| format!("{field}: cannot read {rel}: {e}"))?;
    if !real.starts_with(&root) {
        return Err(format!("{field}: {rel} resolves to outside of the folder"));
    }
    let meta = std::fs::metadata(&real).map_err(|e| format!("{field}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{field}: {rel} is not a file"));
    }
    if meta.len() > MAX_LOGO_BYTES {
        return Err(format!("{field}: {rel} is larger than 512 KiB"));
    }
    let bytes = std::fs::read(&real).map_err(|e| format!("{field}: {e}"))?;
    let ext = real
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let content_type = sniff_image(&ext, &bytes)
        .ok_or_else(|| format!("{field}: {rel} is not a PNG, JPEG, GIF, WebP or SVG image"))?;
    Ok(Some(Logo {
        bytes,
        content_type,
    }))
}

/// The type comes from the bytes, and must agree with the extension.
fn sniff_image(ext: &str, b: &[u8]) -> Option<&'static str> {
    match ext {
        "png" if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) => {
            Some("image/png")
        }
        "jpg" | "jpeg" if b.starts_with(&[0xff, 0xd8, 0xff]) => Some("image/jpeg"),
        "gif" if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") => Some("image/gif"),
        "webp" if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" => Some("image/webp"),
        "svg" => {
            let text = std::str::from_utf8(b).ok()?;
            text.contains("<svg").then_some("image/svg+xml")
        }
        _ => None,
    }
}

/// `#rrggbb` of an accent colour and the text colour that reads well on top of it.
pub fn on_color(hex: &str) -> &'static str {
    let v = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0) as f64 / 255.0;
    let lin = |c: f64| {
        if c <= 0.03928 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let l = 0.2126 * lin(v(1)) + 0.7152 * lin(v(3)) + 0.0722 * lin(v(5));
    if l > 0.4 { "#111111" } else { "#ffffff" }
}

/// What `neoleaf --check-config` prints (never a secret): one line per fact.
pub fn summary(cfg: &Config) -> Vec<String> {
    let mut out = vec![format!("name: {}", cfg.brand.name)];
    let img = |l: &Option<Logo>| match l {
        Some(l) => format!("{} bytes ({})", l.bytes.len(), l.content_type),
        None => "none".to_string(),
    };
    out.push(format!("logo: {}", img(&cfg.brand.logo)));
    out.push(format!("logo_dark: {}", img(&cfg.brand.logo_dark)));
    out.push(format!(
        "accent: {}",
        cfg.brand.accent.as_deref().unwrap_or("default theme")
    ));
    out.push(format!(
        "contact_email: {}",
        cfg.brand.contact_email.as_deref().unwrap_or("none")
    ));
    out.push(format!(
        "terms_url: {}",
        cfg.legal.terms_url.as_deref().unwrap_or("built-in page")
    ));
    out.push(format!(
        "privacy_url: {}",
        cfg.legal.privacy_url.as_deref().unwrap_or("built-in page")
    ));
    for p in [Provider::GitHub, Provider::Codeberg] {
        let on = cfg.provider_enabled(p);
        let keys = !p.client_id().is_empty() && !p.client_secret().is_empty();
        let state = match (on, keys) {
            (false, _) => "off",
            (true, true) => "on",
            (true, false) => "ON BUT THE CLIENT ID OR SECRET IS MISSING (it will not be shown)",
        };
        out.push(format!("provider {}: {state}", p.id()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

    fn dir_with(files: &[(&str, &[u8])]) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        for (name, bytes) in files {
            let p = d.path().join(name);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, bytes).unwrap();
        }
        d
    }

    #[test]
    fn empty_file_gives_the_default_look_and_no_provider() {
        let d = dir_with(&[]);
        let c = parse("", d.path()).unwrap();
        assert_eq!(c.brand.name, "NeoLeaf");
        assert!(c.brand.logo.is_none() && c.brand.accent.is_none());
        assert!(c.enabled_providers().is_empty());
        assert!(c.legal.terms_url.is_none());
    }

    #[test]
    fn full_file_is_read() {
        let d = dir_with(&[("brand/logo.png", PNG), ("brand/dark.svg", b"<svg/>")]);
        let c = parse(
            r##"
            [brand]
            name = "IFTO LaTeX"
            logo = "brand/logo.png"
            logo_dark = "brand/dark.svg"
            accent = "#1A7F37"
            contact_email = "suporte@ifto.edu.br"
            [legal]
            terms_url = "https://ifto.edu.br/termos"
            [providers.github]
            enabled = true
            client_id = "abc"
            client_secret_env = "GH_SECRET"
            [providers.codeberg]
            enabled = false
            "##,
            d.path(),
        )
        .unwrap();
        assert_eq!(c.brand.name, "IFTO LaTeX");
        assert_eq!(c.brand.accent.as_deref(), Some("#1a7f37"));
        assert_eq!(c.brand.logo.as_ref().unwrap().content_type, "image/png");
        assert_eq!(
            c.brand.logo_dark.as_ref().unwrap().content_type,
            "image/svg+xml"
        );
        assert_eq!(c.enabled_providers(), vec![Provider::GitHub]);
        assert_eq!(
            c.provider_client_id(Provider::GitHub).as_deref(),
            Some("abc")
        );
        assert_eq!(
            c.provider_secret_env(Provider::GitHub).as_deref(),
            Some("GH_SECRET")
        );
        assert!(!c.provider_enabled(Provider::Codeberg));
    }

    #[test]
    fn rejects_what_is_wrong_with_a_clear_message() {
        let d = dir_with(&[("logo.png", PNG), ("fake.png", b"not an image")]);
        let err = |t: &str| parse(t, d.path()).unwrap_err();
        assert!(err("[brand]\nname = 3").contains("name"));
        assert!(err("[brand]\naccent = \"red\"").contains("brand.accent"));
        assert!(err("[brand]\ncontact_email = \"a b@c.d\"").contains("contact_email"));
        assert!(err("[brand]\nlogo = \"../x.png\"").contains("no .."));
        assert!(err("[brand]\nlogo = \"/etc/passwd\"").contains("no .."));
        assert!(err("[brand]\nlogo = \"fake.png\"").contains("not a PNG"));
        assert!(err("[brand]\nlogo = \"missing.png\"").contains("cannot read"));
        assert!(err("[legal]\nterms_url = \"http://example.com/t\"").contains("https"));
        assert!(err("[legal]\nterms_url = \"javascript:alert(1)\"").contains("https"));
        assert!(err("[providers.gitlab]\nenabled = true").contains("not supported yet"));
        assert!(
            err("[providers.github]\nclient_secret_env = \"abc def\"")
                .contains("NAME of an environment variable")
        );
        assert!(err("[brand]\nunknown = 1").contains("unknown field"));
    }

    #[test]
    fn logo_cannot_leave_the_folder_through_a_symlink() {
        let outside = dir_with(&[("secret.png", PNG)]);
        let d = dir_with(&[]);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.path().join("secret.png"), d.path().join("l.png"))
                .unwrap();
            let e = parse("[brand]\nlogo = \"l.png\"", d.path()).unwrap_err();
            assert!(e.contains("outside of the folder"), "{e}");
        }
    }

    #[test]
    fn logo_size_limit_and_type_follow_the_bytes() {
        let big = vec![0x89u8; (MAX_LOGO_BYTES + 1) as usize];
        let d = dir_with(&[("big.png", &big), ("p.svg", PNG)]);
        assert!(
            parse("[brand]\nlogo = \"big.png\"", d.path())
                .unwrap_err()
                .contains("512 KiB")
        );
        // PNG bytes under an .svg name are not an SVG
        assert!(parse("[brand]\nlogo = \"p.svg\"", d.path()).is_err());
    }

    #[test]
    fn text_colour_follows_the_accent_brightness() {
        assert_eq!(on_color("#ffffff"), "#111111");
        assert_eq!(on_color("#000000"), "#ffffff");
        assert_eq!(on_color("#1a7f37"), "#ffffff");
        assert_eq!(on_color("#f5c518"), "#111111");
    }
}
