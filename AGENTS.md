# NeoLeaf: guide for LLMs and people who touch the code

Read this whole file before changing anything. It applies to any code assistant (Claude, Codex,
Gemini, Copilot, Cursor etc.). If something here conflicts with what you think is better, **ask the project owner first**.

NeoLeaf is a collaborative LaTeX editor (Rust 2024 + Topcoat on the server, plain JavaScript in the browser). Projects are
each person's GitHub repositories. Compilation runs in the browser (WebAssembly) or in the local agent.

---

## 1. Rule number one: the person's project is NOT on the server

The content of a project (`.tex` files, `.bib` files, images, comments, history, milestones, PDFs) exists **only**:

1. in the person's **browser** (IndexedDB, via `isomorphic-git` + `lightning-fs`, the `BrowserGit` object), and
2. on the person's **GitHub** (the only durability guarantee).

The server **never** stores, caches or logs the content of a project. Not on disk, not in a cache, not in a
temporary file that outlives the request.

What the server may store:

| Data | Where | Note |
|---|---|---|
| GitHub OAuth token and basic session profile | `sessions.json` | Encrypted (AES-256-GCM, key in `SESSION_KEY`; without the key nothing is written to disk). The only user data allowed. Never in a log, never in an error response, never on the client beyond what is needed. |
| Blocked list (admin) | `blocked.json` | **Exception decided by the owner (2026-10):** operational data, with nothing from a project. It stores only the GitHub id and login, name, avatar, reason, date and who blocked. Without it the block would vanish on restart. Do not add other fields. |
| Project template catalog (admin) | `templates.json` | **Exception decided by the owner (2026-10):** metadata only (name, description, category, institution, language, license, GitHub origin link, pinned version, folder, main file, engine, preview, order, who changed it and when). **The template files never stay on the server:** the browser downloads the origin through the `/api/templates/{id}/zip` proxy (only repositories registered by the admin). No user data at all. |
| Cache of TeX Live 2023 packages (`tlcache/`, `TL_CACHE_DIR`) | disk | **Exception decided by the owner (2026-10):** stores only the public `<package>.tar.xz` files of the frozen TeX Live 2023, checked against the SHA-512 of the official index and capped by `TL_CACHE_MAX_MB` (default 3072). They are public files, **with no user or project data at all**; they exist so as not to depend on the mirrors on every request. Outside what the deploy replaces. It also keeps in `tlcache/` the **index** of the TeX Live files (`index-*.idx`, ~35 MB, built once from the official `texlive.tlpdb` and queried by binary search, so it does not occupy RAM). The admin panel shows packages, size and date of the last one. |
| Text of the live editing rooms in memory | RAM | Gone when the last participant leaves. Never on disk. |
| Static files (WASM, TeX Live bundles, fonts, agent) | `static/` | Not user data. |

Any other persistent data on the server requires an **explicit decision by the project owner**. The person's preferences
(theme, language) stay in the browser's `localStorage`.

### Quick test before any change

> Does this change make the server read, write, store or log project content?

If yes, **stop and ask**. The answer is almost always to do it in the browser and, if you need the network, use a proxy (section 4).

---

## 2. Architecture

```text
Browser                                     Server (Rust)                       GitHub
───────                                     ─────────────                       ──────
Monaco (editor)                             SSR pages (just the "shell")
BrowserGit (clone, commit, push, pull) ───► Git proxy (/api/git/owner/repo/...) ──► git smart HTTP
Whole project: IndexedDB                    GitHub API proxy                ───► REST (repos, topics, invitations)
WASM compilation (pdfLaTeX, XeLaTeX,        OAuth + session (token on server)
  LuaLaTeX, BibTeXu) or local agent         live editing relay (WebSocket, RAM)
Comments/history/milestones: .neoleaf/      package proxy (CTAN/TeX Live)
Preferences: localStorage                   static files (WASM, bundles, fonts)
                                            admin (metrics without content)
```

### Role of each side

**Browser (where the project lives)**
- **The larger scripts are split by subject** (classic scripts, each part right after its core file in the load list): `browser-git.js` + `browser-git-sync.js` (status, commit, push, pull) + `browser-git-compare.js` (compare, blame, reset, merge helpers); `project-store.js` + `project-store-texmf.js` + `project-store-build.js`; `git-review.js` + `git-review-modals.js` + `git-review-open.js`; `file-tree.js` + `file-tree-dnd.js` + `file-tree-menu.js` + `file-tree-ops.js`. The public objects (`BrowserGit`, `Project`, `GitReview`, `FT`) keep the same members; the later parts add theirs with `Object.assign` and share the private state of the core through `window.__BG`, `__PS`, `__GR`, `__FT`. The names that the scripts share are listed in `docs/js-globals.md` (generated by `python3 scripts/js_globals.py`; run it after changing the scripts).
- `static/js/browser-git.js`: `BrowserGit` (clone, status, commit, push, pull, reset, compare, file reading and writing).
- `static/js/git-review.js`: pull, push and reset modals, line diff, automatic pull on open.
- `static/js/project-store.js`: the **`Project`** object, with the project data in the browser (no network): `Project.config`,
  `comments`, `history`, `milestones`, `pdf`, `texmf`, plus `Project.texts()`, `build()`, `fileBytes()` and `exportZip()`.
  Everything lives in `.neoleaf/` of the local clone; the functions throw `Error` with a human-readable message. **New project data
  goes here**, never in a server route.
