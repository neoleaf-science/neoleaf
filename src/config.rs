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
    /// NAME of the environment variable that holds the client id (instead of writing the id in the file)
    client_id_env: Option<String>,
    client_secret_env: Option<String>,
    /// numeric ids of the administrators of this installation who sign in with this provider
    admins: Option<Vec<RawId>>,
    /// only for your own Git server: `forgejo` or `gitea`
    kind: Option<String>,
    url: Option<String>,
    /// address NeoLeaf itself uses to reach the server when it differs from `url` (a private network, a container name)
    internal_url: Option<String>,
    label: Option<String>,
}

/// An id written as a number (`12`) or as text (`"12"`).
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawId {
    Num(u64),
    Text(String),
}

/// At most this many administrators per provider (a safety bound, not a design limit).
const MAX_ADMINS: usize = 100;

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
    admins: Vec<u64>,
    client_id: Option<String>,
    client_id_env: Option<String>,
    client_secret_env: Option<String>,
}

/// Your own Git server (Forgejo or Gitea) used as a sign-in provider.
#[derive(Debug, Clone)]
pub struct CustomProvider {
    pub id: String,
    /// text of the sign-in button, written by the administrator (shown as it is)
    pub label: String,
    /// `https://git.example.edu` (no trailing slash): the address people use, for their browser (sign-in page, links)
    pub url: String,
    /// What NeoLeaf's own requests use (token, API, Git proxy). Same as `url` unless `internal_url` is set.
    pub server_url: String,
    /// host part of `url`, for the "no reply" e-mail addresses
    pub host: String,
}

/// More than this many of your own Git servers in one installation is almost certainly a mistake.
pub const MAX_CUSTOM_PROVIDERS: usize = 8;

#[derive(Debug, Clone)]
pub struct Config {
    pub brand: Brand,
    pub legal: Legal,
    providers: HashMap<Provider, ProviderCfg>,
    custom: Vec<CustomProvider>,
}

impl Config {
    /// Is the provider switched on in the file? (a provider that is not mentioned is off)
    pub fn provider_enabled(&self, p: Provider) -> bool {
        self.providers.get(&p).is_some_and(|c| c.enabled)
    }

    pub fn provider_client_id(&self, p: Provider) -> Option<String> {
        self.providers.get(&p).and_then(|c| c.client_id.clone())
    }

    /// Name of the environment variable that holds the client id, if the file says one.
    pub fn provider_id_env(&self, p: Provider) -> Option<String> {
        self.providers.get(&p).and_then(|c| c.client_id_env.clone())
    }

    /// Name of the environment variable that holds the client secret, if the file says one.
    pub fn provider_secret_env(&self, p: Provider) -> Option<String> {
        self.providers
            .get(&p)
            .and_then(|c| c.client_secret_env.clone())
    }

    /// Numeric ids of the administrators the file lists for this provider (empty: the file names none).
    pub fn provider_admins(&self, p: Provider) -> &[u64] {
        self.providers.get(&p).map_or(&[], |c| c.admins.as_slice())
    }

    /// Your own Git server with this id, if the file has it.
    pub fn custom_provider(&self, id: &str) -> Option<&CustomProvider> {
        self.custom.iter().find(|c| c.id == id)
    }

