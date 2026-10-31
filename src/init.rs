//! `neoleaf init`: writes the files of an institution install (`neoleaf.toml`, `.env`, `docker-compose.yml`, `Caddyfile`, and for the
//! bundled Forgejo `setup-forgejo.sh`) into a folder, from a few answers (flags, or questions when run in a terminal).
//!
//! It only ever creates files: if any of them already exists nothing is written. The secrets are not asked for: `SESSION_KEY` is
//! generated here, and the OAuth keys of the Git server are filled in later (by `setup-forgejo.sh`, or by you in `.env`).

use base64::Engine;
use std::io::{BufRead, IsTerminal, Write};
use std::path::{Path, PathBuf};

const COMPOSE: &str = include_str!("../install/docker-compose.yml");
const SETUP_FORGEJO: &str = include_str!("../install/setup-forgejo.sh");

/// Where the bundled Forgejo is reached by NeoLeaf inside the compose network.
const FORGEJO_INTERNAL: &str = "http://forgejo:3000";

#[derive(Debug, PartialEq)]
enum Git {
    /// a Forgejo started by the same compose file
    Bundled,
    /// the institution's own Forgejo or Gitea
    External,
    /// only GitHub and/or Codeberg
    None,
}

#[derive(Debug, Default)]
struct Opts {
    dir: Option<String>,
    url: Option<String>,
    name: Option<String>,
    contact: Option<String>,
    git: Option<String>,
    git_url: Option<String>,
    git_kind: Option<String>,
    git_label: Option<String>,
    git_id: Option<String>,
    admins: Option<String>,
    terms_url: Option<String>,
    privacy_url: Option<String>,
    github: bool,
    codeberg: bool,
    help: bool,
}

const USAGE: &str = "neoleaf init: writes the files of an institution install into a folder.

Usage: neoleaf init [options]       (in a terminal, what you leave out is asked)

  --dir DIR            folder to write into (default: the current one)
  --url URL            the address people will use: https://latex.university.edu (http only for localhost, to try it)
  --name TEXT          name of the institution or service, shown on the sign-in screen (default: NeoLeaf)
  --contact EMAIL      contact e-mail shown on the sign-in screen
  --git WHICH          bundled (a Forgejo of its own, started by the same compose file),
                       external (your Forgejo or Gitea), or none (only GitHub and/or Codeberg)
  --git-url URL        external: the address of your Forgejo or Gitea. bundled: where people will reach it
                       (default: https://git.<your host>)
  --git-kind KIND      external: forgejo (default) or gitea
  --git-label TEXT     text of the sign-in button of your Git server (default: Sign in with your account)
  --git-id ID          short name of that provider (default: git)
  --admins IDS         numeric ids of the administrators, comma-separated (bundled: the first account is 1)
  --github, --codeberg also offer sign-in with GitHub or Codeberg (their keys go in .env)
  --terms-url URL      your Terms of Use page (the built-in one speaks for neoleaf.science, not for you)
  --privacy-url URL    your Privacy Policy page (same)

It never overwrites: if a file it would write already exists, it stops and writes nothing.
";

fn parse_args(args: &[String]) -> Result<Opts, String> {
    let mut o = Opts::default();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        let (key, inline) = match a.split_once('=') {
            Some((k, v)) if k.starts_with("--") => (k.to_string(), Some(v.to_string())),
            _ => (a.clone(), None),
        };
        let value = |i: &mut usize| -> Result<String, String> {
            if let Some(v) = &inline {
                return Ok(v.clone());
            }
            *i += 1;
            args.get(*i)
                .cloned()
                .ok_or_else(|| format!("{key} needs a value"))
        };
        match key.as_str() {
            "--help" | "-h" => o.help = true,
            "--github" => o.github = true,
            "--codeberg" => o.codeberg = true,
            "--dir" => o.dir = Some(value(&mut i)?),
            "--url" => o.url = Some(value(&mut i)?),
            "--name" => o.name = Some(value(&mut i)?),
            "--contact" => o.contact = Some(value(&mut i)?),
            "--git" => o.git = Some(value(&mut i)?),
            "--git-url" => o.git_url = Some(value(&mut i)?),
            "--git-kind" => o.git_kind = Some(value(&mut i)?),
            "--git-label" => o.git_label = Some(value(&mut i)?),
            "--git-id" => o.git_id = Some(value(&mut i)?),
            "--admins" => o.admins = Some(value(&mut i)?),
            "--terms-url" => o.terms_url = Some(value(&mut i)?),
            "--privacy-url" => o.privacy_url = Some(value(&mut i)?),
            other => return Err(format!("unknown option {other} (see --help)")),
        }
        i += 1;
    }
    Ok(o)
}

