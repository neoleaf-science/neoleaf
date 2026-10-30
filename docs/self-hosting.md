# Running your own NeoLeaf

NeoLeaf is one executable plus a few folders. It stores **no projects**: files live in each person's browser and in their GitHub or Codeberg
repositories. The server keeps only sessions (optionally encrypted on disk), an optional blocklist and the template catalog.
Only the Linux x86_64 build is published, and it has been tested on Ubuntu 24.04 behind Caddy.

## 1. Get the files
Download `neoleaf-server-<version>-linux-x86_64.tar.gz` and `SHA256SUMS` from the [releases](https://github.com/neoleaf-science/neoleaf/releases)
and check them (`sha256sum -c SHA256SUMS`, or `gh attestation verify <file> --repo neoleaf-science/neoleaf`). The archive holds the executable
(`neoleaf`), `.env.example`, `site/` (the landing page), `static/texlive/` (the pdfTeX engine and its base package) and the license files.

## 2. Create a GitHub OAuth App
GitHub, Settings, Developer settings, OAuth Apps, New OAuth App. Homepage: your address. Callback: `https://your.domain/auth/callback`.
Copy `.env.example` to `.env` and fill in `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `REDIRECT_URI`. Codeberg is optional (see the file).

Also set:
- `SESSION_KEY`: 32 random bytes in base64 (`openssl rand -base64 32`) so sessions are encrypted on disk.
- `ADMIN_GITHUB_IDS`: numeric GitHub ids of the administrators (nobody can open `/admin` without it or `ADMIN_EMAILS`).

## 3. Run it
Run the executable **from the unpacked folder** (it reads `.env`, `site/` and `static/` relative to the current directory):

```bash
./neoleaf
```

Put it behind an HTTPS reverse proxy (Caddy or nginx). The pdfTeX engine works as soon as it starts. For the other engines and fonts, fetch the
generated files from a clone of the repository at the same tag (they are large and not in the archive), then copy `static/texlive/` and
`static/pyodide/` and `static/typst/` next to the executable:

```bash
mise run fonts bibtex biber xelatex lualatex     # TeX Live fonts, BibTeX, Biber, XeLaTeX, LuaLaTeX (needs Python 3)
python3 scripts/fetch_pyodide.py                 # optional: Python notebooks
mise run typst                                   # optional: Typst projects (compiler and fonts into static/typst/, needs Python 3)
mise run agent                                   # optional: the local agent binaries served at /download/agent (needs Docker and cargo-zigbuild)
```

## 4. Check
Open your address: the landing page appears, sign in with GitHub, create a project and compile. `/licenses` lists the third-party licenses.

## Notes
- Production details of neoleaf.science (Caddy, systemd, Cloudflare) are not part of this repository; any reverse proxy works.
- Keep `.env` and `sessions.json` private; never commit them.
- The GPL-licensed TeX engines are served as separate programs; their source is listed at `/licenses`.
- The spell check dictionaries are not part of the archive or of the server: each person's browser downloads the one it needs from GitHub (pinned commit, SHA-256 checked, with a jsDelivr mirror) and keeps it on the device. Your server needs nothing for it.

## 5. For an institution: your name, logo and sign-in providers (optional)
Copy `neoleaf.example.toml` to `neoleaf.toml` next to the executable. With that file the page that people see before signing in is a plain
sign-in screen with your logo and name (accent colour and contact e-mail optional), and only the providers you switch on (`github`, `codeberg`)
show a button. Without the file the server behaves exactly as described above.

- `[legal]`: the built-in Terms and Privacy pages speak for neoleaf.science. Set `terms_url` and `privacy_url` to your institution's own pages and
  `/terms` and `/privacy` redirect there.
- The logo is a file inside the folder of `neoleaf.toml` (PNG, JPEG, GIF, WebP or SVG, up to 512 KiB). It is read at startup.
- The client secret never goes in the file: `client_secret_env` names the environment variable that holds it.
- `./neoleaf --check-config` validates the file and prints what it means, without starting the server. An invalid file stops the server on start.
- **Your own Git server (Forgejo or Gitea)** as a provider: add a `[providers.<id>]` block with `kind` (`forgejo` or `gitea`), `url`, `label` (the whole text of the
  sign-in button), `client_id` and `client_secret_env`. On the server, create an OAuth2 application whose redirect address is
  `https://your.domain/auth/callback/<id>`. People sign in with that server's account (so whatever login the server already uses, such as CAFe, Google or LDAP,
  applies), their projects are repositories there, and their local copies in the browser are kept apart from other providers (`<id>.<owner>`). Up to 8 servers;
  GitHub and Codeberg can stay on at the same time. A server that is taken out of the file stops working but its sessions and blocks are kept for when it comes back.
- **Administrators** (`/admin`): `admins = [12, 34]` in a provider's block lists the **numeric ids** of the accounts that administer NeoLeaf when they sign in with
  that provider (a login or an e-mail can change hands, an id cannot; the id is `id` in the server's `/api/v1/user`, or in `https://api.github.com/users/<login>`).
  When a provider has a list, only those ids count for it; without a list, GitHub keeps the old rule (`ADMIN_GITHUB_IDS`, then `ADMIN_EMAILS`) and every other provider has no
  administrator. Administrators who signed in with your own server or Codeberg see the Overview and Users tabs; the template catalog lives in GitHub repositories, so its tab is for GitHub administrators.
- Not covered yet: GitLab, and the name and logo outside the sign-in screen.