    /// Providers that are on in the file, in a fixed order: GitHub, Codeberg, then your own servers by id.
    pub fn enabled_providers(&self) -> Vec<Provider> {
        let mut out: Vec<Provider> = [Provider::GitHub, Provider::Codeberg]
            .into_iter()
            .filter(|p| self.provider_enabled(*p))
            .collect();
        for c in &self.custom {
            if let Some(p) = Provider::from_stored(&c.id).filter(|p| self.provider_enabled(*p)) {
                out.push(p);
            }
        }
        out
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
    let mut custom = Vec::new();
    let mut ids: Vec<_> = raw.providers.unwrap_or_default().into_iter().collect();
    ids.sort_by(|a, b| a.0.cmp(&b.0));
    for (id, p) in ids {
        let builtin = matches!(id.as_str(), "github" | "codeberg");
        let prov = if builtin {
            if p.kind.is_some() || p.url.is_some() || p.internal_url.is_some() || p.label.is_some()
            {
                return Err(format!(
                    "providers.{id}: kind, url and label are only for your own Git server (use another id, such as git-myuniversity)"
                ));
            }
            Provider::from_stored(&id).expect("built-in id")
        } else {
            let c = parse_custom(&id, &p)?;
            if custom.len() >= MAX_CUSTOM_PROVIDERS {
                return Err(format!(
                    "providers: at most {MAX_CUSTOM_PROVIDERS} Git servers of your own"
                ));
            }
            let prov = Provider::from_stored(&c.id)
                .ok_or_else(|| format!("providers.{id}: too many different providers"))?;
            custom.push(c);
            prov
        };
        let client_id = match p.client_id.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(c) if c.len() <= 200 && c.chars().all(|c| c.is_ascii_graphic()) => {
                Some(c.to_string())
            }
            Some(_) => return Err(format!("providers.{id}.client_id: invalid value")),
        };
        let client_id_env = match p.client_id_env.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(v) if valid_env_name(v) => Some(v.to_string()),
            Some(_) => {
                return Err(format!(
                    "providers.{id}.client_id_env: must be the NAME of an environment variable (letters, digits and _)"
                ));
            }
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
        let admins = parse_admins(&id, p.admins.as_deref())?;
        providers.insert(
            prov,
            ProviderCfg {
                enabled: p.enabled.unwrap_or(false),
                admins,
                client_id,
                client_id_env,
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
        custom,
    })
}

/// `admins = [12, "34"]`: numeric ids only. A login or an e-mail can change hands, an id cannot.
fn parse_admins(id: &str, raw: Option<&[RawId]>) -> Result<Vec<u64>, String> {
    let mut out = Vec::new();
    for r in raw.unwrap_or(&[]) {
        let n = match r {
            RawId::Num(n) => Some(*n),
            RawId::Text(t) => t.trim().parse::<u64>().ok(),
        };
        match n {
            Some(n) if n > 0 => {
                if !out.contains(&n) {
                    out.push(n);
                }
            }
            _ => {
                return Err(format!(
                    "providers.{id}.admins: only numeric account ids (not logins or e-mails, which can change hands)"
                ));
            }
        }
    }
    if out.len() > MAX_ADMINS {
        return Err(format!(
            "providers.{id}.admins: at most {MAX_ADMINS} administrators"
        ));
    }
    Ok(out)
}

/// `[providers.<id>]` of your own Git server: the id, `kind`, `url` and `label` are checked here.
fn parse_custom(id: &str, p: &RawProvider) -> Result<CustomProvider, String> {
    if !crate::provider::valid_custom_id(id) {
        return Err(format!(
            "providers.{id}: the id of your own Git server is lowercase letters, digits and hyphen, starting with a letter (up to 32), and not github or codeberg"
        ));
    }
    match p.kind.as_deref().map(str::trim) {
        Some("forgejo" | "gitea") => {}
        Some("gitlab") => {
            return Err(format!(
                "providers.{id}.kind: gitlab is not supported yet (supported: forgejo, gitea)"
            ));
        }
        _ => {
            return Err(format!(
                "providers.{id}.kind: required, forgejo or gitea (the server behind the url)"
            ));
        }
    }
    let url = valid_url(p.url.as_deref(), &format!("providers.{id}.url"))?
        .ok_or_else(|| format!("providers.{id}.url: required (the address of the Git server)"))?;
    let url = url.trim_end_matches('/').to_string();
    let rest = url.split_once("://").map(|x| x.1).unwrap_or("");
    let host = rest.split('/').next().unwrap_or("");
    if url.contains(['?', '#']) || host.is_empty() || host.contains('@') {
        return Err(format!(
            "providers.{id}.url: only the address of the server (no user, query or #)"
        ));
    }
    let host = host
        .rsplit_once(':')
        .filter(|(_, port)| port.bytes().all(|b| b.is_ascii_digit()))
        .map_or(host, |(h, _)| h)
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    let server_url = match p.internal_url.as_deref().map(str::trim) {
        None | Some("") => url.clone(),
        Some(u) => valid_internal_url(u, &format!("providers.{id}.internal_url"))?,
    };
    let label = match p.label.as_deref().map(str::trim) {
        None | Some("") => id.to_string(),
        Some(l) if l.chars().count() <= 60 && !l.chars().any(char::is_control) => l.to_string(),
        Some(_) => {
            return Err(format!(
                "providers.{id}.label: up to 60 characters, no control characters"
            ));
        }
    };
    Ok(CustomProvider {
        id: id.to_string(),
        label,
        url,
        server_url,
        host,
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

/// Is the host of `rest` (what follows `http://`) this machine: `localhost`, `*.localhost`, `127.0.0.1` or `[::1]`, with or without a port or path?
/// The comparison is on the whole name: `localhost.example.com` is not local.
fn is_local_authority(rest: &str) -> bool {
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') {
        return false;
    }
    let host = if let Some(v6) = authority.strip_prefix('[') {
        v6.split(']')
            .next()
            .map(|h| format!("[{h}]"))
            .unwrap_or_default()
    } else {
        authority.split(':').next().unwrap_or("").to_string()
    };
    host == "localhost" || host.ends_with(".localhost") || host == "127.0.0.1" || host == "[::1]"
}

/// `https://...` (or `http://` only for a local address, for development).
fn valid_url(v: Option<&str>, field: &str) -> Result<Option<String>, String> {
    let Some(u) = v.map(str::trim).filter(|u| !u.is_empty()) else {
        return Ok(None);
    };
    let local = u.strip_prefix("http://").is_some_and(is_local_authority);
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

/// `internal_url`: where NeoLeaf reaches the server from its own side. Plain `http://` is allowed here, because this is the address of a
/// private network (for example `http://forgejo:3000` between two containers), which never reaches a browser.
fn valid_internal_url(u: &str, field: &str) -> Result<String, String> {
    let bad = || {
        format!(
            "{field}: an http:// or https:// address of the server, without spaces, user, query or #"
        )
    };
    let rest = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))
        .ok_or_else(bad)?;
    let host = rest.split('/').next().unwrap_or("");
    if u.len() > 2048
        || host.is_empty()
        || host.contains('@')
        || u.contains(['?', '#', '"', '\'', '<', '>', '\\'])
        || u.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(bad());
    }
    Ok(u.trim_end_matches('/').to_string())
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
        out.push(format!(
            "provider {}: {state}, {} administrator(s) listed",
            p.id(),
            cfg.provider_admins(p).len()
        ));
    }
    for c in &cfg.custom {
        let Some(p) = Provider::from_stored(&c.id) else {
            continue;
        };
        let on = cfg.provider_enabled(p);
        let keys = !p.client_id().is_empty() && !p.client_secret().is_empty();
        let state = match (on, keys) {
            (false, _) => "off",
            (true, true) => "on",
            (true, false) => "ON BUT THE CLIENT ID OR SECRET IS MISSING (it will not be shown)",
        };
        let internal = if c.server_url == c.url {
            String::new()
        } else {
            format!(", reached by NeoLeaf at {}", c.server_url)
        };
        out.push(format!(
            "provider {} ({} at {}{internal}): {state}, {} administrator(s) listed",
            c.id,
            c.label,
            c.url,
            cfg.provider_admins(p).len()
        ));
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
        assert!(err("[providers.gitlab]\nenabled = true").contains("kind: required"));
        assert!(
            err("[providers.gitlab]\nkind = \"gitlab\"\nurl = \"https://g.edu\"")
                .contains("gitlab is not supported yet")
        );
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
    fn your_own_git_server_is_read_and_checked() {
        let d = dir_with(&[]);
        let c = parse(
            r#"
            [providers.git-ifto]
            kind = "forgejo"
            url = "https://git.ifto.edu.br/"
            label = "Entrar com a conta do IFTO"
            enabled = true
            client_id = "abc"
            client_secret_env = "GIT_IFTO_SECRET"
            [providers.git-lab]
            kind = "gitea"
            url = "http://localhost:3000"
            "#,
            d.path(),
        )
        .unwrap();
        let a = c.custom_provider("git-ifto").unwrap();
        assert_eq!(a.url, "https://git.ifto.edu.br", "trailing slash removed");
        assert_eq!(a.host, "git.ifto.edu.br");
        assert_eq!(a.label, "Entrar com a conta do IFTO");
        let b = c.custom_provider("git-lab").unwrap();
        assert_eq!(
            (b.host.as_str(), b.label.as_str()),
            ("localhost", "git-lab")
        );
        let on = c.enabled_providers();
        assert_eq!(on.len(), 1, "only the one that is on");
        assert_eq!(on[0].id(), "git-ifto");
    }

    #[test]
    fn your_own_git_server_errors_are_clear() {
        let d = dir_with(&[]);
        let err = |t: &str| parse(t, d.path()).unwrap_err();
        let base = "kind = \"forgejo\"\nurl = \"https://g.edu\"\n";
        assert!(
            err("[providers.GitIfto]\nkind=\"forgejo\"\nurl=\"https://g.edu\"")
                .contains("lowercase letters")
        );
        assert!(err("[providers.git-x]\nurl = \"https://g.edu\"").contains("kind: required"));
        assert!(err("[providers.git-x]\nkind = \"forgejo\"").contains("url: required"));
        assert!(
            err("[providers.git-x]\nkind = \"forgejo\"\nurl = \"http://g.edu\"").contains("https")
        );
        assert!(
            err("[providers.git-x]\nkind = \"forgejo\"\nurl = \"https://u:p@g.edu\"")
                .contains("no user")
        );
        assert!(
            err("[providers.git-x]\nkind = \"forgejo\"\nurl = \"https://g.edu/?a=1\"")
                .contains("no user, query")
        );
        assert!(err(&format!("[providers.git-x]\n{base}label = \"a\\nb\"")).contains("label"));
        assert!(
            err("[providers.github]\nkind = \"forgejo\"").contains("only for your own Git server")
        );
        let many: String = (0..9)
            .map(|i| format!("[providers.git-{}]\n{base}\n", (b'a' + i) as char))
            .collect();
        assert!(err(&many).contains("at most 8"));
    }

    #[test]
    fn administrators_are_numeric_ids_per_provider() {
        let d = dir_with(&[]);
        let c = parse(
            r#"
            [providers.github]
            enabled = true
            admins = [12, "34", 12]
            [providers.git-x]
            kind = "forgejo"
            url = "https://g.edu"
            admins = ["77"]
            "#,
            d.path(),
        )
        .unwrap();
        assert_eq!(
            c.provider_admins(Provider::GitHub),
            &[12, 34],
            "numbers or text, no duplicates"
        );
        assert_eq!(
            c.provider_admins(Provider::from_stored("git-x").unwrap()),
            &[77]
        );
        assert!(c.provider_admins(Provider::Codeberg).is_empty());
        let err = |t: &str| parse(t, d.path()).unwrap_err();
        for bad in ["[\"ana\"]", "[\"a@b.c\"]", "[0]", "[\"\"]", "[-3]"] {
            let e = err(&format!("[providers.github]\nadmins = {bad}"));
            assert!(e.contains("admins") || e.contains("expected"), "{bad}: {e}");
        }
        assert!(err("[providers.github]\nadmins = [\"ana\"]").contains("numeric account ids"));
        let many = (1..=101)
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(",");
        assert!(err(&format!("[providers.github]\nadmins = [{many}]")).contains("at most 100"));
    }

    #[test]
    fn internal_url_is_what_neoleaf_reaches_and_url_is_what_people_use() {
        let d = dir_with(&[]);
        let c = parse(
            r#"
            [providers.git-x]
            kind = "forgejo"
            url = "https://git.uni.edu"
            internal_url = "http://forgejo:3000/"
            [providers.git-y]
            kind = "forgejo"
            url = "https://git2.uni.edu"
            "#,
            d.path(),
        )
        .unwrap();
        let x = c.custom_provider("git-x").unwrap();
        assert_eq!(
            (x.url.as_str(), x.server_url.as_str()),
            ("https://git.uni.edu", "http://forgejo:3000")
        );
        let y = c.custom_provider("git-y").unwrap();
        assert_eq!(y.server_url, y.url, "no internal_url: the same address");
        let err = |t: &str| {
            parse(
                &format!("[providers.git-x]\nkind=\"forgejo\"\nurl=\"https://g.edu\"\n{t}"),
                d.path(),
            )
            .unwrap_err()
        };
        for bad in [
            "internal_url = \"ftp://x\"",
            "internal_url = \"http://u:p@x\"",
            "internal_url = \"http://x/?a=1\"",
            "internal_url = \"http://x y\"",
            "internal_url = \"x:3000\"",
        ] {
            assert!(err(bad).contains("internal_url"), "{bad}");
        }
        assert!(
            parse("[providers.github]\ninternal_url = \"http://x\"", d.path())
                .unwrap_err()
                .contains("only for your own Git server")
        );
    }

    #[test]
    fn plain_http_is_only_for_this_machine() {
        let d = dir_with(&[]);
        let url = |u: &str| {
            parse(&format!("[legal]\nterms_url = \"{u}\""), d.path()).map(|c| c.legal.terms_url)
        };
        for ok in [
            "http://localhost",
            "http://localhost:8080/t",
            "http://git.localhost:8080",
            "http://127.0.0.1:3000",
            "http://[::1]:3000/x",
        ] {
            assert!(url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://localhost.example.com",
            "http://127.0.0.1.example.com",
            "http://example.com",
            "http://localhost@evil.com",
            "http://evil.com/localhost",
            "http://notlocalhost",
        ] {
            assert!(url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn text_colour_follows_the_accent_brightness() {
        assert_eq!(on_color("#ffffff"), "#111111");
        assert_eq!(on_color("#000000"), "#ffffff");
        assert_eq!(on_color("#1a7f37"), "#ffffff");
        assert_eq!(on_color("#f5c518"), "#111111");
    }
}