/// An address people type: scheme, host and optional port, nothing else.
#[derive(Debug, PartialEq)]
struct Origin {
    https: bool,
    host: String,
    port: Option<u16>,
}

impl Origin {
    fn parse(s: &str, what: &str) -> Result<Origin, String> {
        let s = s.trim().trim_end_matches('/');
        let (https, rest) = if let Some(r) = s.strip_prefix("https://") {
            (true, r)
        } else if let Some(r) = s.strip_prefix("http://") {
            (false, r)
        } else {
            return Err(format!(
                "{what}: start with https:// (for example https://latex.university.edu)"
            ));
        };
        let (host, port) = match rest.rsplit_once(':') {
            Some((h, p)) => (
                h,
                Some(
                    p.parse::<u16>()
                        .map_err(|_| format!("{what}: the port is not a number"))?,
                ),
            ),
            None => (rest, None),
        };
        let host_ok = !host.is_empty()
            && host.len() <= 253
            && host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            && !host.starts_with(['.', '-'])
            && !host.ends_with(['.', '-']);
        if !host_ok {
            return Err(format!(
                "{what}: only the address (no path, user or spaces), such as https://latex.university.edu"
            ));
        }
        let host = host.to_ascii_lowercase();
        let local = host == "localhost" || host == "127.0.0.1" || host.ends_with(".localhost");
        if !https && !local {
            return Err(format!(
                "{what}: http:// is only for localhost (to try it). For a real install use https:// (Caddy gets the certificate by itself)"
            ));
        }
        if https && port.is_some() {
            return Err(format!(
                "{what}: with https:// leave the port out (Caddy uses 443)"
            ));
        }
        Ok(Origin { https, host, port })
    }

    /// `https://host` or `http://host:port`: the address as people type it.
    fn public(&self) -> String {
        let scheme = if self.https { "https" } else { "http" };
        match self.port {
            Some(p) => format!("{scheme}://{}:{p}", self.host),
            None => format!("{scheme}://{}", self.host),
        }
    }

    /// What Caddy listens for: the host (and automatic HTTPS), or `http://host` on the container's port 80.
    fn caddy_site(&self) -> String {
        if self.https {
            self.host.clone()
        } else {
            format!("http://{}", self.host)
        }
    }
}

fn valid_email(s: &str) -> bool {
    let Some((u, h)) = s.split_once('@') else {
        return false;
    };
    !u.is_empty()
        && h.contains('.')
        && s.len() <= 254
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'@' | b'.' | b'-' | b'_' | b'+'))
}

/// A TOML string, quoted and escaped.
fn q(s: &str) -> String {
    toml::Value::String(s.to_string()).to_string()
}

fn ask(prompt: &str, default: Option<&str>) -> Result<String, String> {
    let mut out = std::io::stderr();
    match default {
        Some(d) => write!(out, "{prompt} [{d}]: "),
        None => write!(out, "{prompt}: "),
    }
    .and_then(|_| out.flush())
    .map_err(|e| e.to_string())?;
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    let v = line.trim();
    Ok(if v.is_empty() {
        default.unwrap_or("").to_string()
    } else {
        v.to_string()
    })
}