- `static/js/mascot.js`: the optional **NeoLeaf mascot** (off by default, silent, editor only). The preference is `localStorage` `ld-mascot` (`'1'` = on), switched by the checkbox `#upm-mascot` of the user modal (`src/views/profile_modal.rs`), which fires `ld-mascot-change`. The animation library is vendored (`static/vendor/neoleaf-mascot.mjs`, `neoleaf-mascot-agent.mjs`, sprite `static/img/neoleaf-mascot.png`; MIT library, see `LICENSES.md` 4h) and loaded with a dynamic `import()` only when the mascot is on. It reacts to the `ld-compile` events that `pdf-panel.js` dispatches (`phase: 'start'` or `'done'`) and respects `prefers-reduced-motion`. Its words go through `T()`.
- `static/js/storage-manager.js`: the **Storage tab** of the user modal (`src/views/profile_modal.rs`, on every page that has the modal): usage bar from `navigator.storage.estimate()`, a button that clears the Cache API (the compiler bundles), and the list of projects kept in this browser (`/repos/<owner>/<repo>` of the `neoleaf-git` LightningFS, sizes counted file by file) with a Remove button per copy. Removing asks first, warns when the copy has changes that are not on GitHub (checked offline with `statusMatrix` and the last known `origin` ref), never removes the project open in the editor, and calls `flush()` so a half-written removal cannot be left behind. It reuses BrowserGit's file system in the editor and opens its own LightningFS elsewhere. Nothing goes to the server.
  **Several people can use one browser:** `BrowserGit.init` records which account opened each copy (`/meta/<dir>.json` inside the same LightningFS; for older copies the owner of the repository counts), the modal carries the signed-in account (`data-account-login`, `data-account-provider`), and the list shows only that account's copies; the others are only counted, never named. **"Delete all local data" and "Sign out" empty everything** this site keeps in the browser (the whole LightningFS, the Cache API, `sessionStorage`, the handoff database); `localStorage` (language, theme, mascot) stays. Both ask first, and name the copies, when something would be lost (changes not on the Git provider, or the extra packages uploaded for all projects). A session that ends by itself (`/auth/logout?expired=1`) deletes nothing.
