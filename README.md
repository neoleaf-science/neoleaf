# NeoLeaf 🍃

A modern, collaborative web platform for **LaTeX**, built in **Rust** with the **Topcoat** framework. NeoLeaf brings native versioning and storage through **GitHub**, **100% WebAssembly compilation in the browser** (or through the **Local Agent**), real-time collaboration (CRDT/Yjs) and zero server cost for compilation.

[![Rust 2024](https://img.shields.io/badge/Rust-2024_Edition-orange?logo=rust)](https://www.rust-lang.org/)
[![Topcoat](https://img.shields.io/badge/Framework-Topcoat-blue)](https://github.com/rust-lang)
[![WebAssembly](https://img.shields.io/badge/Compilation-WebAssembly-purple?logo=webassembly)](https://webassembly.org/)
[![GitHub](https://img.shields.io/badge/Sync-GitHub_API-black?logo=github)](https://github.com)
[![Status](https://img.shields.io/badge/Status-Beta-success)](https://neoleaf.science)

🌐 **Try the production version:** [neoleaf.science](https://neoleaf.science)

---

## 🌟 Main Features

### 🐙 Native Storage and Git via GitHub
- **Your data belongs to you:** every project is a Git repository hosted directly on your GitHub account, marked with the `neoleaf` topic.
- **Browser-First Git:** smart synchronization with `isomorphic-git` and `lightning-fs` in the browser, backed by the Rust server.
- **Full Git Integration:** automatic commits, push, manual pull with <kbd>Ctrl</kbd> + <kbd>S</kbd>, change status (uncommitted, ahead, behind), visual conflict resolution and line-by-line history (**Git Blame**) in the editor margin.
- **Invitations and Collaboration through GitHub:** accept or decline collaboration invitations to LaTeX projects directly from the NeoLeaf dashboard.

### ⚡ Flexible Compilation: WebAssembly, Local Agent or Server
1. **100% WebAssembly in the Browser (Default):**
   - **No TeX dependency on the server:** no need to install heavy distributions on the host.
   - **Zero infrastructure cost:** compilation happens entirely on the client machine, in an isolated sandbox.
   - **Modern Engines:**
     - **TeX Live WASM:** full support for **pdfLaTeX**, **XeLaTeX**, **LuaLaTeX** and **BibTeXu** (with ICU data for full Unicode support).
   - **Automatic Package and Font Download:** automatically detects missing packages (`.sty`, `.cls`) and font families from TeX Live / CTAN and downloads them on demand.
   - **Bidirectional SyncTeX in WASM:** quick navigation with a double click: click the code to jump to the page in the PDF, or click the PDF to go back to the exact line in the editor.
2. **💻 Local Companion Agent (`neoleaf-agent`):**
   - One-line install on Linux and macOS (on Windows: `irm https://neoleaf.science/install.ps1 | iex`): `curl -fsSL https://neoleaf.science/install.sh | sh` (checks the SHA-256, no sudo).
   - Optional Rust executable that lets you compile with the compilers installed on your own computer (TeX Live, TinyTeX, Tectonic).
   - Supports auto-install with `tlmgr`, a system tray icon and secure pairing through a local token.

> The server **does not compile and does not store projects**: the project lives only in the browser (local Git clone) and on your GitHub. The server handles authentication, relays Git and the GitHub API (stateless proxy), downloads packages from CTAN/TeX Live and relays live editing in memory.

### 👥 Real-Time Collaboration (Yjs + WebSockets)
- Simultaneous multi-user editing based on CRDTs (**Yjs** + **yrs** in Rust) over WebSockets.
- Colored cursors that identify users in real time, plus active presence in the document.

### ⌨️ Advanced Editor (Monaco Editor / VS Code)
- **Smart LaTeX Autocomplete:** hundreds of commands, math environments, Greek characters, bibliography citations (`\cite`), labels and cross-references (`\ref`).
- **Global Search and Replace:** find and replace terms across all project files with <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>.
- **Comments and Suggestions:** select any passage of the document to add comments, discussion threads and resolved marks.
- **Milestones and History:** create named project snapshots at any time, with quick restore.
- **Productive Shortcuts:**
  - <kbd>Ctrl</kbd> + <kbd>Enter</kbd> / <kbd>Cmd</kbd> + <kbd>Enter</kbd>: compile the document.
  - <kbd>Ctrl</kbd> + <kbd>S</kbd> / <kbd>Cmd</kbd> + <kbd>S</kbd>: sync (pull and push with GitHub).
  - <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>: global project search.

### 📦 Project and TeXMF Management
- **User blocking (admin):** in the `/admin` panel, the 🚫 Block button ends the person's sessions, prevents new logins and disconnects them from live editing. The "Blocked users" section shows the reason, who blocked and when, lets you block by login (for someone who has not signed in yet) and unblock. The block applies by GitHub id and is kept in `blocked.json` (variable `BLOCKLIST_FILE`).
- **Project trash:** the 🗑️ button in the list sends the project to the trash: the GitHub repository is renamed with the date and time of deletion at the end (`my-paper-deleted-20261009-031507`) and gets the `deleted` tag. The **Trash** view (side menu) lists the deleted projects, with the date, and the **Restore** button brings back the original name and removes the tag. Nothing is erased; only the repository owner can delete and restore.
- **Tag Manager:** add, filter and manage GitHub topics directly from the dashboard with the `+ tag` button.
- **Starter Templates:** Scientific Paper (Default), Technical Report and Slide Presentation (Beamer).
- **Import and Export:** import full projects from `.zip` files (read in the browser itself) and export the source code as `.zip` (the GitHub one when there is nothing to push, or built in the browser) or just the compiled `.bbl` file.
- **TeXMF Manager:** upload custom packages, classes and fonts (`.otf`, `.ttf`, `.sty`, `.cls`) with project or global scope.
- **Internationalization (i18n) and Themes:** 15 interface languages (English, Čeština, Español, Português, Français, Deutsch, Svenska, Türkçe, Italiano, 简体中文, Norsk, Русский, Dansk, 한국어, 日本語; the newest are machine translations, corrections are welcome) and Light / Dark modes.

---

## 🛠️ Development Prerequisites

- **Rust & Cargo** (v1.98+ or the 2024 edition):
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **Git** installed on the system.
- *(Optional)* **Python 3** (if you want to download and update the WebAssembly engine assets in `scripts/`).

---

## 🔑 GitHub OAuth 2.0 Setup

To connect and sync your repositories with GitHub:

1. Go to: **GitHub** > **Settings** > **Developer Settings** > **OAuth Apps** ([Open directly](https://github.com/settings/developers)).
2. Click **"New OAuth App"**.
3. Fill in the settings:
   - **Application name:** `NeoLeaf`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/auth/callback`
4. Generate a **Client Secret**.
5. Create a `.env` file in the project root (use [.env.example](.env.example) as a base):

```env
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
REDIRECT_URI=http://localhost:3000/auth/callback
PORT=3000
# Administrators, by numeric GitHub id (comma-separated; replace with your own).
# When set and not empty, only these ids are administrators and the login/e-mail rules (ADMIN_EMAILS) are ignored.
# ADMIN_GITHUB_IDS=123456,7890123
```

Without `ADMIN_GITHUB_IDS`, administrators are the logins or e-mails listed in `ADMIN_EMAILS` (which can change hands) and the server prints a warning at startup; with neither set, nobody is an administrator. Set `ADMIN_GITHUB_IDS` in production. Session cookies are `Secure` unless `REDIRECT_URI` explicitly starts with `http://localhost` or `http://127.0.0.1`.

> 💡 **Developing without a GitHub account:** run `mise run dev:fake`. It starts a local "fake GitHub" (API, login and Git protocol) and points NeoLeaf to it; click **"Start with GitHub"** and you sign in as the `demo` user, with a sample project. None of this exists in production, and NeoLeaf does not store projects on the server in any mode.

---

## 🚀 Running Locally

1. **Download dependencies and run the server:**
   ```bash
   cargo run
   ```

2. **Open it in the browser:**
   ```text
   http://localhost:3000
   ```

---

## 💻 Local Agent (`neoleaf-agent`)

The repository includes a companion agent in Rust located in the [`agent/`](agent/) folder:

```bash
cd agent
cargo build --release
```

It runs as a user daemon (`./neoleaf-agent install`), listening on `127.0.0.1:47474`, and connects the compilers installed on your machine to the web editor without sending your files to third-party compilation servers.

---

## 📁 Code Structure

```text
neoleaf/
├── Cargo.toml             # Rust project manifest and dependencies
├── mise.toml              # Development, test and quality tasks (deploy lives in the operations layer, one folder up)
├── .env.example           # Example environment variable configuration
├── agent/                 # Local companion daemon in Rust (neoleaf-agent)
│   ├── src/
│   └── README.md
├── scripts/               # Download and packaging scripts for WASM/TeXMF assets
│   ├── fetch_xelatex_assets.py
│   ├── fetch_lualatex_assets.py
│   ├── fetch_bibtex_assets.py
│   └── build_font_packs.py
├── src/
│   ├── main.rs            # Entry point: only builds the Topcoat router
│   ├── routes/            # HTTP handlers (pages, admin, auth, catalog, projects, Git proxy, lookups, static files)
│   ├── assets.rs          # List of the static files embedded in the binary
│   ├── admin.rs           # Metrics, administrative panel and telemetry
│   ├── collab.rs          # Yjs WebSocket server and collaboration CRDTs
│   ├── ctan.rs            # Stateless CTAN/TeX Live proxy: downloads packages and indexes file -> package
│   ├── deps.rs            # List of the files the browser compiler already ships with
│   ├── import.rs          # New project name (the rest of the import happens in the browser)
│   ├── session.rs         # User session management
│   ├── auth/              # GitHub OAuth 2.0 authentication
│   │   └── github.rs
│   ├── drive/             # GitHub API client (repos, topics, invitations, permissions)
│   │   └── client.rs
│   ├── templates/         # Starter templates (.tex) for new papers
│   └── views/             # SSR screens in Topcoat (reactive HTML)
│       ├── dashboard_page.rs  # Dashboard for projects, tags and invitations
│       ├── editor_page.rs     # Monaco editor interface, PDF and tools
│       ├── login_page.rs      # Login and presentation page (landing)
│       ├── admin_page.rs      # System metrics panel
│       └── agent_page.rs      # Local agent guide and download
└── static/
    ├── css/editor.css     # Complete styling of the editor and components
    ├── img/               # Logos and icons
    ├── js/                # Client scripts (Monaco, Yjs, SyncTeX, PDF.js, etc.)
    └── texlive/           # WebAssembly modules (TeX Live, bibtexu)
```

---

## 📜 License and Compliance

- **Code:** dual-licensed under the [Apache License 2.0](LICENSE-APACHE) or the [MIT License](LICENSE-MIT), at your option. Unless you state otherwise, any contribution you intentionally submit is dual-licensed the same way, with no additional terms.
- **Mascot and logos:** [CC BY-NC-ND 4.0](LICENSE-ART) (share with credit, non-commercial, no changes); the name and logo identify the official project, so forks must use another name and art. Details in [ART.md](ART.md). The owner's photo is all rights reserved.
- **Credit (a request):** if you host or distribute an interactive instance, please keep a visible "Powered by NeoLeaf" credit linking to <https://neoleaf.science> (see [NOTICE](NOTICE)). It is a request, not a license condition.
- **Citation:** see [CITATION.cff](CITATION.cff).
- **Third-party material:** see [LICENSES.md](LICENSES.md).
- **Privacy & LGPD:** NeoLeaf respects the privacy of your data and does not share the content of your papers with third parties.
- **Made with care** for the academic and scientific community.