/// Everything the files are made from, already checked.
#[derive(Debug)]
struct Plan {
    site: Origin,
    name: String,
    contact: Option<String>,
    git: Git,
    git_origin: Option<Origin>,
    git_kind: String,
    git_label: String,
    git_id: String,
    admins: Vec<u64>,
    github: bool,
    codeberg: bool,
    terms_url: Option<String>,
    privacy_url: Option<String>,
}

fn https_url(s: &Option<String>, what: &str) -> Result<Option<String>, String> {
    match s.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        None => Ok(None),
        Some(u)
            if u.starts_with("https://")
                && !u.contains(char::is_whitespace)
                && !u.contains(['"', '\\', '<', '>']) =>
        {
            Ok(Some(u.to_string()))
        }
        Some(_) => Err(format!("{what}: an https:// address without spaces")),
    }
}

fn plan(o: &Opts, interactive: bool) -> Result<Plan, String> {
    let need = |v: &Option<String>,
                flag: &str,
                prompt: &str,
                default: Option<&str>|
     -> Result<String, String> {
        match v {
            Some(v) => Ok(v.clone()),
            None if interactive => ask(prompt, default),
            None => default
                .map(str::to_string)
                .ok_or_else(|| format!("{flag} is required (or run in a terminal to be asked)")),
        }
    };
    let url = need(
        &o.url,
        "--url",
        "Address people will use (https://latex.university.edu)",
        None,
    )?;
    let site = Origin::parse(&url, "--url")?;
    let name = need(
        &o.name,
        "--name",
        "Name of the institution or service",
        Some("NeoLeaf"),
    )?;
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("--name: 1 to 80 characters, no control characters".into());
    }
    let contact = match o.contact.clone().or_else(|| {
        if interactive && o.contact.is_none() {
            ask("Contact e-mail (optional)", Some("")).ok()
        } else {
            None
        }
    }) {
        Some(c) if !c.trim().is_empty() => {
            if !valid_email(c.trim()) {
                return Err("--contact: not a valid e-mail address".into());
            }
            Some(c.trim().to_string())
        }
        _ => None,
    };
    let which = need(
        &o.git,
        "--git",
        "Git server: bundled (a Forgejo of its own), external (yours), or none (only GitHub/Codeberg)",
        Some("bundled"),
    )?;
    let git = match which.trim() {
        "bundled" => Git::Bundled,
        "external" => Git::External,
        "none" => Git::None,
        _ => return Err("--git: bundled, external or none".into()),
    };
    let git_id = o.git_id.clone().unwrap_or_else(|| "git".to_string());
    if git != Git::None && !crate::provider::valid_custom_id(&git_id) {
        return Err("--git-id: lowercase letters, digits and hyphen, starting with a letter (not github or codeberg)".into());
    }
    let git_origin = match git {
        Git::Bundled => Some(match &o.git_url {
            Some(u) => Origin::parse(u, "--git-url")?,
            None => {
                let host = if site.host == "localhost" || site.host == "127.0.0.1" {
                    "git.localhost".to_string()
                } else {
                    format!("git.{}", site.host)
                };
                Origin {
                    https: site.https,
                    host,
                    port: site.port,
                }
            }
        }),
        Git::External => {
            let u = need(
                &o.git_url,
                "--git-url",
                "Address of your Forgejo or Gitea (https://git.university.edu)",
                None,
            )?;
            Some(Origin::parse(&u, "--git-url")?)
        }
        Git::None => None,
    };
    let git_kind = o.git_kind.clone().unwrap_or_else(|| "forgejo".to_string());
    if !matches!(git_kind.as_str(), "forgejo" | "gitea") {
        return Err("--git-kind: forgejo or gitea".into());
    }
    let git_label = o
        .git_label
        .clone()
        .unwrap_or_else(|| "Sign in with your account".to_string());
    if git_label.chars().count() > 60 || git_label.chars().any(char::is_control) {
        return Err("--git-label: up to 60 characters".into());
    }
    let mut admins = Vec::new();
    for part in o
        .admins
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        match part.parse::<u64>() {
            Ok(n) if n > 0 => admins.push(n),
            _ => return Err("--admins: numeric account ids, comma-separated (a login or e-mail can change hands)".into()),
        }
    }
    if git == Git::Bundled && admins.is_empty() {
        admins.push(1); // the first account of a new Forgejo, which setup-forgejo.sh creates
    }
    if git == Git::None && !o.github && !o.codeberg {
        return Err("--git none needs --github and/or --codeberg, or nobody could sign in".into());
    }
    Ok(Plan {
        site,
        name,
        contact,
        git,
        git_origin,
        git_kind,
        git_label,
        git_id,
        admins,
        github: o.github,
        codeberg: o.codeberg,
        terms_url: https_url(&o.terms_url, "--terms-url")?,
        privacy_url: https_url(&o.privacy_url, "--privacy-url")?,
    })
}

