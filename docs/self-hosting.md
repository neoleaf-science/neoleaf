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
`static/pyodide/` next to the executable:

```bash
mise run fonts bibtex biber xelatex lualatex     # TeX Live fonts, BibTeX, Biber, XeLaTeX, LuaLaTeX (needs Python 3)
python3 scripts/fetch_pyodide.py                 # optional: Python notebooks
mise run agent                                   # optional: the local agent binaries served at /download/agent (needs Docker and cargo-zigbuild)
```

## 4. Check
Open your address: the landing page appears, sign in with GitHub, create a project and compile. `/licenses` lists the third-party licenses.

## Notes
- Production details of neoleaf.science (Caddy, systemd, Cloudflare) are not part of this repository; any reverse proxy works.
- Keep `.env` and `sessions.json` private; never commit them.
- The GPL-licensed TeX engines are served as separate programs; their source is listed at `/licenses`.