- `site/carbon.json` and `scripts/fetch_carbon.py` (`mise run carbon`): a snapshot of the site's Website Carbon result for the landing footer. `views/login_page.rs` (`carbon_badge`) validates it and renders the badge in place of `{{CARBON_BADGE}}` in `site/index.html`; nothing from the file reaches the page unescaped, and without a valid file the badge is left out. The visitor's browser never calls websitecarbon.com for it.
- **Display title** (`src/drive/client/title.rs`, `POST /api/project/{id}/title`, `editProjectTitle` in `dashboard_page/script.rs`): kept in the repository description as `NeoLeaf: <title>` (max 80 characters, one line). Only descriptions with that marker count as titles; a description of the person's own is replaced only with `overwrite: true` (the browser asks first). Saving needs admin access to the repository (the provider decides; the pencil is shown to the owner only). The editor reads it with the project name (`project_summary` returns both; `PROJECT_TITLE` is the header and the `<title>`, `PROJECT_NAME` stays the PDF file name). The **Local copy** column of the dashboard is filled by `StorageManager.markProjectList()` from the same LightningFS the Storage tab reads.
- `static/js/editor-toolbar.js`: **text toolbar** (LaTeX and Markdown), between the tabs and the editor: undo and redo, style, bold and italic, math, symbols, link, comment, label and reference, citation, image, table and list; whatever does not fit goes into the "⋯" menu and an "Aa" button hides the bar (remembered in `ld-toolbar-hidden`). Every change goes through the editor (`executeEdits` and `snippetController2`), so Ctrl+Z and live editing keep working. Uploaded images are written by `BrowserGit` to the project's image folder (`images`, `imagens`, `img`, `figures`, `figuras` or `fig`; otherwise it creates `images/`), without overwriting, and `\usepackage{graphicx}` is added if missing.
- `static/js/badness.js`, `static/js/badness-worker.js` and `tools/badness-wasm`: **format, syntax errors and style findings** for LaTeX and BibTeX. Badness (MIT, jolars/badness, commit pinned in `tools/badness-wasm/Cargo.toml`) is compiled to WebAssembly by a shim of ours (`format`, `check`, `fix`; positions leave as UTF-16) and built by `scripts/build_badness_vendor.sh` into `static/vendor/badness-engine.js` and `badness-engine_bg.wasm` (both **committed**; needs the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.129). The worker runs on the open file only; the rules that need the whole project (undefined refs and citations) are inactive there and `autocomplete.js` keeps covering them. `badness.js` registers Monaco's document formatter (minimal edit, so collaborators' cursors survive), underlines findings (owner `badness`, code = rule) with quick fixes, adds the "Fix all style issues" action (safe fixes only) and reads `styleCheck`, `formatWrap` and `formatLineWidth` from `.neoleaf/config.json`. Never run the formatter by itself: it rewrites the person's text. texlab (GPL-3.0) is not to be used.
- `static/js/compile-typst.js`, `static/js/typst-worker.js`, `static/js/typst-language.js`: **Typst** projects (`.typ`, engine id `wasm-typst`). The worker loads `static/vendor/typst-engine.min.js` (typst.ts 0.7.0, rebuilt by `scripts/build_typst_vendor.sh`; `import.meta.url` is replaced so it runs as a classic worker), the compiler `static/typst/typst_ts_web_compiler_bg.wasm` and the fonts in `static/typst/fonts/` (all but `NewCM10-Regular`, which is GPL 3+: the worker downloads it from typst-assets with a pinned SHA-256 and keeps it in the Cache API; **generated and gitignored**: `mise run typst` runs `scripts/fetch_typst_assets.py`, which checks the npm integrity and the git blob hashes; the deploy uploads them; routes `serve_typst` and `serve_typst_font` in `routes/static_files.rs`, immutable cache, so assets are requested with the build `?v=`). `compileWithTypst()` sends text files and bytes to the worker and gets PDF bytes and diagnostics (positions counted from 1); packages come from packages.typst.org in the browser (privacy policy). `recompileLatex` in `pdf-panel.js` dispatches to it when the engine or the main file says Typst; `typst-language.js` is the Monaco language (like ConTeXt's) and `outline.js` and `spellcheck.js` have Typst branches. New Typst project template: `src/templates/typst-article.typ`.
- `static/js/spellcheck.js`, `static/js/spellcheck-worker.js` and `static/js/spellcheck-dicts.js`: **spell check** for LaTeX and Markdown. Hunspell compiled to WebAssembly (`static/vendor/hunspell-asm.min.js`, rebuilt by `scripts/build_spell_vendor.sh`) runs in a Web Worker, so nothing is sent to the server; Monaco markers (`owner: 'spellcheck'`) and code actions (suggestions, add to the project dictionary, ignore in this session). **NeoLeaf hosts no dictionary** (a licensing decision by the owner: do not add dictionary files to the repository, the server or the release archive): `spellcheck-dicts.js` (generated by `python3 scripts/pin_dictionaries.py`) pins the files of `LibreOffice/dictionaries` at a commit with their SHA-256; the browser asks the person (`.spell-banner`, consent kept in `localStorage` `neoleaf.spell.consent.<id>`), downloads from raw.githubusercontent.com (jsDelivr as a mirror), checks size and hash and keeps the bytes in the Cache API (`neoleaf-dictionaries-v1`), never in Git. The worker and its library are requested with the page's `?v=` (a worker cached for hours must never meet a newer page). The dictionary is chosen per document (`chooseLanguage`): the project setting, then the babel/polyglossia language, then the document's most frequent words, then the interface language; a language without a dictionary (Swedish, Russian...) is **not checked**, because the wrong dictionary would underline every word. The project's words live in `.neoleaf/dictionary.txt` (one per line, versioned in Git). A dictionary that fails to load is retried twice, then a notice says why. The German files are ISO-8859-1 and are converted in the worker after the hash check. `nspell` was tried first and cannot load the Portuguese dictionary. To add a language: see the docstring of `scripts/pin_dictionaries.py`.
- `static/js/md-preview.js`: **Preview** tab for Markdown (`.md`, `.markdown`): `marked` + `DOMPurify` (in `static/vendor/`, loaded only the first time) and an `iframe` with `sandbox` without `allow-same-origin` and a content security policy (CSP) with a nonce. Never insert user HTML into the main page.
- `static/js/mermaid-preview.js`: **Preview** tab for Mermaid diagrams (`.mmd`, `.mermaid`): library in `static/vendor/mermaid.min.js` (loaded only the first time, handed to the `iframe` by the page), `iframe` with `sandbox` without `allow-same-origin`, `securityLevel: 'strict'` and a content policy with a nonce; bar with examples and export to SVG and PNG.
- `static/js/csv-preview.js`: **Preview** tab for `.csv` and `.tsv` as a table: PapaParse (`static/vendor/papaparse.min.js`, loaded only the first time) and the table built by hand inside an `iframe` with `sandbox` without `allow-same-origin` and a content policy with a nonce; cells enter only as text. It only previews (editing is in the text); sorting, filter, row limit and "copy as tabular".
- `static/js/bib-complete.js`: **Complete bibliography** in a `.bib` (editor menu: "Complete this entry from its DOI..." and "...all entries..."). `parseEntries` reads entries and the position of each field (braces, quotes, bare values, `#` concatenations left alone); `plan` asks `RefSources` (Crossref, then OpenAlex, three at a time, only the DOI leaves the browser) and builds the changes: `add` (missing field, ticked), `normalize` (pages `--`, a doi written as a link, ticked), `remove` (a url that only repeats the doi, ticked) and `change` (a value that differs, **not ticked**: the person's values are never overwritten without a tick). `buildEdits` edits only those fields in place (layout, comments and citation keys stay; renaming a key would break the `\cite`s). It always shows the window first; never apply without it.
- `static/js/ref-sources.js` and `static/js/references.js`: **References** tab. Each paper source (Crossref, OpenAlex, PubMed, Europe PMC, DOAJ, HAL, Zenodo, OpenAIRE, arXiv, DBLP; Unpaywall for open PDFs) is a module that builds the query and normalizes the result; the first eight and Unpaywall allow CORS and are queried **directly from the browser** (contact `contact@neoleaf.science`). The BibTeX entry and the `\cite` are written by the editor itself (opens the `.bib`, edits, saves and goes back to the file), never by a server route. Third-party text enters only as text (never HTML) and only `http(s)` URLs become links.
- `static/js/notebook.js` and `static/js/notebook-frame.js`: **Jupyter notebooks** (`.ipynb`, nbformat 4). Opening an `.ipynb` in the tree opens a **modal** (darkened background, click outside or ✕ closes; asks for confirmation if the kernel has run) with a tree on the left (only `.ipynb`, data files and images: no `.py`, `.tex` or LaTeX structure; clicking another notebook switches the content saving the current one, and data and images open in a viewer with "Copy path") and, on the right, an `iframe` with `sandbox` (without `allow-same-origin`) and a restricted content policy (no network; only `data:` for images): code cells (light Python highlighting, `In [n]`/`Out [n]` prompts), markdown with formulas (KaTeX, in `static/vendor/katex/`), outputs (text, images, HTML sanitized by DOMPurify, errors with ANSI colors), Jupyter keyboard (command and edit mode) and execution with the Pyodide kernel (`PyRunner.cell`, variables persist across cells; Stop restarts the kernel). The kernel sees the project files (data, images and `.py`, up to 8 MB each and 30 MB in total, sent only when they change) and the working directory is the notebook's folder, as in Jupyter. The file is read and written by `BrowserGit` (autosave, keys in alphabetical order and 1-space indentation like Jupyter; optional "Save without outputs"). **There is no live editing room for `.ipynb`** (it is a single JSON): one person edits at a time. Markdown images with a relative path come from the project; external images are discarded.
- `static/js/py-ui.js`: **Run** tab for `.py` files (the ▶ button and Ctrl+Enter run Python when a `.py` is open): output, errors, figures and "save to the project" (writes through `BrowserGit`, asks before replacing). Only the project's data files (`.py`, `.csv`, `.json`, `.txt`... up to 8 MB each and 30 MB in total) and the folders go into Python; the isolation notice appears on the first run.
- `static/js/py-runner.js`: `PyRunner.run(code, { files })` runs Python with Pyodide in a classic `Worker` inside an `iframe` with `sandbox` without `allow-same-origin` and a content policy that only allows downloading from `/static/pyodide/` (the script does not reach the NeoLeaf API or the internet). Engine and packages come from `static/pyodide/` (generated by `python3 scripts/fetch_pyodide.py`, outside Git) and are downloaded on demand. A module Worker does not load from a blob in an isolated origin; that is why the Worker is classic (`importScripts('pyodide.js')`).
- `static/js/zip.js`: read and write ZIP in the browser (export, import, extra packages).
- **The editor was split into several classic scripts that share the global scope** (no bundler, no ES modules). `static/js/monaco-latex.js` **no longer exists**; its parts are now: `editor-core.js`, `completions-data.js`, `git-status.js`, `git-conflicts.js`, `git-sync.js`, `git-blame.js`, `font-packs.js`, `project-build.js`, `bibliography.js`, `compile-pdflatex.js`, `package-install.js`, `compile-xelatex.js`, `compile-lualatex.js`, `pdf-panel.js`, `editor-ui.js`, `share.js` and `history.js`. The **load order** is the order of the `<script>` tags in `src/views/editor_page.rs`; a script may only use at load time what the ones above it defined. Editor, WASM compilation and panels live in these files; change them with care.
- `static/js/file-tree.js`, `comments.js`, `search.js`, `collab.js`, `agent.js`, `synctex.js`, `pdf-view.js`, etc.
- `static/js/context-language.js` (ConTeXt language: `.mkiv`, `.mkxl`, `.mkvi`) and `static/js/context-index.js` (command index, **generated** by `scripts/build_context_index.py` from ConTeXt's `context-en.xml`; do not edit by hand).

**Server (only what the browser cannot do on its own)**

The server code is organized like this:
- `src/main.rs` **only builds the router** (it registers the routes and starts the server); it holds no handlers.
- The HTTP handlers live in `src/routes/*.rs`: `http.rs`, `static_files.rs`, `pages.rs`, `admin_routes.rs`, `auth_routes.rs`, `catalog_routes.rs`, `project_routes.rs`, `git_proxy.rs` and `lookup_routes.rs`.
- The static files embedded in the binary are listed in `src/assets.rs` (`FILES`), served at `/static/{js,css,vendor,img}/{file}`.

What the server does:
- OAuth authentication and session (`src/auth`, `src/session.rs`).
- **Git proxy** (`/api/git/{owner}/{repo}/...`, in `src/routes/git_proxy.rs`): GitHub does not allow CORS on the Git protocol; the server relays the request adding the session token. It stores nothing.
- **GitHub API proxy** (`src/drive/`): project list, repository creation, topics (trash), invitations, permissions. `DriveClient` lives in `src/drive/client.rs` with its `impl` blocks split by subject in `src/drive/client/` (`models`, `names`, `projects`, `collaborators`, `trash`, `archive`); the public paths `drive::client::*` are re-exported.
- **Live editing relay** (`src/collab.rs`): relays Yjs updates between people; the text stays only in memory.
- **Package proxy** (`/api/ctan/package` and `/api/ctan/resolve`, `src/ctan/`: `index`, `cache`, `fetch`, `sanitize`, `resolve`): downloads the package from CTAN/TeX Live and
  returns the files to the browser, which stores them in `.neoleaf/texmf/`. Stateless, no disk.
- **Paper search proxy** (`GET /api/scholar?source=arxiv|dblp`, `src/scholar.rs`): arXiv and DBLP do not allow CORS. The host is fixed (built on the server; the client only provides source, text, limit and page), requires a session, limits text (300 characters), page, response size (2 MB), time (20 s) and requests per person (30 per minute, in memory only), `no-store`, no query logging. Tests swap the hosts through `SCHOLAR_ARXIV_URL` and `SCHOLAR_DBLP_URL`.
- **Template catalog** (`src/catalog.rs`, routes in `src/routes/catalog_routes.rs`): `GET /api/templates` (public, active ones only), `/api/admin/templates` (list, `save`, `delete`, `check`) and the `GET /api/templates/{id}/zip` proxy. The browser uses `ProjectImport.startFromModel` (creates the empty repository, extracts the ZIP, writes to the clone, commit and push).
- **Pyodide files** (`GET /static/pyodide/{file}`): only public files from `static/pyodide/`, streamed, with `Content-Encoding: identity` (the server's compression layer cut the streamed response) and `Access-Control-Allow-Origin: *` (Python runs in an isolated origin).
- Static files, pages, admin, agent downloads.
- **Pages** (`src/views/`): each page is a short `render()` that joins small block functions (head, top bar, modals, script...); the large static HTML, CSS and JS text blocks live in sibling modules (`<page>/shell.rs`, `style.rs`, `script.rs`, `modals.rs`, `layout.rs`). The produced HTML must not change when you reorganise them: compare the output before and after.

**Local agent** (`agent/`, binary `neoleaf-agent`)
- Compiles with the TeX Live/TinyTeX on the person's machine. Listens only on `127.0.0.1:47474`, accepts only NeoLeaf origins and requires pairing. See `agent/README.md`. Source layout (`agent/src/`): `main.rs` (entry point), `cli.rs` (subcommands), `agent.rs` (server startup), `http.rs` (routing, CORS and origin checks), `compile.rs` (the compile pipeline), `project.rs` (blob cache and safe paths), `engines.rs`, `packages.rs`, `texlog.rs`, `pairing.rs`, `desktop.rs` (notifications, clipboard), `config.rs`, plus `auth`, `fonts`, `net`, `service`, `tinytex`, `tlmgr`, `tray*` and `updater`.

### Current state

The migration is done: the server **stores nobody's projects**. On startup it deletes the old copies
(`~/.cache/neoleaf/repos`), no exceptions. What exists on the server for projects is just stateless proxy:

- Git (`/api/git/...`), GitHub API (`src/drive/client/`), GitHub ZIP (`/api/project/{id}/github-zip`),
  CTAN/TeX Live packages (`/api/ctan/*`) and the live editing relay (`src/collab.rs`, memory only).
- The `/project/{id}` page is just the shell: the server checks access and the name on GitHub; tree, files and content
  come from the local clone.
- Creating a new project and importing a ZIP: the server creates the **empty repository** on GitHub (`/api/project/create` and
  `create-empty`); the browser prepares the files (`static/js/project-import.js`), hands them to the editor through IndexedDB
  (`static/js/project-handoff.js`), which writes to the clone, commits and pushes.
- **There is no demo mode.** The server has no project, not even a fake one. To develop and test without a GitHub
  account, use the **fake GitHub** (`tests/fake-github/server.ts`: REST API, OAuth and Git through `git http-backend`),
  which the server reaches through `GITHUB_API_URL` and `GITHUB_WEB_URL`. It only runs in the tests (`mise run test:e2e`) and in
  `mise run dev:fake`; it never goes to production.

Protection against data loss (already done): a clone that fails does **not** become an empty repository (it shows the error, blocks
editing and offers "Try again"; only a repository with no commits on GitHub starts an empty local clone); a clone stuck
empty from old versions is redone keeping a ZIP of whatever exists; the browser is asked not to erase the data
(`navigator.storage.persist()`); and after 10 minutes with unpushed work a warning appears with "Push now".

### Providers (GitHub and Codeberg)

Each session belongs to **one provider** (`src/provider.rs`: `Provider::GitHub`, the default, or `Provider::Codeberg`, a Forgejo), chosen
at login (`/auth/login` and `/auth/login/codeberg`). The provider goes in `GitHubUser.provider` (old users without the field are GitHub ones).
- `DriveClient::for_session(&session)` talks to the right service; paths are written like GitHub's and `u()` swaps the prefix for
  `<codeberg>/api/v1`. Forgejo differences handled in the client: tags in `topics` (GitHub: `names`), repository list without tags
  (one call per repository), collaborator joins directly (no invitation; role through `/collaborators/{u}/permission`), ZIP in `archive/<ref>.zip`.
- The Git proxy uses the address of the session's provider (`git_web`) and the `login:token` authentication (GitHub: `x-access-token:token`).
- The Codeberg token expires: `session::active()` renews it with the `refresh_token`; if that fails, the session is ended.
- Editing rooms and the local clone folder (`codeberg.<owner>`) include the provider, so identical owner/repo on the two services do not get mixed.
- Blocking (`blocked.json`) applies per provider. **Administration only for GitHub**: `is_admin` is false for Codeberg sessions.
- **Who is an administrator** (`src/admin.rs`, `is_admin`): set `ADMIN_GITHUB_IDS` (comma-separated numeric GitHub ids). When it is set and not empty, admin means provider GitHub and an id in the list, and the login/e-mail rules (including `ADMIN_EMAILS`) are ignored. Without it only `ADMIN_EMAILS` applies (login or e-mail can change hands) and the server prints one warning at startup. Never put real ids in `.env.example` or in documents.
- **Sessions** (`src/session.rs`): at most 8 per person (provider + numeric id; `MAX_SESSIONS_PER_USER`), the next sign-in evicts that person's own oldest; the 2000 global cap is only a last resort and takes from whoever holds the most. A Codeberg token refresh is serialized per session (the refresh token is single use); only a definitive refusal (HTTP 400/401 with an OAuth error, except `invalid_client`) ends the session, a transient failure (network, timeout, 5xx) keeps it and answers "not signed in" for that request only. The session expires 30 days after sign-in (absolute, not by inactivity). Cookies are `Secure` unless `REDIRECT_URI` starts with `http://localhost` or `http://127.0.0.1`. `GET /auth/logout` stays only for the interface's sign-out links; `POST /auth/logout` does the same.
- Codeberg only appears at login if `CODEBERG_CLIENT_ID` and `CODEBERG_CLIENT_SECRET` are set (`CODEBERG_URL` changes the instance;
  `CODEBERG_REDIRECT_URI`, by default `<REDIRECT_URI>/codeberg`). In the tests, `tests/fake-github/server.ts` also answers as Codeberg at `/api/v1`.
- **It was only verified against the fake server.** The OAuth app still has to be registered on Codeberg and tested for real (in particular the
  Git Basic authentication with the OAuth token).

---

## 3. Project objects (glossary)

- **Project**: a GitHub repository of the person with the `neoleaf` topic. Internal id `owner__repo` (two underscores).
- **File / tree**: repository files. A relative path (`sections/intro.tex`) is the identifier in the browser.
- **`.neoleaf/`** (inside the repository, versioned in Git):
  - `config.json`: main file (`mainFile`), default engine, automatic sync.
  - `comments.json`: comment threads (`rev`, `threads`). Should only exist when there are comments.
  - `history.json`: authorship (who wrote how much).
  - `milestones/`: milestones (named snapshots).
  - `texmf/`: the project's extra packages.
  - `last.*` (PDF, synctex, bbl): **local only**, ignored by `.gitignore` (`.neoleaf/last.*`).
- **Template**: starter template (`src/templates/*.tex`). **Only used when creating a project from scratch.** Never as
  fallback content when opening, importing, failing a read or creating an editing room (fake text would be written
  over the real file; this has already happened).
- **Session**: `sid` cookie plus the GitHub token kept on the server.
- **Room (live editing)**: one per **project + file**. The key is always the pair; the path alone is not enough (it already caused
  text leaking between projects).
- **Participant (peer)**: person connected to a room (name, email, avatar, cursor).
- **Engine**: `wasm-texlive` (pdfLaTeX), `wasm-xelatex`, `wasm-lualatex`, `agent-*` (local agent). There is no engine on the server.
- **Agent / pairing**: the local `neoleaf-agent`; the browser asks for a code and receives a pairing token.
- **Milestone**: named snapshot of the project.
- **Blocked**: person blocked by the admin (GitHub id), in `blocked.json`.

---

## 4. How to do things without storing anything on the server

### 4.1 Project data: do it in the browser
- Read and write files: `BrowserGit.readFile`, `writeFile`, `deleteFile`, `listFiles` (LightningFS at `/repos/<owner>/<repo>`).
- Metadata (`comments.json`, `config.json`, `history/<person>.json`, milestones, texmf): files in `.neoleaf/` read and
  written by the browser, versioned in Git and sent in the push. Authorship uses **one file per person** so two
  collaborators never conflict on the same file. The "global" configuration and preferences stay in `localStorage`;
  global extra packages, in the browser's storage (`/global-texmf`).
- Compile: gather the files from `BrowserGit` (plus the editor's unsaved text) and hand them to the WASM engine or the agent.
- Export: GitHub ZIP (`archive/refs/heads/<branch>.zip`) when possible; otherwise build the ZIP in the browser.
- Import: read the ZIP in the browser, create the empty repository through the API (proxy), write the files to `BrowserGit`,
  commit and push through the Git proxy.

### 4.2 When the browser cannot reach it: stateless proxy on the server
Use a proxy **only** when the browser cannot (CORS, a token that cannot go to the client, a domain that does not allow the origin).
Rules for a proxy:

1. **Stateless and no disk.** Stream the response; do not write it to a file or a process cache.
2. **Allowlist of destinations.** Never relay to a URL coming from the client without validating it against an allowlist
   (e.g. `github.com`, `api.github.com`, known CTAN/TeX Live hosts). Validate owner/repo (`..`, slashes).
3. **Session authentication** on every route (`get_session`); without a session, 401. The GitHub token is added by the server.
4. **Per-project authorization**: confirm with GitHub that the person has access (`DriveClient::project_access`) before
   operating on a project.
5. **Limits**: maximum body size, timeout, number of requests.
6. **Headers**: `Cache-Control: no-store`; relay only the necessary headers; never return the token.
7. **No content logging.** Log at most method, route and status. Tokens and URLs with credentials are masked (`***`).

Existing example to follow: `/api/git/{owner}/{repo}/info/refs`, `git-upload-pack`, `git-receive-pack` in `src/routes/git_proxy.rs`.

### 4.3 Live editing (in-memory relay)
- Protocol in `src/collab.rs`: WebSocket with binary Yjs messages (`[1] + update`) and JSON (`hello`, `join`, `leave`, `aw`).
- The room is per project + file and **is born empty**. Whoever joins first seeds the text from their `BrowserGit`;
  the others receive the state from the relay. Never read the text from the server/disk nor use a template to seed.
- Saving is local: each browser writes to its own `BrowserGit` (with debounce) and commits/pushes in its own way.
- The room disappears when the last participant leaves. Access: `project_access` (GitHub) on every connection; without access, 403.
- The WebSocket `Origin` must be the same host as the app.

### 4.4 Git in the browser (how it works today)
- Shallow clone (`depth: 1`) through the Git proxy.
- `BrowserGit.clone()` first asks the server (`remoteIsEmpty`): a network or access failure throws `CloneError` and cleans everything; only a
  really empty repository creates a new local clone. Never start an empty repository to "work around" an error.
- `BrowserGit.compare()` does a fetch and computes incoming and outgoing commits and files.
- **Automatic pull on open**: only if there is no changed file on both sides; notifies by toast. Otherwise, it only warns.
- Pull and push go through modals that show commits, files and diff. Push pulls first if GitHub has new commits.
- **Reset**: GitHub overwrites the local copy (`BrowserGit.resetToRemote`).
- Durability is GitHub: "unpushed work" warnings and persistent browser storage are expected.

---

## 5. Security and privacy

- **Validate every identifier that enters a URL.** Path parameters arrive percent-decoded (`%2F`, `..`, `?`, `#` reach the handlers as real characters). Use `src/ids.rs` (`valid_project_id`, `valid_owner`, `valid_repo`, `valid_permission_id`, `valid_login`, `valid_file_path`) before using a project id, an owner, a repository, a collaborator name or a file path; the `need_project!` macro already does it for project ids.
- **Limits that exist, keep them when you change the code:** the live-edit relay refuses documents over `MAX_DOC_BYTES`, has a per-connection byte budget, at most 10 connections per person, an access re-check every 30 s (`COLLAB_RECHECK_SECS`), and never sends e-mails to other peers; the Git proxy streams, has timeouts, a per-person concurrency limit and answers CORS only for its own origin; `/api/ctan/*` (240 calls a minute: a big template needs many) and `/api/scholar` (30) are rate limited per person, and answer 429 or 503 with `Retry-After`, which the browser waits for and retries (`ctan()` in `project-store-texmf.js`); sessions are capped per person (`MAX_SESSIONS_PER_USER`).
- **Admin** is decided by `ADMIN_GITHUB_IDS` (numeric GitHub ids) when it is set; otherwise by the logins or e-mails in `ADMIN_EMAILS` (a warning is printed at startup; there is no built-in administrator). Always set `ADMIN_GITHUB_IDS` in production.

- Never put the GitHub token in a log, error message, HTML or client JavaScript.
- Every route that acts on a project checks the session **and** access to the repository.
- External inputs (project id, file path) are validated against `..`, slashes and control characters.
- Do not write text that claims legal compliance (LGPD etc.). Describe what the system does, precisely, without certifying.
- Account deletion: erases only what NeoLeaf stores (the session); it does **not** delete GitHub repositories.
- Do not access production (SSH, reads on the server) unless the owner asks or authorizes it at that moment.

---

## 6. How to work in this repository

### Repository layout
- The application is this folder. Run development commands from here.

### Commands (`mise`)
- `cargo run` / `mise run dev`: local server at `http://localhost:3000` (needs the GitHub OAuth keys in `.env`).
- `mise run dev:fake`: local server **without a GitHub account**, with the fake GitHub (sign in with the GitHub button: you become `demo`).
- `mise run test:e2e`: browser tests (Playwright with `bun`), test server on port 3001, temporary workspace.
- `cd agent && cargo test`: agent tests. `mise run test` runs the server's Rust tests.
- `tools/windows-vm/`: a Windows 10 LTSC inside a container (dockur/windows, QEMU with KVM) to test the agent on Windows; see the folder's `README.md`.

### Code conventions
- Rust: Topcoat routes must be registered in `main()` with `.route(my_function)`; otherwise they return 404. Handlers live in `src/routes/*.rs`; `src/main.rs` only builds the router.
- Static files are embedded in the binary: they need a rebuild (`cargo build`) to show changes.
- Do not create new routes that read or write project files. What the browser needs from the project it reads from `BrowserGit`.
- **Adding a static JS/CSS/vendor/image file:** add one line to `FILES` in `src/assets.rs` (the file is then served at `/static/{js,css,vendor,img}/{file}`), plus, for a script of the editor, its `<script>` tag in `src/views/editor_page.rs` in the right place of the load order. No new route function is needed.
- Plain JavaScript, no bundler. The editor scripts are classic scripts sharing the global scope (see section 2); do not turn them into ES modules without talking to the owner. Interface texts go through `T('...')` (i18n in `static/js/i18n.js` and one `static/js/i18n-<code>.js` per language).
- `mise.toml`: inside TOML strings avoid backslashes (use `\\n` in `printf`); a TOML error breaks `mise`.
- Do not use `pkill -f` with patterns that match your own shell.

### Language and text style
- **All text in the repository is English**: code, identifiers, comments, documentation and commit messages.
- **English is the source language of the interface.** Every other language is a translation, kept in its own file `static/js/i18n-<code>.js` (today `pt`, `es`, `zh`, `cs`, `fr`, `de`, `sv`, `tr`, `it`, `nb`, `ru`, `da`, `ko`, `ja`) as `"English text": "translation"` entries, **keyed by the English text** (the English string used in the code must be exactly the key; the matcher only normalizes whitespace; a text with `{0}`, `{1}`... placeholders is matched as a pattern). Only the file of the language in use is loaded (written synchronously while the page is parsed, so nothing flashes in English; `LDI18n.setLang` loads another one on demand). A new interface string gets an entry in **every** language file (the test `i18n-complete` fails if a language lacks a key, has an empty text or different placeholders, or leaves interface text in English on the dashboard or the editor). The only texts a language may lack are those of the privacy policy and the terms, which exist only in English, Portuguese, Spanish and Chinese (`LEGAL_LANGS` in `i18n.js`; the other languages show the English text and the `#legal-lang-note` notice). The 11 languages added in 1.18.0 are machine translations (one translator agent per language, with a glossary and a validator that checks placeholders, HTML tags, new lines and the em dash); a string without a translation falls back to English. A new language is a new file plus an entry in the language table of `i18n.js` and in `src/assets.rs`.
- **Do not use the em dash "—"** in any new text (answers, interface, comments, commits). Use a comma, colon, parentheses or a period.
- Code comments short, explaining the why, in the style of the surrounding file.

### Tests
- Every architecture bug gets a test that **fails before and passes after** (see `tests/e2e/specs/collab-rooms.test.ts`).
- The E2E tests use the fake GitHub (`tests/fake-github/server.ts`), which exercises the Git proxy and the API for real; it does not reproduce
  everything about real GitHub (limits, error messages, organizations): say so when reporting what only real GitHub validates.
- Run the whole suite before asking for a commit.

### System version
- The system has its own version in the format `MAJOR.MINOR.PATCH`, in `Cargo.toml` (`version` field). **1.0.0** was tagged on 2026-10-14.
- **Every delivered change bumps the version, in the same commit:** a bug fix, `PATCH` (1.0.0 to 1.0.1); a new feature, `MINOR` (1.0.1 to 1.1.0, resetting the patch); a change that breaks something the person uses or changes the architecture, `MAJOR`.
- In the same commit: update `Cargo.lock` (a `cargo build` does it) and, when the owner asks for the deploy, create the tag `vX.Y.Z` on the commit (`git tag vX.Y.Z` and `git push --tags`).
- The running version appears at the top of the admin panel (`v1.0.0`). The **local agent's** version is separate (`agent/Cargo.toml`).

### Workflow with the project owner
1. **Architecture decisions are discussed first.** Do not implement a big change without aligning.
2. **Commit, push and deploy only when the owner asks** ("do it", "yes", "push and deploy"). Do not do them on your own.
3. Commit messages in the format `type: summary` (`feat`, `fix`, `visual`, `chore`, `refactor`), in English.
4. Report honestly what was and was **not** verified (for example, the macOS and Windows agents were only compiled, not run).
5. If you find a serious problem outside the scope, tell the owner instead of going ahead.

### Known pitfalls
- Two places with the same data (server and browser) diverge. It was the origin of serious bugs; hence rule 1.
- A room key by path only mixes projects. Always use project + file.
- A template as the "default value" of a failed read overwrites the real file.
- Cloning a large repository takes time: while it downloads, `window.__cloning` stays on, a blue notice shows progress and `Project` (compile, settings) answers "still being downloaded" instead of "local project not available". A failure to prepare storage (for example IndexedDB blocked in a private window) shows the reason in the red notice. `window.__projectWaitMs` (default 90000) shortens the wait in the tests.
- `editor.setValue` with live editing active propagates to the other participants: never load content from another project into the editor attached to a room.

---

## 7. Checklist before delivering a change

- [ ] No project content starts being stored, cached or logged on the server.
- [ ] New routes have a session, per-project authorization, limits and `no-store`.
- [ ] Nothing uses the template as a fallback (creation from scratch only).
- [ ] Rooms and caches on the client are keyed by project.
- [ ] New text in English without em dashes; interface strings through `T()` with their entry in every `static/js/i18n-<code>.js`.
- [ ] New tests (fail before, pass after) and the full E2E suite passing.
- [ ] The report says what was verified and what was not.
- [ ] No commit, push or deploy unless the owner asks.