fn render_toml(p: &Plan) -> String {
    let mut s = String::from(
        "# Written by `neoleaf init`. Check it with: neoleaf --check-config\n# The OAuth client ids and secrets are read from .env (they never go in this file).\n\n",
    );
    s.push_str(&format!("[brand]\nname = {}\n", q(&p.name)));
    if let Some(c) = &p.contact {
        s.push_str(&format!("contact_email = {}\n", q(c)));
    }
    s.push_str("\n[legal]\n");
    match &p.terms_url {
        Some(u) => s.push_str(&format!("terms_url = {}\n", q(u))),
        None => s.push_str("# terms_url = \"https://your.institution/terms\"   # the built-in page speaks for neoleaf.science, not for you\n"),
    }
    match &p.privacy_url {
        Some(u) => s.push_str(&format!("privacy_url = {}\n", q(u))),
        None => s.push_str("# privacy_url = \"https://your.institution/privacy\"\n"),
    }
    if p.github {
        s.push_str("\n[providers.github]\nenabled = true\n# keys: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env\n");
    }
    if p.codeberg {
        s.push_str("\n[providers.codeberg]\nenabled = true\n# keys: CODEBERG_CLIENT_ID and CODEBERG_CLIENT_SECRET in .env\n");
    }
    if let Some(g) = &p.git_origin {
        s.push_str(&format!(
            "\n[providers.{}]\nenabled = true\nkind = {}\nurl = {}\n",
            p.git_id,
            q(&p.git_kind),
            q(&g.public())
        ));
        if p.git == Git::Bundled {
            s.push_str(&format!("internal_url = {}\n", q(FORGEJO_INTERNAL)));
        }
        s.push_str(&format!("label = {}\n", q(&p.git_label)));
        if !p.admins.is_empty() {
            let ids: Vec<String> = p.admins.iter().map(u64::to_string).collect();
            s.push_str(&format!("admins = [{}]\n", ids.join(", ")));
        }
        s.push_str(
            "client_id_env = \"GIT_CLIENT_ID\"\nclient_secret_env = \"GIT_CLIENT_SECRET\"\n",
        );
    }
    s
}

fn render_env(p: &Plan, session_key: &str) -> String {
    let mut s = String::from(
        "# Written by `neoleaf init`. Keep this file private (it holds the key that encrypts the sessions).\n",
    );
    s.push_str(&format!("NEOLEAF_PUBLIC_URL={}\n", p.site.public()));
    s.push_str(&format!("REDIRECT_URI={}/auth/callback\n", p.site.public()));
    s.push_str(&format!("SESSION_KEY={session_key}\n"));
    if let Some(port) = p.site.port {
        s.push_str(&format!(
            "{}={port}\n",
            if p.site.https {
                "HTTPS_PORT"
            } else {
                "HTTP_PORT"
            }
        ));
    }
    if p.github {
        s.push_str("GITHUB_CLIENT_ID=\nGITHUB_CLIENT_SECRET=\n");
    }
    if p.codeberg {
        s.push_str("CODEBERG_CLIENT_ID=\nCODEBERG_CLIENT_SECRET=\n");
    }
    if let Some(g) = &p.git_origin {
        s.push_str(&format!(
            "GIT_PROVIDER_ID={}\nGIT_CLIENT_ID=\nGIT_CLIENT_SECRET=\n",
            p.git_id
        ));
        if p.git == Git::Bundled {
            s.push_str(&format!(
                "COMPOSE_PROFILES=forgejo\nFORGE_PUBLIC_URL={}\nFORGE_DOMAIN={}\nFORGE_ADMIN_USER=forgeadmin\n",
                g.public(),
                g.host
            ));
        }
    }
    s
}

fn render_caddyfile(p: &Plan) -> String {
    const HEADERS: &str = "\theader {\n\t\tX-Content-Type-Options \"nosniff\"\n\t\tReferrer-Policy \"strict-origin-when-cross-origin\"\n\t\tContent-Security-Policy \"frame-ancestors 'self'\"\n\t}\n";
    let mut s = format!(
        "{} {{\n{HEADERS}\treverse_proxy neoleaf:3000\n}}\n",
        p.site.caddy_site()
    );
    if p.git == Git::Bundled
        && let Some(g) = &p.git_origin
    {
        s.push_str(&format!(
            "\n{} {{\n{HEADERS}\treverse_proxy forgejo:3000\n}}\n",
            g.caddy_site()
        ));
    }
    s
}

/// The files to write, as (name, text, executable, private).
fn files(p: &Plan, session_key: &str) -> Vec<(&'static str, String, bool, bool)> {
    let mut v = vec![
        ("neoleaf.toml", render_toml(p), false, false),
        (".env", render_env(p, session_key), false, true),
        ("docker-compose.yml", COMPOSE.to_string(), false, false),
        ("Caddyfile", render_caddyfile(p), false, false),
    ];
    if p.git == Git::Bundled {
        v.push(("setup-forgejo.sh", SETUP_FORGEJO.to_string(), true, false));
    }
    v
}

fn write_file(path: &Path, text: &str, executable: bool, private: bool) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    let mode = if private {
        0o600
    } else if executable {
        0o755
    } else {
        0o644
    };
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true) // never overwrites, even if the file appeared since the check
        .mode(mode)
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    f.write_all(text.as_bytes())
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Entry point. Returns the process exit code.
pub fn run(args: &[String]) -> i32 {
    let o = match parse_args(args) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("neoleaf init: {e}");
            return 2;
        }
    };
    if o.help {
        print!("{USAGE}");
        return 0;
    }
    let interactive = std::io::stdin().is_terminal();
    let p = match plan(&o, interactive) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("neoleaf init: {e}");
            return 2;
        }
    };
    let dir = PathBuf::from(o.dir.as_deref().unwrap_or("."));
    let key = base64::engine::general_purpose::STANDARD.encode(rand::random::<[u8; 32]>());
    let list = files(&p, &key);
    // everything is checked before anything is written: the generated file must be one `neoleaf` itself accepts
    if let Err(e) = crate::config::parse(&render_toml(&p), &dir) {
        eprintln!(
            "neoleaf init: the generated neoleaf.toml is not valid ({e}). This is a bug; nothing was written."
        );
        return 1;
    }
    let existing: Vec<&str> = list
        .iter()
        .map(|f| f.0)
        .filter(|n| dir.join(n).exists())
        .collect();
    if !existing.is_empty() {
        eprintln!(
            "neoleaf init: {} already exist(s) in {}: {}. Nothing was written. Move them away or choose another --dir.",
            existing.len(),
            dir.display(),
            existing.join(", ")
        );
        return 1;
    }
    if let Err(e) =
        std::fs::create_dir_all(&dir).and_then(|_| std::fs::create_dir_all(dir.join("brand")))
    {
        eprintln!("neoleaf init: {}: {e}", dir.display());
        return 1;
    }
    for (name, text, exec, private) in &list {
        if let Err(e) = write_file(&dir.join(name), text, *exec, *private) {
            eprintln!("neoleaf init: {e}");
            return 1;
        }
    }
    print_next_steps(&p, &dir);
    0
}

fn print_next_steps(p: &Plan, dir: &Path) {
    println!(
        "Wrote neoleaf.toml, .env, docker-compose.yml and Caddyfile in {}.",
        dir.display()
    );
    println!();
    println!("Next:");
    match p.git {
        Git::Bundled => {
            println!(
                "  1. Point the names {} and {} at this server (DNS).",
                p.site.host,
                p.git_origin.as_ref().map(|g| g.host.as_str()).unwrap_or("")
            );
            println!(
                "  2. Build the image from the unpacked release folder:  docker build -f install/Dockerfile -t neoleaf:local ."
            );
            println!(
                "  3. In this folder run:  ./setup-forgejo.sh   (starts everything, creates the Forgejo administrator and the OAuth application)"
            );
        }
        Git::External => {
            println!("  1. Point {} at this server (DNS).", p.site.host);
            println!(
                "  2. On your Git server create an OAuth2 application with the redirect address:"
            );
            println!("       {}/auth/callback/{}", p.site.public(), p.git_id);
            println!(
                "     and put its keys in .env (GIT_CLIENT_ID and GIT_CLIENT_SECRET). Add the numeric ids of the administrators to neoleaf.toml (admins = [...])."
            );
            println!(
                "  3. Build the image from the unpacked release folder:  docker build -f install/Dockerfile -t neoleaf:local ."
            );
            println!("  4. In this folder run:  docker compose up -d");
        }
        Git::None => {
            println!("  1. Point {} at this server (DNS).", p.site.host);
            println!(
                "  2. Put the OAuth keys of GitHub/Codeberg in .env (redirect address: {}/auth/callback, and {}/auth/callback/codeberg).",
                p.site.public(),
                p.site.public()
            );
            println!(
                "  3. Build the image from the unpacked release folder:  docker build -f install/Dockerfile -t neoleaf:local ."
            );
            println!("  4. In this folder run:  docker compose up -d");
        }
    }
    println!();
    println!(
        "Check the configuration at any time with:  docker compose run --rm neoleaf ./neoleaf --check-config"
    );
    if p.terms_url.is_none() || p.privacy_url.is_none() {
        println!();
        println!(
            "Notice: set terms_url and privacy_url in neoleaf.toml. Without them /terms and /privacy show the NeoLeaf site's own texts, which are not yours."
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(s: &str) -> Vec<String> {
        s.split_whitespace().map(str::to_string).collect()
    }

    fn opts(s: &str) -> Opts {
        parse_args(&args(s)).unwrap()
    }

    #[test]
    fn addresses_are_checked() {
        assert_eq!(
            Origin::parse("https://Latex.Uni.edu/", "u")
                .unwrap()
                .public(),
            "https://latex.uni.edu"
        );
        assert_eq!(
            Origin::parse("http://localhost:8080", "u")
                .unwrap()
                .public(),
            "http://localhost:8080"
        );
        for bad in [
            "latex.uni.edu",
            "ftp://x.edu",
            "http://latex.uni.edu",
            "https://x.edu:8443",
            "https://a b.edu",
            "https://u:p@x.edu",
            "https://x.edu/path",
            "https://",
            "http://localhost:abc",
        ] {
            assert!(Origin::parse(bad, "u").is_err(), "{bad}");
        }
        assert_eq!(
            Origin::parse("https://x.edu", "u").unwrap().caddy_site(),
            "x.edu"
        );
        assert_eq!(
            Origin::parse("http://localhost:8080", "u")
                .unwrap()
                .caddy_site(),
            "http://localhost"
        );
    }

    #[test]
    fn bundled_forgejo_install_is_complete_and_accepted_by_neoleaf() {
        let p = plan(&opts("--url https://latex.uni.edu --name IFTO --contact a@uni.edu --git bundled --terms-url https://uni.edu/t --privacy-url https://uni.edu/p"), false).unwrap();
        let toml = render_toml(&p);
        let c = crate::config::parse(&toml, Path::new(".")).unwrap();
        let g = c.custom_provider("git").unwrap();
        assert_eq!(
            (g.url.as_str(), g.server_url.as_str()),
            ("https://git.latex.uni.edu", "http://forgejo:3000")
        );
        assert_eq!(c.legal.terms_url.as_deref(), Some("https://uni.edu/t"));
        let env = render_env(&p, "KEY");
        assert!(env.contains("REDIRECT_URI=https://latex.uni.edu/auth/callback\n"));
        assert!(env.contains("COMPOSE_PROFILES=forgejo\n") && env.contains("SESSION_KEY=KEY\n"));
        let caddy = render_caddyfile(&p);
        assert!(
            caddy.contains("latex.uni.edu {")
                && caddy.contains("git.latex.uni.edu {")
                && caddy.contains("reverse_proxy forgejo:3000")
        );
        assert!(
            files(&p, "K")
                .iter()
                .any(|f| f.0 == "setup-forgejo.sh" && f.2)
        );
    }

    #[test]
    fn local_trial_uses_http_and_the_port() {
        let p = plan(&opts("--url http://localhost:8080 --git bundled"), false).unwrap();
        assert_eq!(
            p.git_origin.as_ref().unwrap().public(),
            "http://git.localhost:8080"
        );
        let env = render_env(&p, "K");
        assert!(
            env.contains("HTTP_PORT=8080\n")
                && env.contains("NEOLEAF_PUBLIC_URL=http://localhost:8080\n")
        );
        assert!(render_caddyfile(&p).contains("http://localhost {"));
    }

    #[test]
    fn external_server_and_provider_choices_are_checked() {
        let p = plan(&opts("--url https://l.uni.edu --git external --git-url https://git.uni.edu --git-kind gitea --admins 12,34 --github"), false).unwrap();
        let toml = render_toml(&p);
        assert!(
            toml.contains("kind = \"gitea\"")
                && toml.contains("admins = [12, 34]")
                && toml.contains("[providers.github]")
        );
        assert!(!toml.contains("internal_url"));
        crate::config::parse(&toml, Path::new(".")).unwrap();
        let e = |s: &str| plan(&opts(s), false).unwrap_err();
        assert!(e("--git none --url https://l.uni.edu").contains("--github"));
        assert!(e("--url https://l.uni.edu --git external").contains("--git-url"));
        assert!(e("--url https://l.uni.edu --git bundled --git-id github").contains("--git-id"));
        assert!(e("--url https://l.uni.edu --git bundled --admins ana").contains("--admins"));
        assert!(
            e("--url https://l.uni.edu --git bundled --git-kind gitlab").contains("--git-kind")
        );
        assert!(e("--url https://l.uni.edu --git other").contains("--git"));
        assert!(e("--git bundled").contains("--url"));
    }

    #[test]
    fn names_with_quotes_stay_one_toml_string() {
        let p = plan(&opts("--url https://l.uni.edu --git none --github"), false).unwrap();
        let mut p = p;
        p.name = "A \"quoted\" \\ name".to_string();
        let c = crate::config::parse(&render_toml(&p), Path::new(".")).unwrap();
        assert_eq!(c.brand.name, "A \"quoted\" \\ name");
    }

    #[test]
    fn nothing_is_overwritten_and_secrets_are_private() {
        let d = tempfile::tempdir().unwrap();
        let a = |extra: &str| {
            args(&format!(
                "--dir {} --url https://l.uni.edu --git none --github{extra}",
                d.path().display()
            ))
        };
        assert_eq!(run(&a("")), 0);
        let mode = std::fs::metadata(d.path().join(".env")).unwrap();
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(mode.permissions().mode() & 0o777, 0o600);
        let key = std::fs::read_to_string(d.path().join(".env")).unwrap();
        assert!(
            key.lines()
                .any(|l| l.starts_with("SESSION_KEY=") && l.len() > 40)
        );
        // a second run stops and changes nothing
        let before = std::fs::read_to_string(d.path().join("neoleaf.toml")).unwrap();
        assert_eq!(run(&a(" --name Other")), 1);
        assert_eq!(
            std::fs::read_to_string(d.path().join("neoleaf.toml")).unwrap(),
            before
        );
        assert!(d.path().join("brand").is_dir());
    }
}
